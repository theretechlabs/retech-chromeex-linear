import { formatClock } from '../lib/format'
import { whoAmI } from '../lib/linear'
import {
  getFaceEnrollment,
  getSettings,
  saveSettings,
  setFaceEnrollment,
  timerElapsedMs,
  type PauseReason,
  type Settings,
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
const agentPortInput = $<HTMLInputElement>('agentPort')
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
  agentPortInput.value = String(s.agentPort)
  soundEnabledInput.checked = s.soundEnabled
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
  const settings: Settings = {
    apiKey: apiKeyInput.value.trim(),
    webhookUrl: webhookInput.value.trim(),
    phone: phoneInput.value.trim(),
    reminderMinutes: Math.max(5, Number(reminderInput.value) || 60),
    autoPause: autoPauseInput.checked,
    idleMinutes: Math.max(1, Number(idleMinutesInput.value) || 5),
    requireIssueTab: requireIssueTabInput.checked,
    agentEnabled: agentEnabledInput.checked,
    agentPort: Math.min(65535, Math.max(1024, Number(agentPortInput.value) || 8998)),
    soundEnabled: soundEnabledInput.checked
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

void loadSettings()
void refreshTimer()
void loadEnrollment()
setInterval(renderTimer, 1000)
