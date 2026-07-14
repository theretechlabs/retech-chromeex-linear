import { buildComment, formatElapsed } from './lib/format'
import { createComment, resolveIssue } from './lib/linear'
import {
  clearTimer,
  getSettings,
  getTimer,
  setTimer,
  timerElapsedMs,
  type PauseReason,
  type Settings,
  type TimerState
} from './lib/storage'

const BADGE_ALARM = 'badge'
const REMINDER_ALARM = 'reminder'
/** Segmento mais curto que isso não vira comentário no Linear (evita spam), mas conta no total local. */
const MIN_SEGMENT_MS = 60_000

type Message =
  | { type: 'GET_STATE' }
  | { type: 'START'; identifier: string }
  | { type: 'STOP' }
  | { type: 'RESUME' }
  | { type: 'ENROLL_FACE'; image: string }
  | { type: 'UNENROLL_FACE' }
  | { type: 'GET_ENROLLMENT' }

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  handle(msg)
    .then(sendResponse)
    .catch((e: unknown) =>
      sendResponse({ error: e instanceof Error ? e.message : String(e) })
    )
  return true // resposta assíncrona
})

async function handle(msg: Message): Promise<unknown> {
  switch (msg.type) {
    case 'GET_STATE':
      return { timer: await getTimer() }
    case 'START':
      return startTimer(msg.identifier)
    case 'STOP':
      return stopTimer()
    case 'RESUME':
      return { timer: await resumeTimer('manual') }
    case 'ENROLL_FACE':
      return enrollFace(msg.image)
    case 'UNENROLL_FACE':
      return agentRequest({ type: 'unenroll' })
    case 'GET_ENROLLMENT':
      return agentRequest({ type: 'get_enrollment' })
  }
}

async function startTimer(identifier: string) {
  const settings = await getSettings()
  if (!settings.apiKey) {
    throw new Error('Configure sua API key do Linear no ícone da extensão')
  }

  // Um timer por dev: play em outra issue encerra e registra a anterior.
  const existing = await getTimer()
  if (existing && existing.identifier === identifier) {
    // Play na mesma issue: se estava pausado, retoma (verifica o rosto lá); rodando é no-op.
    if (existing.status === 'paused') return { timer: await resumeTimer('manual'), previous: null }
    return { timer: existing, previous: null }
  }

  // Reconhecimento antes de qualquer efeito (não encerra o timer anterior à toa).
  await verifyIdentity(settings)

  let previous: TimerState | null = null
  if (existing) {
    // Segmento pausado já foi registrado no pause; só o rodando precisa de comentário.
    if (existing.status === 'running') await postSegment(existing, settings, Date.now())
    previous = existing
  }

  const issue = await resolveIssue(settings.apiKey, identifier)
  const now = Date.now()
  const timer: TimerState = {
    issueId: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    startedAt: now,
    status: 'running',
    segmentStartedAt: now,
    accumulatedMs: 0,
    pausedAt: null,
    pauseReason: null
  }
  await setTimer(timer)
  await scheduleAlarms(settings)
  applyIdleInterval(settings)
  ensureAgentConnection(settings)
  await updateBadge()
  return { timer, previous }
}

async function stopTimer() {
  const timer = await getTimer()
  if (!timer) return { stopped: null }

  const settings = await getSettings()
  const now = Date.now()
  let totalMs = timer.accumulatedMs
  if (timer.status === 'running') {
    // Comentário primeiro: se a API falhar, o timer continua rodando.
    await postSegment(timer, settings, now)
    totalMs += now - timer.segmentStartedAt
  }
  // Pausado: segmento atual já foi registrado no momento do pause.
  await clearTimer()
  await chrome.alarms.clear(BADGE_ALARM)
  await chrome.alarms.clear(REMINDER_ALARM)
  closeAgentConnection()
  await updateBadge()
  return { stopped: timer, durationMs: totalMs }
}

