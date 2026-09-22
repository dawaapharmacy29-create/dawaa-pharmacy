import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { createStaffEmploymentRecord, listStaffEmploymentRecords, type StaffEmploymentRecord } from '@/lib/hr/staffEmploymentService';

const kinds: Record<StaffEmploymentRecord['record_kind'], string> = {
  contract: 'عقد', renewal: 'تجديد', assignment: 'تكليف موثق', correction: 'تصحيح سجل سابق',
};

export default function StaffEmploymentRecords({ staffId, canWrite }: { staffId: string; canWrite: boolean }) {
  const [records, setRecords] = useState<StaffEmploymentRecord[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [kind, setKind] = useState<StaffEmploymentRecord['record_kind']>('contract');
  const [title, setTitle] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [supersedesId, setSupersedesId] = useState<string | null>(null);

  useEffect(() => {
    setKind('contract'); setTitle(''); setFrom(''); setTo('');
    setReference(''); setNote(''); setSupersedesId(null);
  }, [staffId]);

  useEffect(() => {
    let active = true;
    setRecords([]); setError(''); setLoading(true);
    listStaffEmploymentRecords(staffId)
      .then((data) => { if (active) setRecords(data); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'تعذر تحميل السجل الوظيفي'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [staffId]);

  async function save() {
    if (!from || title.trim().length < 3 || (to && to < from)) {
      toast.warning('راجع العنوان وتاريخ السريان والانتهاء.'); return;
    }
    setSaving(true);
    try {
      await createStaffEmploymentRecord({
        staffId, kind, title: title.trim(), effectiveFrom: from, effectiveTo: to || null,
        referenceCode: reference.trim() || null, note: note.trim() || null, supersedesId,
      });
      setRecords(await listStaffEmploymentRecords(staffId));
      setKind('contract'); setTitle(''); setFrom(''); setTo(''); setReference(''); setNote(''); setSupersedesId(null);
      setError('');
      toast.success('تم حفظ السجل بتاريخ السريان');
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : 'تعذر حفظ السجل'); }
    finally { setSaving(false); }
  }

  function correct(record: StaffEmploymentRecord) {
    setKind('correction'); setTitle(record.title); setFrom(record.effective_from);
    setTo(record.effective_to || ''); setReference(record.reference_code || '');
    setNote(record.note || ''); setSupersedesId(record.id);
  }

  return <section className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4">
    <h2 className="font-black">سجل العقود والتكليفات {loading ? '· جارٍ التحميل' : `· ${records.length}`}</h2>
    <p className="mt-1 text-xs text-[var(--dawaa-theme-muted)]">توثيق بيانات العقد أو التكليف وتاريخ سريانه فقط. لا يغيّر فرع الموظف أو دوره أو راتبه، ولا يحفظ نسخة من المستند نفسه.</p>
    {error && <div role="alert" className="mt-3 text-sm text-[var(--dawaa-status-danger-text)]">{error}</div>}
    {canWrite && <div className="mt-4 rounded-xl border border-[var(--dawaa-theme-border)] p-3">
      <h3 className="font-bold">{supersedesId ? 'تصحيح سجل محفوظ' : 'توثيق سجل جديد'}</h3>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label>نوع السجل<select className="input-dark mt-1 w-full" disabled={!!supersedesId} value={kind} onChange={(event) => setKind(event.target.value as StaffEmploymentRecord['record_kind'])}>{Object.entries(kinds).filter(([key]) => key !== 'correction' || !!supersedesId).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>
        <label>عنوان العقد أو التكليف<input className="input-dark mt-1 w-full" maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>يسري من<input type="date" className="input-dark mt-1 w-full" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>يسري حتى · اختياري<input type="date" className="input-dark mt-1 w-full" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <label>رقم أو مرجع المستند · اختياري<input className="input-dark mt-1 w-full" maxLength={100} value={reference} onChange={(event) => setReference(event.target.value)} /></label>
        <label>ملاحظة · اختياري<input className="input-dark mt-1 w-full" maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      </div>
      <div className="mt-3 flex gap-2"><button className="btn-primary" disabled={saving} onClick={() => void save()}>حفظ السجل</button>
        {supersedesId && <button className="btn-secondary" disabled={saving} onClick={() => { setKind('contract'); setSupersedesId(null); }}>إلغاء التصحيح</button>}
      </div>
    </div>}
    {!loading && !error && records.length === 0 && <p className="mt-3 text-sm text-[var(--dawaa-theme-muted)]">لا يوجد سجل موثق لهذا الموظف بعد.</p>}
    <div className="mt-4 space-y-2">{records.map((record) => <article key={record.id} className="rounded-xl border border-[var(--dawaa-theme-border)] p-3">
      <div className="flex flex-wrap justify-between gap-2"><strong>{record.title}</strong><span className="text-xs">{kinds[record.record_kind]}{record.is_superseded ? ' · تم تصحيحه' : ''}</span></div>
      <div className="mt-1 text-xs text-[var(--dawaa-theme-muted)]">من {record.effective_from} إلى {record.effective_to || 'غير محدد'} · المرجع: {record.reference_code || 'غير مسجل'}</div>
      {record.note && <p className="mt-2 text-sm">{record.note}</p>}
      <div className="mt-2 text-xs text-[var(--dawaa-theme-muted)]">سجّله {record.created_by_name || 'غير معروف'} · {new Date(record.created_at).toLocaleString('ar-EG')}</div>
      {canWrite && !record.is_superseded && <button className="btn-secondary mt-2" onClick={() => correct(record)}>تصحيح بسجل جديد</button>}
    </article>)}</div>
  </section>;
}
