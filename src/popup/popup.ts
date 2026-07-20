import { formatClock } from '../lib/format'
import { whoAmI } from '../lib/linear'
import {
  DESK_PROFILES,
  getCustomVoices,
  getFaceEnrollment,
  getSettings,
  saveSettings,
  setCustomVoice,
  setFaceEnrollment,
  timerElapsedMs,
  type CustomVoices,
  type DeskProfile,
  type PauseReason,
  type Settings,
  type SoundName,
  type TimerState
} from '../lib/storage'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const apiKeyInput = $<HTMLInputElement>('apiKey')
const webhookInput = $<HTMLInputElement>('webhookUrl')
const phoneInput = $<HTMLInputElement>('phone')
const reminderInput = $<HTMLInputElement>('reminderMinutes')
const autoPauseInput = $<HTMLInputElement>('autoPause')
const idleMinutesInput = $<HTMLInputElement>('idleMinutes')
const requireIssueTabInput = $<HTMLInputElement>('requireIssueTab')
const agentEnabledInput = $<HTMLInputElement>('agentEnabled')
const agentTransportSelect = $<HTMLSelectElement>('agentTransport')
const agentPortInput = $<HTMLInputElement>('agentPort')
const agentStatusDot = $<HTMLElement>('agentStatusDot')
const agentStatusText = $<HTMLElement>('agentStatusText')
const agentInstallBlock = $<HTMLElement>('agent-install')
const installCmdEl = $<HTMLElement>('installCmd')
const otherOsBlock = $<HTMLElement>('other-os')
const soundEnabledInput = $<HTMLInputElement>('soundEnabled')
const facePhotoInput = $<HTMLInputElement>('facePhoto')
const faceThumb = $<HTMLImageElement>('faceThumb')
const faceStatus = $<HTMLElement>('faceStatus')
const faceUploadBtn = $<HTMLButtonElement>('face-upload-btn')
const faceRemoveBtn = $<HTMLButtonElement>('face-remove-btn')
const feedback = $<HTMLParagraphElement>('feedback')
const timerCard = $<HTMLElement>('timer-card')
const noTimer = $<HTMLElement>('no-timer')
const timerIssue = $<HTMLElement>('timer-issue')
const timerClock = $<HTMLElement>('timer-clock')
const timerState = $<HTMLElement>('timer-state')

const PAUSE_LABEL: Record<PauseReason, string> = {
  idle: 'inatividade',
  'no-face': 'ausência (câmera)',
  'no-tab': 'aba da issue fechada',
  unrecognized: 'rosto não reconhecido',
  'no-blink': 'pisque para a câmera'
}

let timer: TimerState | null = null

function setFeedback(message: string, kind: 'ok' | 'error' | '' = ''): void {
  feedback.textContent = message
  feedback.className = kind
}

async function loadSettings(): Promise<void> {
  const s = await getSettings()
  apiKeyInput.value = s.apiKey
  webhookInput.value = s.webhookUrl
  phoneInput.value = s.phone
  reminderInput.value = String(s.reminderMinutes)
  autoPauseInput.checked = s.autoPause
  idleMinutesInput.value = String(s.idleMinutes)
  requireIssueTabInput.checked = s.requireIssueTab
  agentEnabledInput.checked = s.agentEnabled
  agentTransportSelect.value = s.agentTransport
  agentPortInput.value = String(s.agentPort)
  agentPortInput.disabled = s.agentTransport === 'native'
  soundEnabledInput.checked = s.soundEnabled
  deskProfile = s.deskProfile
  tunGraceInput.value = String(s.customTuning.graceSeconds)
  tunRearmInput.value = String(s.customTuning.rearmSeconds)
  tunBlinkGraceInput.value = String(s.customTuning.blinkGraceSeconds)
  renderDeskCards()
}

agentTransportSelect.addEventListener('change', () => {
  agentPortInput.disabled = agentTransportSelect.value === 'native'
})

