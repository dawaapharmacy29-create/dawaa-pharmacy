import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Save, Star, X } from 'lucide-react';
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
  review_status: 'pending' | 'approved' | 'rejected';
  reviewer_note: string | null;
  staff_daily_checklist_items: { title: string; description: string | null; requires_photo: boolean } | null;
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

export default function BranchChecklistReview() {
  const { user } = useAuth();
  const branch = user?.branch || '';
  const [rows, setRows] = useState<Row[]>([]);
  const [cleaningRatings, setCleaningRatings] = useState<CleaningRatingCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [starDraft, setStarDraft] = useState<Record<string, number>>({});
  const [ratingNoteDraft, setRatingNoteDraft] = useState<Record<string, string>>({});
  const [ratingSaving, setRatingSaving] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  const load = useCallback(async () => {
    if (!branch) {
      setRows([]);
      setCleaningRatings([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [checklistResult, ratingResult] = await Promise.all([
      supabase
        .from('staff_daily_checklist_submissions')
        .select(
          'id, staff_id, branch, completed, photo_url, staff_note, review_status, reviewer_note, staff_daily_checklist_items(title, description, requires_photo), staff:staff!staff_daily_checklist_submissions_staff_id_fkey(name, role)'
        )
        .eq('branch', branch)
        .eq('submission_date', today)
        .eq('completed', true)
        .order('created_at', { ascending: true }),
      supabase.rpc('get_cleaning_daily_rating_cards_v1', {
        p_rating_date: today,
        p_branch: branch,
      }),
    ]);

    if (checklistResult.error) {
      toast.error('تعذر تحميل مراجعات التشيك ليست');
      console.error('[BranchChecklistReview] checklist load failed', checklistResult.error);
      setRows([]);
    } else {
      setRows((checklistResult.data || []) as unknown as Row[]);
    }

    if (ratingResult.error) {
      console.error('[BranchChecklistReview] cleaning rating load failed', ratingResult.error);
      setCleaningRatings([]);
    } else {
      const cards = ((ratingResult.data || []) as CleaningRatingCard[]).map((card) => ({
        ...card,
        stars: card.stars == null ? null : Number(card.stars),
        score_pct: card.score_pct == null ? null : Number(card.score_pct),
        points_delta: card.points_delta == null ? null : Number(card.points_delta),
      }));
      setCleaningRatings(cards);
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
  }, [branch, today]);

  useEffect(() => {
    void load();
  }, [load]);

  const review = useCallback(
    async (row: Row, status: 'approved' | 'rejected') => {
      const { data, error } = await supabase.rpc('review_staff_daily_checklist_v1', {
        p_submission_id: row.id,
        p_status: status,
        p_reviewer_note: status === 'rejected' ? noteDraft[row.id] || null : null,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success(status === 'approved' ? 'تم الاعتماد' : 'تم الرفض وتسجيل الإجراء');
      const saved = Array.isArray(data) ? data[0] : data;
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, review_status: saved?.review_status || status } : r)));
    },
    [noteDraft]
  );

  const saveCleaningRating = useCallback(async (card: CleaningRatingCard) => {
    const stars = starDraft[card.staff_id] || 0;
    if (stars < 1 || stars > 5) {
      toast.error('اختر من 1 إلى 5 نجوم أولًا.');
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
  }, [load, ratingNoteDraft, starDraft, today]);

  const pending = rows.filter((r) => r.review_status === 'pending');
  const reviewed = rows.filter((r) => r.review_status !== 'pending');
  const cleaningChecklistStats = useMemo(() => {
    const byStaff = new Map<string, { total: number; approved: number; rejected: number; pending: number }>();
    for (const row of rows) {
      const current = byStaff.get(row.staff_id) || { total: 0, approved: 0, rejected: 0, pending: 0 };
      current.total += 1;
      current[row.review_status] += 1;
      byStaff.set(row.staff_id, current);
    }
    return byStaff;
  }, [rows]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 pb-24" dir="rtl">
      <div className="dawaa-card dawaa-card--raised p-5">
        <h1 className="dawaa-title text-xl">مراجعة تشيك ليست النظافة والمساعدين — {new Date().toLocaleDateString('ar-EG')}</h1>
        <p className="dawaa-caption mt-1 text-sm font-semibold">
          راجع كل بند والصورة المرفقة. الرفض يسجل الإجراء المعتمد، وتقييم النظافة اليومي يدخل مباشرة في مسار النقاط الشهري.
        </p>
      </div>

      {loading ? (
        <div className="dawaa-card flex justify-center py-10"><Loader2 className="animate-spin text-[var(--dawaa-theme-primary)]" /></div>
      ) : (
        <>
          <section className="space-y-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 className="text-base font-black text-[var(--dawaa-theme-heading)]">تقييم عامل النظافة اليومي</h2>
                <p className="mt-1 text-xs font-semibold text-[var(--dawaa-theme-muted)]">
                  5★ = +5 نقاط، 4★ = +2، 3★ = ثابت، 2★ = -5، 1★ = -10. كل يوم يُحتسب مرة واحدة فقط داخل دورة 26→25.
                </p>
              </div>
            </div>

            {cleaningRatings.length === 0 ? (
              <div className="dawaa-card dawaa-card--soft p-4 text-sm font-semibold text-[var(--dawaa-theme-muted)]">
                لا يوجد عامل نظافة نشط مرتبط بهذا الفرع أو تعذر تحميل التقييمات.
              </div>
            ) : null}

            {cleaningRatings.map((card) => {
              const selected = starDraft[card.staff_id] || card.stars || 0;
              const projectedPoints = starPoints(selected || 1);
              const stats = cleaningChecklistStats.get(card.staff_id);
              const changed = selected !== (card.stars || 0) || (ratingNoteDraft[card.staff_id] || '') !== (card.manager_note || '');
              return (
                <div key={card.staff_id} className="dawaa-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-black text-[var(--dawaa-theme-heading)]">{card.staff_name}</p>
                      <p className="mt-1 text-xs font-semibold text-[var(--dawaa-theme-muted)]">
                        {card.branch} • {stats ? `${stats.approved}/${stats.total} بنود معتمدة` : 'لا توجد بنود مكتملة للمراجعة بعد'}
                        {stats?.rejected ? ` • ${stats.rejected} مرفوض` : ''}
                        {stats?.pending ? ` • ${stats.pending} بانتظار المراجعة` : ''}
                      </p>
                    </div>
                    {card.stars ? (
                      <span className="dawaa-badge dawaa-badge--success text-xs">
                        محفوظ: {card.stars}/5 • {Number(card.score_pct || 0).toLocaleString('ar-EG')}%
                      </span>
                    ) : (
                      <span className="dawaa-badge dawaa-badge--warning text-xs">لم يُقيّم اليوم</span>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-1" aria-label="اختر تقييم النظافة من 1 إلى 5 نجوم">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <button
                        key={value}
                        type="button"
                        className="rounded-lg p-1.5 transition hover:bg-white/5"
                        aria-label={`${value} نجوم`}
                        onClick={() => setStarDraft((prev) => ({ ...prev, [card.staff_id]: value }))}
                      >
                        <Star
                          size={30}
                          className={value <= selected ? 'fill-amber-400 text-amber-400' : 'text-[var(--dawaa-theme-muted)]'}
                        />
                      </button>
                    ))}
                    {selected ? (
                      <div className="mr-2 text-xs font-black text-[var(--dawaa-theme-text)]">
                        {selected}/5 = {selected * 20}% • {pointsLabel(projectedPoints)}
                      </div>
                    ) : null}
                  </div>

                  <textarea
                    placeholder="ملاحظة يومية مختصرة: نقاط القوة أو ما يحتاج تحسين"
                    className="dawaa-input mt-3 w-full p-2 text-xs"
                    rows={2}
                    value={ratingNoteDraft[card.staff_id] || ''}
                    onChange={(e) => setRatingNoteDraft((prev) => ({ ...prev, [card.staff_id]: e.target.value }))}
                  />

                  <button
                    type="button"
                    disabled={!selected || ratingSaving === card.staff_id || (!changed && Boolean(card.rating_id))}
                    onClick={() => void saveCleaningRating(card)}
                    className="dawaa-button dawaa-button--primary mt-3 flex w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {ratingSaving === card.staff_id ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    {card.rating_id ? 'تحديث تقييم اليوم' : 'حفظ تقييم اليوم'}
                  </button>

                  {card.rated_by_name && card.updated_at ? (
                    <p className="mt-2 text-[11px] font-semibold text-[var(--dawaa-theme-muted)]">
                      آخر اعتماد: {card.rated_by_name} • {new Date(card.updated_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-black text-[var(--dawaa-status-warning-text)]">بانتظار المراجعة ({pending.length})</h2>
            {pending.length === 0 ? (
              <div className="dawaa-card dawaa-card--soft p-4 text-sm font-semibold text-[var(--dawaa-theme-muted)]">لا توجد بنود تحتاج مراجعة الآن.</div>
            ) : null}
            {pending.map((row) => (
              <div key={row.id} className="dawaa-card p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-black text-[var(--dawaa-theme-heading)]">{row.staff_daily_checklist_items?.title || 'بند بدون عنوان'}</p>
                  <span className="text-xs font-bold text-[var(--dawaa-theme-muted)]">{row.staff?.name || 'موظف غير محدد'}</span>
                </div>
                {row.staff_daily_checklist_items?.description ? (
                  <p className="mt-1 text-xs text-[var(--dawaa-theme-muted)]">{row.staff_daily_checklist_items.description}</p>
                ) : null}
                {row.photo_url ? (
                  <img src={row.photo_url} alt="دليل تنفيذ البند" className="mt-3 h-40 w-full rounded-xl border border-[var(--dawaa-theme-border)] object-cover" />
                ) : (
                  <div className="dawaa-alert dawaa-alert--warning mt-3 text-xs font-bold">لا توجد صورة مرفقة.</div>
                )}
                <textarea
                  placeholder="ملاحظة الرفض (اختياري)"
                  className="dawaa-input mt-3 w-full p-2 text-xs"
                  rows={2}
                  value={noteDraft[row.id] || ''}
                  onChange={(e) => setNoteDraft((prev) => ({ ...prev, [row.id]: e.target.value }))}
                />
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => void review(row, 'approved')}
                    className="dawaa-button dawaa-button--primary flex flex-1 items-center justify-center gap-1.5"
                  >
                    <Check size={16} /> اعتماد
                  </button>
                  <button
                    onClick={() => void review(row, 'rejected')}
                    className="dawaa-button dawaa-button--danger flex flex-1 items-center justify-center gap-1.5"
                  >
                    <X size={16} /> رفض
                  </button>
                </div>
              </div>
            ))}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-black text-[var(--dawaa-theme-muted)]">تمت مراجعتها اليوم ({reviewed.length})</h2>
            {reviewed.map((row) => (
              <div key={row.id} className="dawaa-card dawaa-card--soft flex items-center justify-between gap-3 px-3 py-2 text-xs">
                <span className="font-semibold text-[var(--dawaa-theme-text)]">{row.staff_daily_checklist_items?.title || 'بند'} — {row.staff?.name || 'موظف غير محدد'}</span>
                <span className={row.review_status === 'approved' ? 'font-black text-[var(--dawaa-status-success-text)]' : 'font-black text-[var(--dawaa-status-danger-text)]'}>
                  {row.review_status === 'approved' ? 'معتمد' : 'مرفوض'}
                </span>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
