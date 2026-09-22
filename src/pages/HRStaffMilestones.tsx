import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { readStaffDirectory, type StaffDirectoryIdentity } from '@/lib/readModels/staffDirectoryReadModel';
import { completeStaffMilestone, createStaffMilestone, listDueStaffMilestones, listStaffMilestones, type DueStaffMilestone, type StaffMilestone } from '@/lib/hr/staffMilestoneService';

const kinds: Record<StaffMilestone['kind'], string> = {
  onboarding: 'تهيئة موظف جديد', document: 'استكمال مستند',
  training: 'تدريب', offboarding: 'تسليم ومغادرة',
};
const centralRoles = ['general_manager', 'admin', 'executive_manager', 'branches_manager'];

export default function HRStaffMilestones() {
  const { user } = useAuth();
  const central = centralRoles.includes(user?.role || '');
  const allowed = central || user?.role === 'branch_manager';
  const [staff, setStaff] = useState<StaffDirectoryIdentity[]>([]);
  const [staffId, setStaffId] = useState('');
  const [rows, setRows] = useState<StaffMilestone[]>([]);
  const [due, setDue] = useState<DueStaffMilestone[]>([]);
  const [dueError, setDueError] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [kind, setKind] = useState<StaffMilestone['kind']>('onboarding');
  const [title, setTitle] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!allowed) return;
    let active = true;
    readStaffDirectory().then((items) => {
      if (!active) return;
      const branch = normalizeBranchName(user?.branch || '');
      setStaff(items.filter((item) => item.source === 'staff' && item.id &&
        (central || normalizeBranchName(item.branch || '') === branch)));
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'تعذر تحميل الموظفين'); });
    return () => { active = false; };
  }, [allowed, central, user?.branch]);

  useEffect(() => {
    if (!allowed) return;
    let active = true;
    listDueStaffMilestones(central ? null : user?.branch || null)
      .then((items) => { if (active) { setDue(items); setDueError(''); } })
      .catch((cause) => { if (active) { setDue([]); setDueError(cause instanceof Error ? cause.message : 'تعذر تحميل المهام المستحقة'); } });
    return () => { active = false; };
  }, [allowed, central, user?.branch]);

  useEffect(() => {
    if (!staffId || !allowed) { setRows([]); return; }
    let active = true;
    setLoading(true);
    setError('');
    listStaffMilestones(staffId).then((items) => { if (active) setRows(items); })
      .catch((cause) => { if (active) { setRows([]); setError(cause instanceof Error ? cause.message : 'تعذر تحميل سجل الموظف'); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [staffId, allowed]);

  const selected = useMemo(() => staff.find((item) => item.id === staffId), [staff, staffId]);
  if (!allowed) return <div role="alert" className="p-6">غير مصرح بعرض سجلات الموارد البشرية.</div>;

  async function refresh() {
    const [staffRows, dueRows] = await Promise.all([
      staffId ? listStaffMilestones(staffId) : Promise.resolve([]),
      listDueStaffMilestones(central ? null : user?.branch || null),
    ]);
    setRows(staffRows);
    setDue(dueRows);
    setError('');
    setDueError('');
  }

  async function create() {
    if (!staffId || title.trim().length < 3) { toast.warning('اختر الموظف واكتب مهمة واضحة.'); return; }
    setSaving(true);
    try {
      await createStaffMilestone({ staffId, kind, title: title.trim(), dueOn: dueOn || null, note: note.trim() || null });
      setTitle(''); setNote(''); setDueOn('');
      await refresh();
      toast.success('تم تسجيل المهمة في ملف الموظف');
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : 'تعذر حفظ المهمة'); }
    finally { setSaving(false); }
  }

  async function complete(id: string) {
    setSaving(true);
    try {
      const changed = await completeStaffMilestone(id);
      await refresh();
      toast.success(changed ? 'تم تسجيل الإكمال' : 'المهمة مكتملة بالفعل');
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : 'تعذر إكمال المهمة'); }
    finally { setSaving(false); }
  }

  return <div dir="rtl" className="space-y-5">
    <header className="rounded-3xl border border-[var(--dawaa-theme-border)] dawaa-surface p-5">
      <h1 className="text-2xl font-black text-[var(--dawaa-theme-heading)]">ملف الموظف الوظيفي · المهام</h1>
      <p className="mt-2 text-sm text-[var(--dawaa-theme-muted)]">متابعة تهيئة الموظف والمستندات والتدريب والتسليم. الإكمال يسجل اسم المسؤول ووقته، ولا يغيّر الحضور أو المرتب.</p>
    </header>
    <section className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4">
      <h2 className="font-black">مهام تحتاج متابعة خلال أسبوع · {dueError ? 'غير متاحة' : due.length}</h2>
      <p className="mt-1 text-xs text-[var(--dawaa-theme-muted)]">تعرض أول ١٠٠ مهمة متأخرة أو مستحقة خلال ٧ أيام، مرتبة حسب الموعد. المهام بلا موعد تظهر في ملف الموظف فقط.</p>
      {dueError && <div role="alert" className="mt-2 text-sm text-[var(--dawaa-status-danger-text)]">{dueError}</div>}
      {!dueError && due.length === 0 && <p className="mt-3 text-sm">لا توجد مهام محددة الموعد تحتاج متابعة.</p>}
      <div className="mt-3 grid gap-2 md:grid-cols-2">{due.map((item) => <button key={item.id} type="button" onClick={() => setStaffId(item.staff_id)} className="rounded-xl border border-[var(--dawaa-theme-border)] p-3 text-right hover:bg-[var(--dawaa-theme-surface-2)]">
        <div className="flex justify-between gap-2"><strong>{item.staff_name} · {item.title}</strong><span className={item.days_until_due < 0 ? 'text-[var(--dawaa-status-danger-text)]' : 'text-[var(--dawaa-theme-muted)]'}>{item.days_until_due < 0 ? `متأخرة ${Math.abs(item.days_until_due)} يوم` : item.days_until_due === 0 ? 'اليوم' : `خلال ${item.days_until_due} يوم`}</span></div>
        <div className="mt-1 text-xs text-[var(--dawaa-theme-muted)]">{item.branch} · {kinds[item.kind]} · {item.due_on}</div>
      </button>)}</div>
    </section>
    <section className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4">
      <label className="block text-sm font-bold">الموظف</label>
      <select className="input-dark mt-2 w-full max-w-lg" value={staffId} onChange={(event) => setStaffId(event.target.value)}>
        <option value="">اختر موظفًا</option>
        {staff.map((item) => <option key={item.id} value={item.id || ''}>{item.name} · {item.branch}</option>)}
      </select>
      {selected && <div className="mt-3 text-sm text-[var(--dawaa-theme-muted)]">{selected.role} · {selected.branch} · <Link className="underline" to={`/staff/${selected.id}`}>الملف والأداء</Link></div>}
    </section>
    {error && <div role="alert" className="rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] p-4">{error}</div>}
    {staffId && central && <section className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4">
      <h2 className="font-black">إضافة مهمة للموظف</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label>النوع<select className="input-dark mt-1 w-full" value={kind} onChange={(event) => setKind(event.target.value as StaffMilestone['kind'])}>{Object.entries(kinds).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>
        <label>موعد المتابعة<input className="input-dark mt-1 w-full" type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} /></label>
        <label>المهمة<input className="input-dark mt-1 w-full" maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>ملاحظة اختيارية<input className="input-dark mt-1 w-full" maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      </div>
      <button className="btn-primary mt-3" disabled={saving} onClick={() => void create()}>تسجيل المهمة</button>
    </section>}
    {staffId && <section className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4">
      <h2 className="font-black">سجل المهام {loading ? '· جارٍ التحميل' : `· ${rows.length}`}</h2>
      {!loading && !error && rows.length === 0 && <p className="mt-3 text-sm text-[var(--dawaa-theme-muted)]">لا توجد مهام مسجلة لهذا الموظف.</p>}
      <div className="mt-3 space-y-2">{rows.map((row) => <article key={row.id} className="rounded-xl border border-[var(--dawaa-theme-border)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><strong>{row.title}</strong><span className="text-xs">{kinds[row.kind]} · {row.completed_at ? 'مكتملة' : 'مفتوحة'}</span></div>
        <div className="mt-1 text-xs text-[var(--dawaa-theme-muted)]">موعد المتابعة: {row.due_on || 'غير محدد'} · سُجلت بواسطة {row.created_by_name || 'غير معروف'}</div>
        {row.note && <p className="mt-2 text-sm">{row.note}</p>}
        {row.completed_at ? <div className="mt-2 text-xs">أكملها {row.completed_by_name || 'غير معروف'} · {new Date(row.completed_at).toLocaleString('ar-EG')}</div> :
          <button className="btn-secondary mt-2" disabled={saving} onClick={() => void complete(row.id)}>تأكيد الإكمال</button>}
      </article>)}</div>
    </section>}
  </div>;
}