// ---------------------------------------------------------------------------
// Setup da mesa: perfil de layout físico → tolerâncias do agente de câmera.
// ---------------------------------------------------------------------------

const deskCardsEl = $<HTMLElement>('desk-cards')
const deskCaption = $<HTMLElement>('desk-caption')
const deskCustomBlock = $<HTMLElement>('desk-custom')
const tunGraceInput = $<HTMLInputElement>('tunGrace')
const tunRearmInput = $<HTMLInputElement>('tunRearm')
const tunBlinkGraceInput = $<HTMLInputElement>('tunBlinkGrace')

let deskProfile: DeskProfile = 'frontal'

const DESK_CAPTION: Record<DeskProfile, string> = {
  frontal: `Monitor único, câmera de frente. Pausa "ausente" após ${DESK_PROFILES.frontal.graceSeconds}s sem rosto — o perfil mais rígido.`,
  lateral: `Monitores dos lados, notebook/câmera no centro. Consultas longas às laterais não pausam; "ausente" só após ${DESK_PROFILES.lateral.graceSeconds}s sem rosto.`,
  extrema: `Monitor principal longe da câmera (rosto quase sempre de lado). Tolerância máxima: "ausente" após ${DESK_PROFILES.extrema.graceSeconds}s sem rosto.`,
  custom: 'Valores manuais. Em todos os perfis: piscada na entrada/volta, reconhecimento a cada 1s e inatividade de 5min continuam valendo.'
}

function renderDeskCards(): void {
  for (const card of deskCardsEl.querySelectorAll<HTMLButtonElement>('.desk-card')) {
    card.classList.toggle('selected', card.dataset.profile === deskProfile)
  }
  deskCaption.textContent = DESK_CAPTION[deskProfile]
  deskCustomBlock.classList.toggle('hidden', deskProfile !== 'custom')
}

deskCardsEl.addEventListener('click', (event) => {
  const card = (event.target as HTMLElement).closest<HTMLButtonElement>('.desk-card')
  if (!card?.dataset.profile) return
  deskProfile = card.dataset.profile as DeskProfile
  renderDeskCards()
})

// Legenda acompanha o hover (popover leve, sem clipping do popup) e volta
// pra descrição do selecionado quando o mouse sai.
deskCardsEl.addEventListener('mouseover', (event) => {
  const card = (event.target as HTMLElement).closest<HTMLButtonElement>('.desk-card')
  if (card?.dataset.profile) deskCaption.textContent = DESK_CAPTION[card.dataset.profile as DeskProfile]
})
deskCardsEl.addEventListener('mouseleave', () => {
  deskCaption.textContent = DESK_CAPTION[deskProfile]
})

