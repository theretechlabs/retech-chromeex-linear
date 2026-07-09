import { formatClock } from './lib/format'
import type { TimerState } from './lib/storage'

const ISSUE_RE = /\/issue\/([A-Za-z0-9]+-\d+)(?:[/?#]|$)/i

let pageIdentifier: string | null = null
let timer: TimerState | null = null
let busy = false
let flashUntil = 0

interface Ui {
  host: HTMLDivElement
  card: HTMLDivElement
  issue: HTMLSpanElement
  clock: HTMLSpanElement
  button: HTMLButtonElement
  status: HTMLDivElement
}
let ui: Ui | null = null

function ensureUi(): Ui {
  if (ui) return ui

  const host = document.createElement('div')
  host.id = 'retech-linear-timer'
  const shadow = host.attachShadow({ mode: 'closed' })

  const style = document.createElement('style')
  style.textContent = `
    .card {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 2147483647;
      display: none;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      border-radius: 12px;
      background: #191a1f;
      border: 1px solid #2c2d33;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
      color: #e8e9ed;
      font: 500 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      user-select: none;
    }
    .card.visible { display: flex; }
    .issue { color: #9fa2ab; font-weight: 600; }
    .clock {
      font-variant-numeric: tabular-nums;
      font-size: 15px;
      font-weight: 600;
      min-width: 72px;
    }
    .clock.running { color: #6ee7a0; }
    button {
      width: 36px;
      height: 36px;
      border: none;
      border-radius: 50%;
      background: #5e6ad2;
      color: #fff;
      font-size: 13px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
    }
    button:hover { background: #6f7ae0; }
    button:disabled { opacity: 0.5; cursor: wait; }
    button.running { background: #d25e5e; }
    button.running:hover { background: #e07070; }
    .status {
      position: fixed;
      right: 18px;
      bottom: 78px;
      z-index: 2147483647;
      display: none;
      max-width: 320px;
      padding: 8px 12px;
      border-radius: 8px;
      background: #24262c;
      border: 1px solid #2c2d33;
      color: #c9ccd4;
      font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .status.visible { display: block; }
    .status.error { color: #f0a0a0; border-color: #5a3030; }
  `

  const card = document.createElement('div')
  card.className = 'card'

  const issue = document.createElement('span')
  issue.className = 'issue'

  const clock = document.createElement('span')
  clock.className = 'clock'

  const button = document.createElement('button')
  button.addEventListener('click', () => void onToggle())

  const status = document.createElement('div')
  status.className = 'status'

  card.append(issue, clock, button)
  shadow.append(style, card, status)
  document.documentElement.append(host)

  ui = { host, card, issue, clock, button, status }
  return ui
}

async function send<T = Record<string, unknown>>(msg: unknown): Promise<T> {
  const res = (await chrome.runtime.sendMessage(msg)) as T & { error?: string }
  if (res && typeof res === 'object' && res.error) throw new Error(res.error)
  return res
}

async function pollState(): Promise<void> {
  try {
    const res = await send<{ timer: TimerState | null }>({ type: 'GET_STATE' })
    timer = res.timer
  } catch {
    // Service worker reiniciando; próxima rodada resolve.
  }
  render()
}

function syncPage(): void {
  const match = location.pathname.match(ISSUE_RE)
  const identifier = match ? match[1].toUpperCase() : null
  if (identifier !== pageIdentifier) {
    pageIdentifier = identifier
    render()
  }
}

function render(): void {
  const { card, issue, clock, button } = ensureUi()

  // Timer ativo → widget em qualquer página do Linear; senão só em issues.
  const visible = timer !== null || pageIdentifier !== null
  card.classList.toggle('visible', visible)
  if (!visible) return

  if (timer) {
    issue.textContent = timer.identifier
    clock.textContent = formatClock(Date.now() - timer.startedAt)
    clock.classList.add('running')
    button.textContent = '❚❚'
    button.classList.add('running')
    button.title = `Pausar e registrar tempo em ${timer.identifier}`
  } else {
    issue.textContent = pageIdentifier
    clock.textContent = '00:00:00'
    clock.classList.remove('running')
    button.textContent = '▶'
    button.classList.remove('running')
    button.title = `Iniciar timer em ${pageIdentifier}`
  }
  button.disabled = busy

  if (Date.now() > flashUntil) {
    ensureUi().status.classList.remove('visible')
  }
}

function flash(message: string, isError = false): void {
  const { status } = ensureUi()
  status.textContent = message
  status.classList.toggle('error', isError)
  status.classList.add('visible')
  flashUntil = Date.now() + (isError ? 6000 : 3500)
}

async function onToggle(): Promise<void> {
  if (busy) return
  busy = true
  render()
  try {
    if (timer) {
      await send({ type: 'STOP' })
      timer = null
      flash('✓ Tempo registrado no ticket')
    } else if (pageIdentifier) {
      const res = await send<{ timer: TimerState; previous: TimerState | null }>({
        type: 'START',
        identifier: pageIdentifier
      })
      timer = res.timer
      if (res.previous) {
        flash(`✓ ${res.previous.identifier} pausado e registrado`)
      }
    }
  } catch (e) {
    flash(e instanceof Error ? e.message : String(e), true)
  } finally {
    busy = false
    render()
  }
}

// Linear é SPA: URL muda sem recarregar a página.
setInterval(syncPage, 800)
setInterval(() => void pollState(), 5000)
setInterval(render, 1000) // cronômetro ao vivo
syncPage()
void pollState()