async function pauseTimer(reason: PauseReason): Promise<TimerState | null> {
  const timer = await getTimer()
  if (!timer || timer.status !== 'running') return timer
  const settings = await getSettings()
  const now = Date.now()
  const segmentMs = now - timer.segmentStartedAt
  // Comentário primeiro: se a API falhar, segue rodando e o próximo tick tenta de novo.
  if (segmentMs >= MIN_SEGMENT_MS) {
    try {
      await postSegment(timer, settings, now)
    } catch {
      return timer
    }
  }
  const paused: TimerState = {
    ...timer,
    status: 'paused',
    accumulatedMs: timer.accumulatedMs + segmentMs,
    pausedAt: now,
    pauseReason: reason
  }
  await setTimer(paused)
  await updateBadge()
  return paused
}

async function resumeTimer(trigger: 'auto' | 'manual'): Promise<TimerState | null> {
  const timer = await getTimer()
  if (!timer || timer.status !== 'paused') return timer
  if (trigger === 'manual') {
    // Retomar manual também exige ser o dev cadastrado na frente da câmera.
    await verifyIdentity(await getSettings())
    // Verificado (ou sem agente): confia até o agente/idle dizerem o contrário.
    facePresent = null
  }
  const resumed: TimerState = {
    ...timer,
    status: 'running',
    segmentStartedAt: Date.now(),
    pausedAt: null,
    pauseReason: null
  }
  await setTimer(resumed)
  await updateBadge()
  return resumed
}

async function postSegment(timer: TimerState, settings: Settings, endMs: number): Promise<void> {
  const body = buildComment(new Date(timer.segmentStartedAt), new Date(endMs))
  await createComment(settings.apiKey, timer.issueId, body)
}

// ---------------------------------------------------------------------------
// Presença: idle (teclado/mouse) + agente de câmera + aba da issue aberta.
// ---------------------------------------------------------------------------

/** Último estado reportado pelo agente de câmera; null = agente desligado/desconectado. */
let facePresent: boolean | null = null
/** Reconhecimento facial do agente; null = sem cadastro/reconhecimento off. */
let agentRecognized: boolean | null = null
/** Prova de vida do agente; false = rosto presente mas sem piscada recente. */
let agentLive: boolean | null = null
/** Rostos no último payload do agente (distingue "ausente" de "não reconhecido"). */
let lastAgentFaces = 0
let agentSocket: WebSocket | null = null

let evaluating = false

/**
 * Reavalia todas as condições e transiciona o timer.
 * Prioridade do motivo exibido: idle > sem rosto > aba fechada.
 * Serializado: avaliações concorrentes (idle event + alarm) poderiam
 * postar o mesmo segmento duas vezes.
 */
async function evaluatePresence(): Promise<void> {
  if (evaluating) return
  evaluating = true
  try {
    await evaluatePresenceInner()
  } finally {
    evaluating = false
  }
}

async function evaluatePresenceInner(): Promise<void> {
  const timer = await getTimer()
  if (!timer) return
  const settings = await getSettings()
  if (!settings.autoPause) return

  const idleSeconds = Math.max(15, Math.round(settings.idleMinutes * 60))
  const idleState = await chrome.idle.queryState(idleSeconds)
  const tabOpen = settings.requireIssueTab ? await issueTabOpen(timer.identifier) : true

  // Rosto na câmera: estranho → "não reconhecido"; dev sem piscar ainda
  // (pós-ausência) → "pisque para a câmera"; sem rosto → "ausente".
  const faceReason: PauseReason =
    lastAgentFaces > 0
      ? agentRecognized === false
        ? 'unrecognized'
        : agentLive === false
          ? 'no-blink'
          : 'no-face'
      : 'no-face'

  const reason: PauseReason | null =
    idleState !== 'active'
      ? 'idle'
      : facePresent === false
        ? faceReason
        : !tabOpen
          ? 'no-tab'
          : null

  if (timer.status === 'running' && reason) {
    const paused = await pauseTimer(reason)
    if (paused?.status === 'paused' && settings.soundEnabled)
      void playSound(reason === 'unrecognized' ? 'unrecognized' : 'pause')
  } else if (timer.status === 'paused' && !reason) {
    const resumed = await resumeTimer('auto')
    if (resumed?.status === 'running' && settings.soundEnabled) void playSound('resume')
  } else if (timer.status === 'paused' && reason && reason !== timer.pauseReason) {
    // Já pausado mas o motivo mudou (ex.: estranho sentou depois que o dev
    // saiu): atualiza o rótulo no widget/popup e avisa com voz na transição
    // para "não reconhecido".
    await setTimer({ ...timer, pauseReason: reason })
    if (reason === 'unrecognized' && settings.soundEnabled) void playUnrecognizedThrottled()
  }
}