function clampTuning(value: string, fallback: number, min: number, max: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

async function refreshTimer(): Promise<void> {
  try {
    const res = (await chrome.runtime.sendMessage({ type: 'GET_STATE' })) as {
      timer: TimerState | null
    }
    timer = res.timer
  } catch {
    timer = null
  }
  renderTimer()
}

function renderTimer(): void {
  timerCard.classList.toggle('hidden', !timer)
  noTimer.classList.toggle('hidden', !!timer)
  if (!timer) return
  timerIssue.textContent = timer.identifier
  timerClock.textContent = formatClock(timerElapsedMs(timer))
  timerClock.classList.toggle('paused', timer.status === 'paused')
  const paused = timer.status === 'paused'
  timerState.classList.toggle('hidden', !paused)
  if (paused) {
    timerState.textContent = `⏸ pausado — ${timer.pauseReason ? PAUSE_LABEL[timer.pauseReason] : 'manual'}`
  }
}

$<HTMLButtonElement>('stop-btn').addEventListener('click', async () => {
  setFeedback('Registrando tempo…')
  try {
    const res = (await chrome.runtime.sendMessage({ type: 'STOP' })) as { error?: string }
    if (res?.error) throw new Error(res.error)
    setFeedback('✓ Tempo registrado no ticket', 'ok')
  } catch (e) {
    setFeedback(e instanceof Error ? e.message : String(e), 'error')
  }
  await refreshTimer()
})

$<HTMLFormElement>('settings-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  // Spread preserva campos sem UI própria (ex.: agentTransport).
  const settings: Settings = {
    ...(await getSettings()),
    apiKey: apiKeyInput.value.trim(),
    webhookUrl: webhookInput.value.trim(),
    phone: phoneInput.value.trim(),
    reminderMinutes: Math.max(5, Number(reminderInput.value) || 60),
    autoPause: autoPauseInput.checked,
    idleMinutes: Math.max(1, Number(idleMinutesInput.value) || 5),
    requireIssueTab: requireIssueTabInput.checked,
    agentEnabled: agentEnabledInput.checked,
    agentTransport: agentTransportSelect.value as Settings['agentTransport'],
    agentPort: Math.min(65535, Math.max(1024, Number(agentPortInput.value) || 8998)),
    soundEnabled: soundEnabledInput.checked,
    deskProfile,
    customTuning: {
      graceSeconds: clampTuning(tunGraceInput.value, DESK_PROFILES.frontal.graceSeconds, 5, 300),
      rearmSeconds: clampTuning(tunRearmInput.value, DESK_PROFILES.frontal.rearmSeconds, 1, 300),
      blinkGraceSeconds: clampTuning(tunBlinkGraceInput.value, DESK_PROFILES.frontal.blinkGraceSeconds, 1, 60)
    }
  }

  // Webhook em host próprio exige permissão opcional de origem.
  if (settings.webhookUrl) {
    try {
      const origin = new URL(settings.webhookUrl).origin + '/*'
      const granted = await chrome.permissions.request({ origins: [origin] })
      if (!granted) {
        setFeedback('Permissão negada para o host do webhook', 'error')
        return
      }
    } catch {
      setFeedback('URL de webhook inválida', 'error')
      return
    }
  }

  await saveSettings(settings)

  if (!settings.apiKey) {
    setFeedback('Salvo. Falta a API key do Linear.', 'ok')
    return
  }
  setFeedback('Validando API key…')
  try {
    const name = await whoAmI(settings.apiKey)
    setFeedback(`✓ Salvo — conectado como ${name}`, 'ok')
  } catch (e) {
    setFeedback(e instanceof Error ? e.message : String(e), 'error')
  }
})

// ---------------------------------------------------------------------------
// Cadastro facial: foto → downscale → base64 → background → agente (embedding).
// ---------------------------------------------------------------------------

/** Redimensiona a imagem (máx `maxSide` px) e devolve dataURL JPEG. */
async function scaleImage(source: ImageBitmap, maxSide: number, quality: number): Promise<string> {
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(source.width * scale)
  canvas.height = Math.round(source.height * scale)
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', quality)
}

function renderEnrollment(thumbnail: string | null): void {
  const enrolled = thumbnail !== null
  faceThumb.classList.toggle('hidden', !enrolled)
  faceRemoveBtn.classList.toggle('hidden', !enrolled)
  if (thumbnail) faceThumb.src = thumbnail
  faceStatus.textContent = enrolled ? 'Rosto cadastrado — verificação ativa.' : 'Nenhum rosto cadastrado.'
  faceUploadBtn.textContent = enrolled ? 'Trocar foto' : 'Enviar foto de referência'
}

faceUploadBtn.addEventListener('click', () => facePhotoInput.click())

