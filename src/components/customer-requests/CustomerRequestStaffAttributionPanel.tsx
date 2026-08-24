import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck, UserRoundSearch } from 'lucide-react';
import { toast } from 'sonner';
import {
  getCustomerRequestStaffAttributionReview,
  type CustomerRequestStaffAttributionRow,
} from '@/lib/api/customerRequestStaffAttribution';

export default function CustomerRequestStaffAttributionPanel({ branch }: { branch: string }) {
  const [rows, setRows] = useState<CustomerRequestStaffAttributionRow[]>([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <section className="rounded-3xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]">
            <UserRoundSearch size={18} className="text-[var(--dawaa-theme-primary)]" />
            مراجعة هوية الموظف في الطلبات القديمة
          </div>
          <p className="mt-1 max-w-4xl text-xs font-bold leading-6 text-[var(--dawaa-theme-muted)]">
            هذه الشاشة للقراءة والمراجعة فقط. لا يتم ربط أي Doctor ID تلقائيًا من الاسم، ولا تُحتسب نقاط تاريخية قبل اعتماد هوية حقيقية غير ملتبسة.
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="btn-secondary flex items-center gap-2 text-xs">
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
        <table className="min-w-[860px] w-full text-right text-xs">
          <thead className="bg-[var(--dawaa-theme-surface-2)] text-[var(--dawaa-theme-muted)]">
            <tr>
              <th className="px-3 py-3">الاسم القادم من المصدر</th>
              <th className="px-3 py-3">الفرع</th>
              <th className="px-3 py-3">عدد الطلبات</th>
              <th className="px-3 py-3">الموظف المقترح</th>
              <th className="px-3 py-3">الدور</th>
              <th className="px-3 py-3">حالة المطابقة</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.branch || 'none'}:${row.source_label}`} className="border-t border-[var(--dawaa-theme-border)]">
                <td className="px-3 py-3 font-black text-[var(--dawaa-theme-heading)]">{row.source_label}</td>
                <td className="px-3 py-3 text-[var(--dawaa-theme-text)]">{row.branch || 'غير محدد'}</td>
                <td className="px-3 py-3 font-black text-[var(--dawaa-theme-heading)]">{row.requests_count.toLocaleString('ar-EG')}</td>
                <td className="px-3 py-3">{row.suggested_staff_name || '—'}</td>
                <td className="px-3 py-3 text-[var(--dawaa-theme-muted)]">{row.suggested_staff_role || '—'}</td>
                <td className="px-3 py-3"><MatchState state={row.match_state} /></td>
              </tr>
            ))}
            {!loading && rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center font-bold text-[var(--dawaa-theme-muted)]">لا توجد أسماء قديمة تحتاج مراجعة ضمن هذا النطاق.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
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