/** Voz de "rosto não reconhecido" no máx 1x/30s: detecção de rosto oscila
 * (0↔1 rostos) e cada reentrada no motivo tocaria a voz de novo. */
let lastUnrecognizedSoundAt = 0
function playUnrecognizedThrottled(): void {
  const now = Date.now()
  if (now - lastUnrecognizedSoundAt < 30_000) return
  lastUnrecognizedSoundAt = now
  void playSound('unrecognized')
}

async function issueTabOpen(identifier: string): Promise<boolean> {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://linear.app/*' })
    const re = new RegExp(`/issue/${identifier}([/?#]|$)`, 'i')
    return tabs.some((tab) => re.test(tab.url ?? ''))
  } catch {
    // Sem permissão/erro de query não pode travar o timer.
    return true
  }
}

chrome.idle.onStateChanged.addListener(() => void evaluatePresence())
chrome.tabs.onRemoved.addListener(() => void evaluatePresence())
chrome.tabs.onUpdated.addListener((_tabId, info) => {
  if (info.url) void evaluatePresence()
})

function applyIdleInterval(settings: Settings): void {
  chrome.idle.setDetectionInterval(Math.max(15, Math.round(settings.idleMinutes * 60)))
}

// Settings salvos no popup mudam o intervalo de idle e o estado do agente.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return
  void getSettings().then((settings) => {
    applyIdleInterval(settings)
    if (settings.agentEnabled) ensureAgentConnection(settings)
    else closeAgentConnection()
    void evaluatePresence()
  })
})

// ---------------------------------------------------------------------------
// Agente de câmera: WebSocket local (retech-presence-agent).
// O agente envia {type:'presence', present:boolean} em toda mudança + heartbeat
// a cada ~20s, o que também mantém o service worker vivo enquanto conectado.
// ---------------------------------------------------------------------------

