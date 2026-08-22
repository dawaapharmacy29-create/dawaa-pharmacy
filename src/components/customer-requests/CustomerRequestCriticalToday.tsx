import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { CustomerRequest } from '@/lib/api/customerRequests';
import { getCustomerRequestQualityCenter, qualityPriorityLabel, type QualityCenterRow } from '@/lib/api/customerRequestQualityCenter';

export default function CustomerRequestCriticalToday({ branch, onOpenRequest }: { branch: string; onOpenRequest: (request: CustomerRequest) => void }) {
  const [rows, setRows] = useState<QualityCenterRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getCustomerRequestQualityCenter({ branch, priority: 'critical', sort: 'smart', limit: 120 })
      .then((data) => { if (active) setRows(data.rows.slice(0, 5)); })
      .catch((error) => toast.error(`تعذر تحميل أهم طلبات التدخل: ${(error as Error).message}`))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [branch]);

  return (
    <section className="rounded-3xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)]/[0.05] p-4 shadow-lg">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]"><AlertTriangle size={18} className="text-[var(--dawaa-status-danger-text)]" /> أعلى طلبات تحتاج تدخل الآن</div>
          <p className="mt-1 text-xs text-[var(--dawaa-theme-muted)]">تجمع العاجل والتأخير ومشاكل ربط العميل أو الصنف وعدم وجود مسئول.</p>
        </div>
        {!loading && <span className="num rounded-full bg-[var(--dawaa-status-danger-bg)] px-3 py-1 text-xs font-black text-[var(--dawaa-status-danger-text)]">{rows.length}</span>}
      </div>

      {loading ? <div className="flex h-24 items-center justify-center"><Loader2 className="animate-spin text-[var(--dawaa-status-danger-text)]" /></div>
        : rows.length === 0 ? <div className="mt-4 rounded-2xl border border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)]/[0.06] p-4 text-center text-xs font-bold text-[var(--dawaa-status-success-text)]">لا توجد طلبات حرجة في النطاق الحالي.</div>
        : <div className="mt-4 grid gap-2 xl:grid-cols-2">{rows.map((row) => <button key={row.request.id} type="button" onClick={() => onOpenRequest(row.request)} className="rounded-2xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-theme-surface)] p-3 text-right transition hover:border-[var(--dawaa-status-danger-border)] hover:bg-[var(--dawaa-status-danger-bg)]/[0.06]"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate font-black text-[var(--dawaa-theme-heading)]">{row.request.medicine_name || 'صنف غير محدد'}</div><div className="mt-1 text-[11px] text-[var(--dawaa-theme-muted)]">{row.request.customer_name || 'عميل غير محدد'} · {row.request.branch || 'بدون فرع'}</div><div className="mt-2 flex flex-wrap gap-1">{row.priorityReasons.slice(0, 3).map((reason) => <span key={reason} className="rounded-lg bg-[var(--dawaa-status-danger-bg)] px-2 py-1 text-[10px] font-black text-[var(--dawaa-status-danger-text)]">{reason}</span>)}</div></div><div className="shrink-0 text-left"><div className="num text-xl font-black text-[var(--dawaa-status-danger-text)]">{row.priorityScore}</div><div className="text-[10px] font-bold text-[var(--dawaa-status-danger-text)]">{qualityPriorityLabel(row.priorityBand)}</div><ChevronLeft size={15} className="mr-auto mt-2 text-[var(--dawaa-theme-primary)]" /></div></div></button>)}</div>}
    </section>
  );
}
