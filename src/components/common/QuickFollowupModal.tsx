import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { createDoctorRequestedFollowup } from '@/lib/api/doctorRequestedFollowups';
import {
  createExceptionalFollowup,
  searchCustomerMetrics,
  updateFollowupResult,
} from '@/lib/api/customerServiceCommandCenter';
import { isValidEgyptPhone } from '@/lib/customerAnalyticsService';
import { BRANCHES, CUSTOMER_SERVICE_DOCTORS } from '@/lib/constants';
import { normalizeBranchName } from '@/lib/branch';
import { X } from 'lucide-react';
import { canViewAllBranches } from '@/lib/security/userDataScope';

type FollowupMode = 'execute' | 'request';
type CustomerSearchResult = {
  id: string;
  name: string | null;
  phone: string | null;
  customer_code: string | null;
  branch: string | null;
  total_spent?: number | null;
  avg_monthly?: number | null;
  avg_invoice?: number | null;
  invoices_count?: number | null;
  last_purchase?: string | null;
  segment?: string | null;
};

function notify(type: 'success' | 'error', message: string) {
  window.dispatchEvent(new CustomEvent('toast', { detail: { type, message } }));
}

function normalizePhoneInput(value: string) {
  return value.replace(/[^\d+]/g, '').trim();
}

