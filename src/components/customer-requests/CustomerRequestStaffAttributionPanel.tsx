import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck, UserRoundSearch } from 'lucide-react';
import { toast } from 'sonner';
import {
  applyCustomerRequestStaffAttribution,
  getCustomerRequestStaffAttributionReview,
  previewCustomerRequestStaffAttributionApply,
  reviewCustomerRequestStaffAttribution,
  type CustomerRequestStaffAttributionPreview,
  type CustomerRequestStaffAttributionRow,
} from '@/lib/api/customerRequestStaffAttribution';

type ReviewDialogState = {
  row: CustomerRequestStaffAttributionRow;
  reason: string;
  approved: boolean;
  preview: CustomerRequestStaffAttributionPreview | null;
};

export default function CustomerRequestStaffAttributionPanel({ branch }: { branch: string }) {
  const [rows, setRows] = useState<CustomerRequestStaffAttributionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [review, setReview] = useState<ReviewDialogState | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setRows(await getCustomerRequestStaffAttributionReview(branch, 120));
    } catch (error) {
      toast.error(`تعذر تحميل مراجعة هوية الموظفين: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch]);

  const summary = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.requests += row.requests_count;
        if (row.match_state === 'unique_exact_normalized') acc.safe += row.requests_count;
        else if (row.match_state === 'ambiguous') acc.ambiguous += row.requests_count;
        else acc.unmatched += row.requests_count;
        return acc;
      },
      { requests: 0, safe: 0, ambiguous: 0, unmatched: 0 }
    );
  }, [rows]);

  const approveReview = async () => {
    if (!review?.row.suggested_staff_id) return;
    if (review.reason.trim().length < 5) return toast.error('اكتب سبب المراجعة قبل الاعتماد');
    setSaving(true);
    try {
      await reviewCustomerRequestStaffAttribution({
        sourceLabel: review.row.source_label,
        branch: review.row.branch,
        staffId: review.row.suggested_staff_id,
        decision: 'approved',
        reason: review.reason.trim(),
      });
      const preview = await previewCustomerRequestStaffAttributionApply({
        sourceLabel: review.row.source_label,
        branch: review.row.branch,
        staffId: review.row.suggested_staff_id,
      });
      setReview((current) => current ? { ...current, approved: true, preview } : current);
      toast.success('تم اعتماد المطابقة للمراجعة. لم يتم تعديل الطلبات بعد.');
    } catch (error) {
      toast.error(`تعذر اعتماد المطابقة: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const applyApprovedReview = async () => {
    if (!review?.approved || !review.row.suggested_staff_id || !review.preview?.approved) return;
    setSaving(true);
    try {
      const updatedCount = await applyCustomerRequestStaffAttribution({
        sourceLabel: review.row.source_label,
        branch: review.row.branch,
        staffId: review.row.suggested_staff_id,
      });
      toast.success(`تم ربط ${updatedCount.toLocaleString('ar-EG')} طلب بالموظف المعتمد. النقاط لا تُحتسب إلا للطلبات المستوفية لشروط الهوية والسياسة.`);
      setReview(null);
      await load();
    } catch (error) {
      toast.error(`تعذر تطبيق الربط: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-3xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]">
            <UserRoundSearch size={18} className="text-[var(--dawaa-theme-primary)]" />
            مراجعة هوية الموظف في الطلبات القديمة
          </div>
          <p className="mt-1 max-w-4xl text-xs font-bold leading-6 text-[var(--dawaa-theme-muted)]">
            لا يتم ربط Doctor ID أو احتساب نقاط من الاسم وحده. التطابق الوحيد يمر بمرحلتين منفصلتين: اعتماد بشري موثق، ثم معاينة عدد الطلبات قبل التطبيق الفعلي.
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading || saving} className="btn-secondary flex items-center gap-2 text-xs">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> تحديث
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Metric label="طلبات تحتاج هوية" value={summary.requests} />
        <Metric label="تطابق وحيد قابل للمراجعة" value={summary.safe} tone="success" />
        <Metric label="ملتبس" value={summary.ambiguous} tone="warning" />
        <Metric label="غير مطابق" value={summary.unmatched} tone="danger" />
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-[var(--dawaa-theme-border)]">
        <table className="min-w-[960px] w-full text-right text-xs">
          <thead className="bg-[var(--dawaa-theme-surface-2)] text-[var(--dawaa-theme-muted)]">
            <tr>
              <th className="px-3 py-3">الاسم القادم من المصدر</th>
              <th className="px-3 py-3">الفرع</th>
              <th className="px-3 py-3">عدد الطلبات</th>
              <th className="px-3 py-3">الموظف المقترح</th>
              <th className="px-3 py-3">الدور</th>
              <th className="px-3 py-3">حالة المطابقة</th>
              <th className="px-3 py-3">الإجراء</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const reviewable = row.match_state === 'unique_exact_normalized' && Boolean(row.suggested_staff_id);
              return (
                <tr key={`${row.branch || 'none'}:${row.source_label}`} className="border-t border-[var(--dawaa-theme-border)]">
                  <td className="px-3 py-3 font-black text-[var(--dawaa-theme-heading)]">{row.source_label}</td>
                  <td className="px-3 py-3 text-[var(--dawaa-theme-text)]">{row.branch || 'غير محدد'}</td>
                  <td className="px-3 py-3 font-black text-[var(--dawaa-theme-heading)]">{row.requests_count.toLocaleString('ar-EG')}</td>
                  <td className="px-3 py-3">{row.suggested_staff_name || '—'}</td>
                  <td className="px-3 py-3 text-[var(--dawaa-theme-muted)]">{row.suggested_staff_role || '—'}</td>
                  <td className="px-3 py-3"><MatchState state={row.match_state} /></td>
                  <td className="px-3 py-3">
                    {reviewable ? (
                      <button type="button" disabled={saving} onClick={() => setReview({ row, reason: '', approved: false, preview: null })} className="btn-secondary text-[11px]">مراجعة واعتماد</button>
                    ) : (
                      <span className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">يحتاج اختيارًا يدويًا منفصلًا</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {!loading && rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center font-bold text-[var(--dawaa-theme-muted)]">لا توجد أسماء قديمة تحتاج مراجعة ضمن هذا النطاق.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {review ? (
        <div className="mt-4 rounded-2xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-accent-soft)]/30 p-4">
          <div className="font-black text-[var(--dawaa-theme-heading)]">مراجعة: {review.row.source_label} ← {review.row.suggested_staff_name}</div>
          <div className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">{review.row.branch || 'فرع غير محدد'} · {review.row.requests_count.toLocaleString('ar-EG')} طلب</div>
          {!review.approved ? (
            <div className="mt-3 space-y-2">
              <textarea className="input-dark min-h-20" value={review.reason} onChange={(event) => setReview((current) => current ? { ...current, reason: event.target.value } : current)} placeholder="سبب اعتماد أن هذا الاسم يعود لنفس الموظف..." />
              <div className="flex flex-wrap gap-2"><button type="button" disabled={saving || review.reason.trim().length < 5} onClick={() => void approveReview()} className="btn-primary">اعتماد المطابقة فقط</button><button type="button" disabled={saving} onClick={() => setReview(null)} className="btn-secondary">إلغاء</button></div>
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-3">
              <div className="font-black text-[var(--dawaa-status-warning-text)]">المعاينة قبل التطبيق</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 text-xs"><div>طلبات سيتم ربطها: <strong>{Number(review.preview?.requests_to_attribute || 0).toLocaleString('ar-EG')}</strong></div><div>مكتملة الهوية للنقاط حاليًا: <strong>{Number(review.preview?.currently_points_identity_ready || 0).toLocaleString('ar-EG')}</strong></div></div>
              <p className="mt-2 text-[11px] font-bold leading-6 text-[var(--dawaa-theme-muted)]">التطبيق يثبت هوية الدكتور فقط. أي نقطة تظل خاضعة لفئة الدكتور، اكتمال العميل والصنف، تاريخ سريان السياسة ومنع التكرار.</p>
              <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={saving || !review.preview?.approved} onClick={() => void applyApprovedReview()} className="btn-primary">تطبيق الربط المعتمد</button><button type="button" disabled={saving} onClick={() => setReview(null)} className="btn-secondary">تركه معتمدًا بدون تطبيق الآن</button></div>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function MatchState({ state }: { state: CustomerRequestStaffAttributionRow['match_state'] }) {
  if (state === 'unique_exact_normalized') return <span className="inline-flex items-center gap-1 rounded-full bg-[var(--dawaa-status-success-bg)] px-2 py-1 font-black text-[var(--dawaa-status-success-text)]"><CheckCircle2 size={12} /> تطابق وحيد</span>;
  if (state === 'ambiguous') return <span className="inline-flex items-center gap-1 rounded-full bg-[var(--dawaa-status-warning-bg)] px-2 py-1 font-black text-[var(--dawaa-status-warning-text)]"><AlertTriangle size={12} /> ملتبس</span>;
  return <span className="inline-flex items-center gap-1 rounded-full bg-[var(--dawaa-status-danger-bg)] px-2 py-1 font-black text-[var(--dawaa-status-danger-text)]"><ShieldCheck size={12} /> يحتاج ربط يدوي</span>;
}

function Metric({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'success' | 'warning' | 'danger' }) {
  const toneClass = tone === 'success' ? 'text-[var(--dawaa-status-success-text)]' : tone === 'warning' ? 'text-[var(--dawaa-status-warning-text)]' : tone === 'danger' ? 'text-[var(--dawaa-status-danger-text)]' : 'text-[var(--dawaa-theme-primary)]';
  return <div className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-3"><div className="text-[10px] font-black text-[var(--dawaa-theme-muted)]">{label}</div><div className={`mt-1 text-xl font-black ${toneClass}`}>{value.toLocaleString('ar-EG')}</div></div>;
}
