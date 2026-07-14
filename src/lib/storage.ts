export type TimerStatus = 'running' | 'paused'

/** Motivo do pause automático. */
export type PauseReason = 'idle' | 'no-face' | 'no-tab' | 'unrecognized' | 'no-blink'

export interface TimerState {
  /** UUID interno do Linear, usado na mutation de comentário. */
  issueId: string
  /** Identificador humano, ex.: THE-558. */
  identifier: string
  title: string
  /** Epoch ms UTC do play original (primeiro segmento). */
  startedAt: number
  status: TimerStatus
  /** Início do segmento atual (epoch ms); válido enquanto `status === 'running'`. */
  segmentStartedAt: number
  /** Tempo acumulado dos segmentos anteriores (já registrados no Linear no pause). */
  accumulatedMs: number
  /** Epoch ms do pause atual; null quando rodando. */
  pausedAt: number | null
  pauseReason: PauseReason | null
}

export interface Settings {
  apiKey: string
  webhookUrl: string
  phone: string
  reminderMinutes: number
  /** Liga o play/pause automático (idle + agente de presença). */
  autoPause: boolean
  /** Minutos sem teclado/mouse para considerar o dev ausente. */
  idleMinutes: number
  /** Exige uma aba do Linear com a issue aberta para o timer rodar. */
  requireIssueTab: boolean
  /** Liga a integração com o agente de câmera (retech-presence-agent). */
  agentEnabled: boolean
  /** Porta local do WebSocket do agente. */
  agentPort: number
  /** Toca voz ao pausar/retomar automaticamente. */
  soundEnabled: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  webhookUrl: '',
  phone: '',
  reminderMinutes: 60,
  autoPause: true,
  idleMinutes: 5,
  requireIssueTab: true,
  agentEnabled: false,
  agentPort: 8998,
  soundEnabled: true
}

/** Cadastro facial local (só preview/estado; o embedding fica no agente). */
export interface FaceEnrollment {
  /** Thumbnail ~96px em dataURL para o popup. */
  thumbnail: string
  enrolledAt: number
}

/** Total decorrido (segmentos fechados + segmento atual se rodando). */
export function timerElapsedMs(timer: TimerState, now = Date.now()): number {
  const current = timer.status === 'running' ? now - timer.segmentStartedAt : 0
  return timer.accumulatedMs + current
}

export async function getTimer(): Promise<TimerState | null> {
  const { timer } = await chrome.storage.local.get('timer')
  if (!timer) return null
  const t = timer as TimerState & { status?: TimerStatus }
  // Migração de timers v0.1 (sem pause/resume) persistidos antes do upgrade.
  if (t.status === undefined) {
    return {
      ...t,
      status: 'running',
      segmentStartedAt: t.startedAt,
      accumulatedMs: 0,
      pausedAt: null,
      pauseReason: null
    }
  }
  return t
}

export async function setTimer(timer: TimerState): Promise<void> {
  await chrome.storage.local.set({ timer })
}

export async function clearTimer(): Promise<void> {
  await chrome.storage.local.remove('timer')
}

export async function getSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get('settings')
  return { ...DEFAULT_SETTINGS, ...((settings as Partial<Settings> | undefined) ?? {}) }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ settings })
}

export async function getFaceEnrollment(): Promise<FaceEnrollment | null> {
  const { faceEnrollment } = await chrome.storage.local.get('faceEnrollment')
  return (faceEnrollment as FaceEnrollment | undefined) ?? null
}

export async function setFaceEnrollment(enrollment: FaceEnrollment | null): Promise<void> {
  if (enrollment === null) {
    await chrome.storage.local.remove('faceEnrollment')
  } else {
    await chrome.storage.local.set({ faceEnrollment: enrollment })
  }
}