function nowLocalInput() {
  return new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
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
  const managerView = canViewAllBranches(user);
  const [mode, setMode] = useState<FollowupMode>('execute');
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
  const [reason, setReason] = useState('طلب متابعة');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedCustomerBranch, setSelectedCustomerBranch] = useState('');
  const [contactMethod, setContactMethod] = useState('واتساب');
  const [contactResult, setContactResult] = useState('تم الرد');
  const [followupResult, setFollowupResult] = useState('تم الرد والعميل راضي');
  const [summary, setSummary] = useState('');
  const [purchaseAfter, setPurchaseAfter] = useState(false);
  const [purchaseAmount, setPurchaseAmount] = useState('');
  const [nextFollowup, setNextFollowup] = useState('');

  useEffect(() => {
    if (!open) return;
    setBranch((current) => current || normalizeBranchName(defaultBranch || user?.branch || '') || '');
    setDue((current) => current || nowLocalInput());
  }, [defaultBranch, open, user?.branch]);

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
      const selectedBranch = normalizeBranchName(branch || defaultBranch || user?.branch || '');
      if (!selectedBranch) {
        setSearching(false);
        setResults([]);
        return;
      }
      const data = await searchCustomerMetrics(term, selectedBranch);
      if (cancelled) return;
      setSearching(false);
      setResults(
        data.slice(0, 8).map((customer) => ({
          id: customer.customer_id || customer.id,
          name: customer.customer_name || customer.name,
          phone: customer.displayPhone || customer.customer_phone || customer.phone,
          customer_code: customer.customer_code,
          branch: normalizeBranchName(customer.branch || selectedBranch),
          total_spent: Number(customer.total_spent || 0),
          avg_monthly: Number(customer.avg_monthly || 0),
          avg_invoice: Number(customer.avg_invoice || 0),
          invoices_count: Number(customer.invoices_count || 0),
          last_purchase: customer.last_purchase || null,
          segment: customer.segment || customer.status || null,
        }))
      );
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [branch, defaultBranch, open, search, user?.branch]);

  if (!open) return null;

  const selectCustomer = (customer: CustomerSearchResult) => {
    setSelectedCustomer(customer);
    setName(customer.name || '');
    setPhone(customer.phone || '');
    setCode(customer.customer_code || '');
    setSelectedCustomerBranch(normalizeBranchName(customer.branch || ''));
    setSearch('');
    setResults([]);
  };

  const reset = () => {
    setMode('execute');
    setSearch('');
    setResults([]);
    setSelectedCustomer(null);
    setName('');
    setPhone('');
    setCode('');
    setBranch(normalizeBranchName(defaultBranch || user?.branch || '') || '');
    setPriority('مهم');
    setAssignedDoctor('');
    setDue(nowLocalInput());
    setReason('طلب متابعة');
    setNote('');
    setSelectedCustomerBranch('');
    setContactMethod('واتساب');
    setContactResult('تم الرد');
    setFollowupResult('تم الرد والعميل راضي');
    setSummary('');
    setPurchaseAfter(false);
    setPurchaseAmount('');
    setNextFollowup('');
  };

  const validateCustomer = () => {
    const cleanName = name.trim();
    const cleanPhone = normalizePhoneInput(phone);
    const targetBranch = normalizeBranchName(branch || defaultBranch || user?.branch || '');
    if (!cleanName && !cleanPhone) throw new Error('أدخل اسم العميل أو رقم الهاتف');
    if (!targetBranch) throw new Error('اختر الفرع');
    if (selectedCustomerBranch && selectedCustomerBranch !== targetBranch) {
      throw new Error(`العميل تابع ${selectedCustomerBranch} ولا يمكن تسجيله على ${targetBranch}`);
    }
    return { cleanName, cleanPhone, targetBranch };
  };

  const submitRequest = async () => {
    const { cleanName, cleanPhone, targetBranch } = validateCustomer();
    const cleanNote = note.trim();
    if (!cleanNote) throw new Error('ملاحظة طلب المتابعة مطلوبة');
    const validPhone = cleanPhone && isValidEgyptPhone(cleanPhone, code || undefined);
    const phoneStatusNote = validPhone ? '' : '\n[بدون رقم صحيح]';
    let duplicateQuery = supabase
      .from('daily_followups')
      .select('id,customer_name,status,followup_status,completed_at,created_at')
      .eq('is_hidden', false)
      .eq('branch', targetBranch)
      .order('created_at', { ascending: false })
      .limit(10);
    const cleanCode = code.trim();
    if (cleanCode) duplicateQuery = duplicateQuery.eq('customer_code', cleanCode);
    else if (cleanPhone) duplicateQuery = duplicateQuery.or(`customer_phone.eq.${cleanPhone},phone.eq.${cleanPhone}`);
    const duplicateResult = cleanCode || cleanPhone ? await duplicateQuery : { data: [] };
    const finalStatuses = new Set(['تم', 'مكتمل', 'تم الرد والعميل راضي', 'تم الرد ولا يحتاج الآن', 'تم الشراء بعد المتابعة', 'تم حل الشكوى', 'تم تنفيذ الطلب والتأكد من العميل']);
    const existingOpen = (duplicateResult.data || []).find((row) => !row.completed_at && !finalStatuses.has(String(row.followup_status || row.status || '')));
    if (existingOpen) throw new Error(`يوجد طلب متابعة مفتوح بالفعل للعميل ${existingOpen.customer_name || cleanName}`);
    await createDoctorRequestedFollowup({
      customerName: cleanName || 'عميل بدون اسم',
      customerPhone: cleanPhone || null,
      branch: targetBranch,
      priority,
      requestType: 'doctor_requested_followup',
      followupReason: reason || cleanNote,
      requestDetails: `${cleanNote}${phoneStatusNote}`,
      notes: `${cleanNote}${phoneStatusNote}\nالمصدر: exceptional_followup_request`,
      assignedDoctor: assignedDoctor || undefined,
      followupDatetime: due ? new Date(due).toISOString() : undefined,
      createdBy: user?.id || null,
      createdByStaffId: user?.staffId || null,
      createdByName: user?.name?.trim() || 'مستخدم النظام',
      source: 'doctor_requested_followup',
      customerCode: code.trim() || null,
      contactStatus: validPhone ? undefined : 'بدون رقم صحيح',
    });
    notify('success', 'تم تسجيل طلب المتابعة الاستثنائية وسيظهر في سجل الطلبات');
  };

  const submitExecution = async () => {
    const { cleanName, cleanPhone, targetBranch } = validateCustomer();
    if (!selectedCustomer) throw new Error('اختر العميل من نتيجة البحث لعرض بياناته وتسجيل المتابعة');
    if (!summary.trim()) throw new Error('اكتب ما تم مع العميل');
    const created = await createExceptionalFollowup({
      customerName: cleanName || 'عميل بدون اسم',
      customerPhone: cleanPhone || null,
      customerCode: code.trim() || null,
      branch: targetBranch,
      priority,
      requestType: 'exceptional_quick_executed',
      followupReason: reason || 'متابعة استثنائية سريعة',
      assignedDoctor: user?.name || assignedDoctor || undefined,
      followupDatetime: new Date().toISOString(),
      requestDetails: summary.trim(),
      notes: `${note.trim()}\nالمصدر: exceptional_quick_execution`.trim(),
      createdBy: user?.id || null,
      createdByName: user?.name?.trim() || 'مستخدم النظام',
      source: 'exceptional_quick_execution',
    });
    if (!created?.id) throw new Error('تعذر إنشاء سجل المتابعة');
    await updateFollowupResult(created.id, {
      contact_method: contactMethod,
      contact_result: contactResult,
      followup_result: followupResult,
      followup_summary: summary.trim(),
      followup_notes: note.trim() || null,
      followup_status: followupResult === 'لم يرد' ? 'لم يرد' : followupResult === 'طلب التواصل لاحقًا' ? 'مؤجل' : 'تم',
      status: followupResult === 'لم يرد' ? 'لم يرد' : followupResult === 'طلب التواصل لاحقًا' ? 'مؤجل' : 'تم',
      purchase_after_followup: purchaseAfter,
      purchase_amount: purchaseAfter ? Number(purchaseAmount || 0) || null : null,
      next_followup_date: nextFollowup || null,
      contacted_at: new Date().toISOString(),
      completed_at: ['لم يرد', 'طلب التواصل لاحقًا'].includes(followupResult) ? null : new Date().toISOString(),
      updated_by: user?.id || null,
    });
    notify('success', 'تم تنفيذ وحفظ المتابعة الاستثنائية السريعة في سجل المتابعات المنفذة');
  };

  const submit = async () => {
    setLoading(true);
    try {
      if (mode === 'execute') await submitExecution();
      else await submitRequest();
      reset();
      window.dispatchEvent(new CustomEvent('dataChanged', { detail: { table: 'daily_followups' } }));
      window.dispatchEvent(new CustomEvent('customer-followup-imported'));
      onCreated?.();
      onClose();
    } catch (error) {
      console.error('Failed to create exceptional followup:', error);
      notify('error', error instanceof Error ? error.message : 'تعذر حفظ المتابعة');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center" dir="rtl">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-cyan-400/20 bg-slate-950 p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-black text-white">المتابعات الاستثنائية</h3>
            <p className="mt-1 text-sm text-slate-400">نفّذ متابعة كاملة الآن، أو سجّل طلبًا ليتم تنفيذه لاحقًا.</p>
          </div>
          <button type="button" className="rounded-xl border border-slate-700 p-2 text-slate-200 hover:bg-slate-800" onClick={onClose} aria-label="إغلاق"><X className="h-4 w-4" /></button>
        </div>

        <div className="mb-5 grid gap-3 md:grid-cols-2">
          <button type="button" onClick={() => setMode('execute')} className={`rounded-2xl border p-4 text-right ${mode === 'execute' ? 'border-emerald-400 bg-emerald-500/15 text-emerald-100' : 'border-slate-700 bg-slate-900 text-slate-300'}`}>
            <span className="block text-base font-black">متابعة استثنائية سريعة</span>
            <span className="mt-1 block text-xs">اختيار العميل، عرض بياناته، تسجيل التواصل والنتيجة فورًا.</span>
          </button>
          <button type="button" onClick={() => setMode('request')} className={`rounded-2xl border p-4 text-right ${mode === 'request' ? 'border-cyan-400 bg-cyan-500/15 text-cyan-100' : 'border-slate-700 bg-slate-900 text-slate-300'}`}>
            <span className="block text-base font-black">تسجيل طلب متابعة استثنائية</span>
            <span className="mt-1 block text-xs">إنشاء طلب بمسؤول وموعد ليظهر في سجل الطلبات.</span>
          </button>
        </div>

        <div className="relative mb-3">
          <input className="input-dark" placeholder="ابحث بالاسم أو الهاتف أو كود العميل" value={search} onChange={(event) => setSearch(event.target.value)} />
          {searching && <div className="mt-1 text-xs text-slate-400">جارٍ البحث...</div>}
          {results.length > 0 && <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded border border-slate-700 bg-slate-800 shadow-xl">
            {results.map((customer) => <button key={customer.id} type="button" className="block w-full border-b border-slate-700 px-3 py-2 text-right text-sm text-white last:border-0 hover:bg-slate-700" onClick={() => selectCustomer(customer)}>
              <span className="block font-semibold">{customer.name || 'بدون اسم'}</span>
              <span className="text-xs text-slate-400">{[customer.phone, customer.customer_code, customer.branch].filter(Boolean).join(' — ')}</span>
            </button>)}
          </div>}
        </div>

        {mode === 'execute' && selectedCustomer && <div className="mb-4 rounded-2xl border border-emerald-400/25 bg-emerald-500/10 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><strong className="text-emerald-100">بيانات العميل قبل المتابعة</strong><a className="text-sm font-bold text-cyan-300 underline" href={`/customer-360?customerId=${encodeURIComponent(selectedCustomer.id)}&code=${encodeURIComponent(code)}&phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}`} target="_blank" rel="noreferrer">فتح ملف العميل 360</a></div>
          <div className="grid gap-2 text-sm text-slate-200 sm:grid-cols-2 lg:grid-cols-4">
            <div>الاسم: <b>{name || 'غير مسجل'}</b></div><div>الكود: <b>{code || 'غير مسجل'}</b></div><div>الهاتف: <b>{phone || 'غير مسجل'}</b></div><div>الفرع: <b>{selectedCustomer.branch || branch}</b></div>
            <div>إجمالي المشتريات: <b>{Number(selectedCustomer.total_spent || 0).toLocaleString('ar-EG')} ج.م</b></div><div>المتوسط الشهري: <b>{Number(selectedCustomer.avg_monthly || 0).toLocaleString('ar-EG')} ج.م</b></div><div>متوسط الفاتورة: <b>{Number(selectedCustomer.avg_invoice || 0).toLocaleString('ar-EG')} ج.م</b></div><div>عدد الفواتير: <b>{Number(selectedCustomer.invoices_count || 0).toLocaleString('ar-EG')}</b></div>
            <div className="sm:col-span-2">آخر شراء: <b>{selectedCustomer.last_purchase || 'غير متاح'}</b></div><div className="sm:col-span-2">التصنيف: <b>{selectedCustomer.segment || 'غير محدد'}</b></div>
          </div>
        </div>}

        <div className="grid gap-3 md:grid-cols-2">
          <input className="input-dark" placeholder="اسم العميل" value={name} onChange={(event) => { setName(event.target.value); setSelectedCustomer(null); setSelectedCustomerBranch(''); }} />
          <input className="input-dark" placeholder="رقم الهاتف" value={phone} onChange={(event) => { setPhone(event.target.value); setSelectedCustomer(null); setSelectedCustomerBranch(''); }} />
          <input className="input-dark" placeholder="كود العميل (اختياري)" value={code} onChange={(event) => { setCode(event.target.value); setSelectedCustomer(null); setSelectedCustomerBranch(''); }} />
          <select className="input-dark" value={branch} onChange={(event) => setBranch(event.target.value)} disabled={!managerView}><option value="">اختر الفرع</option>{BRANCHES.map((item) => <option key={item} value={item}>{item}</option>)}</select>
          <select className="input-dark" value={reason} onChange={(event) => setReason(event.target.value)}><option>طلب متابعة</option><option>شكوى</option><option>لم يرد</option><option>طلب لاحق</option><option>تم البيع</option><option>يحتاج مدير</option><option>انخفاض شراء</option><option>متابعة استثنائية سريعة</option></select>
          <select className="input-dark" value={priority} onChange={(event) => setPriority(event.target.value)}><option>عادي</option><option>مهم</option><option>عاجل</option></select>

          {mode === 'request' ? <>
            <select className="input-dark" value={assignedDoctor} onChange={(event) => setAssignedDoctor(event.target.value)}><option value="">المسؤول</option>{CUSTOMER_SERVICE_DOCTORS.map((doctor) => <option key={doctor} value={doctor}>{doctor}</option>)}</select>
            <input className="input-dark" type="datetime-local" value={due} onChange={(event) => setDue(event.target.value)} />
            <textarea className="input-dark md:col-span-2" placeholder="تفاصيل طلب المتابعة *" value={note} onChange={(event) => setNote(event.target.value)} rows={4} required />
          </> : <>
            <select className="input-dark" value={contactMethod} onChange={(event) => setContactMethod(event.target.value)}><option>واتساب</option><option>اتصال</option><option>رسالة</option><option>زيارة</option></select>
            <select className="input-dark" value={contactResult} onChange={(event) => setContactResult(event.target.value)}><option>تم الرد</option><option>لم يرد</option><option>الرقم غير صحيح</option><option>طلب التواصل لاحقًا</option></select>
            <select className="input-dark" value={followupResult} onChange={(event) => setFollowupResult(event.target.value)}><option>تم الرد والعميل راضي</option><option>تم الرد ولا يحتاج الآن</option><option>تم الشراء بعد المتابعة</option><option>تم حل الشكوى</option><option>تم تنفيذ الطلب والتأكد من العميل</option><option>لم يرد</option><option>طلب التواصل لاحقًا</option><option>يحتاج متابعة مدير</option></select>
            <input className="input-dark" type="date" value={nextFollowup} onChange={(event) => setNextFollowup(event.target.value)} aria-label="موعد المتابعة القادمة" />
            <textarea className="input-dark md:col-span-2" placeholder="ما تم مع العميل وملخص المحادثة *" value={summary} onChange={(event) => setSummary(event.target.value)} rows={4} required />
            <textarea className="input-dark md:col-span-2" placeholder="ملاحظات إضافية" value={note} onChange={(event) => setNote(event.target.value)} rows={2} />
            <label className="flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-3 text-sm text-slate-200"><input type="checkbox" checked={purchaseAfter} onChange={(event) => setPurchaseAfter(event.target.checked)} /> تمت عملية شراء بعد المتابعة</label>
            <input className="input-dark" type="number" min="0" step="0.01" placeholder="قيمة عملية الشراء" value={purchaseAmount} onChange={(event) => setPurchaseAmount(event.target.value)} disabled={!purchaseAfter} />
          </>}
        </div>

        <p className="my-3 rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-100">{mode === 'execute' ? 'اختر العميل من البحث ثم سجّل نتيجة التواصل كاملة. ستظهر في سجل المتابعات الاستثنائية المنفذة.' : 'هذا المسار يسجل طلبًا فقط، وسيظهر في سجل طلبات المتابعة الاستثنائية حتى يتم تنفيذه.'}</p>
        <div className="flex flex-wrap justify-end gap-2"><button className="btn-secondary" onClick={onClose}>إلغاء</button><button className="btn-primary disabled:opacity-60" onClick={() => void submit()} disabled={loading}>{loading ? 'جارٍ الحفظ...' : mode === 'execute' ? 'حفظ المتابعة المنفذة' : 'تسجيل طلب المتابعة'}</button></div>
      </div>
    </div>
  );
}