facePhotoInput.addEventListener('change', async () => {
  const file = facePhotoInput.files?.[0]
  facePhotoInput.value = ''
  if (!file) return
  setFeedback('Cadastrando rosto…')
  try {
    // createImageBitmap respeita a orientação EXIF de fotos de celular.
    const bitmap = await createImageBitmap(file)
    const photo = await scaleImage(bitmap, 640, 0.85)
    const thumbnail = await scaleImage(bitmap, 96, 0.8)
    bitmap.close()
    const image = photo.replace(/^data:image\/jpeg;base64,/, '')
    const res = (await chrome.runtime.sendMessage({ type: 'ENROLL_FACE', image })) as {
      ok?: boolean
      error?: string
    }
    if (res?.error) throw new Error(res.error)
    await setFaceEnrollment({ thumbnail, enrolledAt: Date.now() })
    renderEnrollment(thumbnail)
    setFeedback('✓ Rosto cadastrado — só você mantém o timer rodando', 'ok')
  } catch (e) {
    setFeedback(e instanceof Error ? e.message : String(e), 'error')
  }
})

faceRemoveBtn.addEventListener('click', async () => {
  setFeedback('Removendo cadastro…')
  try {
    const res = (await chrome.runtime.sendMessage({ type: 'UNENROLL_FACE' })) as {
      ok?: boolean
      error?: string
    }
    await setFaceEnrollment(null)
    renderEnrollment(null)
    if (res?.error) {
      setFeedback(
        'Removido localmente, mas o agente está offline — apague também ' +
          '~/.cache/retech-presence-agent/face_embedding.json',
        'error'
      )
    } else {
      setFeedback('✓ Cadastro removido', 'ok')
    }
  } catch (e) {
    setFeedback(e instanceof Error ? e.message : String(e), 'error')
  }
})

async function loadEnrollment(): Promise<void> {
  const local = await getFaceEnrollment()
  renderEnrollment(local?.thumbnail ?? null)
  // Checagem de drift: extensão acha que tem cadastro mas o cache do agente sumiu.
  if (!local) return
  try {
    // Só checa se o agente JÁ está conectado — no modo nativo, mandar comando
    // spawnaria o processo e acenderia a câmera a cada abertura do popup.
    const status = (await chrome.runtime.sendMessage({ type: 'GET_AGENT_STATUS' })) as {
      connected?: boolean
    }
    if (!status?.connected) return
    const res = (await chrome.runtime.sendMessage({ type: 'GET_ENROLLMENT' })) as {
      enrolled?: boolean
      error?: string
    }
    if (!res?.error && res?.enrolled === false) {
      faceStatus.textContent = 'Foto de referência não está no agente — reenvie.'
    }
  } catch {
    // Agente offline: mantém o estado local sem alarde.
  }
}

// ---------------------------------------------------------------------------
// Vozes personalizadas: cada dev sobe um MP3 por aviso; vazio = voz padrão.
// ---------------------------------------------------------------------------

const voiceFileInput = $<HTMLInputElement>('voiceFile')
const voiceList = $<HTMLElement>('voice-list')

const VOICES: { name: SoundName; label: string }[] = [
  { name: 'pause', label: 'Pausa' },
  { name: 'resume', label: 'Retomada' },
  { name: 'unrecognized', label: 'Rosto não reconhecido' }
]
const MAX_VOICE_BYTES = 1_000_000

let voices: CustomVoices = {}
let uploadingVoice: SoundName | null = null

/** dataURL do dev, ou o mp3 bundlado como fallback. */
function voiceSrc(name: SoundName): string {
  return voices[name] ?? chrome.runtime.getURL(`sounds/${name}.mp3`)
}

