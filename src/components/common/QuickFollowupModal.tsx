import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { createDoctorRequestedFollowup } from '@/lib/api/doctorRequestedFollowups';
import { isValidEgyptPhone } from '@/lib/customerAnalyticsService';
import { BRANCHES, CUSTOMER_SERVICE_DOCTORS } from '@/lib/constants';
import { normalizeBranchName } from '@/lib/branch';
import { X } from 'lucide-react';

type CustomerSearchResult = {
  id: string;
  name: string | null;
  phone: string | null;
  customer_code: string | null;
};

function notify(type: 'success' | 'error', message: string) {
  window.dispatchEvent(new CustomEvent('toast', { detail: { type, message } }));
}

function normalizePhoneInput(value: string) {
  return value.replace(/[^\d+]/g, '').trim();
}

export default function QuickFollowupModal({
  open,
  onClose,
  onCreated,
  defaultBranch,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
  defaultBranch?: string;
}) {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<CustomerSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [branch, setBranch] = useState('');
  const [priority, setPriority] = useState('مهم');
  const [assignedDoctor, setAssignedDoctor] = useState('');
  const [due, setDue] = useState('');
  const [reason, setReason] = useState('طلب متابعة');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBranch((current) => current || normalizeBranchName(defaultBranch || user?.branch || '') || '');
    setDue((current) => current || new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  }, [defaultBranch, open, user?.branch]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (!open || search.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      const term = search.trim().replace(/[,%_()]/g, ' ');
      const { data, error } = await supabase
        .from('customers')
        .select('id,name,phone,customer_code')
        .or(`name.ilike.%${term}%,phone.ilike.%${term}%,customer_code.ilike.%${term}%`)
        .limit(8);
      if (cancelled) return;
      setSearching(false);
      if (error) {
        console.error('Failed to search customers:', error);
        setResults([]);
        return;
      }
      setResults((data || []) as CustomerSearchResult[]);
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [open, search]);

  if (!open) return null;

  const selectCustomer = (customer: CustomerSearchResult) => {
    setName(customer.name || '');
    setPhone(customer.phone || '');
    setCode(customer.customer_code || '');
    setSearch('');
    setResults([]);
  };

  const reset = () => {
    setSearch(''); setResults([]); setName(''); setPhone(''); setCode('');
    setBranch(normalizeBranchName(defaultBranch || user?.branch || '') || '');
    setPriority('مهم'); setAssignedDoctor('');
    setDue(new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16));
    setReason('طلب متابعة'); setNote('');
  };

  const submit = async () => {
    const cleanName = name.trim();
    const cleanPhone = normalizePhoneInput(phone);
    const cleanNote = note.trim();
    if ((!cleanName && !cleanPhone) || !cleanNote) {
      notify('error', 'أدخل اسم العميل أو رقم الهاتف، وملاحظة المتابعة');
      return;
    }
    const validPhone = cleanPhone && isValidEgyptPhone(cleanPhone, code || undefined);
    const phoneStatusNote = validPhone ? '' : '\n[بدون رقم صحيح]';
    setLoading(true);
    try {
      await createDoctorRequestedFollowup({
        customerName: cleanName || 'عميل بدون اسم',
        customerPhone: cleanPhone || null,
        branch: branch || defaultBranch || user?.branch || null,
        priority,
        requestType: 'doctor_requested_followup',
        followupReason: reason || cleanNote,
        requestDetails: `${cleanNote}${phoneStatusNote}`,
        notes: `${cleanNote}${phoneStatusNote}\nالمصدر: quick_followup_modal`,
        assignedDoctor: assignedDoctor || undefined,
        followupDatetime: due ? new Date(due).toISOString() : undefined,
        createdBy: user?.id || null,
        createdByStaffId: user?.staffId || null,
        createdByName: user?.name?.trim() || 'مستخدم النظام',
        source: 'doctor_requested_followup',
        customerCode: code.trim() || null,
        contactStatus: validPhone ? undefined : 'بدون رقم صحيح',
      });
      reset();
      window.dispatchEvent(new CustomEvent('dataChanged', { detail: { table: 'daily_followups' } }));
      notify('success', 'تم إنشاء طلب المتابعة بنجاح');
      onCreated?.();
      onClose();
    } catch (error) {
      console.error('Failed to create followup:', error);
      notify('error', 'تعذر إنشاء المتابعة');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center" dir="rtl">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-cyan-400/20 bg-slate-950 p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div><h3 className="text-xl font-black text-white">إنشاء متابعة سريعة</h3><p className="mt-1 text-sm text-slate-400">ستُسجل المتابعة على staff_id الخاص بحسابك وتظهر في «متابعاتي المطلوبة».</p></div>
          <button type="button" className="rounded-xl border border-slate-700 p-2 text-slate-200 hover:bg-slate-800" onClick={onClose} aria-label="إغلاق"><X className="h-4 w-4" /></button>
        </div>

        <div className="relative mb-3">
          <input className="input-dark" placeholder="ابحث بالاسم أو الهاتف أو كود العميل" value={search} onChange={(event) => setSearch(event.target.value)} />
          {searching && <div className="mt-1 text-xs text-slate-400">جارٍ البحث...</div>}
          {results.length > 0 && <div className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded border border-slate-700 bg-slate-800 shadow-xl">{results.map((customer) => <button key={customer.id} type="button" className="block w-full border-b border-slate-700 px-3 py-2 text-right text-sm text-white last:border-0 hover:bg-slate-700" onClick={() => selectCustomer(customer)}><span className="block font-semibold">{customer.name || 'بدون اسم'}</span><span className="text-xs text-slate-400">{[customer.phone, customer.customer_code].filter(Boolean).join(' — ')}</span></button>)}</div>}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <input className="input-dark" placeholder="اسم العميل" value={name} onChange={(event) => setName(event.target.value)} />
          <input className="input-dark" placeholder="رقم الهاتف" value={phone} onChange={(event) => setPhone(event.target.value)} />
          <input className="input-dark" placeholder="كود العميل (اختياري)" value={code} onChange={(event) => setCode(event.target.value)} />
          <select className="input-dark" value={branch} onChange={(event) => setBranch(event.target.value)}><option value="">اختر الفرع</option>{BRANCHES.map((item) => <option key={item} value={item}>{item}</option>)}</select>
          <select className="input-dark" value={reason} onChange={(event) => setReason(event.target.value)}><option>طلب متابعة</option><option>شكوى</option><option>لم يرد</option><option>طلب لاحق</option><option>تم البيع</option><option>يحتاج مدير</option><option>انخفاض شراء</option><option>سريع/طلب دكتور</option></select>
          <select className="input-dark" value={priority} onChange={(event) => setPriority(event.target.value)}><option>عادي</option><option>مهم</option><option>عاجل</option></select>
          <select className="input-dark" value={assignedDoctor} onChange={(event) => setAssignedDoctor(event.target.value)}><option value="">المسؤول</option>{CUSTOMER_SERVICE_DOCTORS.map((doctor) => <option key={doctor} value={doctor}>{doctor}</option>)}</select>
          <input className="input-dark" type="datetime-local" value={due} onChange={(event) => setDue(event.target.value)} />
          <textarea className="input-dark md:col-span-2" placeholder="ملاحظة المتابعة *" value={note} onChange={(event) => setNote(event.target.value)} rows={4} required />
        </div>
        <p className="my-3 rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-100">يجب إدخال اسم العميل أو رقم الهاتف على الأقل، وملاحظة المتابعة مطلوبة.</p>
        <div className="flex flex-wrap justify-end gap-2"><button className="btn-secondary" onClick={onClose}>إلغاء</button><button className="btn-primary disabled:opacity-60" onClick={() => void submit()} disabled={loading}>{loading ? 'جارٍ الإنشاء...' : 'إنشاء'}</button></div>
      </div>
    </div>
  );
}
