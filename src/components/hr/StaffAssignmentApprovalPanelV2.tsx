import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, GitBranch, RefreshCw, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  decideStaffAssignmentV2,
  listPendingStaffAssignmentsV2,
  type PendingStaffAssignmentV2,
} from '@/lib/hr/staffAssignmentService';

export default function StaffAssignmentApprovalPanelV2({ enabled }: { enabled: boolean }) {
  const [rows, setRows] = useState<PendingStaffAssignmentV2[]>([]);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      setRows(await listPendingStaffAssignmentsV2());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل تغييرات الفرع والدور المعلقة');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => { void load(); }, [load]);

  async function decide(row: PendingStaffAssignmentV2, decision: 'approve' | 'reject') {
    const decisionNote = (note[row.id] || '').trim();
    if (decision === 'reject' && !decisionNote) {
      toast.warning('سبب الرفض مطلوب.');
      return;
    }
    setLoading(true);
    try {
      const result = await decideStaffAssignmentV2(row.id, decision, decisionNote || null);
      toast.success(
        decision === 'approve'
          ? result.applied_now
            ? 'تم اعتماد التغيير وتحديث Projection الموظف الحالي.'
            : 'تم اعتماد التغيير بتاريخ سريان مستقبلي. لم يتم تعديل Projection الحالي بعد.'
          : 'تم رفض طلب التغيير.'
      );
      setNote((current) => ({ ...current, [row.id]: '' }));
      await load();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'تعذر تسجيل قرار التغيير';
      if (message.includes('requester_cannot_approve_own_request')) {
        toast.error('من أنشأ طلب التغيير لا يمكنه اعتماد طلبه بنفسه.');
      } else {
        toast.error(message);
      }
    } finally {
      setLoading(false);
    }
  }

  if (!enabled) return null;

  return (
    <section className="rounded-3xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]"><GitBranch size={17} /> تغييرات الفرع والدور المعلقة</div>
          <div className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">Governance V2: Request → Review → Effective Date → Projection.</div>
        </div>
        <button onClick={() => void load()} className="btn-secondary"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> تحديث</button>
      </div>

      <div className="mt-3 grid gap-2">
        {rows.map((row) => (
          <div key={row.id} className="rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-3">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="font-black text-[var(--dawaa-theme-heading)]">{row.staff_name}</div>
                <div className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">
                  {row.branch} · {row.role} · يسري من {row.effective_from}
                </div>
                <div className="mt-1 text-xs">{row.change_reason}</div>
                <div className="mt-1 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">
                  طلبه {row.requested_by_name || 'غير معروف'} · {new Date(row.requested_at).toLocaleString('ar-EG')}
                </div>
              </div>
              <div className="flex min-w-[360px] flex-col gap-2 sm:flex-row">
                <input
                  value={note[row.id] || ''}
                  onChange={(e) => setNote((current) => ({ ...current, [row.id]: e.target.value }))}
                  className="input-dark flex-1"
                  placeholder="ملاحظة القرار · مطلوبة عند الرفض"
                />
                <button onClick={() => void decide(row, 'approve')} disabled={loading} className="btn-primary"><CheckCircle2 size={14} /> اعتماد</button>
                <button onClick={() => void decide(row, 'reject')} disabled={loading} className="btn-secondary"><XCircle size={14} /> رفض</button>
              </div>
            </div>
          </div>
        ))}
        {!loading && rows.length === 0 && <div className="rounded-xl border border-[var(--dawaa-theme-border)] p-4 text-sm font-bold text-[var(--dawaa-theme-muted)]">لا توجد تغييرات فرع/دور معلقة حاليًا.</div>}
      </div>
    </section>
  );
}
