/** 无效感系数（仅用于问卷/总结文案，不参与金额计算） */
export const INEFFICIENCY_FACTOR: Record<string, number> = {
  '💎': 0.9,
  '🪨': 0.6,
  '🗑': 0.3,
  '🤮': 0.1,
}

export function inefficiencyFactor(emoji: string): number {
  return INEFFICIENCY_FACTOR[emoji] ?? 0.5
}

/** 将 "HH:MM" 或 "HH:MM:SS" 转为当天从 00:00 起的分钟数 */
export function timeStringToMinutes(t: string): number {
  const parts = t.slice(0, 8).split(':').map(Number)
  const h = parts[0] ?? 0
  const m = parts[1] ?? 0
  return h * 60 + m
}

/** 计划净工作时长（分钟）= 下班 − 上班 − 午休（墙钟） */
export function scheduledWorkMinutes(
  workStart: string,
  workEnd: string,
  lunchMinutes: number
): number {
  const s = timeStringToMinutes(workStart)
  const e = timeStringToMinutes(workEnd)
  let span = e - s
  if (span <= 0) span += 24 * 60
  return Math.max(0, span - Math.max(0, lunchMinutes))
}

/** 日薪 = 月薪 / 每月工作日天数 */
export function dailySalary(monthly: number, workDaysPerMonth: number): number {
  if (workDaysPerMonth <= 0) return 0
  return monthly / workDaysPerMonth
}

/**
 * 时薪 = 日薪 /（当日净工作小时数）
 * 当日净工作小时 = (下班−上班−午休) / 60
 */
export function hourlyRateFromDailyAndNetMinutes(dailySalaryAmount: number, netWorkdayMinutes: number): number {
  if (netWorkdayMinutes <= 0) return 0
  return dailySalaryAmount / (netWorkdayMinutes / 60)
}

/** @deprecated 使用 hourlyRateFromDailyAndNetMinutes(dailySalary(m,d), capacity) */
export function hourlyRateFromSchedule(
  monthly: number,
  workDaysPerMonth: number,
  workMinutesPerDay: number
): number {
  const day = dailySalary(monthly, workDaysPerMonth)
  return hourlyRateFromDailyAndNetMinutes(day, workMinutesPerDay)
}

/**
 * 当日已上班时长（分钟）：当前时刻与当日上班时间之差；
 * 若已超过下班时间，则截断到「上班点～下班点」这段墙钟时长（含午休墙钟，不含下班后）。
 */
export function elapsedWorkMinutesSinceStart(now: Date, workStartHm: string, workEndHm: string): number {
  const startHm = workStartHm.slice(0, 5)
  const endHm = workEndHm.slice(0, 5)
  const y = now.getFullYear()
  const mo = now.getMonth()
  const d = now.getDate()
  const [sh, sm] = startHm.split(':').map(Number)
  const [eh, em] = endHm.split(':').map(Number)
  const startDt = new Date(y, mo, d, sh, sm, 0, 0)
  const endDt = new Date(y, mo, d, eh, em, 0, 0)
  if (endDt.getTime() <= startDt.getTime()) {
    endDt.setDate(endDt.getDate() + 1)
  }
  const t = now.getTime()
  if (t <= startDt.getTime()) return 0
  const capEnd = Math.min(t, endDt.getTime())
  return Math.max(0, Math.round((capEnd - startDt.getTime()) / 60000))
}

export type ShiftMoneyInput = {
  monthlySalary: number
  workDaysPerMonth: number
  workStartHm: string
  workEndHm: string
  lunchMinutes: number
  now: Date
  slackMinutes: number
}

export type ShiftMoneyResult = {
  /** 下班−上班−午休（分钟），用于算时薪 */
  capacityMinutes: number
  daySalary: number
  hourly: number
  /** 当日已上班时长（分钟） */
  elapsedMinutes: number
  slackMinutes: number
  /** 当日实际工作 = 已上班 − 摸鱼 */
  actualWorkMinutes: number
  /** 已赚 = (已上班/60)*时薪 */
  earnedMoney: number
  /** 摸鱼白嫖 = (摸鱼/60)*时薪 */
  leakedMoney: number
}

/** 首页与日报提交用的统一计算 */
export function computeTodayShiftMetrics(input: ShiftMoneyInput): ShiftMoneyResult {
  const capacityMinutes = scheduledWorkMinutes(
    input.workStartHm,
    input.workEndHm,
    input.lunchMinutes
  )
  const daySalary = dailySalary(input.monthlySalary, input.workDaysPerMonth)
  const hourly = hourlyRateFromDailyAndNetMinutes(daySalary, capacityMinutes)
  const elapsedMinutes = elapsedWorkMinutesSinceStart(input.now, input.workStartHm, input.workEndHm)
  const slackMinutes = Math.max(0, input.slackMinutes)
  const actualWorkMinutes = Math.max(0, elapsedMinutes - slackMinutes)
  const earnedMoney = (elapsedMinutes / 60) * hourly
  const leakedMoney = (slackMinutes / 60) * hourly
  return {
    capacityMinutes,
    daySalary,
    hourly,
    elapsedMinutes,
    slackMinutes,
    actualWorkMinutes,
    earnedMoney,
    leakedMoney,
  }
}

export function buildSummaryText(params: {
  mood: string
  intensity: string
  inefficiency: string
  moneyEarnedToday: number
  moneyLeakedToday: number
  slackMinutes: number
}): string {
  const moodLine: Record<string, string> = {
    '😄': '今天心情居然还行',
    '😐': '又是平平无奇被班味腌透的一天',
    '😡': '上班上得想给宇宙写差评',
    '🤡': '小丑竟是我自己，工位竟是马戏团',
  }
  const intLine: Record<string, string> = {
    '💤': '强度像在梦游',
    '🧩': '强度中规中矩，拼图式打工',
    '🔥': '强度拉满，人快碳化',
    '💀': '强度地狱模式，存活即胜利',
  }
  const a = moodLine[params.mood] ?? '今日打工已存档'
  const b = intLine[params.intensity] ?? ''
  const earned = params.moneyEarnedToday.toFixed(0)
  const leaked = params.moneyLeakedToday.toFixed(0)
  const slack =
    params.slackMinutes > 0
      ? `摸鱼约 ${params.slackMinutes} 分钟，白嫖约 ¥${leaked}。`
      : '今天居然没怎么摸鱼，值得怀疑。'
  return `${a}；${b}。按已上班时长粗算约 ¥${earned}。${slack}`
}

export function localDateString(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
