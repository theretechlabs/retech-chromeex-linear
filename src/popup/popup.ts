import { formatClock } from '../lib/format'
import { whoAmI } from '../lib/linear'
import { getSettings, saveSettings, type Settings, type TimerState } from '../lib/storage'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const apiKeyInput = $<HTMLInputElement>('apiKey')
const webhookInput = $<HTMLInputElement>('webhookUrl')
const phoneInput = $<HTMLInputElement>('phone')
const reminderInput = $<HTMLInputElement>('reminderMinutes')
const feedback = $<HTMLParagraphElement>('feedback')
const timerCard = $<HTMLElement>('timer-card')
const noTimer = $<HTMLElement>('no-timer')
const timerIssue = $<HTMLElement>('timer-issue')
const timerClock = $<HTMLElement>('timer-clock')

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
  if (timer) {
    timerIssue.textContent = timer.identifier
    timerClock.textContent = formatClock(Date.now() - timer.startedAt)
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
    reminderMinutes: Math.max(5, Number(reminderInput.value) || 60)
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

void loadSettings()
void refreshTimer()
setInterval(renderTimer, 1000)
