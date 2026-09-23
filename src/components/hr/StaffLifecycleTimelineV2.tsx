import { useEffect, useState } from 'react';
import { Archive, CalendarClock, History, Save, UserCheck, UserMinus } from 'lucide-react';
import { toast } from 'sonner';
import {
  getStaffLifecycleSnapshotV2,
  requestStaffLifecycleChangeV2,
  type SeparationKindV2,
  type StaffLifecycleSnapshotV2,
  type StaffLifecycleStateV2,
} from '@/lib/hr/staffLifecycleService';

function cairoToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

const stateLabels: Record<StaffLifecycleStateV2, string> = {
  active: 'نشط',
  leaving: 'قيد المغادرة',
  archived: 'مؤرشف',
};

const separationLabels: Record<SeparationKindV2, string> = {
  resignation: 'استقالة',
  termination: 'إنهاء خدمة',
  contract_end: 'انتهاء تعاقد',
  retirement: 'تقاعد',
  transfer_out: 'نقل خارج المنظومة',
  other: 'سبب آخر',
};

export default function StaffLifecycleTimelineV2({
  staffId,
  canWrite,
}: {
  staffId: string;
  canWrite: boolean;
}) {
  const [asOf, setAsOf] = useState(cairoToday());
  const [data, setData] = useState<StaffLifecycleSnapshotV2 | null>(null);
  const [loading, setLoading] = useState(false);
  const [targetState, setTargetState] = useState<StaffLifecycleStateV2>('active');
  const [effectiveFrom, setEffectiveFrom] = useState(cairoToday());
  const [lastWorkingDate, setLastWorkingDate] = useState('');
  const [separationKind, setSeparationKind] = useState<SeparationKindV2>('resignation');
  const [reason, setReason] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    getStaffLifecycleSnapshotV2(staffId, asOf)
      .then((result) => {
        if (!active) return;
        setData(result);
        const effectiveState = result.current?.effective_state || result.current?.target_state || 'active';
        setTargetState(effectiveState);
      })
      .catch((error) => {
        if (active) toast.error(error instanceof Error ? error.message : 'تعذر تحميل Lifecycle الموظف');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [asOf, staffId]);

  async function submit() {
    if (!effectiveFrom || reason.trim().length < 3) {
      toast.warning('حدد تاريخ السريان واكتب سبب واضح للتغيير.');
      return;
    }
    if (targetState === 'leaving' && !lastWorkingDate) {
      toast.warning('حدد آخر يوم عمل عند اختيار قيد المغادرة.');
      return;
    }
    setLoading(true);
    try {
      await requestStaffLifecycleChangeV2({
        staffId,
        effectiveFrom,
        targetState,
        lastWorkingDate: targetState === 'leaving' ? lastWorkingDate : null,
        separationKind: targetState === 'active' ? null : separationKind,
        reason: reason.trim(),
      });
      setReason('');
      setData(await getStaffLifecycleSnapshotV2(staffId, asOf));
      toast.success('تم إنشاء طلب Lifecycle للمراجعة. لم يتم تغيير حالة الموظف مباشرة.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر إنشاء طلب Lifecycle');
    } finally {
      setLoading(false);
    }
  }

  const currentState = data?.current?.effective_state || data?.current?.target_state || 'active';
  const isProjectionActive = data?.projection?.active !== false && data?.projection?.is_active !== false;
  const projectionMismatch =
    (currentState === 'archived' && isProjectionActive)
    || (currentState !== 'archived' && !isProjectionActive);

  return (
    <section className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]">
            <UserCheck size={17} /> Employee Lifecycle V2
          </div>
          <p className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">
            Active → Leaving → Archived بتاريخ سريان ومراجعة. الأرشفة توقف الظهور التشغيلي والدخول بدون حذف التاريخ.
          </p>
        </div>
        <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">
          الحالة في تاريخ
          <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="input-dark mt-1 block" />
        </label>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <div className="rounded-xl bg-[var(--dawaa-theme-surface-2)] p-3">
          <div className="text-[10px] font-black text-[var(--dawaa-theme-muted)]">الحالة الفعلية</div>
          <div className="mt-1 font-black">{stateLabels[currentState as StaffLifecycleStateV2] || currentState}</div>
        </div>
        <div className="rounded-xl bg-[var(--dawaa-theme-surface-2)] p-3">
          <div className="text-[10px] font-black text-[var(--dawaa-theme-muted)]">الحالة في Projection</div>
          <div className="mt-1 font-black">{data?.projection?.status || 'غير محدد'}</div>
        </div>
        <div className="rounded-xl bg-[var(--dawaa-theme-surface-2)] p-3">
          <div className="text-[10px] font-black text-[var(--dawaa-theme-muted)]">آخر يوم عمل</div>
          <div className="mt-1 font-black">{data?.current?.last_working_date || '—'}</div>
        </div>
        <div className="rounded-xl bg-[var(--dawaa-theme-surface-2)] p-3">
          <div className="text-[10px] font-black text-[var(--dawaa-theme-muted)]">الظهور في الجدول</div>
          <div className="mt-1 font-black">{data?.projection?.visible_in_schedule === false ? 'مخفي' : 'ظاهر'}</div>
        </div>
      </div>

      {projectionMismatch && (
        <div className="mt-3 rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-3 text-xs font-bold text-[var(--dawaa-status-warning-text)]">
          يوجد اختلاف بين Lifecycle المعتمدة وProjection التشغيلية الحالية. الـMaterializer سيعيد المزامنة تلقائيًا، لكن راجع الحالة قبل اتخاذ قرار مالي.
        </div>
      )}

      {canWrite && (
        <div className="mt-4 rounded-xl border border-[var(--dawaa-theme-border)] p-3">
          <div className="font-black">طلب تغيير Lifecycle</div>
          <div className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">
            الطلب لا يغيّر الموظف مباشرة. الإدارة العليا تعتمد أولًا، ثم يطبق النظام التغيير في تاريخ السريان.
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="text-sm font-bold">الحالة الجديدة
              <select value={targetState} onChange={(e) => setTargetState(e.target.value as StaffLifecycleStateV2)} className="input-dark mt-1 w-full">
                <option value="active">نشط</option>
                <option value="leaving">قيد المغادرة</option>
                <option value="archived">مؤرشف</option>
              </select>
            </label>
            <label className="text-sm font-bold">يسري من
              <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="input-dark mt-1 w-full" />
            </label>
            {targetState === 'leaving' && (
              <label className="text-sm font-bold">آخر يوم عمل
                <input type="date" min={effectiveFrom} value={lastWorkingDate} onChange={(e) => setLastWorkingDate(e.target.value)} className="input-dark mt-1 w-full" />
              </label>
            )}
            {targetState !== 'active' && (
              <label className="text-sm font-bold">سبب إنهاء/مغادرة
                <select value={separationKind} onChange={(e) => setSeparationKind(e.target.value as SeparationKindV2)} className="input-dark mt-1 w-full">
                  {Object.entries(separationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
            )}
            <label className="text-sm font-bold md:col-span-2 xl:col-span-4">سبب التغيير
              <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} className="input-dark mt-1 w-full" placeholder="سبب موثق وواضح" />
            </label>
          </div>
          <button onClick={() => void submit()} disabled={loading} className="btn-primary mt-3">
            {targetState === 'archived' ? <Archive size={14} /> : targetState === 'leaving' ? <UserMinus size={14} /> : <Save size={14} />}
            إرسال للمراجعة
          </button>
        </div>
      )}

      <div className="mt-4">
        <div className="flex items-center gap-2 font-black"><History size={15} /> تاريخ Lifecycle · {data?.history.length ?? 0}</div>
        <div className="mt-2 space-y-2">
          {data?.history.slice(0, 12).map((row) => (
            <div key={row.id || `${row.effective_from}-${row.target_state}`} className="rounded-xl border border-[var(--dawaa-theme-border)] p-3 text-xs">
              <div className="font-black">{stateLabels[row.target_state]} · {row.state}</div>
              <div className="mt-1 font-bold text-[var(--dawaa-theme-muted)]">
                <CalendarClock size={12} className="ml-1 inline" /> من {row.effective_from || 'Legacy'}
                {row.last_working_date ? ` · آخر يوم ${row.last_working_date}` : ''}
              </div>
              <div className="mt-1">{row.reason}</div>
              {row.decided_by_name && <div className="mt-1 text-[var(--dawaa-theme-muted)]">قرار: {row.decided_by_name}</div>}
            </div>
          ))}
          {!loading && !data?.history.length && (
            <div className="text-xs font-bold text-[var(--dawaa-theme-muted)]">لا توجد تغييرات Lifecycle V2 موثقة بعد؛ الحالة الحالية مأخوذة من Projection الموظف.</div>
          )}
        </div>
      </div>
    </section>
  );
}
