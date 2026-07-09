/**
 * Formato do comentário consumido pela extração de dados existente.
 * NÃO alterar sem atualizar o parser do outro lado:
 *
 *   init_task: 2026-07-09 09:00:00.000000 -03:00
 *   -end_task: 2026-07-09 12:00:00.000000 -03:00-
 */

function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0')
}

/** Timestamp na hora local do dev, padrão `YYYY-MM-DD HH:MM:SS.ffffff ±HH:MM`. */
export function formatLinearTimestamp(date: Date): string {
  const micros = pad(date.getMilliseconds(), 3) + '000'
  // getTimezoneOffset: minutos para chegar em UTC (BRT = 180 → offset -03:00).
  const offsetMin = -date.getTimezoneOffset()
  const sign = offsetMin < 0 ? '-' : '+'
  const abs = Math.abs(offsetMin)
  const offset = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `.${micros} ${offset}`
  )
}

/** Corpo do comentário de uma sessão play→pause. */
export function buildComment(start: Date, end: Date): string {
  return `init_task: ${formatLinearTimestamp(start)}\n-end_task: ${formatLinearTimestamp(end)}-`
}

/** Duração humana: "3h 05m", "47m", "2m". */
export function formatElapsed(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes}m`
  return `${hours}h ${pad(minutes)}m`
}

/** Relógio "HH:MM:SS" para o cronômetro ao vivo. */
export function formatClock(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}
