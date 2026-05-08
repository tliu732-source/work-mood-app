'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  clearDevClockOverride,
  formatDateTimeLocalValue,
  readDevClockOverride,
  writeDevClockOverride,
} from '@/lib/dev-clock'
import {
  buildSummaryText,
  computeTodayShiftMetrics,
  localDateString,
} from '@/lib/daily-math'

type UserRow = {
  id: string
  timezone: string
  default_work_start_time: string
  default_work_end_time: string
  monthly_salary: number
  work_days_per_month: number
}

type SnapshotRow = {
  id: string
  user_id: string
  date: string
  work_start_time: string | null
  work_end_time: string | null
  mood: string | null
  intensity: string | null
  inefficiency: string | null
  total_work_minutes: number | null
  effective_minutes: number | null
  salary_estimated_today: number | null
  hourly_rate_effective: number | null
  money_earned_today: number | null
  money_leaked_today: number | null
  summary_text: string | null
}

const STATUS_LINES = ['正在出卖时间', '带薪发呆中', '无意义劳动中'] as const

const MOODS = ['😄', '😐', '😡', '🤡'] as const
const INTENSITIES = ['💤', '🧩', '🔥', '💀'] as const
const INEFFS = ['💎', '🪨', '🗑', '🤮'] as const

const SLACK_PRESETS: { label: string; type: 'coffee' | 'phone' | 'toilet' | 'idle' }[] = [
  { label: '买咖啡', type: 'coffee' },
  { label: '刷手机', type: 'phone' },
  { label: '摸鱼圣地', type: 'toilet' },
  { label: '发呆', type: 'idle' },
]

const LUNCH_STORAGE_KEY = 'work-mood-lunch-minutes'

function coerceEmoji<T extends string>(value: string | null | undefined, allowed: readonly T[], fallback: T): T {
  if (value && (allowed as readonly string[]).includes(value)) return value as T
  return fallback
}

