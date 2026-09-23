import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { cairoToday } from '@/lib/attendance/period';
import { createEmploymentProfileVersion, getEmploymentProfileTimeline, type EmploymentProfileTimeline, type EmploymentProfileVersion } from '@/lib/hr/employmentProfileService';
import type { StaffDirectoryIdentity } from '@/lib/readModels/staffDirectoryReadModel';

const types: Record<EmploymentProfileVersion['employment_type'], string> = {
  full_time: 'دوام كامل', part_time: 'دوام جزئي', temporary: 'مؤقت', contractor: 'تعاقد خارجي',
};

export default function EmploymentProfileTimeline({ staffId, canWrite, staffOptions }: {
  staffId: string; canWrite: boolean; staffOptions: StaffDirectoryIdentity[];
}) {
  const [asOf, setAsOf] = useState(cairoToday());
  const [data, setData] = useState<EmploymentProfileTimeline | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState(cairoToday());
  const [employmentType, setEmploymentType] = useState<EmploymentProfileVersion['employment_type']>('full_time');
  const [grade, setGrade] = useState('');
  const [managerId, setManagerId] = useState('');
  const [reason, setReason] = useState('');
  const [supersedesId, setSupersedesId] = useState<string | null>(null);

  useEffect(() => {
    setEffectiveFrom(cairoToday()); setEmploymentType('full_time'); setGrade('');
    setManagerId(''); setReason(''); setSupersedesId(null);
  }, [staffId]);

  useEffect(() => {
    let active = true;
    setData(null); setError(''); setLoading(true);
    getEmploymentProfileTimeline(staffId, asOf)
      .then((result) => { if (active) setData(result); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'تعذر تحميل البيانات الوظيفية'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [staffId, asOf]);

  function correct(row: EmploymentProfileVersion) {
    setEffectiveFrom(row.effective_from); setEmploymentType(row.employment_type);
    setGrade(row.grade_label || ''); setManagerId(row.reports_to_staff_id || '');
    setReason(''); setSupersedesId(row.id);
  }

  async function save() {
    if (!effectiveFrom || managerId === staffId || (supersedesId && !reason.trim())) {
      toast.warning('راجع تاريخ السريان والمسؤول وسبب التصحيح.'); return;
    }
    setSaving(true);
    try {
      await createEmploymentProfileVersion({
        staffId, effectiveFrom, employmentType, gradeLabel: grade.trim() || null,
        managerStaffId: managerId || null, changeReason: reason.trim() || null, supersedesId,
      });
      setData(await getEmploymentProfileTimeline(staffId, asOf));
      setEffectiveFrom(cairoToday()); setEmploymentType('full_time'); setGrade('');
      setManagerId(''); setReason(''); setSupersedesId(null); setError('');
      toast.success('تم حفظ نسخة البيانات الوظيفية');
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : 'تعذر الحفظ'); }
    finally { setSaving(false); }
  }

  return <section className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4">
    <h2 className="font-black">البيانات الوظيفية المؤرخة</h2>
    <p className="mt-1 text-xs text-[var(--dawaa-theme-muted)]">نوع التوظيف والدرجة والمسؤول المباشر حسب تاريخ السريان. لا تغيّر هذه البيانات دور الدخول أو الفرع أو الراتب.</p>
    <label className="mt-3 block max-w-xs text-sm">عرض الحالة في تاريخ<input type="date" className="input-dark mt-1 w-full" value={asOf} onChange={(event) => setAsOf(event.target.value)} /></label>
    {loading && <p className="mt-3">جارٍ التحميل...</p>}
    {error && <div role="alert" className="mt-3 text-[var(--dawaa-status-danger-text)]">{error}</div>}
    {!loading && !error && <div className="mt-3 rounded-xl border border-[var(--dawaa-theme-border)] p-3 text-sm">
      {data?.current ? <><strong>{types[data.current.employment_type]}</strong> · الدرجة: {data.current.grade_label || 'غير محددة'} · المسؤول: {data.current.manager_name || 'غير محدد'} <span className="text-xs text-[var(--dawaa-theme-muted)]">(من {data.current.effective_from})</span></> : 'لا توجد بيانات وظيفية مؤرخة لهذا التاريخ.'}
    </div>}
    {canWrite && <div className="mt-4 rounded-xl border border-[var(--dawaa-theme-border)] p-3">
      <h3 className="font-bold">{supersedesId ? 'تصحيح نسخة سابقة' : 'إضافة نسخة بتاريخ سريان'}</h3>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label>يسري من<input type="date" className="input-dark mt-1 w-full" disabled={!!supersedesId} value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} /></label>
        <label>نوع التوظيف<select className="input-dark mt-1 w-full" value={employmentType} onChange={(event) => setEmploymentType(event.target.value as EmploymentProfileVersion['employment_type'])}>{Object.entries(types).map(([key,label]) => <option value={key} key={key}>{label}</option>)}</select></label>
        <label>الدرجة الوظيفية · اختياري<input className="input-dark mt-1 w-full" maxLength={100} value={grade} onChange={(event) => setGrade(event.target.value)} /></label>
        <label>المسؤول المباشر · اختياري<select className="input-dark mt-1 w-full" value={managerId} onChange={(event) => setManagerId(event.target.value)}><option value="">غير محدد</option>{staffOptions.filter((item) => item.id && item.id !== staffId).map((item) => <option key={item.id} value={item.id || ''}>{item.name} · {item.branch}</option>)}</select></label>
        <label className="md:col-span-2">سبب التغيير {supersedesId ? '· مطلوب للتصحيح' : '· اختياري'}<input className="input-dark mt-1 w-full" maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      </div>
      <div className="mt-3 flex gap-2"><button className="btn-primary" disabled={saving} onClick={() => void save()}>حفظ النسخة</button>
        {supersedesId && <button className="btn-secondary" disabled={saving} onClick={() => setSupersedesId(null)}>إلغاء التصحيح</button>}
      </div>
    </div>}
    <h3 className="mt-4 font-bold">تاريخ النسخ · {data?.history.length ?? '—'}</h3>
    {data?.history.length === 100 && <p className="text-xs text-[var(--dawaa-theme-muted)]">تعرض أحدث ١٠٠ نسخة.</p>}
    <div className="mt-2 space-y-2">{data?.history.map((row) => <article key={row.id} className="rounded-xl border border-[var(--dawaa-theme-border)] p-3 text-sm">
      <strong>{types[row.employment_type]}</strong> · {row.grade_label || 'درجة غير محددة'} · من {row.effective_from}
      {row.is_superseded && <span className="mr-2 text-[var(--dawaa-theme-muted)]">تم تصحيحها</span>}
      <div className="mt-1 text-xs text-[var(--dawaa-theme-muted)]">المسؤول: {row.manager_name || 'غير محدد'} · سجلها {row.created_by_name || 'غير معروف'} · {new Date(row.created_at).toLocaleString('ar-EG')}</div>
      {row.change_reason && <div className="mt-1 text-xs">السبب: {row.change_reason}</div>}
      {canWrite && !row.is_superseded && <button className="btn-secondary mt-2" onClick={() => correct(row)}>تصحيح هذه النسخة</button>}
    </article>)}</div>
  </section>;
}
