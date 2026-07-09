export interface TimerState {
  /** UUID interno do Linear, usado na mutation de comentário. */
  issueId: string
  /** Identificador humano, ex.: THE-558. */
  identifier: string
  title: string
  /** Epoch ms UTC do play. */
  startedAt: number
}

export interface Settings {
  apiKey: string
  webhookUrl: string
  phone: string
  reminderMinutes: number
}

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  webhookUrl: '',
  phone: '',
  reminderMinutes: 60
}

export async function getTimer(): Promise<TimerState | null> {
  const { timer } = await chrome.storage.local.get('timer')
  return (timer as TimerState | undefined) ?? null
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
