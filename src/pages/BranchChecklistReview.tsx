import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Clock3, Loader2, Save, Star, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import {
  loadBranchChecklistDashboard,
  rateCleaningDay,
  rateOperationsDay,
  reviewChecklistSubmission,
  type ChecklistReviewRow,
  type CleaningCycleManagerSummary,
  type DailyRatingCard,
} from '@/lib/branchChecklistOperations';

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

function timingStatus(row: ChecklistReviewRow) {
  const minutes = cairoMinutes(row.submitted_at);
  const slot = row.staff_daily_checklist_items?.time_slot || '';
  if (minutes == null) return 'unclassified' as const;
  // Internal timing keys are retained for historical compatibility even though the
  // visible task wording is now 24-hour-operation friendly.
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

function qualityBonus(card: DailyRatingCard, stars: number) {
  if (card.rejected_items > 0) return 0;
  if (stars === 5) return 5;
  if (stars === 4) return 2;
  return 0;
}

function pointsLabel(points: number) {
  if (points > 0) return `+${points} نقاط جودة`;
  return 'بدون نقاط إضافية';
}

function DailyRatingSection({
  title,
  description,
  emptyLabel,
  cards,
  cycleSummary,
  starDraft,
  noteDraft,
  savingStaffId,
  onStarChange,
  onNoteChange,
  onSave,
}: {
  title: string;
  description: string;
  emptyLabel: string;
  cards: DailyRatingCard[];
  cycleSummary?: Record<string, CleaningCycleManagerSummary>;
  starDraft: Record<string, number>;
  noteDraft: Record<string, string>;
  savingStaffId: string | null;
  onStarChange: (staffId: string, stars: number) => void;
  onNoteChange: (staffId: string, note: string) => void;
  onSave: (card: DailyRatingCard) => void;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-black text-[var(--dawaa-theme-heading)]">{title}</h2>
        <p className="mt-1 text-xs font-semibold text-[var(--dawaa-theme-muted)]">{description}</p>
      </div>

      {cards.length === 0 ? (
        <div className="dawaa-card dawaa-card--soft p-4 text-sm font-semibold text-[var(--dawaa-theme-muted)]">
          {emptyLabel}
        </div>
      ) : null}

      {cards.map((card) => {
        const selected = starDraft[card.staff_id] || card.stars || 0;
        const bonus = selected ? qualityBonus(card, selected) : 0;
        const cycle = cycleSummary?.[card.staff_id];
        const changed = selected !== (card.stars || 0) || (noteDraft[card.staff_id] || '') !== (card.manager_note || '');
        const lowRatingNeedsNote = selected > 0 && selected <= 2 && !(noteDraft[card.staff_id] || '').trim();

        return (
          <div key={card.staff_id} className="dawaa-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-black text-[var(--dawaa-theme-heading)]">{card.staff_name}</p>
                <p className="mt-1 text-xs font-semibold text-[var(--dawaa-theme-muted)]">{card.branch} • {card.staff_role}</p>
              </div>
              {card.stars ? (
                <span className="dawaa-badge dawaa-badge--success text-xs">
                  محفوظ: {card.stars}/5 • {Number(card.score_pct || 0).toLocaleString('ar-EG')}%
                </span>
              ) : (
                <span className="dawaa-badge dawaa-badge--warning text-xs">لم يُقيّم اليوم</span>
              )}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Metric label="المطلوب" value={card.required_items} />
              <Metric label="تم التنفيذ" value={`${card.submitted_items}/${card.required_items}`} />
              <Metric label="تمت المراجعة" value={`${card.reviewed_items}/${card.required_items}`} />
              <Metric label="معتمد / مرفوض" value={`${card.approved_items} / ${card.rejected_items}`} />
              <Metric label="أقصى تقييم" value={card.rating_ready ? `${card.max_stars}/5` : 'بعد المراجعة'} />
            </div>

            {cycle ? (
              <div className="mt-3 rounded-xl border border-[var(--dawaa-theme-border)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-black text-[var(--dawaa-theme-heading)]">ملخص دورة {cycle.month_cycle}</p>
                  <p className="text-[11px] font-semibold text-[var(--dawaa-theme-muted)]">{cycle.cycle_start} ← {cycle.cycle_end}</p>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Metric label="متوسط النجوم" value={`${cycle.avg_stars.toFixed(2)}★`} />
                  <Metric label="تغطية التقييم" value={`${cycle.rating_coverage_pct}%`} />
                  <Metric label="الالتزام بالتوقيت" value={`${cycle.on_time_pct}%`} />
                  <Metric label="مكافآت الجودة" value={`${cycle.total_star_points > 0 ? '+' : ''}${cycle.total_star_points}`} />
                </div>
              </div>
            ) : null}

            {!card.rating_ready ? (
              <div className="dawaa-alert dawaa-alert--warning mt-3 text-xs font-bold">
                التقييم مقفول حتى تُنفذ وتُراجع كل المهام المستحقة لهذا الموظف في يوم عمله.
              </div>
            ) : null}

            {card.rejected_items > 0 ? (
              <div className="dawaa-alert dawaa-alert--warning mt-3 text-xs font-bold">
                يوجد {card.rejected_items} بند مرفوض. الخصم يأتي من البنود المرفوضة نفسها، لذلك لا يتم إنشاء خصم ثانٍ من النجوم ولا تُصرف مكافأة جودة لهذا اليوم.
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-1" aria-label="اختر تقييم اليوم من 1 إلى 5 نجوم">
              {[1, 2, 3, 4, 5].map((value) => {
                const unavailable = !card.rating_ready || value > card.max_stars;
                return (
                  <button
                    key={value}
                    type="button"
                    disabled={unavailable}
                    className="rounded-lg p-1.5 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-30"
                    aria-label={`${value} نجوم`}
                    onClick={() => onStarChange(card.staff_id, value)}
                  >
                    <Star size={30} className={value <= selected ? 'fill-amber-400 text-amber-400' : 'text-[var(--dawaa-theme-muted)]'} />
                  </button>
                );
              })}
              {selected ? (
                <div className="mr-2 text-xs font-black text-[var(--dawaa-theme-text)]">
                  {selected}/5 = {selected * 20}% • {pointsLabel(bonus)}
                </div>
              ) : null}
            </div>

            <textarea
              placeholder={selected <= 2 && selected > 0 ? 'سبب التقييم المنخفض — مطلوب' : 'ملاحظة يومية مختصرة: نقاط القوة أو ما يحتاج تحسين'}
              className="dawaa-input mt-3 w-full p-2 text-xs"
              rows={2}
              value={noteDraft[card.staff_id] || ''}
              onChange={(e) => onNoteChange(card.staff_id, e.target.value)}
            />

            <button
              type="button"
              disabled={!card.rating_ready || !selected || selected > card.max_stars || lowRatingNeedsNote || savingStaffId === card.staff_id || (!changed && Boolean(card.rating_id))}
              onClick={() => onSave(card)}
              className="dawaa-button dawaa-button--primary mt-3 flex w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {savingStaffId === card.staff_id ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              {card.rating_id ? 'تحديث تقييم اليوم' : 'اعتماد تقييم اليوم'}
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
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="dawaa-card dawaa-card--soft p-2 text-center">
      <p className="text-[10px] font-semibold text-[var(--dawaa-theme-muted)]">{label}</p>
      <p className="text-sm font-black">{value}</p>
    </div>
  );
}

export default function BranchChecklistReview() {
  const { user } = useAuth();
  const branch = user?.branch || '';
  const allBranches = isAllBranchesValue(branch);
  const today = cairoDateKey();

  const [rows, setRows] = useState<ChecklistReviewRow[]>([]);
  const [cleaningRatings, setCleaningRatings] = useState<DailyRatingCard[]>([]);
  const [operationsRatings, setOperationsRatings] = useState<DailyRatingCard[]>([]);
  const [cycleSummary, setCycleSummary] = useState<Record<string, CleaningCycleManagerSummary>>({});
  const [loading, setLoading] = useState(true);
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [starDraft, setStarDraft] = useState<Record<string, number>>({});
  const [ratingNoteDraft, setRatingNoteDraft] = useState<Record<string, string>>({});
  const [ratingSaving, setRatingSaving] = useState<string | null>(null);
  const [branchFilter, setBranchFilter] = useState('all');

  const load = useCallback(async () => {
    if (!branch) {
      setRows([]);
      setCleaningRatings([]);
      setOperationsRatings([]);
      setCycleSummary({});
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const dashboard = await loadBranchChecklistDashboard({ branch, allBranches, date: today });
      setRows(dashboard.rows);
      setCleaningRatings(dashboard.cleaningRatings);
      setOperationsRatings(dashboard.operationsRatings);
      setCycleSummary(dashboard.cleaningCycle);

      setStarDraft((prev) => {
        const next = { ...prev };
        for (const card of [...dashboard.cleaningRatings, ...dashboard.operationsRatings]) {
          if (next[card.staff_id] == null && card.stars) next[card.staff_id] = card.stars;
        }
        return next;
      });
      setRatingNoteDraft((prev) => {
        const next = { ...prev };
        for (const card of [...dashboard.cleaningRatings, ...dashboard.operationsRatings]) {
          if (next[card.staff_id] == null && card.manager_note) next[card.staff_id] = card.manager_note;
        }
        return next;
      });
    } catch (error) {
      console.error('[BranchChecklistReview] dashboard load failed', error);
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل مركز مراجعة مهام الفرع');
      setRows([]);
      setCleaningRatings([]);
      setOperationsRatings([]);
      setCycleSummary({});
    } finally {
      setLoading(false);
    }
  }, [allBranches, branch, today]);

  useEffect(() => { void load(); }, [load]);

  const review = useCallback(async (row: ChecklistReviewRow, status: 'approved' | 'rejected') => {
    const rejectionNote = noteDraft[row.id]?.trim() || '';
    if (status === 'rejected' && !rejectionNote) {
      toast.error('اكتب سبب الرفض قبل تسجيل الإجراء.');
      return;
    }
    try {
      await reviewChecklistSubmission({
        submissionId: row.id,
        status,
        reviewerNote: status === 'rejected' ? rejectionNote : null,
      });
      toast.success(status === 'approved' ? 'تم اعتماد البند' : 'تم رفض البند وتسجيل السبب');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تسجيل المراجعة');
    }
  }, [load, noteDraft]);

  const saveRating = useCallback(async (card: DailyRatingCard, kind: 'cleaning' | 'operations') => {
    const stars = starDraft[card.staff_id] || 0;
    const managerNote = ratingNoteDraft[card.staff_id]?.trim() || null;
    if (!card.rating_ready) {
      toast.error('راجع كل المهام المستحقة أولًا قبل اعتماد تقييم اليوم.');
      return;
    }
    if (stars < 1 || stars > card.max_stars) {
      toast.error(`الحد الأقصى لتقييم اليوم هو ${card.max_stars}/5 حسب نتيجة المهام.`);
      return;
    }
    if (stars <= 2 && !managerNote) {
      toast.error('سبب التقييم المنخفض مطلوب.');
      return;
    }

    setRatingSaving(card.staff_id);
    try {
      if (kind === 'cleaning') {
        await rateCleaningDay({ staffId: card.staff_id, stars, managerNote, date: today });
      } else {
        await rateOperationsDay({ staffId: card.staff_id, stars, managerNote, date: today });
      }
      toast.success(`تم اعتماد تقييم ${card.staff_name}: ${stars}/5`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر حفظ التقييم اليومي');
    } finally {
      setRatingSaving(null);
    }
  }, [load, ratingNoteDraft, starDraft, today]);

  const availableBranches = useMemo(() => {
    if (!allBranches) return branch ? [branch] : [];
    return Array.from(new Set([
      ...cleaningRatings.map((card) => card.branch),
      ...operationsRatings.map((card) => card.branch),
      ...rows.map((row) => row.branch),
    ].filter(Boolean))).sort();
  }, [allBranches, branch, cleaningRatings, operationsRatings, rows]);

  const visibleRows = useMemo(
    () => branchFilter === 'all' ? rows : rows.filter((row) => row.branch === branchFilter),
    [branchFilter, rows]
  );
  const visibleCleaning = useMemo(
    () => branchFilter === 'all' ? cleaningRatings : cleaningRatings.filter((card) => card.branch === branchFilter),
    [branchFilter, cleaningRatings]
  );
  const visibleOperations = useMemo(
    () => branchFilter === 'all' ? operationsRatings : operationsRatings.filter((card) => card.branch === branchFilter),
    [branchFilter, operationsRatings]
  );

  const pending = visibleRows.filter((row) => row.review_status === 'pending');
  const reviewed = visibleRows.filter((row) => row.review_status !== 'pending');

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 pb-24" dir="rtl">
      <div className="dawaa-card dawaa-card--raised p-5">
        <h1 className="dawaa-title text-xl">مركز مراجعة مهام الفرع — {new Date().toLocaleDateString('ar-EG')}</h1>
        <p className="dawaa-caption mt-1 text-sm font-semibold">
          كل مهمة مرتبطة بموظف وفرع محددين. النظافة والرص لا يُعتمدان بدون صورة، والخصم يأتي من البند المرفوض نفسه فقط. تقييم اليوم يسجل الجودة ويضيف مكافأة عند الأداء الكامل دون مضاعفة العقوبة.
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
          <DailyRatingSection
            title="تقييم النظافة اليومي"
            description="التقييم لا يفتح إلا بعد تنفيذ ومراجعة كل البنود. 5★ = +5 جودة، 4★ = +2، وما دون ذلك بدون نقاط إضافية. أي رفض يُحاسب من البند نفسه فقط."
            emptyLabel="لا توجد مسئولية نظافة مستحقة في النطاق المحدد اليوم."
            cards={visibleCleaning}
            cycleSummary={cycleSummary}
            starDraft={starDraft}
            noteDraft={ratingNoteDraft}
            savingStaffId={ratingSaving}
            onStarChange={(staffId, stars) => setStarDraft((prev) => ({ ...prev, [staffId]: stars }))}
            onNoteChange={(staffId, note) => setRatingNoteDraft((prev) => ({ ...prev, [staffId]: note }))}
            onSave={(card) => void saveRating(card, 'cleaning')}
          />

          <DailyRatingSection
            title="تقييم الرص والجرد اليومي"
            description="يعتمد على مهام الرص والجزء اليومي من الجرد المستحقة في يوم عمل الموظف فقط. يوم الإجازة لا يدخل في المطلوب ولا في التقييم."
            emptyLabel="لا توجد مهام رص أو جرد مستحقة للموظفين في النطاق المحدد اليوم."
            cards={visibleOperations}
            starDraft={starDraft}
            noteDraft={ratingNoteDraft}
            savingStaffId={ratingSaving}
            onStarChange={(staffId, stars) => setStarDraft((prev) => ({ ...prev, [staffId]: stars }))}
            onNoteChange={(staffId, note) => setRatingNoteDraft((prev) => ({ ...prev, [staffId]: note }))}
            onSave={(card) => void saveRating(card, 'operations')}
          />

          <section className="space-y-3">
            <h2 className="text-sm font-black text-[var(--dawaa-status-warning-text)]">بانتظار المراجعة ({pending.length})</h2>
            {pending.length === 0 ? (
              <div className="dawaa-card dawaa-card--soft p-4 text-sm font-semibold text-[var(--dawaa-theme-muted)]">لا توجد بنود تحتاج مراجعة الآن.</div>
            ) : null}
            {pending.map((row) => {
              const timing = timingStatus(row);
              const requiresPhoto = Boolean(row.staff_daily_checklist_items?.requires_photo);
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
                    {requiresPhoto ? <span className="dawaa-badge">الصورة إلزامية</span> : null}
                  </div>

                  {row.photo_url ? (
                    <img src={row.photo_url} alt="دليل تنفيذ البند" loading="lazy" className="mt-3 h-44 w-full rounded-xl border border-[var(--dawaa-theme-border)] object-cover" />
                  ) : requiresPhoto ? (
                    <div className="dawaa-alert dawaa-alert--danger mt-3 text-xs font-bold">لا توجد صورة مطلوبة لهذا البند — لا يمكن اعتماده.</div>
                  ) : (
                    <div className="dawaa-card dawaa-card--soft mt-3 p-3 text-xs font-semibold text-[var(--dawaa-theme-muted)]">هذا البند لا يتطلب صورة.</div>
                  )}

                  <textarea
                    placeholder="سبب الرفض — مطلوب عند الرفض"
                    className="dawaa-input mt-3 w-full p-2 text-xs"
                    rows={2}
                    value={noteDraft[row.id] || ''}
                    onChange={(e) => setNoteDraft((prev) => ({ ...prev, [row.id]: e.target.value }))}
                  />
                  <div className="mt-3 flex gap-2">
                    <button disabled={requiresPhoto && !row.photo_url} onClick={() => void review(row, 'approved')} className="dawaa-button dawaa-button--primary flex flex-1 items-center justify-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-40"><Check size={16} /> اعتماد</button>
                    <button onClick={() => void review(row, 'rejected')} className="dawaa-button dawaa-button--danger flex flex-1 items-center justify-center gap-1.5"><X size={16} /> رفض</button>
                  </div>
                </div>
              );
            })}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-black text-[var(--dawaa-theme-muted)]">تمت مراجعتها اليوم ({reviewed.length})</h2>
            {reviewed.map((row) => (
              <div key={row.id} className="dawaa-card dawaa-card--soft flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-xs">
                <span className="font-semibold text-[var(--dawaa-theme-text)]">{row.staff_daily_checklist_items?.title || 'بند'} — {row.staff?.name || 'موظف غير محدد'}{allBranches ? ` — ${row.branch}` : ''}</span>
                <span className={row.review_status === 'approved' ? 'font-black text-[var(--dawaa-status-success-text)]' : 'font-black text-[var(--dawaa-status-danger-text)]'}>
                  {row.review_status === 'approved' ? 'معتمد' : `مرفوض${row.reviewer_note ? ` — ${row.reviewer_note}` : ''}`}
                </span>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
