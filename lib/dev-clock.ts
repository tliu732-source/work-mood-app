/** 本地假时间（毫秒时间戳），仅用于开发/自测 UI 与计算 */

export const DEV_CLOCK_MS_KEY = 'work-mood-dev-clock-override-ms'

export function readDevClockOverride(): number | null {
  if (typeof window === 'undefined') return null
  try {
    const s = localStorage.getItem(DEV_CLOCK_MS_KEY)
    if (s == null || s === '') return null
    const n = Number(s)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

export function writeDevClockOverride(ms: number): void {
  localStorage.setItem(DEV_CLOCK_MS_KEY, String(ms))
}

export function clearDevClockOverride(): void {
  localStorage.removeItem(DEV_CLOCK_MS_KEY)
}

/** `datetime-local` 用的字符串（本地时区） */
export function formatDateTimeLocalValue(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${day}T${h}:${min}`
}
