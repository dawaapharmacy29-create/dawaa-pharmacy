import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { createExceptionalFollowup } from '@/lib/api/customerServiceCommandCenter';
import { isValidEgyptPhone } from '@/lib/customerAnalyticsService';
import { BRANCHES, CUSTOMER_SERVICE_DOCTORS } from '@/lib/constants';
import { normalizeBranchName } from '@/lib/branch';
import { X } from 'lucide-react';

type CustomerSearchResult = {
  id: string;
  name: string | null;
  phone: string | null;
  customer_code: string | null;
  branch?: string | null;
  customer_notes?: string | null;
  service_notes?: string | null;
  handling_notes?: string | null;
};

type QuickFollowupMode = 'quick' | 'doctor_request';

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
  mode = 'quick',
  defaultBranch,
  title,
  description,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
  mode?: QuickFollowupMode;
  defaultBranch?: string;
  title?: string;
  description?: string;
}) {
  const { user } = useAuth();
  const isDoctorRequest = mode === 'doctor_request';
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<CustomerSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSearchResult | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [branch, setBranch] = useState('');
  const [priority, setPriority] = useState('مهم');
  const [assignedDoctor, setAssignedDoctor] = useState('');
  const [due, setDue] = useState('');
  const [reason, setReason] = useState(isDoctorRequest ? 'سريع/طلب دكتور' : 'طلب متابعة');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBranch((current) => current || normalizeBranchName(defaultBranch || user?.branch || '') || '');
    setDue((current) => current || new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16));
    if (isDoctorRequest) setReason('سريع/طلب دكتور');
  }, [defaultBranch, isDoctorRequest, open, user?.branch]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
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
        .select('id,name,phone,customer_code,branch,customer_notes,service_notes,handling_notes')
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

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, search]);

  if (!open) return null;

  const selectCustomer = (customer: CustomerSearchResult) => {
    setSelectedCustomer(customer);
    setName(customer.name || '');
    setPhone(customer.phone || '');
    setCode(customer.customer_code || '');
    setBranch(normalizeBranchName(customer.branch || defaultBranch || user?.branch || '') || '');
    setSearch('');
    setResults([]);
  };

  const reset = () => {
    setSearch('');
    setResults([]);
    setSelectedCustomer(null);
    setName('');
    setPhone('');
    setCode('');
    setBranch(normalizeBranchName(defaultBranch || user?.branch || '') || '');
    setPriority('مهم');
    setAssignedDoctor('');
    setDue(new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16));
    setReason(isDoctorRequest ? 'سريع/طلب دكتور' : 'طلب متابعة');
    setNote('');
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
    const sourceLabel = isDoctorRequest ? 'doctor_dashboard_request' : 'quick_followup_modal';

    setLoading(true);
    try {
      await createExceptionalFollowup({
        customerName: cleanName || 'عميل بدون اسم',
        customerPhone: cleanPhone || null,
        branch: branch || defaultBranch || user?.branch || null,
        priority,
        requestType: isDoctorRequest ? 'doctor_requested_followup' : reason || 'طلب متابعة',
        followupReason: reason || cleanNote,
        requestDetails: `${cleanNote}${phoneStatusNote}`,
        notes: `${cleanNote}${phoneStatusNote}\nالمصدر: ${sourceLabel}\nمقدم الطلب: ${user?.name?.trim() || 'مستخدم النظام'}`,
        assignedDoctor: assignedDoctor || undefined,
        followupDatetime: due ? new Date(due).toISOString() : undefined,
        createdBy: user?.id || null,
        createdByName: user?.name?.trim() || 'مستخدم النظام',
        source: isDoctorRequest ? 'doctor_dashboard' : 'sidebar_quick_followup',
        customerCode: code.trim() || null,
        contactStatus: validPhone ? undefined : 'بدون رقم صحيح',
      });

      reset();
      window.dispatchEvent(new CustomEvent('dataChanged', { detail: { table: 'daily_followups' } }));
      notify('success', isDoctorRequest ? 'تم إرسال طلب المتابعة لمسئول خدمة العملاء' : 'تم إنشاء طلب المتابعة بنجاح');
      onCreated?.();
      onClose();
    } catch (error) {
      console.error('Failed to create followup:', error);
      notify('error', 'تعذر إنشاء المتابعة');
    } finally {
      setLoading(false);
    }
  };

  const importantNotes = [selectedCustomer?.customer_notes, selectedCustomer?.service_notes, selectedCustomer?.handling_notes].filter(Boolean);

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center" dir="rtl">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-cyan-400/20 bg-slate-950 p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-black text-white">{title || (isDoctorRequest ? 'طلب متابعة من خدمة العملاء' : 'إنشاء متابعة سريعة')}</h3>
            <p className="mt-1 text-sm text-slate-400">{description || (isDoctorRequest ? 'ابحث عن العميل، راجع ملاحظاته المهمة، ثم أرسل الطلب لمسئول خدمة العملاء.' : 'ابحث عن عميل موجود أو أضف بيانات المتابعة يدويًا.')}</p>
          </div>
          <button type="button" className="rounded-xl border border-slate-700 p-2 text-slate-200 hover:bg-slate-800" onClick={onClose} aria-label="إغلاق">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="relative mb-3">
          <input className="input-dark" placeholder="ابحث بالاسم أو الهاتف أو كود العميل" value={search} onChange={(event) => setSearch(event.target.value)} />
          {searching && <div className="mt-1 text-xs text-slate-400">جارٍ البحث...</div>}
          {results.length > 0 && (
            <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded border border-slate-700 bg-slate-800 shadow-xl">
              {results.map((customer) => (
                <button key={customer.id} type="button" className="block w-full border-b border-slate-700 px-3 py-2 text-right text-sm text-white last:border-0 hover:bg-slate-700" onClick={() => selectCustomer(customer)}>
                  <span className="block font-semibold">{customer.name || 'بدون اسم'}</span>
                  <span className="text-xs text-slate-400">{[customer.phone, customer.customer_code, customer.branch].filter(Boolean).join(' — ')}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedCustomer && (
          <div className="mb-3 rounded-2xl border border-teal-400/20 bg-teal-500/10 p-3">
            <div className="font-black text-teal-100">{selectedCustomer.name || 'عميل بدون اسم'}</div>
            <div className="mt-1 text-xs text-teal-200">{[selectedCustomer.customer_code, selectedCustomer.phone, selectedCustomer.branch].filter(Boolean).join(' — ')}</div>
            {importantNotes.length > 0 ? (
              <div className="mt-3 space-y-2">
                {importantNotes.map((item, index) => <div key={index} className="rounded-xl border border-amber-400/20 bg-amber-500/10 p-2 text-xs font-bold text-amber-100">{item}</div>)}
              </div>
            ) : (
              <div className="mt-2 text-xs text-slate-300">لا توجد ملاحظات مهمة مسجلة على العميل.</div>
            )}
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <input className="input-dark" placeholder="اسم العميل" value={name} onChange={(event) => setName(event.target.value)} />
          <input className="input-dark" placeholder="رقم الهاتف" value={phone} onChange={(event) => setPhone(event.target.value)} />
          <input className="input-dark" placeholder="كود العميل (اختياري)" value={code} onChange={(event) => setCode(event.target.value)} />
          <select className="input-dark" value={branch} onChange={(event) => setBranch(event.target.value)}>
            <option value="">اختر الفرع</option>
            {BRANCHES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select className="input-dark" value={reason} onChange={(event) => setReason(event.target.value)}>
            {isDoctorRequest && <option>سريع/طلب دكتور</option>}
            <option>طلب متابعة</option>
            <option>شكوى</option>
            <option>طلب لاحق</option>
            <option>صنف غير متوفر</option>
            <option>مشكلة في أوردر سابق</option>
            <option>عميل مهم يحتاج اهتمامًا</option>
            <option>يحتاج مدير</option>
          </select>
          <select className="input-dark" value={priority} onChange={(event) => setPriority(event.target.value)}>
            <option>عادي</option>
            <option>مهم</option>
            <option>عاجل</option>
          </select>
          {!isDoctorRequest && (
            <select className="input-dark" value={assignedDoctor} onChange={(event) => setAssignedDoctor(event.target.value)}>
              <option value="">المسؤول</option>
              {CUSTOMER_SERVICE_DOCTORS.map((doctor) => <option key={doctor} value={doctor}>{doctor}</option>)}
            </select>
          )}
          <input className="input-dark" type="datetime-local" value={due} onChange={(event) => setDue(event.target.value)} />
          <textarea className="input-dark md:col-span-2" placeholder="سبب ومطلوب المتابعة *" value={note} onChange={(event) => setNote(event.target.value)} rows={4} required />
        </div>
        <p className="my-3 rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-100">
          الدكتور يسجل الطلب فقط، ومسئول خدمة العملاء هو المسئول عن التواصل وإغلاق المتابعة.
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>إلغاء</button>
          <button className="btn-primary disabled:opacity-60" onClick={() => void submit()} disabled={loading}>
            {loading ? 'جارٍ الإرسال...' : isDoctorRequest ? 'إرسال لخدمة العملاء' : 'إنشاء'}
          </button>
        </div>
      </div>
    </div>
  );
}