function renderVoices(): void {
  voiceList.textContent = ''
  for (const { name, label } of VOICES) {
    const custom = Boolean(voices[name])

    const info = document.createElement('div')
    info.className = 'voice-info'
    const strong = document.createElement('strong')
    strong.textContent = label
    const status = document.createElement('small')
    status.className = custom ? 'voice-status is-custom' : 'voice-status'
    status.textContent = custom ? 'personalizado' : 'padrão'
    info.append(strong, status)

    const testBtn = document.createElement('button')
    testBtn.type = 'button'
    testBtn.textContent = '▶'
    testBtn.title = 'Testar'
    testBtn.addEventListener('click', async () => {
      // Caminho REAL: background → offscreen. Tocar aqui no popup esconderia
      // defeito no transporte (offscreen) que os avisos automáticos usam.
      setFeedback('Tocando via extensão…')
      try {
        const res = (await chrome.runtime.sendMessage({ type: 'TEST_VOICE', sound: name })) as {
          ok?: boolean
          error?: string
        }
        if (res?.ok) setFeedback('✓ Voz tocada pelo caminho real (offscreen)', 'ok')
        else setFeedback(`Falha no áudio: ${res?.error ?? 'desconhecida'}`, 'error')
      } catch (e) {
        setFeedback(e instanceof Error ? e.message : String(e), 'error')
      }
    })

    const upBtn = document.createElement('button')
    upBtn.type = 'button'
    upBtn.textContent = custom ? 'Trocar' : 'Enviar'
    upBtn.addEventListener('click', () => {
      uploadingVoice = name
      voiceFileInput.click()
    })

    const resetBtn = document.createElement('button')
    resetBtn.type = 'button'
    resetBtn.className = custom ? 'danger' : 'danger hidden'
    resetBtn.textContent = 'Padrão'
    resetBtn.addEventListener('click', async () => {
      await setCustomVoice(name, null)
      voices = await getCustomVoices()
      renderVoices()
      setFeedback(`✓ Voz de "${label}" restaurada ao padrão`, 'ok')
    })

    const actions = document.createElement('div')
    actions.className = 'voice-actions'
    actions.append(testBtn, upBtn, resetBtn)

    const row = document.createElement('div')
    row.className = 'voice-row'
    row.append(info, actions)
    voiceList.append(row)
  }
}

voiceFileInput.addEventListener('change', async () => {
  const file = voiceFileInput.files?.[0]
  voiceFileInput.value = ''
  const name = uploadingVoice
  uploadingVoice = null
  if (!file || !name) return
  if (file.type !== 'audio/mpeg' && !file.name.toLowerCase().endsWith('.mp3')) {
    setFeedback('O arquivo precisa ser um MP3', 'error')
    return
  }
  if (file.size > MAX_VOICE_BYTES) {
    setFeedback(`MP3 grande demais (${(file.size / 1e6).toFixed(1)} MB). Máx 1 MB.`, 'error')
    return
  }
  setFeedback('Salvando voz…')
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error ?? new Error('falha ao ler o arquivo'))
      reader.readAsDataURL(file)
    })
    await setCustomVoice(name, dataUrl)
    voices = await getCustomVoices()
    renderVoices()
    setFeedback('✓ Voz personalizada salva', 'ok')
  } catch (e) {
    setFeedback(e instanceof Error ? e.message : String(e), 'error')
  }
})

async function loadVoices(): Promise<void> {
  voices = await getCustomVoices()
  renderVoices()
}

// ---------------------------------------------------------------------------
// Setup do agente: status da conexão, comando de instalação, teste.
// ---------------------------------------------------------------------------

const INSTALL_BASE = 'https://raw.githubusercontent.com/theretechlabs/retech-chromeex-linear/main/scripts'
const INSTALL_CMDS: Record<string, { label: string; cmd: string }> = {
  mac: { label: 'macOS', cmd: `curl -fsSL ${INSTALL_BASE}/install-agent.sh | bash` },
  linux: { label: 'Linux', cmd: `curl -fsSL ${INSTALL_BASE}/install-agent.sh | bash` },
  win: { label: 'Windows (PowerShell)', cmd: `iwr -useb ${INSTALL_BASE}/install-agent.ps1 | iex` }
}

function currentOs(): 'mac' | 'win' | 'linux' {
  const ua = navigator.userAgent
  if (/Macintosh/.test(ua)) return 'mac'
  if (/Windows/.test(ua)) return 'win'
  return 'linux'
}

