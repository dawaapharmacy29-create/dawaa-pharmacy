import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Clock3, Loader2, Save, Star, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

type Row = {
  id: string;
  staff_id: string;
  branch: string;
  completed: boolean;
  photo_url: string | null;
  staff_note: string | null;
  submitted_at: string | null;
  review_status: 'pending' | 'approved' | 'rejected';
  reviewer_note: string | null;
  staff_daily_checklist_items: { title: string; description: string | null; requires_photo: boolean; time_slot: string } | null;
  staff: { name: string; role: string } | null;
};

type CleaningRatingCard = {
  staff_id: string;
  staff_name: string;
  staff_role: string;
  branch: string;
  rating_id: string | null;
  stars: number | null;
  score_pct: number | null;
  points_delta: number | null;
  manager_note: string | null;
  rated_by_name: string | null;
  updated_at: string | null;
};

type CleaningDaySummary = {
  staff_id: string;
  rating_date: string;
  required_items: number;
  submitted_items: number;
  reviewed_items: number;
  approved_items: number;
  rejected_items: number;
  pending_items: number;
  max_stars: number;
  rating_ready: boolean;
};

type CleaningCycleManagerSummary = {
  staff_id: string;
  staff_name: string;
  branch: string;
  month_cycle: string;
  cycle_start: string;
  cycle_end: string;
  rated_days: number;
  avg_stars: number;
  total_star_points: number;
  checklist_days: number;
  fully_reviewed_days: number;
  submitted_items: number;
  approved_items: number;
  rejected_items: number;
  pending_items: number;
  timing_attention_count: number;
  rating_coverage_pct: number;
  on_time_pct: number;
};

function starPoints(stars: number) {
  if (stars === 5) return 5;
  if (stars === 4) return 2;
  if (stars === 3) return 0;
  if (stars === 2) return -5;
  return -10;
}

function pointsLabel(points: number) {
  if (points > 0) return `+${points} نقاط`;
  if (points < 0) return `${points} نقاط`;
  return 'بدون تغيير نقاط';
}

function isAllBranchesValue(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return ['كل_الفروع', 'all_branches', 'all'].includes(normalized);
}

function cairoDateKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function cairoMinutes(iso: string | null) {
  if (!iso) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
  return hour * 60 + minute;
}

function cleaningTimingStatus(row: Row) {
  const minutes = cairoMinutes(row.submitted_at);
  const slot = row.staff_daily_checklist_items?.time_slot || '';
  if (minutes == null) return 'unclassified' as const;
  if (slot === 'فتح') return minutes >= 360 && minutes <= 660 ? 'on_time' as const : 'outside_window' as const;
  if (slot === 'أثناء اليوم') return minutes >= 540 && minutes <= 1320 ? 'on_time' as const : 'outside_window' as const;
  if (slot === 'قفل') return minutes >= 1200 || minutes <= 240 ? 'on_time' as const : 'outside_window' as const;
  return 'unclassified' as const;
}