export default function Home() {
  const [user, setUser] = useState<UserRow | null>(null)
  const [snapshot, setSnapshot] = useState<SnapshotRow | null>(null)
  const [slackMinutesToday, setSlackMinutesToday] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [recordOpen, setRecordOpen] = useState(false)
  const [recordStep, setRecordStep] = useState(0)
  const [slackOpen, setSlackOpen] = useState(false)
  const [devTimeOpen, setDevTimeOpen] = useState(false)
  const [devDatetimeLocal, setDevDatetimeLocal] = useState('')

  const [draftMood, setDraftMood] = useState<string>(MOODS[0])
  const [draftIntensity, setDraftIntensity] = useState<string>(INTENSITIES[0])
  const [draftIneff, setDraftIneff] = useState<string>(INEFFS[0])

  const [lunchMinutes, setLunchMinutes] = useState(60)

  const [formSalary, setFormSalary] = useState('')
  const [formWorkDays, setFormWorkDays] = useState('22')
  const [formStart, setFormStart] = useState('09:00')
  const [formEnd, setFormEnd] = useState('18:00')
  const [formLunch, setFormLunch] = useState('60')

  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  const [clockOverrideMs, setClockOverrideMs] = useState<number | null>(null)
  const [liveTick, setLiveTick] = useState(0)

  useEffect(() => {
    setClockOverrideMs(readDevClockOverride())
  }, [])

  useEffect(() => {
    if (clockOverrideMs != null) return
    const id = window.setInterval(() => setLiveTick((n) => n + 1), 15_000)
    return () => window.clearInterval(id)
  }, [clockOverrideMs])

  const nowMs = useMemo(
    () => (clockOverrideMs != null ? clockOverrideMs : Date.now()),
    [clockOverrideMs, liveTick]
  )
  const today = useMemo(() => localDateString(new Date(nowMs)), [nowMs])

  useEffect(() => {
    try {
      const v = localStorage.getItem(LUNCH_STORAGE_KEY)
      if (v != null) setLunchMinutes(Math.max(0, parseInt(v, 10) || 0))
    } catch {
      /* ignore */
    }
  }, [])

  const refreshSlackTotal = useCallback(async (userId: string) => {
    const { data, error: e } = await supabase
      .from('slack_events')
      .select('duration_minutes')
      .eq('user_id', userId)
      .eq('date', today)

    if (e) {
      console.error(e)
      return
    }
    const sum = (data ?? []).reduce(
      (acc, row: { duration_minutes: number }) => acc + (row.duration_minutes ?? 0),
      0
    )
    setSlackMinutesToday(sum)
  }, [today])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data: users, error: uErr } = await supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(1)

    if (uErr) {
      setError(uErr.message)
      setLoading(false)
      return
    }

    const u = (users?.[0] ?? null) as UserRow | null
    setUser(u)

    if (u) {
      const { data: snap, error: sErr } = await supabase
        .from('daily_snapshots')
        .select('*')
        .eq('user_id', u.id)
        .eq('date', today)
        .maybeSingle()

      if (sErr) setError(sErr.message)
      else setSnapshot((snap as SnapshotRow) ?? null)

      await refreshSlackTotal(u.id)
    } else {
      setSnapshot(null)
      setSlackMinutesToday(0)
    }

    setLoading(false)
  }, [refreshSlackTotal, today])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!user) return
    setFormSalary(String(user.monthly_salary ?? 0))
    setFormWorkDays(String(user.work_days_per_month ?? 22))
    setFormStart(String(user.default_work_start_time ?? '09:00').slice(0, 5))
    setFormEnd(String(user.default_work_end_time ?? '18:00').slice(0, 5))
    setFormLunch(String(lunchMinutes))
  }, [user, lunchMinutes])

  const shift = useMemo(() => {
    if (!user) return null
    return computeTodayShiftMetrics({
      monthlySalary: Number(user.monthly_salary) || 0,
      workDaysPerMonth: Number(user.work_days_per_month) || 22,
      workStartHm: String(user.default_work_start_time).slice(0, 5),
      workEndHm: String(user.default_work_end_time).slice(0, 5),
      lunchMinutes,
      now: new Date(nowMs),
      slackMinutes: slackMinutesToday,
    })
  }, [user, lunchMinutes, nowMs, slackMinutesToday])

  const minutesUntilOff = useMemo(() => {
    if (!user) return null
    const end = String(user.default_work_end_time).slice(0, 5)
    const [eh, em] = end.split(':').map(Number)
    const now = new Date(nowMs)
    const endToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), eh, em, 0, 0)
    const diff = Math.round((endToday.getTime() - now.getTime()) / 60000)
    return diff
  }, [user, nowMs])

  const statusLine = useMemo(() => {
    const now = new Date(nowMs)
    const idx =
      (now.getHours() + now.getMinutes() + (snapshot ? 1 : 0)) % STATUS_LINES.length
    return STATUS_LINES[idx]!
  }, [snapshot, nowMs])

  const ensureUser = async () => {
    const { data, error: e } = await supabase
      .from('users')
      .insert({
        timezone: 'Asia/Shanghai',
        default_work_start_time: '09:00',
        default_work_end_time: '18:00',
        monthly_salary: 20000,
        work_days_per_month: 22,
      })
      .select()
      .single()

    if (e) {
      setError(e.message)
      return
    }
    setUser(data as UserRow)
    setSettingsOpen(true)
  }

  const saveSettings = async () => {
    if (!user) return
    const salary = Number(formSalary) || 0
    const days = Math.min(31, Math.max(1, Math.floor(Number(formWorkDays) || 22)))
    const lunch = Math.max(0, Math.floor(Number(formLunch) || 0))
    try {
      localStorage.setItem(LUNCH_STORAGE_KEY, String(lunch))
    } catch {
      /* ignore */
    }
    setLunchMinutes(lunch)

    const { error: e } = await supabase
      .from('users')
      .update({
        monthly_salary: salary,
        work_days_per_month: days,
        default_work_start_time: formStart.length === 5 ? `${formStart}:00` : formStart,
        default_work_end_time: formEnd.length === 5 ? `${formEnd}:00` : formEnd,
      })
      .eq('id', user.id)

    if (e) {
      setError(e.message)
      return
    }
    setSettingsOpen(false)
    await load()
  }

  const submitDayRecord = async () => {
    if (!user) return

    const m = computeTodayShiftMetrics({
      monthlySalary: Number(user.monthly_salary) || 0,
      workDaysPerMonth: Number(user.work_days_per_month) || 22,
      workStartHm: String(user.default_work_start_time).slice(0, 5),
      workEndHm: String(user.default_work_end_time).slice(0, 5),
      lunchMinutes,
      now: new Date(nowMs),
      slackMinutes: slackMinutesToday,
    })

    const summary = buildSummaryText({
      mood: draftMood,
      intensity: draftIntensity,
      inefficiency: draftIneff,
      moneyEarnedToday: m.earnedMoney,
      moneyLeakedToday: m.leakedMoney,
      slackMinutes: m.slackMinutes,
    })

    const row = {
      user_id: user.id,
      date: today,
      work_start_time: String(user.default_work_start_time).slice(0, 8),
      work_end_time: String(user.default_work_end_time).slice(0, 8),
      mood: draftMood,
      intensity: draftIntensity,
      inefficiency: draftIneff,
      total_work_minutes: m.elapsedMinutes,
      effective_minutes: m.actualWorkMinutes,
      salary_estimated_today: m.daySalary,
      hourly_rate_effective: m.hourly,
      money_earned_today: m.earnedMoney,
      money_leaked_today: m.leakedMoney,
      summary_text: summary,
    }

    const { data, error: e } = await supabase
      .from('daily_snapshots')
      .upsert(row, { onConflict: 'user_id,date' })
      .select()
      .single()

    if (e) {
      setError(e.message)
      return
    }

    setSnapshot(data as SnapshotRow)
    setRecordOpen(false)
    setRecordStep(0)
  }

  const logSlack = async (type: 'coffee' | 'phone' | 'toilet' | 'idle') => {
    if (!user) {
      setError('请先初始化账户，再记录摸鱼')
      return
    }
    setError(null)
    const { error: e } = await supabase.from('slack_events').insert({
      user_id: user.id,
      date: today,
      type,
      duration_minutes: 10,
    })
    if (e) {
      setError(e.message)
      return
    }
    await refreshSlackTotal(user.id)
    setSlackOpen(false)
  }

  useEffect(() => {
    if (!slackOpen) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setSlackOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [slackOpen])

  useEffect(() => {
    if (!recordOpen) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setRecordOpen(false)
        setRecordStep(0)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [recordOpen])

  useEffect(() => {
    if (!devTimeOpen) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setDevTimeOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [devTimeOpen])

  const openRecord = (mode: 'new' | 'reedit' = 'new') => {
    setRecordStep(0)
    if (mode === 'reedit' && snapshot) {
      setDraftMood(coerceEmoji(snapshot.mood, MOODS, MOODS[0]))
      setDraftIntensity(coerceEmoji(snapshot.intensity, INTENSITIES, INTENSITIES[0]))
      setDraftIneff(coerceEmoji(snapshot.inefficiency, INEFFS, INEFFS[0]))
    }
    setRecordOpen(true)
  }

  const clearTodaySnapshot = async () => {
    if (!user || !snapshot) return
    if (!confirm('确定清空今日日报？清空后可以重新走一遍「结束今天的打工」流程。')) return
    setError(null)
    const { error: e } = await supabase
      .from('daily_snapshots')
      .delete()
      .eq('user_id', user.id)
      .eq('date', today)

    if (e) {
      setError(e.message)
      return
    }
    setSnapshot(null)
    setDraftMood(MOODS[0])
    setDraftIntensity(INTENSITIES[0])
    setDraftIneff(INEFFS[0])
  }

  const nextRecordStep = () => {
    if (recordStep < 2) setRecordStep((s) => s + 1)
    else void submitDayRecord()
  }

  const showSlackDock = mounted && !recordOpen && !settingsOpen && !devTimeOpen

  const openDevTimeModal = () => {
    setDevDatetimeLocal(formatDateTimeLocalValue(new Date(nowMs)))
    setDevTimeOpen(true)
  }

  const applyDevTime = () => {
    const d = new Date(devDatetimeLocal)
    if (Number.isNaN(d.getTime())) {
      setError('测试时间格式无效')
      return
    }
    setError(null)
    writeDevClockOverride(d.getTime())
    setClockOverrideMs(d.getTime())
    setDevTimeOpen(false)
    void load()
  }

  const resetDevTimeToReal = () => {
    setError(null)
    clearDevClockOverride()
    setClockOverrideMs(null)
    setLiveTick((n) => n + 1)
    setDevTimeOpen(false)
    void load()
  }

  return (
    <>
    <div className="relative mx-auto flex min-h-full max-w-md flex-1 flex-col px-4 pb-28 pt-6">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
            打工状态
          </p>
          <h1 className="mt-1 text-xl font-semibold text-neutral-900 dark:text-neutral-50">
            {statusLine}
          </h1>
          {user && minutesUntilOff != null && (
            <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
              {minutesUntilOff > 0
                ? `距离下班大约还有 ${Math.floor(minutesUntilOff / 60)} 小时 ${minutesUntilOff % 60} 分`
                : '今日班次时间已过，灵魂是否下班另说'}
            </p>
          )}
          {mounted && clockOverrideMs != null && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-300/90">
              测试时钟：{formatDateTimeLocalValue(new Date(nowMs)).replace('T', ' ')}（非真实时间）
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {mounted && (
            <button
              type="button"
              onClick={openDevTimeModal}
              className="rounded-full border border-dashed border-amber-300/80 bg-amber-50/90 px-2.5 py-1 text-xs font-medium text-amber-900 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-100"
            >
              测试时间
            </button>
          )}
          {user ? (
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="rounded-full border border-neutral-200 bg-white/80 px-3 py-1.5 text-sm text-neutral-700 shadow-sm backdrop-blur dark:border-neutral-700 dark:bg-neutral-900/80 dark:text-neutral-200"
              aria-label="设置"
            >
              设置
            </button>
          ) : (
            <span className="h-9 w-14" aria-hidden />
          )}
        </div>
      </header>

      {error && (
        <div
          className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200"
          role="alert"
        >
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-neutral-500">加载中…</p>
      ) : !user ? (
        <section className="rounded-2xl border border-dashed border-neutral-300 bg-neutral-50/80 p-6 text-center dark:border-neutral-600 dark:bg-neutral-900/40">
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            还没有用户配置。点下面一键创建默认用户（可在设置里改月薪与工时）。
          </p>
          <button
            type="button"
            onClick={() => void ensureUser()}
            className="mt-4 w-full rounded-xl bg-neutral-900 py-3 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
          >
            初始化账户
          </button>
        </section>
      ) : (
        <>
          <section className="mb-6">
            {!snapshot ? (
              <button
                type="button"
                onClick={() => openRecord('new')}
                className="w-full rounded-2xl bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500 py-4 text-base font-semibold text-white shadow-lg shadow-orange-500/25"
              >
                结束今天的打工
              </button>
            ) : (
              <div className="rounded-2xl border border-neutral-200 bg-white/90 p-5 shadow-sm dark:border-neutral-700 dark:bg-neutral-900/90">
                <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                  今日日报
                </p>
                {shift && (
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-neutral-500 dark:text-neutral-400">当日已上班时长</p>
                      <p className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                        {shift.elapsedMinutes} 分
                      </p>
                    </div>
                    <div>
                      <p className="text-neutral-500 dark:text-neutral-400">时薪（估）</p>
                      <p className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                        ¥{shift.hourly.toFixed(2)}/h
                      </p>
                    </div>
                    <div>
                      <p className="text-neutral-500 dark:text-neutral-400">已赚金额（估）</p>
                      <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">
                        ¥{shift.earnedMoney.toFixed(0)}
                      </p>
                    </div>
                    <div>
                      <p className="text-neutral-500 dark:text-neutral-400">摸鱼时长</p>
                      <p className="text-lg font-semibold text-amber-600 dark:text-amber-400">
                        {shift.slackMinutes} 分
                      </p>
                    </div>
                    <div>
                      <p className="text-neutral-500 dark:text-neutral-400">当日实际工作时长</p>
                      <p className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                        {shift.actualWorkMinutes} 分
                      </p>
                    </div>
                    <div>
                      <p className="text-neutral-500 dark:text-neutral-400">摸鱼白嫖金额（估）</p>
                      <p className="text-lg font-semibold text-rose-600 dark:text-rose-400">
                        ¥{shift.leakedMoney.toFixed(0)}
                      </p>
                    </div>
                  </div>
                )}
                <p className="mt-4 rounded-xl bg-neutral-100/80 px-3 py-3 text-sm leading-relaxed text-neutral-800 dark:bg-neutral-800/60 dark:text-neutral-100">
                  {snapshot.summary_text ?? '—'}
                </p>
                <div className="mt-4 flex flex-col gap-2 border-t border-neutral-200 pt-4 dark:border-neutral-700">
                  <button
                    type="button"
                    onClick={() => openRecord('reedit')}
                    className="w-full rounded-xl border border-neutral-200 bg-white py-3 text-sm font-medium text-neutral-800 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
                  >
                    重新记录今天
                  </button>
                  <button
                    type="button"
                    onClick={() => void clearTodaySnapshot()}
                    className="text-center text-sm text-neutral-500 underline-offset-2 hover:text-neutral-700 hover:underline dark:text-neutral-400 dark:hover:text-neutral-200"
                  >
                    清空今日日报
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-neutral-200 bg-neutral-50/60 p-4 dark:border-neutral-700 dark:bg-neutral-900/50">
            <h2 className="text-sm font-medium text-neutral-800 dark:text-neutral-100">实时数据</h2>
            {shift ? (
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-neutral-500 dark:text-neutral-400">当日已上班时长</p>
                  <p className="font-semibold text-neutral-900 dark:text-neutral-50">
                    {shift.elapsedMinutes} 分
                  </p>
                </div>
                <div>
                  <p className="text-neutral-500 dark:text-neutral-400">时薪（估）</p>
                  <p className="font-semibold text-neutral-900 dark:text-neutral-50">
                    ¥{shift.hourly.toFixed(2)}/h
                  </p>
                </div>
                <div>
                  <p className="text-neutral-500 dark:text-neutral-400">已赚金额（估）</p>
                  <p className="font-semibold text-neutral-900 dark:text-neutral-50">
                    ¥{shift.earnedMoney.toFixed(0)}
                  </p>
                </div>
                <div>
                  <p className="text-neutral-500 dark:text-neutral-400">摸鱼时长</p>
                  <p className="font-semibold text-neutral-900 dark:text-neutral-50">
                    {shift.slackMinutes} 分
                  </p>
                </div>
                <div>
                  <p className="text-neutral-500 dark:text-neutral-400">当日实际工作时长</p>
                  <p className="font-semibold text-neutral-900 dark:text-neutral-50">
                    {shift.actualWorkMinutes} 分
                  </p>
                </div>
                <div>
                  <p className="text-neutral-500 dark:text-neutral-400">摸鱼白嫖金额（估）</p>
                  <p className="font-semibold text-rose-600 dark:text-rose-400">
                    ¥{shift.leakedMoney.toFixed(0)}
                  </p>
                </div>
              </div>
            ) : (
              <p className="mt-2 text-sm text-neutral-500">—</p>
            )}
          </section>
        </>
      )}

      {/* 记录流程 */}
      {recordOpen && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="record-title"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-neutral-900">
            <h2 id="record-title" className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
              {recordStep === 0 && '今天心情怎么样？'}
              {recordStep === 1 && '工作强度？'}
              {recordStep === 2 && '无效感有多强？'}
            </h2>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              第 {recordStep + 1} / 3 步
            </p>
            {snapshot && (
              <p className="mt-2 text-xs text-amber-800 dark:text-amber-200/90">
                正在修改已有日报，保存后会覆盖今日数据。
              </p>
            )}
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              {recordStep === 0 &&
                MOODS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setDraftMood(m)}
                    className={`flex h-14 w-14 items-center justify-center rounded-2xl text-2xl transition ${
                      draftMood === m
                        ? 'bg-orange-100 ring-2 ring-orange-500 dark:bg-orange-950 dark:ring-orange-400'
                        : 'bg-neutral-100 dark:bg-neutral-800'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              {recordStep === 1 &&
                INTENSITIES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setDraftIntensity(m)}
                    className={`flex h-14 w-14 items-center justify-center rounded-2xl text-2xl transition ${
                      draftIntensity === m
                        ? 'bg-orange-100 ring-2 ring-orange-500 dark:bg-orange-950 dark:ring-orange-400'
                        : 'bg-neutral-100 dark:bg-neutral-800'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              {recordStep === 2 &&
                INEFFS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setDraftIneff(m)}
                    className={`flex h-14 w-14 items-center justify-center rounded-2xl text-2xl transition ${
                      draftIneff === m
                        ? 'bg-orange-100 ring-2 ring-orange-500 dark:bg-orange-950 dark:ring-orange-400'
                        : 'bg-neutral-100 dark:bg-neutral-800'
                    }`}
                  >
                    {m}
                  </button>
                ))}
            </div>
            <div className="mt-8 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  if (recordStep === 0) setRecordOpen(false)
                  else setRecordStep((s) => s - 1)
                }}
                className="flex-1 rounded-xl border border-neutral-200 py-3 text-sm font-medium dark:border-neutral-600"
              >
                {recordStep === 0 ? '取消' : '上一步'}
              </button>
              <button
                type="button"
                onClick={recordStep === 2 ? () => void submitDayRecord() : () => nextRecordStep()}
                className="flex-1 rounded-xl bg-neutral-900 py-3 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
              >
                {recordStep === 2 ? (snapshot ? '更新日报' : '生成日报') : '下一步'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 设置 */}
      {settingsOpen && user && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl dark:bg-neutral-900">
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">设置</h2>
            <div className="mt-4 space-y-3 text-sm">
              <label className="block">
                <span className="text-neutral-600 dark:text-neutral-300">月薪（元）</span>
                <input
                  className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 dark:border-neutral-600 dark:bg-neutral-950"
                  value={formSalary}
                  onChange={(e) => setFormSalary(e.target.value)}
                  inputMode="decimal"
                />
              </label>
              <label className="block">
                <span className="text-neutral-600 dark:text-neutral-300">每月工作天数</span>
                <input
                  className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 dark:border-neutral-600 dark:bg-neutral-950"
                  value={formWorkDays}
                  onChange={(e) => setFormWorkDays(e.target.value)}
                  inputMode="numeric"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-neutral-600 dark:text-neutral-300">上班时间</span>
                  <input
                    type="time"
                    className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-2 py-2 dark:border-neutral-600 dark:bg-neutral-950"
                    value={formStart.length === 5 ? formStart : formStart.slice(0, 5)}
                    onChange={(e) => setFormStart(e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="text-neutral-600 dark:text-neutral-300">下班时间</span>
                  <input
                    type="time"
                    className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-2 py-2 dark:border-neutral-600 dark:bg-neutral-950"
                    value={formEnd.length === 5 ? formEnd : formEnd.slice(0, 5)}
                    onChange={(e) => setFormEnd(e.target.value)}
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-neutral-600 dark:text-neutral-300">午休（分钟，仅用于计算）</span>
                <input
                  className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 dark:border-neutral-600 dark:bg-neutral-950"
                  value={formLunch}
                  onChange={(e) => setFormLunch(e.target.value)}
                  inputMode="numeric"
                />
              </label>
              <p className="rounded-xl bg-neutral-100 px-3 py-2 text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                节假日规则：MVP 未写入数据库，后续可在工作日历里扩展。
              </p>
            </div>
            <div className="mt-6 flex gap-2">
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="flex-1 rounded-xl border border-neutral-200 py-3 text-sm dark:border-neutral-600"
              >
                关闭
              </button>
              <button
                type="button"
                onClick={() => void saveSettings()}
                className="flex-1 rounded-xl bg-neutral-900 py-3 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {devTimeOpen && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dev-time-title"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-neutral-900">
            <h2 id="dev-time-title" className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
              测试时间
            </h2>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              仅保存在本机浏览器，用于自测「今日」数据、下班倒计时和状态文案。应用后会重新拉取该日期的快照与摸鱼记录。
            </p>
            <label className="mt-4 block text-sm">
              <span className="text-neutral-600 dark:text-neutral-300">假定为此刻（本地时区）</span>
              <input
                type="datetime-local"
                className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 dark:border-neutral-600 dark:bg-neutral-950"
                value={devDatetimeLocal}
                onChange={(e) => setDevDatetimeLocal(e.target.value)}
              />
            </label>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => setDevTimeOpen(false)}
                className="flex-1 rounded-xl border border-neutral-200 py-3 text-sm dark:border-neutral-600"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void resetDevTimeToReal()}
                className="flex-1 rounded-xl border border-neutral-200 py-3 text-sm dark:border-neutral-600"
              >
                使用真实时间
              </button>
              <button
                type="button"
                onClick={() => void applyDevTime()}
                className="flex-1 rounded-xl bg-neutral-900 py-3 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
              >
                应用
              </button>
            </div>
          </div>
        </div>
      )}
    </div>

    {showSlackDock && (
      <>
        {slackOpen && (
          <div
            className="fixed inset-0 z-[190] bg-black/25"
            aria-hidden
            onClick={() => setSlackOpen(false)}
          />
        )}
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[200] flex justify-center pb-[max(1.25rem,env(safe-area-inset-bottom,0px))]">
          <div className="pointer-events-auto flex w-full max-w-md flex-col items-end gap-2 px-4">
            {slackOpen && (
              <div
                role="menu"
                aria-label="摸鱼快捷记录"
                className="mb-1 flex min-w-[10.5rem] flex-col gap-1 rounded-2xl border border-neutral-200 bg-white p-2 shadow-xl dark:border-neutral-600 dark:bg-neutral-900"
                onClick={(e) => e.stopPropagation()}
              >
                {SLACK_PRESETS.map((p) => (
                  <button
                    key={p.type}
                    type="button"
                    role="menuitem"
                    onClick={() => void logSlack(p.type)}
                    className="rounded-xl px-4 py-3 text-left text-sm font-medium text-neutral-800 touch-manipulation active:bg-neutral-100 dark:text-neutral-100 dark:active:bg-neutral-800"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => setSlackOpen((o) => !o)}
              className="flex h-14 w-14 shrink-0 touch-manipulation items-center justify-center rounded-full border-2 border-white bg-neutral-900 text-lg shadow-xl text-white dark:border-neutral-700 dark:bg-neutral-100 dark:text-neutral-900"
              aria-expanded={slackOpen}
              aria-haspopup="menu"
              aria-label={slackOpen ? '关闭摸鱼菜单' : '打开摸鱼菜单'}
            >
              🐟
            </button>
          </div>
        </div>
      </>
    )}
    </>
  )
}
