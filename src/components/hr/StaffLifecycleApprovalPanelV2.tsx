import { useCallback, useEffect, useState } from 'react';
import { Archive, CheckCircle2, RefreshCw, UserMinus, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  decideStaffLifecycleChangeV2,
  listPendingStaffLifecycleChangesV2,
  type PendingStaffLifecycleChangeV2,
} from '@/lib/hr/staffLifecycleService';

const stateLabel = {
  active: 'تفعيل',
  leaving: 'قيد المغادرة',
  archived: 'أرشفة',
} as const;

export default function StaffLifecycleApprovalPanelV2({ enabled }: { enabled: boolean }) {
  const [rows, setRows] = useState<PendingStaffLifecycleChangeV2[]>([]);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      setRows(await listPendingStaffLifecycleChangesV2());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل طلبات Lifecycle');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => { void load(); }, [load]);

  async function decide(row: PendingStaffLifecycleChangeV2, decision: 'approve' | 'reject') {
    const decisionNote = (note[row.id] || '').trim();
    if (decision === 'reject' && !decisionNote) {
      toast.warning('سبب الرفض مطلوب.');
      return;
    }
    const confirmArchive = row.target_state === 'archived' && decision === 'approve'
      ? window.confirm('اعتماد الأرشفة سيخفي الموظف تشغيليًا ويعطل دخوله عند تاريخ السريان، مع الاحتفاظ بكامل سجلاته. متابعة؟')
      : true;
    if (!confirmArchive) return;

    setLoading(true);
    try {
      await decideStaffLifecycleChangeV2(row.id, decision, decisionNote || null);
      toast.success(decision === 'approve' ? 'تم اعتماد Lifecycle وتسجيل تاريخ السريان.' : 'تم رفض الطلب.');
      setNote((current) => ({ ...current, [row.id]: '' }));
      await load();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'تعذر تسجيل القرار';
      if (message.includes('requester_cannot_approve_own_request')) {
        toast.error('من أنشأ طلب Lifecycle لا يمكنه اعتماد طلبه بنفسه.');
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
          <div className="flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]"><UserMinus size={17} /> Lifecycle الموظفين المعلق</div>
          <div className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">Active / Leaving / Archived بتاريخ سريان وموافقة منفصلة.</div>
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
                  {row.branch || '-'} · {row.role || '-'} · {stateLabel[row.target_state]} · يسري من {row.effective_from}
                  {row.last_working_date ? ` · آخر يوم عمل ${row.last_working_date}` : ''}
                </div>
                <div className="mt-1 text-xs">{row.reason}</div>
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
                <button onClick={() => void decide(row, 'approve')} disabled={loading} className="btn-primary">
                  {row.target_state === 'archived' ? <Archive size={14} /> : <CheckCircle2 size={14} />} اعتماد
                </button>
                <button onClick={() => void decide(row, 'reject')} disabled={loading} className="btn-secondary"><XCircle size={14} /> رفض</button>
              </div>
            </div>
          </div>
        ))}
        {!loading && rows.length === 0 && (
          <div className="rounded-xl border border-[var(--dawaa-theme-border)] p-4 text-sm font-bold text-[var(--dawaa-theme-muted)]">
            لا توجد طلبات Lifecycle معلقة حاليًا.
          </div>
        )}
      </div>
    </section>
  );
}