function formatCairoTime(iso: string | null) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'Africa/Cairo',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export default function BranchChecklistReview() {
  const { user } = useAuth();
  const branch = user?.branch || '';
  const allBranches = isAllBranchesValue(branch);
  const [rows, setRows] = useState<Row[]>([]);
  const [cleaningRatings, setCleaningRatings] = useState<CleaningRatingCard[]>([]);
  const [cleaningDaySummary, setCleaningDaySummary] = useState<Record<string, CleaningDaySummary>>({});
  const [cycleSummary, setCycleSummary] = useState<Record<string, CleaningCycleManagerSummary>>({});
  const [loading, setLoading] = useState(true);
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [starDraft, setStarDraft] = useState<Record<string, number>>({});
  const [ratingNoteDraft, setRatingNoteDraft] = useState<Record<string, string>>({});
  const [ratingSaving, setRatingSaving] = useState<string | null>(null);
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const today = cairoDateKey();

  const load = useCallback(async () => {
    if (!branch) {
      setRows([]);
      setCleaningRatings([]);
      setCleaningDaySummary({});
      setCycleSummary({});
      setLoading(false);
      return;
    }

    setLoading(true);

    let checklistQuery = supabase
      .from('staff_daily_checklist_submissions')
      .select(
        'id, staff_id, branch, completed, photo_url, staff_note, submitted_at, review_status, reviewer_note, staff_daily_checklist_items(title, description, requires_photo, time_slot), staff:staff!staff_daily_checklist_submissions_staff_id_fkey(name, role)'
      )
      .eq('submission_date', today)
      .eq('completed', true)
      .order('branch', { ascending: true })
      .order('created_at', { ascending: true });

    if (!allBranches) checklistQuery = checklistQuery.eq('branch', branch);

    const [checklistResult, ratingResult, cycleResult] = await Promise.all([
      checklistQuery,
      supabase.rpc('get_cleaning_daily_rating_cards_v1', {
        p_rating_date: today,
        p_branch: allBranches ? null : branch,
      }),
      supabase.rpc('get_cleaning_cycle_manager_summary_v1', {
        p_month_cycle: null,
        p_branch: allBranches ? null : branch,
      }),
    ]);

    if (checklistResult.error) {
      toast.error('تعذر تحميل مراجعات التشيك ليست');
      console.error('[BranchChecklistReview] checklist load failed', checklistResult.error);
      setRows([]);
    } else {
      setRows((checklistResult.data || []) as unknown as Row[]);
    }

    if (cycleResult.error) {
      console.error('[BranchChecklistReview] cycle summary load failed', cycleResult.error);
      setCycleSummary({});
    } else {
      const map: Record<string, CleaningCycleManagerSummary> = {};
      for (const raw of (cycleResult.data || []) as Record<string, unknown>[]) {
        const summary: CleaningCycleManagerSummary = {
          staff_id: String(raw.staff_id || ''),
          staff_name: String(raw.staff_name || ''),
          branch: String(raw.branch || ''),
          month_cycle: String(raw.month_cycle || ''),
          cycle_start: String(raw.cycle_start || ''),
          cycle_end: String(raw.cycle_end || ''),
          rated_days: Number(raw.rated_days || 0),
          avg_stars: Number(raw.avg_stars || 0),
          total_star_points: Number(raw.total_star_points || 0),
          checklist_days: Number(raw.checklist_days || 0),
          fully_reviewed_days: Number(raw.fully_reviewed_days || 0),
          submitted_items: Number(raw.submitted_items || 0),
          approved_items: Number(raw.approved_items || 0),
          rejected_items: Number(raw.rejected_items || 0),
          pending_items: Number(raw.pending_items || 0),
          timing_attention_count: Number(raw.timing_attention_count || 0),
          rating_coverage_pct: Number(raw.rating_coverage_pct || 0),
          on_time_pct: Number(raw.on_time_pct || 0),
        };
        if (summary.staff_id) map[summary.staff_id] = summary;
      }
      setCycleSummary(map);
    }

    if (ratingResult.error) {
      console.error('[BranchChecklistReview] cleaning rating load failed', ratingResult.error);
      setCleaningRatings([]);
      setCleaningDaySummary({});
    } else {
      const cards = ((ratingResult.data || []) as CleaningRatingCard[]).map((card) => ({
        ...card,
        stars: card.stars == null ? null : Number(card.stars),
        score_pct: card.score_pct == null ? null : Number(card.score_pct),
        points_delta: card.points_delta == null ? null : Number(card.points_delta),
      }));
      setCleaningRatings(cards);

      const summaryEntries = await Promise.all(
        cards.map(async (card) => {
          const { data, error } = await supabase.rpc('get_cleaning_day_checklist_summary_v2', {
            p_staff_id: card.staff_id,
            p_rating_date: today,
          });
          if (error) {
            console.error('[BranchChecklistReview] cleaning day summary failed', card.staff_id, error);
            return [card.staff_id, null] as const;
          }
          const raw = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
          if (!raw) return [card.staff_id, null] as const;
          return [card.staff_id, {
            staff_id: String(raw.staff_id || card.staff_id),
            rating_date: String(raw.rating_date || today),
            required_items: Number(raw.required_items || 0),
            submitted_items: Number(raw.submitted_items || 0),
            reviewed_items: Number(raw.reviewed_items || 0),
            approved_items: Number(raw.approved_items || 0),
            rejected_items: Number(raw.rejected_items || 0),
            pending_items: Number(raw.pending_items || 0),
            max_stars: Number(raw.max_stars || 0),
            rating_ready: Boolean(raw.rating_ready),
          } satisfies CleaningDaySummary] as const;
        })
      );
      const nextSummary: Record<string, CleaningDaySummary> = {};
      for (const [staffId, summary] of summaryEntries) {
        if (summary) nextSummary[staffId] = summary;
      }
      setCleaningDaySummary(nextSummary);

      setStarDraft((prev) => {
        const next = { ...prev };
        for (const card of cards) {
          if (next[card.staff_id] == null && card.stars) next[card.staff_id] = card.stars;
        }
        return next;
      });
      setRatingNoteDraft((prev) => {
        const next = { ...prev };
        for (const card of cards) {
          if (next[card.staff_id] == null && card.manager_note) next[card.staff_id] = card.manager_note;
        }
        return next;
      });
    }
    setLoading(false);
  }, [allBranches, branch, today]);

  useEffect(() => {
    void load();
  }, [load]);

  const review = useCallback(
    async (row: Row, status: 'approved' | 'rejected') => {
      const rejectionNote = noteDraft[row.id]?.trim() || '';
      if (status === 'rejected' && !rejectionNote) {
        toast.error('اكتب سبب الرفض قبل تسجيل الخصم.');
        return;
      }
      const { error } = await supabase.rpc('review_staff_daily_checklist_v1', {
        p_submission_id: row.id,
        p_status: status,
        p_reviewer_note: status === 'rejected' ? rejectionNote : null,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success(status === 'approved' ? 'تم الاعتماد' : 'تم الرفض وتسجيل الإجراء');
      await load();
    },
    [load, noteDraft]
  );

  const saveCleaningRating = useCallback(async (card: CleaningRatingCard) => {
    const stars = starDraft[card.staff_id] || 0;
    const daySummary = cleaningDaySummary[card.staff_id];
    if (!daySummary?.rating_ready) {
      toast.error('راجع كل مهام النظافة المطلوبة أولًا قبل اعتماد تقييم اليوم.');
      return;
    }
    if (stars < 1 || stars > daySummary.max_stars) {
      toast.error(`الحد الأقصى لتقييم اليوم هو ${daySummary.max_stars}/5 حسب البنود المعتمدة.`);
      return;
    }
    setRatingSaving(card.staff_id);
    try {
      const { error } = await supabase.rpc('rate_cleaning_staff_day_v1', {
        p_staff_id: card.staff_id,
        p_stars: stars,
        p_manager_note: ratingNoteDraft[card.staff_id]?.trim() || null,
        p_rating_date: today,
      });
      if (error) throw error;
      toast.success(`تم حفظ تقييم ${card.staff_name}: ${stars}/5`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر حفظ تقييم النظافة');
    } finally {
      setRatingSaving(null);
    }
  }, [cleaningDaySummary, load, ratingNoteDraft, starDraft, today]);

  const availableBranches = useMemo(() => {
    if (!allBranches) return branch ? [branch] : [];
    return Array.from(new Set([...cleaningRatings.map((card) => card.branch), ...rows.map((row) => row.branch)].filter(Boolean))).sort();
  }, [allBranches, branch, cleaningRatings, rows]);

  const visibleRows = useMemo(
    () => branchFilter === 'all' ? rows : rows.filter((row) => row.branch === branchFilter),
    [branchFilter, rows]
  );
  const visibleRatings = useMemo(
    () => branchFilter === 'all' ? cleaningRatings : cleaningRatings.filter((card) => card.branch === branchFilter),
    [branchFilter, cleaningRatings]
  );
  const pending = visibleRows.filter((r) => r.review_status === 'pending');
  const reviewed = visibleRows.filter((r) => r.review_status !== 'pending');

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 pb-24" dir="rtl">
      <div className="dawaa-card dawaa-card--raised p-5">
        <h1 className="dawaa-title text-xl">مراجعة تشيك ليست النظافة والمساعدين — {new Date().toLocaleDateString('ar-EG')}</h1>
        <p className="dawaa-caption mt-1 text-sm font-semibold">
          راجع كل بند والصورة المرفقة. تقييم النظافة لا يُعتمد إلا بعد مراجعة كل مهام اليوم، والرفض يحتاج سببًا مكتوبًا ويُسجل في دورة 26→25.
        </p>
      </div>

      {allBranches && availableBranches.length > 1 ? (
        <div className="dawaa-card dawaa-card--soft flex flex-wrap gap-2 p-3">
          <button type="button" onClick={() => setBranchFilter('all')} className={`dawaa-button ${branchFilter === 'all' ? 'dawaa-button--primary' : 'dawaa-button--secondary'}`}>
            كل الفروع
          </button>
          {availableBranches.map((item) => (
            <button key={item} type="button" onClick={() => setBranchFilter(item)} className={`dawaa-button ${branchFilter === item ? 'dawaa-button--primary' : 'dawaa-button--secondary'}`}>
              {item}
            </button>
          ))}
        </div>
      ) : null}

      {loading ? (
        <div className="dawaa-card flex justify-center py-10"><Loader2 className="animate-spin text-[var(--dawaa-theme-primary)]" /></div>
      ) : (
        <>
          <section className="space-y-3">
            <div>
              <h2 className="text-base font-black text-[var(--dawaa-theme-heading)]">تقييم عامل النظافة اليومي</h2>
              <p className="mt-1 text-xs font-semibold text-[var(--dawaa-theme-muted)]">
                5★ = +5 نقاط، 4★ = +2، 3★ = ثابت، 2★ = -5، 1★ = -10. حد النجوم يتحدد تلقائيًا من نتيجة مهام اليوم.
              </p>
            </div>

            {visibleRatings.length === 0 ? (
              <div className="dawaa-card dawaa-card--soft p-4 text-sm font-semibold text-[var(--dawaa-theme-muted)]">
                لا يوجد عامل نظافة نشط في النطاق المحدد أو تعذر تحميل التقييمات.
              </div>
            ) : null}

            {visibleRatings.map((card) => {
              const daySummary = cleaningDaySummary[card.staff_id];
              const cycle = cycleSummary[card.staff_id];
              const selected = starDraft[card.staff_id] || card.stars || 0;
              const projectedPoints = starPoints(selected || 1);
              const changed = selected !== (card.stars || 0) || (ratingNoteDraft[card.staff_id] || '') !== (card.manager_note || '');
              const ratingReady = Boolean(daySummary?.rating_ready);
              const maxStars = daySummary?.max_stars || 0;
              return (
                <div key={card.staff_id} className="dawaa-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-black text-[var(--dawaa-theme-heading)]">{card.staff_name}</p>
                      <p className="mt-1 text-xs font-semibold text-[var(--dawaa-theme-muted)]">{card.branch}</p>
                    </div>
                    {card.stars ? (
                      <span className="dawaa-badge dawaa-badge--success text-xs">محفوظ: {card.stars}/5 • {Number(card.score_pct || 0).toLocaleString('ar-EG')}%</span>
                    ) : (
                      <span className="dawaa-badge dawaa-badge--warning text-xs">لم يُقيّم اليوم</span>
                    )}
                  </div>

                  {daySummary ? (
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <div className="dawaa-card dawaa-card--soft p-2 text-center"><p className="text-[11px] font-semibold text-[var(--dawaa-theme-muted)]">المطلوب</p><p className="font-black">{daySummary.required_items}</p></div>
                      <div className="dawaa-card dawaa-card--soft p-2 text-center"><p className="text-[11px] font-semibold text-[var(--dawaa-theme-muted)]">تمت المراجعة</p><p className="font-black">{daySummary.reviewed_items}/{daySummary.required_items}</p></div>
                      <div className="dawaa-card dawaa-card--soft p-2 text-center"><p className="text-[11px] font-semibold text-[var(--dawaa-theme-muted)]">معتمد / مرفوض</p><p className="font-black">{daySummary.approved_items} / {daySummary.rejected_items}</p></div>
                      <div className="dawaa-card dawaa-card--soft p-2 text-center"><p className="text-[11px] font-semibold text-[var(--dawaa-theme-muted)]">أقصى تقييم</p><p className="font-black">{ratingReady ? `${maxStars}/5` : 'بعد المراجعة'}</p></div>
                    </div>
                  ) : null}

                  {cycle ? (
                    <div className="mt-3 rounded-xl border border-[var(--dawaa-theme-border)] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-black text-[var(--dawaa-theme-heading)]">ملخص دورة {cycle.month_cycle}</p>
                        <p className="text-[11px] font-semibold text-[var(--dawaa-theme-muted)]">{cycle.cycle_start} ← {cycle.cycle_end}</p>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <div className="dawaa-card dawaa-card--soft p-2 text-center"><p className="text-[10px] font-semibold text-[var(--dawaa-theme-muted)]">متوسط النجوم</p><p className="text-sm font-black">{cycle.avg_stars.toFixed(2)}★</p></div>
                        <div className="dawaa-card dawaa-card--soft p-2 text-center"><p className="text-[10px] font-semibold text-[var(--dawaa-theme-muted)]">تغطية التقييم</p><p className="text-sm font-black">{cycle.rating_coverage_pct}%</p></div>
                        <div className="dawaa-card dawaa-card--soft p-2 text-center"><p className="text-[10px] font-semibold text-[var(--dawaa-theme-muted)]">الالتزام بالتوقيت</p><p className="text-sm font-black">{cycle.on_time_pct}%</p></div>
                        <div className="dawaa-card dawaa-card--soft p-2 text-center"><p className="text-[10px] font-semibold text-[var(--dawaa-theme-muted)]">نقاط النجوم</p><p className="text-sm font-black">{cycle.total_star_points > 0 ? '+' : ''}{cycle.total_star_points}</p></div>
                      </div>
                      <p className="mt-2 text-[11px] font-semibold text-[var(--dawaa-theme-muted)]">
                        {cycle.rated_days} يوم مُقيّم • {cycle.fully_reviewed_days} يوم مكتمل المراجعة • {cycle.approved_items} بند معتمد • {cycle.rejected_items} مرفوض
                        {cycle.timing_attention_count > 0 ? ` • ${cycle.timing_attention_count} توقيت يحتاج مراجعة` : ''}
                      </p>
                    </div>
                  ) : null}

                  {!ratingReady ? (
                    <div className="dawaa-alert dawaa-alert--warning mt-3 text-xs font-bold">
                      التقييم مقفول حتى يتم إرسال ومراجعة كل مهام النظافة المطلوبة لليوم.
                    </div>
                  ) : null}

                  <div className="mt-4 flex flex-wrap items-center gap-1" aria-label="اختر تقييم النظافة من 1 إلى 5 نجوم">
                    {[1, 2, 3, 4, 5].map((value) => {
                      const unavailable = !ratingReady || value > maxStars;
                      return (
                        <button key={value} type="button" disabled={unavailable} className="rounded-lg p-1.5 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-30" aria-label={`${value} نجوم`} onClick={() => setStarDraft((prev) => ({ ...prev, [card.staff_id]: value }))}>
                          <Star size={30} className={value <= selected ? 'fill-amber-400 text-amber-400' : 'text-[var(--dawaa-theme-muted)]'} />
                        </button>
                      );
                    })}
                    {selected ? <div className="mr-2 text-xs font-black text-[var(--dawaa-theme-text)]">{selected}/5 = {selected * 20}% • {pointsLabel(projectedPoints)}</div> : null}
                  </div>

                  <textarea placeholder="ملاحظة يومية مختصرة: نقاط القوة أو ما يحتاج تحسين" className="dawaa-input mt-3 w-full p-2 text-xs" rows={2} value={ratingNoteDraft[card.staff_id] || ''} onChange={(e) => setRatingNoteDraft((prev) => ({ ...prev, [card.staff_id]: e.target.value }))} />

                  <button type="button" disabled={!ratingReady || !selected || selected > maxStars || ratingSaving === card.staff_id || (!changed && Boolean(card.rating_id))} onClick={() => void saveCleaningRating(card)} className="dawaa-button dawaa-button--primary mt-3 flex w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50">
                    {ratingSaving === card.staff_id ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    {card.rating_id ? 'تحديث تقييم اليوم' : 'حفظ تقييم اليوم'}
                  </button>

                  {card.rated_by_name && card.updated_at ? <p className="mt-2 text-[11px] font-semibold text-[var(--dawaa-theme-muted)]">آخر اعتماد: {card.rated_by_name} • {new Date(card.updated_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</p> : null}
                </div>
              );
            })}
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-black text-[var(--dawaa-status-warning-text)]">بانتظار المراجعة ({pending.length})</h2>
            {pending.length === 0 ? <div className="dawaa-card dawaa-card--soft p-4 text-sm font-semibold text-[var(--dawaa-theme-muted)]">لا توجد بنود تحتاج مراجعة الآن.</div> : null}
            {pending.map((row) => {
              const timing = cleaningTimingStatus(row);
              return (
                <div key={row.id} className="dawaa-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="font-black text-[var(--dawaa-theme-heading)]">{row.staff_daily_checklist_items?.title || 'بند بدون عنوان'}</p>
                    <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-[var(--dawaa-theme-muted)]">
                      <span>{row.staff?.name || 'موظف غير محدد'}</span>
                      {allBranches ? <span className="dawaa-badge text-xs">{row.branch}</span> : null}
                    </div>
                  </div>
                  {row.staff_daily_checklist_items?.description ? <p className="mt-1 text-xs text-[var(--dawaa-theme-muted)]">{row.staff_daily_checklist_items.description}</p> : null}
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                    <span className="dawaa-badge flex items-center gap-1"><Clock3 size={12} /> {row.staff_daily_checklist_items?.time_slot || 'وقت غير محدد'} • {formatCairoTime(row.submitted_at)}</span>
                    {timing === 'outside_window' ? <span className="dawaa-badge dawaa-badge--warning">توقيت يحتاج مراجعة — بدون خصم تلقائي</span> : null}
                  </div>
                  {row.photo_url ? <img src={row.photo_url} alt="دليل تنفيذ البند" className="mt-3 h-40 w-full rounded-xl border border-[var(--dawaa-theme-border)] object-cover" /> : <div className="dawaa-alert dawaa-alert--warning mt-3 text-xs font-bold">لا توجد صورة مرفقة.</div>}
                  <textarea placeholder="سبب الرفض — مطلوب عند الرفض" className="dawaa-input mt-3 w-full p-2 text-xs" rows={2} value={noteDraft[row.id] || ''} onChange={(e) => setNoteDraft((prev) => ({ ...prev, [row.id]: e.target.value }))} />
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => void review(row, 'approved')} className="dawaa-button dawaa-button--primary flex flex-1 items-center justify-center gap-1.5"><Check size={16} /> اعتماد</button>
                    <button onClick={() => void review(row, 'rejected')} className="dawaa-button dawaa-button--danger flex flex-1 items-center justify-center gap-1.5"><X size={16} /> رفض</button>
                  </div>
                </div>
              );
            })}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-black text-[var(--dawaa-theme-muted)]">تمت مراجعتها اليوم ({reviewed.length})</h2>
            {reviewed.map((row) => {
              const timing = cleaningTimingStatus(row);
              return (
                <div key={row.id} className="dawaa-card dawaa-card--soft flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-xs">
                  <span className="font-semibold text-[var(--dawaa-theme-text)]">{row.staff_daily_checklist_items?.title || 'بند'} — {row.staff?.name || 'موظف غير محدد'}{allBranches ? ` — ${row.branch}` : ''}</span>
                  <div className="flex items-center gap-2">
                    {timing === 'outside_window' ? <span className="dawaa-badge dawaa-badge--warning text-[10px]">وقت غير معتاد</span> : null}
                    <span className={row.review_status === 'approved' ? 'font-black text-[var(--dawaa-status-success-text)]' : 'font-black text-[var(--dawaa-status-danger-text)]'}>{row.review_status === 'approved' ? 'معتمد' : 'مرفوض'}</span>
                  </div>
                </div>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}