interface AgentStatus {
  transport: 'native' | 'ws' | null
  connected: boolean
  ready: boolean
  nativeStatus: { status: string; lastError: string | null }
}

function renderAgentStatus(status: AgentStatus | null, transportSetting: string): void {
  let dot = 'unknown'
  let text = 'Estado do agente desconhecido'
  let showInstall = false
  if (!status) {
    text = 'Não consegui consultar o background — recarregue a extensão'
    dot = 'error'
  } else if (transportSetting === 'ws') {
    dot = status.connected ? 'ok' : 'unknown'
    text = status.connected
      ? 'Modo legado (WebSocket) — conectado'
      : 'Modo legado (WebSocket) — agente manual não conectado'
  } else if (status.connected) {
    dot = 'ok'
    text = status.transport === 'native'
      ? status.ready ? 'Agente nativo rodando' : 'Agente nativo iniciando…'
      : 'Conectado via WebSocket (fallback)'
  } else {
    switch (status.nativeStatus.status) {
      case 'ok':
        dot = 'ok'
        text = 'Agente nativo instalado (inicia junto com o timer)'
        break
      case 'not_installed':
        dot = 'error'
        text = 'Agente não instalado'
        showInstall = true
        break
      case 'error':
        dot = 'error'
        text = `Agente com erro: ${status.nativeStatus.lastError ?? 'desconhecido'}`
        showInstall = true
        break
      default:
        dot = 'unknown'
        text = 'Agente ainda não testado — use "Testar conexão"'
        showInstall = true
    }
  }
  agentStatusDot.className = `status-dot ${dot}`
  agentStatusText.textContent = text
  agentInstallBlock.classList.toggle('hidden', !showInstall)
}

async function loadAgentStatus(): Promise<void> {
  installCmdEl.textContent = INSTALL_CMDS[currentOs()].cmd
  otherOsBlock.innerHTML = ''
  for (const [os, { label, cmd }] of Object.entries(INSTALL_CMDS)) {
    if (os === currentOs()) continue
    const line = document.createElement('small')
    line.textContent = `${label}: ${cmd}`
    otherOsBlock.appendChild(line)
  }
  try {
    const [status, settings] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'GET_AGENT_STATUS' }) as Promise<AgentStatus>,
      getSettings()
    ])
    renderAgentStatus(status, settings.agentTransport)
  } catch {
    renderAgentStatus(null, 'auto')
  }
}

$<HTMLButtonElement>('copy-cmd-btn').addEventListener('click', async () => {
  await navigator.clipboard.writeText(installCmdEl.textContent ?? '')
  setFeedback('✓ Comando copiado — cole no terminal', 'ok')
})

$<HTMLAnchorElement>('other-os-link').addEventListener('click', (event) => {
  event.preventDefault()
  otherOsBlock.classList.toggle('hidden')
})

$<HTMLButtonElement>('test-agent-btn').addEventListener('click', async () => {
  setFeedback('Testando conexão com o agente (pode levar ~15s no primeiro boot)…')
  try {
    const res = (await chrome.runtime.sendMessage({ type: 'TEST_AGENT' })) as {
      ok?: boolean
      error?: string
      transport?: string
      enrolled?: boolean
    }
    if (res?.error) throw new Error(res.error)
    const via = res.transport === 'native' ? 'nativo' : 'WebSocket'
    const face = res.enrolled ? 'rosto cadastrado' : 'nenhum rosto cadastrado'
    setFeedback(`✓ Agente respondeu (${via}) — ${face}`, 'ok')
  } catch (e) {
    setFeedback(e instanceof Error ? e.message : String(e), 'error')
  }
  await loadAgentStatus()
})

void loadSettings()
void refreshTimer()
void loadEnrollment()
void loadVoices()
void loadAgentStatus()
setInterval(renderTimer, 1000)
