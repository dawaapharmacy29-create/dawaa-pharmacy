import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock3, History, RefreshCw, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  decideOvertimeApproval,
  listOvertimeDecisions,
  listPendingOvertime,
  type OvertimeDecisionRow,
  type PendingOvertimeRow,
} from '@/lib/attendance/attendanceBreakdownService';

export default function OvertimeApprovalCenter({ defaultBranch = '' }: { defaultBranch?: string }) {
  const [branch, setBranch] = useState(defaultBranch);
  const [pending, setPending] = useState<PendingOvertimeRow[]>([]);
  const [decisions, setDecisions] = useState<OvertimeDecisionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [decidingId, setDecidingId] = useState<string | null>(null);

  useEffect(() => { setBranch(defaultBranch); }, [defaultBranch]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pendingRows, decisionRows] = await Promise.all([
        listPendingOvertime(branch || null),
        listOvertimeDecisions({ branch: branch || null, limit: 100 }),
      ]);
      setPending(pendingRows);
      setDecisions(decisionRows);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر تحميل بيانات الأوفر تايم');
    } finally {
      setLoading(false);
    }
  }, [branch]);

  useEffect(() => { void load(); }, [load]);

  async function decide(id: string, decision: 'approved' | 'rejected') {
    setDecidingId(id);
    try {
      await decideOvertimeApproval(id, decision);
      toast.success(decision === 'approved' ? 'تم اعتماد الأوفر تايم' : 'تم رفض الأوفر تايم');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر تسجيل القرار');
    } finally {
      setDecidingId(null);
    }
  }

  const money = (v: number | null | undefined) => (v == null ? 'غير محدد' : `${v.toLocaleString('ar-EG')} ج.م`);

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-col gap-3 rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-black text-[var(--dawaa-theme-heading)]">الأوفر تايم</h2>
          <p className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">اعتماد ساعات العمل الإضافي المسجلة وقيمتها المالية. لا يُصرف ولا يُحتسب في الحوافز إلا بعد اعتمادك.</p>
        </div>
        <div className="flex items-center gap-2">
          <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="الفرع (اتركه فارغًا لكل الفروع)" className="input-dark" />
          <button onClick={() => void load()} className="btn-secondary"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث</button>
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-black text-[var(--dawaa-status-warning-text)]"><Clock3 size={17} /> بانتظار اعتمادك</h3>
          <span className="rounded-full border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-theme-surface)] px-3 py-1 text-xs font-black text-[var(--dawaa-status-warning-text)]">{pending.length.toLocaleString('ar-EG')}</span>
        </div>
        {!pending.length ? (
          <p className="text-sm font-bold text-[var(--dawaa-theme-muted)]">لا يوجد أوفر تايم بانتظار القرار حاليًا.</p>
        ) : (
          <div className="grid gap-2">
            {pending.map((row) => (
              <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--dawaa-theme-border)] dawaa-surface p-3">
                <div className="text-sm font-bold text-[var(--dawaa-theme-heading)]">
                  <span className="font-black">{row.staff_name}</span> · {row.branch} · {row.attendance_date} · {row.overtime_hours.toFixed(1)} ساعة
                  {row.overtime_amount != null && <span className="text-[var(--dawaa-theme-muted)]"> (~{money(row.overtime_amount)})</span>}
                </div>
                <div className="flex gap-2">
                  <button disabled={decidingId === row.id} onClick={() => void decide(row.id, 'approved')} className="btn-primary !py-1 !px-3 text-xs"><CheckCircle2 size={14} /> اعتماد</button>
                  <button disabled={decidingId === row.id} onClick={() => void decide(row.id, 'rejected')} className="btn-secondary !py-1 !px-3 text-xs"><XCircle size={14} /> رفض</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
        <h3 className="mb-3 flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]"><History size={17} /> معتمد ومرفوض مؤخرًا</h3>
        {!decisions.length ? (
          <p className="text-sm font-bold text-[var(--dawaa-theme-muted)]">لا توجد قرارات سابقة بعد.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[var(--dawaa-theme-border)]">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--dawaa-theme-border)] text-right text-xs font-black text-[var(--dawaa-theme-muted)]">
                  <th className="p-3">الموظف</th><th className="p-3">الفرع</th><th className="p-3">التاريخ</th><th className="p-3">الساعات</th><th className="p-3">القيمة</th><th className="p-3">الحالة</th><th className="p-3">القرار بواسطة</th><th className="p-3">السبب</th>
                </tr>
              </thead>
              <tbody>
                {decisions.map((row) => (
                  <tr key={row.id} className="border-b border-[var(--dawaa-theme-border)] last:border-0">
                    <td className="p-3 font-bold text-[var(--dawaa-theme-heading)]">{row.staff_name}</td>
                    <td className="p-3">{row.branch}</td>
                    <td className="p-3">{row.attendance_date}</td>
                    <td className="p-3 font-black">{row.overtime_hours.toFixed(1)}</td>
                    <td className="p-3">{money(row.overtime_amount)}</td>
                    <td className="p-3">
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-black ${row.status === 'approved' ? 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]' : 'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] text-[var(--dawaa-status-danger-text)]'}`}>
                        {row.status === 'approved' ? 'معتمد' : 'مرفوض'}
                      </span>
                    </td>
                    <td className="p-3 text-xs font-bold text-[var(--dawaa-theme-muted)]">{row.decided_by_name || '-'}</td>
                    <td className="p-3 text-xs font-bold text-[var(--dawaa-theme-muted)]">{row.decision_note || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
