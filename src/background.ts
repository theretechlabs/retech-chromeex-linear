import { buildComment, formatElapsed } from './lib/format'
import { createComment, resolveIssue } from './lib/linear'
import {
  clearTimer,
  getSettings,
  getTimer,
  setTimer,
  type Settings,
  type TimerState
} from './lib/storage'

const BADGE_ALARM = 'badge'
const REMINDER_ALARM = 'reminder'

type Message =
  | { type: 'GET_STATE' }
  | { type: 'START'; identifier: string }
  | { type: 'STOP' }

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
  }
}

async function startTimer(identifier: string) {
  const settings = await getSettings()
  if (!settings.apiKey) {
    throw new Error('Configure sua API key do Linear no ícone da extensão')
  }

  // Um timer por dev: play em outra issue pausa e registra a anterior.
  const existing = await getTimer()
  let previous: TimerState | null = null
  if (existing) {
    if (existing.identifier === identifier) return { timer: existing, previous: null }
    await postSession(existing, settings)
    previous = existing
  }

  const issue = await resolveIssue(settings.apiKey, identifier)
  const timer: TimerState = {
    issueId: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    startedAt: Date.now()
  }
  await setTimer(timer)
  await scheduleAlarms(settings)
  await updateBadge()
  return { timer, previous }
}

async function stopTimer() {
  const timer = await getTimer()
  if (!timer) return { stopped: null }

  const settings = await getSettings()
  // Comentário primeiro: se a API falhar, o timer continua rodando.
  await postSession(timer, settings)
  await clearTimer()
  await chrome.alarms.clear(BADGE_ALARM)
  await chrome.alarms.clear(REMINDER_ALARM)
  await updateBadge()
  return { stopped: timer, durationMs: Date.now() - timer.startedAt }
}

async function postSession(timer: TimerState, settings: Settings): Promise<void> {
  const body = buildComment(new Date(timer.startedAt), new Date())
  await createComment(settings.apiKey, timer.issueId, body)
}

async function scheduleAlarms(settings: Settings): Promise<void> {
  const period = Math.max(5, settings.reminderMinutes || 60)
  chrome.alarms.create(BADGE_ALARM, { periodInMinutes: 1 })
  chrome.alarms.create(REMINDER_ALARM, {
    delayInMinutes: period,
    periodInMinutes: period
  })
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === BADGE_ALARM) void updateBadge()
  if (alarm.name === REMINDER_ALARM) void sendReminder()
})

async function updateBadge(): Promise<void> {
  const timer = await getTimer()
  if (!timer) {
    await chrome.action.setBadgeText({ text: '' })
    return
  }
  const minutes = Math.floor((Date.now() - timer.startedAt) / 60_000)
  const text =
    minutes < 60
      ? `${minutes}m`
      : `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`
  await chrome.action.setBadgeText({ text })
  await chrome.action.setBadgeBackgroundColor({ color: '#5e6ad2' })
}

async function sendReminder(): Promise<void> {
  const timer = await getTimer()
  if (!timer) return
  const settings = await getSettings()
  const elapsedMs = Date.now() - timer.startedAt
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
async function restoreAlarms(): Promise<void> {
  const timer = await getTimer()
  if (timer) {
    const settings = await getSettings()
    await scheduleAlarms(settings)
  }
  await updateBadge()
}

chrome.runtime.onStartup.addListener(() => void restoreAlarms())
chrome.runtime.onInstalled.addListener(() => void restoreAlarms())