function ensureAgentConnection(settings: Settings): void {
  if (!settings.agentEnabled) return
  if (
    agentSocket &&
    (agentSocket.readyState === WebSocket.OPEN ||
      agentSocket.readyState === WebSocket.CONNECTING)
  ) {
    return
  }
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${settings.agentPort}`)
    agentSocket = ws
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as AgentMessage
        if (msg.type === 'presence' && typeof msg.present === 'boolean') {
          const faces = typeof msg.faces === 'number' ? msg.faces : 0
          const changed =
            facePresent !== msg.present ||
            agentRecognized !== (msg.recognized ?? null) ||
            agentLive !== (msg.live ?? null) ||
            (lastAgentFaces > 0) !== (faces > 0)
          facePresent = msg.present
          agentRecognized = msg.recognized ?? null
          agentLive = typeof msg.live === 'boolean' ? msg.live : null
          lastAgentFaces = faces
          if (changed) void evaluatePresence()
        } else if (typeof msg.id === 'string') {
          // Resposta de enroll/unenroll/get_enrollment.
          const resolve = pendingAgentRequests.get(msg.id)
          if (resolve) {
            pendingAgentRequests.delete(msg.id)
            resolve(msg)
          }
        }
      } catch {
        // Mensagem inválida do agente é ignorada.
      }
    }
    ws.onclose = () => {
      if (agentSocket === ws) {
        agentSocket = null
        // Agente fora do ar não pode manter o timer pausado por 'no-face'.
        facePresent = null
        agentRecognized = null
        agentLive = null
        lastAgentFaces = 0
        void evaluatePresence()
      }
    }
    ws.onerror = () => ws.close()
  } catch {
    agentSocket = null
  }
}

function closeAgentConnection(): void {
  const ws = agentSocket
  agentSocket = null
  facePresent = null
  agentRecognized = null
  agentLive = null
  lastAgentFaces = 0
  ws?.close()
}

// ---------------------------------------------------------------------------
// RPC com o agente: enroll/unenroll/get_enrollment sobre o mesmo WebSocket.
// ---------------------------------------------------------------------------

interface AgentMessage {
  type?: string
  present?: boolean
  faces?: number
  live?: boolean
  recognized?: boolean | null
  id?: string
  ok?: boolean
  error?: string
  enrolled?: boolean
  available?: boolean
}

const pendingAgentRequests = new Map<string, (msg: AgentMessage) => void>()

async function agentRequest(payload: Record<string, unknown>): Promise<AgentMessage> {
  const settings = await getSettings()
  if (!settings.agentEnabled) {
    throw new Error('Ative o agente de câmera nas configurações primeiro')
  }
  ensureAgentConnection(settings)
  // Espera a conexão abrir (até 3s); agente parado falha rápido com erro claro.
  const deadline = Date.now() + 3000
  while (agentSocket?.readyState !== WebSocket.OPEN) {
    if (!agentSocket || Date.now() > deadline) {
      throw new Error('Agente offline — inicie o presence agent e tente de novo')
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  const id = crypto.randomUUID()
  const socket = agentSocket
  return new Promise<AgentMessage>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingAgentRequests.delete(id)
      reject(new Error('Agente não respondeu (timeout)'))
    }, 10_000)
    pendingAgentRequests.set(id, (msg) => {
      clearTimeout(timeout)
      resolve(msg)
    })
    try {
      socket.send(JSON.stringify({ ...payload, id }))
    } catch (e) {
      clearTimeout(timeout)
      pendingAgentRequests.delete(id)
      reject(e instanceof Error ? e : new Error(String(e)))
    }
  })
}

/**
 * Reconhecimento facial no play/resume MANUAL: com agente ativo e rosto
 * cadastrado, o timer só inicia depois de o agente reconhecer o dev (espera
 * até ~6s por um match fresco). Permissivo por decisão: agente desligado,
 * offline ou sem cadastro deixa iniciar — consistente com o auto-pause, que
 * também não trava o timer com o agente fora do ar.
 */
async function verifyIdentity(settings: Settings): Promise<void> {
  if (!settings.agentEnabled) return
  let result: AgentMessage
  try {
    result = await agentRequest({ type: 'verify' })
  } catch {
    // Agente offline não bloqueia o play.
    return
  }
  if (result.recognized === false) {
    if (settings.soundEnabled) void playSound('unrecognized')
    throw new Error('Rosto não reconhecido — olhe para a câmera e tente de novo')
  }
}

const ENROLL_ERRORS: Record<string, string> = {
  no_face: 'Nenhum rosto encontrado na foto — use uma foto frontal e bem iluminada',
  multiple_faces: 'Mais de um rosto na foto — envie uma foto só sua',
  decode_error: 'Não consegui ler a imagem — tente outra foto (JPEG/PNG)',
  recognition_unavailable: 'Agente sem modelos de reconhecimento (veja o log do agente)'
}

async function enrollFace(image: string): Promise<{ ok: true }> {
  const result = await agentRequest({ type: 'enroll', image })
  if (!result.ok) {
    throw new Error(ENROLL_ERRORS[result.error ?? ''] ?? `Falha no cadastro (${result.error})`)
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Voz de pause/play: SW MV3 não tem DOM, então o áudio toca num offscreen
// document (Chrome fecha sozinho ~30s após o áudio terminar).
// ---------------------------------------------------------------------------

let creatingOffscreen: Promise<void> | null = null

async function ensureOffscreen(): Promise<void> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT]
  })
  if (contexts.length > 0) return
  // Single-flight: só pode existir um offscreen document por extensão.
  creatingOffscreen ??= chrome.offscreen
    .createDocument({
      url: 'src/offscreen/index.html',
      reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
      justification: 'Aviso sonoro ao pausar/retomar o timer automaticamente'
    })
    .catch(() => undefined)
    .finally(() => {
      creatingOffscreen = null
    })
  await creatingOffscreen
}

async function playSound(sound: 'pause' | 'resume' | 'unrecognized'): Promise<void> {
  try {
    await ensureOffscreen()
    await chrome.runtime.sendMessage({ type: 'PLAY_SOUND', sound })
  } catch {
    // Sem offscreen/sem mp3 não pode afetar o timer.
  }
}

// ---------------------------------------------------------------------------

async function scheduleAlarms(settings: Settings): Promise<void> {
  const period = Math.max(5, settings.reminderMinutes || 60)
  chrome.alarms.create(BADGE_ALARM, { periodInMinutes: 1 })
  chrome.alarms.create(REMINDER_ALARM, {
    delayInMinutes: period,
    periodInMinutes: period
  })
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === BADGE_ALARM) {
    void updateBadge()
    void evaluatePresence()
    // Reconecta o agente se caiu (service worker pode ter reiniciado).
    void getTimer().then(async (timer) => {
      if (timer) ensureAgentConnection(await getSettings())
    })
  }
  if (alarm.name === REMINDER_ALARM) void sendReminder()
})

async function updateBadge(): Promise<void> {
  const timer = await getTimer()
  if (!timer) {
    await chrome.action.setBadgeText({ text: '' })
    return
  }
  const minutes = Math.floor(timerElapsedMs(timer) / 60_000)
  const text =
    minutes < 60
      ? `${minutes}m`
      : `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`
  await chrome.action.setBadgeText({ text })
  await chrome.action.setBadgeBackgroundColor({
    color: timer.status === 'paused' ? '#b98a3a' : '#5e6ad2'
  })
}

async function sendReminder(): Promise<void> {
  const timer = await getTimer()
  if (!timer || timer.status !== 'running') return
  const settings = await getSettings()
  const elapsedMs = timerElapsedMs(timer)
  const elapsed = formatElapsed(elapsedMs)

  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: `⏱️ ${timer.identifier} rodando há ${elapsed}`,
    message: 'Timer ativo sem pause. Que tal uma pausa de 5 minutos?',
    priority: 2
  })

  if (!settings.webhookUrl) return
  const message =
    `⏱️ Timer ativo há ${elapsed} na ${timer.identifier} — ${timer.title}.\n\n` +
    'Que tal uma pausa de 5 min? 🚻☕'
  try {
    await fetch(settings.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'timer_reminder',
        phone: settings.phone,
        issue: timer.identifier,
        title: timer.title,
        startedAt: new Date(timer.startedAt).toISOString(),
        elapsedMinutes: Math.floor(elapsedMs / 60_000),
        elapsedHuman: elapsed,
        message
      })
    })
  } catch {
    // Webhook fora do ar não pode derrubar o timer; notificação local já saiu.
  }
}

// Alarms podem se perder em restart do navegador; timer persistido os recria.
// Também restaura intervalo de idle e conexão com o agente após restart do SW.
async function restore(): Promise<void> {
  const settings = await getSettings()
  applyIdleInterval(settings)
  const timer = await getTimer()
  if (timer) {
    await scheduleAlarms(settings)
    ensureAgentConnection(settings)
  }
  await updateBadge()
}

chrome.runtime.onStartup.addListener(() => void restore())
chrome.runtime.onInstalled.addListener(() => void restore())

// Service worker MV3 morre/acorda o tempo todo: a cada wake, restaura idle e
// reconecta o agente (sem recriar alarms, senão o reminder nunca dispararia).
void (async () => {
  const settings = await getSettings()
  applyIdleInterval(settings)
  if (await getTimer()) ensureAgentConnection(settings)
})()
