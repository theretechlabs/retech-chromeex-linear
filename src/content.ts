import { formatClock } from './lib/format'
import { getSettings, timerElapsedMs, type PauseReason, type TimerState } from './lib/storage'

const ISSUE_RE = /\/issue\/([A-Za-z0-9]+-\d+)(?:[/?#]|$)/i

const PAUSE_LABEL: Record<PauseReason, string> = {
  idle: 'inativo',
  'no-face': 'ausente',
  'no-tab': 'aba da issue fechada',
  unrecognized: 'rosto não reconhecido',
  'no-blink': 'pisque para a câmera 👁'
}

let pageIdentifier: string | null = null
let timer: TimerState | null = null
let busy = false
let flashUntil = 0

interface Ui {
  host: HTMLDivElement
  card: HTMLDivElement
  issue: HTMLSpanElement
  clock: HTMLSpanElement
  partials: HTMLButtonElement
  popover: HTMLDivElement
  button: HTMLButtonElement
  stopButton: HTMLButtonElement
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
      cursor: grab;
      touch-action: none;
    }
    .card.visible { display: flex; }
    .card.dragging { cursor: grabbing; }
    .issue { color: #9fa2ab; font-weight: 600; }
    .clock {
      font-variant-numeric: tabular-nums;
      font-size: 15px;
      font-weight: 600;
      min-width: 72px;
    }
    .clock.running { color: #6ee7a0; }
    .clock.paused { color: #e8b45e; }
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
    button.stop-mini {
      width: 28px;
      height: 28px;
      font-size: 10px;
      background: #d25e5e;
      display: none;
    }
    button.stop-mini:hover { background: #e07070; }
    button.stop-mini.visible { display: flex; }
    button.partials {
      width: 24px;
      height: 24px;
      font-size: 10px;
      font-weight: 700;
      background: #2c2d33;
      color: #6b6e78;
      cursor: default;
    }
    button.partials:hover { background: #2c2d33; }
    button.partials.active {
      background: #1f3a2b;
      color: #6ee7a0;
      cursor: pointer;
    }
    button.partials.active:hover { background: #27492f; }
    .popover {
      position: absolute;
      bottom: calc(100% + 10px);
      right: 0;
      display: none;
      min-width: 240px;
      max-height: 260px;
      overflow-y: auto;
      padding: 10px 12px;
      border-radius: 10px;
      background: #24262c;
      border: 1px solid #2c2d33;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
      color: #c9ccd4;
      font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      cursor: default;
    }
    .popover.visible { display: block; }
    .popover h4 {
      margin: 0 0 6px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #9fa2ab;
    }
    .popover table { border-collapse: collapse; width: 100%; }
    .popover td {
      padding: 2px 0;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .popover td.range { color: #9fa2ab; padding-right: 10px; }
    .popover td.dur { font-weight: 600; padding-right: 10px; }
    .popover td.why { color: #8a8d96; }
    .popover tr.current td { color: #6ee7a0; }
    .popover tr.current td.range, .popover tr.current td.why { color: #4fae77; }
    .popover .note { margin: 6px 0 0; font-size: 11px; color: #8a8d96; }
    .popover .total {
      margin-top: 6px;
      padding-top: 6px;
      border-top: 1px solid #2c2d33;
      font-weight: 600;
      color: #e8e9ed;
    }
    .status {
      position: fixed;
      right: 18px;
      bottom: 78px;
      transform: none;
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

  const partials = document.createElement('button')
  partials.className = 'partials'

  const popover = document.createElement('div')
  popover.className = 'popover'

  // Hover abre; clique fixa (some só com outro clique). Ícone inerte sem parciais.
  // Estado "fixado" vive em dataset para o render() poder resetar ao encerrar o timer.
  let hideDelay: number | undefined
  const showPopover = () => {
    if (!timer || timer.segments.length === 0) return
    clearTimeout(hideDelay)
    renderPopover()
    popover.classList.add('visible')
  }
  const hidePopover = () => {
    if (popover.dataset.pinned === '1') return
    hideDelay = window.setTimeout(() => popover.classList.remove('visible'), 200)
  }
  partials.addEventListener('mouseenter', showPopover)
  partials.addEventListener('mouseleave', hidePopover)
  popover.addEventListener('mouseenter', () => clearTimeout(hideDelay))
  popover.addEventListener('mouseleave', hidePopover)
  partials.addEventListener('click', () => {
    if (!timer || timer.segments.length === 0) return
    if (popover.dataset.pinned === '1') {
      delete popover.dataset.pinned
      clearTimeout(hideDelay)
      popover.classList.remove('visible')
    } else {
      popover.dataset.pinned = '1'
      showPopover()
    }
  })

  const button = document.createElement('button')
  button.addEventListener('click', () => void onToggle())

  const stopButton = document.createElement('button')
  stopButton.className = 'stop-mini'
  stopButton.textContent = '■'
  stopButton.title = 'Encerrar e registrar tempo'
  stopButton.addEventListener('click', () => void onStop())

  const status = document.createElement('div')
  status.className = 'status'

  // Arrastar pelo corpo do card (botões continuam clicáveis).
  let dragOffset: { dx: number; dy: number } | null = null
  card.addEventListener('pointerdown', (e: PointerEvent) => {
    if (
      e.target instanceof Node &&
      (button.contains(e.target) ||
        stopButton.contains(e.target) ||
        partials.contains(e.target) ||
        popover.contains(e.target))
    )
      return
    const rect = card.getBoundingClientRect()
    dragOffset = { dx: e.clientX - rect.left, dy: e.clientY - rect.top }
    card.setPointerCapture(e.pointerId)
    card.classList.add('dragging')
  })
  card.addEventListener('pointermove', (e: PointerEvent) => {
    if (!dragOffset) return
    widgetPos = { x: e.clientX - dragOffset.dx, y: e.clientY - dragOffset.dy }
    applyWidgetPos()
  })
  card.addEventListener('pointerup', (e: PointerEvent) => {
    if (!dragOffset) return
    dragOffset = null
    card.classList.remove('dragging')
    card.releasePointerCapture(e.pointerId)
    void chrome.storage.local.set({ widgetPos })
  })

  card.append(issue, clock, partials, button, stopButton, popover)
  shadow.append(style, card, status)
  document.documentElement.append(host)

  ui = { host, card, issue, clock, partials, popover, button, stopButton, status }
  return ui
}

let widgetPos: { x: number; y: number } | null = null

/** Aplica posição salva (clampada na viewport); sem posição, fica no padrão bottom-right. */
function applyWidgetPos(): void {
  if (!ui || !widgetPos) return
  const { card, status } = ui
  const rect = card.getBoundingClientRect()
  const width = rect.width || 200
  const height = rect.height || 56
  const x = Math.min(Math.max(widgetPos.x, 0), Math.max(0, window.innerWidth - width))
  const y = Math.min(Math.max(widgetPos.y, 0), Math.max(0, window.innerHeight - height))
  card.style.left = `${x}px`
  card.style.top = `${y}px`
  card.style.right = 'auto'
  card.style.bottom = 'auto'
  // Balão de status acompanha o card, logo acima dele.
  status.style.left = `${x}px`
  status.style.top = `${y - 8}px`
  status.style.transform = 'translateY(-100%)'
  status.style.right = 'auto'
  status.style.bottom = 'auto'
}

async function loadWidgetPos(): Promise<void> {
  const { widgetPos: saved } = await chrome.storage.local.get('widgetPos')
  if (saved) {
    widgetPos = saved as { x: number; y: number }
    ensureUi()
    applyWidgetPos()
  }
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
  const { card, issue, clock, partials, popover, button, stopButton } = ensureUi()

  // Timer ativo → widget em qualquer página do Linear; senão só em issues.
  const visible = timer !== null || pageIdentifier !== null
  card.classList.toggle('visible', visible)
  if (!visible) return

  // Ícone de parciais: verde e clicável quando o total é composto por
  // segmentos anteriores; apagado quando o tempo corre sem nunca ter pausado.
  const segmentCount = timer?.segments.length ?? 0
  partials.textContent = String(segmentCount)
  partials.classList.toggle('active', segmentCount > 0)
  partials.title =
    segmentCount > 0
      ? `${segmentCount} ${segmentCount === 1 ? 'parcial compõe' : 'parciais compõem'} este total`
      : 'Tempo contínuo — sem parciais'
  if (segmentCount === 0) {
    delete popover.dataset.pinned
    popover.classList.remove('visible')
  } else if (popover.classList.contains('visible')) {
    renderPopover() // popover aberto acompanha o cronômetro ao vivo
  }

  if (timer && timer.status === 'running') {
    issue.textContent = timer.identifier
    clock.textContent = formatClock(timerElapsedMs(timer))
    clock.classList.add('running')
    clock.classList.remove('paused')
    button.textContent = '❚❚'
    button.classList.add('running')
    button.title = `Encerrar e registrar tempo em ${timer.identifier}`
    stopButton.classList.remove('visible')
  } else if (timer) {
    const reason = timer.pauseReason ? PAUSE_LABEL[timer.pauseReason] : 'pausado'
    issue.textContent = `${timer.identifier} · ⏸ ${reason}`
    clock.textContent = formatClock(timerElapsedMs(timer))
    clock.classList.remove('running')
    clock.classList.add('paused')
    button.textContent = '▶'
    button.classList.remove('running')
    button.title = `Retomar timer em ${timer.identifier}`
    stopButton.classList.add('visible')
  } else {
    issue.textContent = pageIdentifier
    clock.textContent = '00:00:00'
    clock.classList.remove('running', 'paused')
    button.textContent = '▶'
    button.classList.remove('running')
    button.title = `Iniciar timer em ${pageIdentifier}`
    stopButton.classList.remove('visible')
  }
  button.disabled = busy
  stopButton.disabled = busy

  if (Date.now() > flashUntil) {
    ensureUi().status.classList.remove('visible')
  }
}

function fmtTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Duração curta: "38s", "12m", "1h 05m". */
function fmtDur(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const totalMinutes = Math.floor(totalSeconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes}m`
  return `${hours}h ${String(minutes).padStart(2, '0')}m`
}

/**
 * Duração com segundos, pro popover de parciais: "45s", "1m 47s", "1h 05m 20s".
 * Mantém precisão de segundo pra soma das linhas fechar com o Total (fmtDur
 * trunca minuto e faria as parciais parecerem não somar).
 */
function fmtDurPrecise(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  const s = `${String(seconds).padStart(2, '0')}s`
  if (hours === 0) return `${minutes}m ${s}`
  return `${hours}h ${String(minutes).padStart(2, '0')}m ${s}`
}

/** Lista de parciais que compõem o total do cronômetro. */
function renderPopover(): void {
  const { popover } = ensureUi()
  if (!timer) return

  popover.textContent = ''

  const heading = document.createElement('h4')
  heading.textContent = `Parciais · ${timer.identifier}`

  const table = document.createElement('table')
  let hasUnposted = false
  const addRow = (start: number, end: number, why: string, opts?: { current?: boolean; unposted?: boolean }) => {
    const tr = document.createElement('tr')
    if (opts?.current) tr.className = 'current'
    const range = document.createElement('td')
    range.className = 'range'
    range.textContent = `${fmtTime(start)}–${opts?.current ? 'agora' : fmtTime(end)}`
    const dur = document.createElement('td')
    dur.className = 'dur'
    dur.textContent = fmtDurPrecise(end - start) + (opts?.unposted ? ' *' : '')
    const reason = document.createElement('td')
    reason.className = 'why'
    reason.textContent = why
    tr.append(range, dur, reason)
    table.append(tr)
  }

  for (const seg of timer.segments) {
    if (!seg.posted) hasUnposted = true
    addRow(seg.start, seg.end, PAUSE_LABEL[seg.reason] ?? seg.reason, { unposted: !seg.posted })
  }
  if (timer.status === 'running') {
    addRow(timer.segmentStartedAt, Date.now(), 'em andamento', { current: true })
  }

  const total = document.createElement('div')
  total.className = 'total'
  total.textContent = `Total: ${fmtDurPrecise(timerElapsedMs(timer))}`

  popover.append(heading, table, total)

  if (hasUnposted) {
    const note = document.createElement('p')
    note.className = 'note'
    note.textContent = '* abaixo de 1min: conta no total, mas não vira comentário na issue'
    popover.append(note)
  }
}

function flash(message: string, isError = false): void {
  const { status } = ensureUi()
  status.textContent = message
  status.classList.toggle('error', isError)
  status.classList.add('visible')
  flashUntil = Date.now() + (isError ? 6000 : 3500)
}

/** Play/resume manual passa por reconhecimento facial (até ~6s) quando o
 * agente de câmera está ativo — avisa para o dev olhar para a câmera. */
async function flashVerifying(): Promise<void> {
  try {
    if ((await getSettings()).agentEnabled) flash('🔍 Verificando rosto — olhe para a câmera…')
  } catch {
    // Sem settings não pode travar o play.
  }
}

async function onToggle(): Promise<void> {
  if (busy) return
  busy = true
  render()
  try {
    if (timer && timer.status === 'running') {
      await send({ type: 'STOP' })
      timer = null
      flash('✓ Tempo registrado no ticket')
    } else if (timer) {
      await flashVerifying()
      const res = await send<{ timer?: TimerState }>({ type: 'RESUME' })
      if (res.timer) timer = res.timer
      flash('▶ Timer retomado')
    } else if (pageIdentifier) {
      await flashVerifying()
      const res = await send<{ timer: TimerState; previous: TimerState | null }>({
        type: 'START',
        identifier: pageIdentifier
      })
      timer = res.timer
      if (res.previous) {
        flash(`✓ ${res.previous.identifier} encerrado e registrado`)
      } else {
        flash('▶ Timer iniciado')
      }
    }
  } catch (e) {
    flash(e instanceof Error ? e.message : String(e), true)
  } finally {
    busy = false
    render()
  }
}

async function onStop(): Promise<void> {
  if (busy) return
  busy = true
  render()
  try {
    await send({ type: 'STOP' })
    timer = null
    flash('✓ Tempo registrado no ticket')
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
window.addEventListener('resize', applyWidgetPos)
syncPage()
void pollState()
void loadWidgetPos()
