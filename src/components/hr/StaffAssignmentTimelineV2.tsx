import { useEffect, useState } from 'react';
import { CalendarClock, GitBranch, History, Save } from 'lucide-react';
import { toast } from 'sonner';
import { BRANCHES, ROLES } from '@/lib/constants';
import {
  getStaffAssignmentTimelineV2,
  requestStaffAssignmentV2,
  type StaffAssignmentTimelineV2,
} from '@/lib/hr/staffAssignmentService';

function cairoToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export default function StaffAssignmentTimelineV2({
  staffId,
  canWrite,
}: {
  staffId: string;
  canWrite: boolean;
}) {
  const [asOf, setAsOf] = useState(cairoToday());
  const [data, setData] = useState<StaffAssignmentTimelineV2 | null>(null);
  const [loading, setLoading] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState(cairoToday());
  const [branch, setBranch] = useState('');
  const [role, setRole] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    getStaffAssignmentTimelineV2(staffId, asOf)
      .then((result) => {
        if (!active) return;
        setData(result);
        setBranch(result.current?.branch || result.projection?.branch || '');
        setRole(result.current?.role || result.projection?.role || '');
      })
      .catch((error) => {
        if (active) toast.error(error instanceof Error ? error.message : 'تعذر تحميل تاريخ الفرع والدور');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [asOf, staffId]);

  async function submit() {
    if (!effectiveFrom || !branch || !role || reason.trim().length < 3) {
      toast.warning('حدد تاريخ السريان والفرع والدور وسبب واضح للتغيير.');
      return;
    }
    setLoading(true);
    try {
      await requestStaffAssignmentV2({
        staffId,
        effectiveFrom,
        branch,
        role,
        reason: reason.trim(),
      });
      setReason('');
      setData(await getStaffAssignmentTimelineV2(staffId, asOf));
      toast.success('تم إنشاء طلب تغيير وظيفي للمراجعة. لم يتم تعديل سجل الموظف مباشرة.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر إنشاء طلب التغيير');
    } finally {
      setLoading(false);
    }
  }

  const current = data?.current;
  const projectionDrift = !!current
    && current.state !== 'legacy_projection'
    && (current.branch !== data?.projection.branch || current.role !== data?.projection.role);

  return (
    <section className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]">
            <GitBranch size={17} /> الفرع والدور بتاريخ السريان
          </div>
          <p className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">
            سجل Effective-dated مستقل. public.staff يظل Projection حاليًا للتوافق مع الصفحات القديمة، ولا يُعدّل إلا بعد اعتماد التغيير.
          </p>
        </div>
        <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">
          الحالة في تاريخ
          <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="input-dark mt-1 block" />
        </label>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-xl bg-[var(--dawaa-theme-surface-2)] p-3">
          <div className="text-[10px] font-black text-[var(--dawaa-theme-muted)]">الفرع المعتمد</div>
          <div className="mt-1 font-black">{current?.branch || 'غير محدد'}</div>
        </div>
        <div className="rounded-xl bg-[var(--dawaa-theme-surface-2)] p-3">
          <div className="text-[10px] font-black text-[var(--dawaa-theme-muted)]">الدور المعتمد</div>
          <div className="mt-1 font-black">{current?.role || 'غير محدد'}</div>
        </div>
        <div className="rounded-xl bg-[var(--dawaa-theme-surface-2)] p-3">
          <div className="text-[10px] font-black text-[var(--dawaa-theme-muted)]">المصدر</div>
          <div className="mt-1 font-black">{current?.state === 'legacy_projection' ? 'Legacy Projection' : 'Assignment V2'}</div>
        </div>
      </div>

      {projectionDrift && (
        <div className="mt-3 rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-3 text-xs font-bold text-[var(--dawaa-status-warning-text)]">
          يوجد اختلاف بين الـAssignment المعتمد وProjection الموظف الحالي. يحتاج تشغيل projection/materializer قبل الاعتماد التشغيلي.
        </div>
      )}

      {canWrite && (
        <div className="mt-4 rounded-xl border border-[var(--dawaa-theme-border)] p-3">
          <div className="font-black">طلب تغيير فرع / دور</div>
          <div className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">Request → Review → Effective Date. لا يوجد تعديل مباشر هنا.</div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-sm font-bold">يسري من<input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="input-dark mt-1 w-full" /></label>
            <label className="text-sm font-bold">الفرع<select value={branch} onChange={(e) => setBranch(e.target.value)} className="input-dark mt-1 w-full">
              <option value="">اختر الفرع</option>{BRANCHES.map((item) => <option key={item}>{item}</option>)}
            </select></label>
            <label className="text-sm font-bold">الدور<select value={role} onChange={(e) => setRole(e.target.value)} className="input-dark mt-1 w-full">
              <option value="">اختر الدور</option>{ROLES.map((item) => <option key={item}>{item}</option>)}
            </select></label>
            <label className="text-sm font-bold">سبب التغيير<input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className="input-dark mt-1 w-full" placeholder="مثال: نقل للفرع / تغيير مسمى وظيفي" /></label>
          </div>
          <button onClick={() => void submit()} disabled={loading} className="btn-primary mt-3"><Save size={14} /> إرسال للمراجعة</button>
        </div>
      )}

      <div className="mt-4">
        <div className="flex items-center gap-2 font-black"><History size={15} /> تاريخ التغييرات · {data?.history.length ?? 0}</div>
        <div className="mt-2 space-y-2">
          {data?.history.slice(0, 10).map((row) => (
            <div key={row.id || `${row.effective_from}-${row.branch}-${row.role}`} className="rounded-xl border border-[var(--dawaa-theme-border)] p-3 text-xs">
              <div className="font-black">{row.branch} · {row.role}</div>
              <div className="mt-1 font-bold text-[var(--dawaa-theme-muted)]">
                <CalendarClock size={12} className="ml-1 inline" /> من {row.effective_from || 'Legacy'} · {row.state}
              </div>
              <div className="mt-1">{row.change_reason}</div>
              {row.decision_note && <div className="mt-1 text-[var(--dawaa-theme-muted)]">قرار: {row.decision_note}</div>}
            </div>
          ))}
          {!loading && !data?.history.length && <div className="text-xs font-bold text-[var(--dawaa-theme-muted)]">لا توجد تغييرات V2 موثقة بعد؛ الحالة الحالية مأخوذة من Projection الموظف.</div>}
        </div>
      </div>
    </section>
  );
}
