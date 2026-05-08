-- ============================================================
-- 可选：仅为 daily_snapshots 列补充说明（语义与 App 新逻辑对齐）
-- 不需要改列类型或加列；在 Supabase → SQL Editor 整段执行即可。
-- ============================================================

COMMENT ON COLUMN public.daily_snapshots.total_work_minutes IS
  '当日已上班时长(分钟)：提交时刻与上班时间的差，截断在下班后；与 App elapsedWorkMinutesSinceStart 一致';

COMMENT ON COLUMN public.daily_snapshots.effective_minutes IS
  '当日实际工作时长(分钟) = 当日已上班时长 − 摸鱼时长（摸鱼为 slack_events 当日合计）';

COMMENT ON COLUMN public.daily_snapshots.salary_estimated_today IS
  '日薪 = 月薪 / 每月工作日天数';

COMMENT ON COLUMN public.daily_snapshots.hourly_rate_effective IS
  '时薪 = 日薪 / 当日净工作小时数；净工作分钟 = 下班−上班−午休';

COMMENT ON COLUMN public.daily_snapshots.money_earned_today IS
  '已赚金额(估) = (当日已上班分钟/60) × 时薪';

COMMENT ON COLUMN public.daily_snapshots.money_leaked_today IS
  '摸鱼白嫖金额(估) = (摸鱼分钟/60) × 时薪';

COMMENT ON COLUMN public.daily_snapshots.mood IS '用户选择的心情（不参与金额公式）';
COMMENT ON COLUMN public.daily_snapshots.intensity IS '用户选择的工作强度（不参与金额公式）';
COMMENT ON COLUMN public.daily_snapshots.inefficiency IS '用户选择的无效感（不参与金额公式）';
