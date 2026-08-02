import { useEffect, useMemo, useState } from 'react';
import { Calculator, CalendarClock, Gift, History, Plus, RefreshCw, Search, Settings2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useSearchParams } from 'react-router-dom';
import { BRANCHES } from '@/lib/constants';
import { useAuth } from '@/hooks/useAuth';
import { formatCurrency } from '@/lib/utils';
import {
  addCustomerPoints,
  calculateCustomerLoyaltyCycle,
  fetchCustomerLoyaltySetting,
  fetchCustomerPointsLedger,
  previewCustomerInvoicePeriod,
  runDueCustomerLoyaltyCycles,
  saveCustomerLoyaltySetting,
  searchCustomerIdentity,
  totalCustomerPoints,
  type CustomerIdentity,
  type CustomerInvoicePeriodSummary,
  type CustomerLoyaltySetting,
  type CustomerPointsLedgerRow,
} from '@/lib/customerEngagement';

const todayKey = () => new Date().toISOString().slice(0, 10);
const shiftMonths = (dateText: string, months: number) => {
  const date = new Date(`${dateText}T12:00:00`);
  date.setMonth(date.getMonth() + months);
  return date.toISOString().slice(0, 10);
};
const dayAfter = (dateText?: string | null) => {
  if (!dateText) return '';
  const date = new Date(`${dateText}T12:00:00`);
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
};
const formatDate = (value?: string | null) => value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('ar-EG') : 'لم يتم';

export default function CustomerPointsLedger() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const initialCustomer = useMemo<CustomerIdentity>(() => ({
    customer_id: params.get('customerId'),
    customer_code: params.get('code'),
    customer_phone: params.get('phone'),
    customer_name: params.get('name'),
    branch: params.get('branch') || user?.branch || BRANCHES[0],
  }), [params, user?.branch]);

  const [query, setQuery] = useState(initialCustomer.customer_code || initialCustomer.customer_phone || initialCustomer.customer_name || '');
  const [matches, setMatches] = useState<CustomerIdentity[]>([]);
  const [customer, setCustomer] = useState<CustomerIdentity>(initialCustomer);
  const [customerConfirmed, setCustomerConfirmed] = useState(Boolean(initialCustomer.customer_id || initialCustomer.customer_code || initialCustomer.customer_phone));
  const [rows, setRows] = useState<CustomerPointsLedgerRow[]>([]);
  const [setting, setSetting] = useState<CustomerLoyaltySetting | null>(null);
  const [preview, setPreview] = useState<CustomerInvoicePeriodSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<'automatic' | 'manual'>('automatic');
  const [rate, setRate] = useState<0.03 | 0.05>(0.05);
  const [periodStart, setPeriodStart] = useState(shiftMonths(todayKey(), -3));
  const [periodEnd, setPeriodEnd] = useState(todayKey());
  const [manualTotal, setManualTotal] = useState('');
  const [cycleStartDate, setCycleStartDate] = useState(todayKey());
  const [adjustment, setAdjustment] = useState({ points_amount: '', transaction_type: 'credit' as 'credit' | 'debit' | 'correction', points_reason: '', notes: '' });

  const normalizedCustomerPhone = String(customer.customer_phone || '').replace(/\D/g, '');
  const validNewCustomerPhone = /^(?:01\d{9}|1\d{9}|201\d{9})$/.test(normalizedCustomerPhone);
  const newCustomerReady = Boolean(customer.customer_name?.trim() && validNewCustomerPhone);
  const canUseCustomer = customerConfirmed || newCustomerReady;

  const loyaltyRows = useMemo(() => rows.filter((row) => row.source_type === 'quarterly_loyalty'), [rows]);
  const lastCycle = loyaltyRows[0] || null;
  const calculatedTotal = mode === 'manual' ? Number(manualTotal || 0) : Number(preview?.purchase_total || 0);
  const calculatedPoints = Math.round(calculatedTotal * rate * 100) / 100;
  const purchasesSinceLastReward = useMemo(() => {
    if (!lastCycle) return preview?.purchase_total || 0;
    return preview?.purchase_total || 0;
  }, [lastCycle, preview]);

  const applySetting = (value: CustomerLoyaltySetting | null) => {
    setSetting(value);
    if (!value) return;
    setRate(Number(value.reward_rate) === 0.03 ? 0.03 : 0.05);
    setMode(value.calculation_mode);
    setCycleStartDate(value.cycle_start_date);
    const start = dayAfter(value.last_period_end) || value.cycle_start_date;
    setPeriodStart(start);
    setPeriodEnd(shiftMonths(start, value.cycle_months || 3).replace(/(.*)/, (date) => {
      const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10);
    }));
  };

  const loadCustomerData = async (identity = customer) => {
    if (!identity.customer_code && !identity.customer_phone && !identity.customer_id) return;
    setLoading(true);
    try {
      const [ledger, loyaltySetting] = await Promise.all([
        fetchCustomerPointsLedger(identity),
        fetchCustomerLoyaltySetting(identity).catch(() => null),
      ]);
      setRows(ledger);
      applySetting(loyaltySetting);
      const start = dayAfter(loyaltySetting?.last_period_end) || loyaltySetting?.cycle_start_date || shiftMonths(todayKey(), -3);
      const end = todayKey();
      setPeriodStart(start);
      setPeriodEnd(end);
      try { setPreview(await previewCustomerInvoicePeriod(identity, start, end)); } catch { setPreview(null); }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل سجل النقاط');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (customer.customer_code || customer.customer_phone || customer.customer_id) void loadCustomerData(customer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runSearch = async () => {
    if (query.trim().length < 2) return toast.error('اكتب كود العميل أو الهاتف أو الاسم');
    setLoading(true);
    try {
      const found = await searchCustomerIdentity(query);
      setMatches(found);
      if (found[0]) {
        setCustomer(found[0]);
        setCustomerConfirmed(true);
        await loadCustomerData(found[0]);
      } else {
        const trimmed = query.trim();
        const digits = trimmed.replace(/\D/g, '');
        const fullPhone = /^(?:01\d{9}|1\d{9}|201\d{9})$/.test(digits);
        setCustomer({
          customer_id: null,
          customer_code: null,
          customer_phone: fullPhone ? trimmed : null,
          customer_name: fullPhone ? null : (/^\D/.test(trimmed) ? trimmed : null),
          branch: user?.branch || BRANCHES[0],
        });
        setCustomerConfirmed(false);
        setRows([]); setSetting(null); setPreview(null);
        toast.info(fullPhone
          ? 'لم يتم العثور على العميل. اكتب اسمه ثم يمكن تسجيله كعميل جديد بهذا الهاتف.'
          : 'لم يتم العثور على العميل. لم يتم الاحتفاظ ببيانات العميل السابق؛ ابحث بكود أو هاتف صحيح.');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر البحث عن العميل');
    } finally { setLoading(false); }
  };

  const previewPeriod = async () => {
    if (!canUseCustomer) return toast.error('اختر عميلًا موجودًا أو اكتب اسمًا ورقم هاتف مصريًا صحيحًا أولًا.');
    if (!periodStart || !periodEnd) return toast.error('حدد بداية ونهاية الفترة');
    setLoading(true);
    try {
      const result = await previewCustomerInvoicePeriod(customer, periodStart, periodEnd);
      setPreview(result);
      toast.success(`تم العثور على ${result.invoice_count} فاتورة بقيمة ${formatCurrency(result.purchase_total)}`);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'تعذر حساب الفترة'); }
    finally { setLoading(false); }
  };

  const saveSetting = async () => {
    if (!canUseCustomer) return toast.error('لا يمكن حفظ إعداد النقاط قبل تأكيد العميل أو إدخال اسم ورقم هاتف صحيحين.');
    setSaving(true);
    try {
      const saved = await saveCustomerLoyaltySetting({
        ...customer, reward_rate: rate, cycle_months: 3, calculation_mode: mode,
        cycle_start_date: cycleStartDate, active: true, created_by: user?.id || null, created_by_name: user?.name || null,
      });
      applySetting(saved);
      toast.success('تم حفظ إعداد العميل: احتساب كل 3 شهور');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'تعذر حفظ الإعداد'); }
    finally { setSaving(false); }
  };

  const calculateCycle = async () => {
    if (!setting) return toast.error('احفظ إعداد النقاط أولًا');
    if (mode === 'manual' && !Number(manualTotal)) return toast.error('اكتب إجمالي مشتريات العميل');
    setSaving(true);
    try {
      const saved = await calculateCustomerLoyaltyCycle({
        settingId: setting.id, periodStart, periodEnd,
        manualPurchaseTotal: mode === 'manual' ? Number(manualTotal) : null,
        actorId: user?.id || null, actorName: user?.name || null,
      });
      setRows((current) => [saved, ...current.filter((row) => row.id !== saved.id)]);
      setManualTotal('');
      const refreshed = await fetchCustomerLoyaltySetting(customer);
      applySetting(refreshed);
      toast.success(`تم احتساب ${formatCurrency(saved.points_amount)} نقاط/رصيد للعميل`);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'تعذر احتساب الدورة'); }
    finally { setSaving(false); }
  };

  const runAutomaticDue = async () => {
    setSaving(true);
    try {
      const result = await runDueCustomerLoyaltyCycles(user?.id || null, user?.name || null);
      toast.success(`تم احتساب ${result.calculated} استحقاق تلقائي${result.errors ? `، وتعذر ${result.errors}` : ''}`);
      await loadCustomerData(customer);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'تعذر تشغيل الاستحقاقات'); }
    finally { setSaving(false); }
  };

  const saveAdjustment = async () => {
    if (!canUseCustomer) return toast.error('اختر العميل الصحيح قبل تعديل رصيد النقاط.');
    setSaving(true);
    try {
      const saved = await addCustomerPoints({ ...customer, points_amount: Number(adjustment.points_amount), transaction_type: adjustment.transaction_type, source_type: 'manual_adjustment', points_reason: adjustment.points_reason || null, notes: adjustment.notes || null, created_by: user?.id || null, created_by_name: user?.name || null });
      setRows((current) => [saved, ...current]);
      setAdjustment({ points_amount: '', transaction_type: 'credit', points_reason: '', notes: '' });
      toast.success('تم حفظ تعديل الرصيد');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'تعذر حفظ التعديل'); }
    finally { setSaving(false); }
  };

  return <div className="space-y-5" dir="rtl">
    <section className="rounded-3xl border border-emerald-500/30 bg-slate-950/50 p-5">
      <h1 className="flex items-center gap-2 text-2xl font-black text-white"><Gift className="text-emerald-300"/> نظام نقاط وولاء العملاء الذكي</h1>
      <p className="mt-2 text-sm text-slate-300">احتساب يدوي أو تلقائي من الفواتير بنسبة 3% أو 5%، ودورة افتراضية كل 3 شهور مع سجل تاريخي كامل.</p>
    </section>

    <section className="dawaa-panel grid gap-3 lg:grid-cols-[1fr_auto]">
      <input className="input-dark" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث بالكود أو الهاتف أو الاسم"/>
      <button className="btn-primary" onClick={() => void runSearch()} disabled={loading}>{loading ? <RefreshCw className="ml-1 inline h-4 w-4 animate-spin"/> : <Search className="ml-1 inline h-4 w-4"/>} بحث</button>
      {matches.length > 1 && <div className="flex flex-wrap gap-2 lg:col-span-2">{matches.map((item) => <button key={`${item.customer_code || item.customer_phone}-${item.customer_name}`} className="btn-secondary text-xs" onClick={() => { setCustomer(item); setCustomerConfirmed(true); void loadCustomerData(item); }}>{item.customer_name || 'عميل'} - {item.customer_code || item.customer_phone}</button>)}</div>}
    </section>

    <section className="dawaa-panel grid gap-3 lg:grid-cols-4">
      <input className="input-dark" placeholder="اسم العميل" value={customer.customer_name || ''} onChange={(e) => { setCustomerConfirmed(false); setCustomer((c) => ({...c,customer_name:e.target.value})); }}/>
      <input className="input-dark" placeholder="الهاتف" value={customer.customer_phone || ''} onChange={(e) => { setCustomerConfirmed(false); setCustomer((c) => ({...c,customer_phone:e.target.value})); }}/>
      <input className="input-dark" placeholder="الكود" value={customer.customer_code || ''} onChange={(e) => { setCustomerConfirmed(false); setCustomer((c) => ({...c,customer_code:e.target.value})); }}/>
      <select className="input-dark" value={customer.branch || ''} onChange={(e) => setCustomer((c) => ({...c,branch:e.target.value}))}><option value="">بدون فرع</option>{BRANCHES.map((b) => <option key={b}>{b}</option>)}</select>
      {!canUseCustomer ? <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm font-bold text-amber-100 lg:col-span-4">لم يتم تأكيد هوية العميل. اختر نتيجة بحث صحيحة، أو أدخل اسم العميل مع رقم هاتف مصري صحيح لتسجيل عميل جديد. لن يتم حفظ أي نقاط قبل التأكيد.</div> : null}
    </section>

    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4"><div className="text-xs font-black text-emerald-200">إجمالي الرصيد الحالي</div><div className="mt-2 text-2xl font-black text-white">{formatCurrency(totalCustomerPoints(rows))}</div></div>
      <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-4"><div className="text-xs font-black text-cyan-200">آخر احتساب</div><div className="mt-2 font-black text-white">{lastCycle ? `${formatCurrency(lastCycle.points_amount)} من ${formatCurrency(lastCycle.purchase_total || 0)}` : 'لم يتم بعد'}</div><div className="mt-1 text-xs text-slate-400">{lastCycle ? `${formatDate(lastCycle.period_start)} — ${formatDate(lastCycle.period_end)}` : ''}</div></div>
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4"><div className="text-xs font-black text-amber-200">مشتريات منذ آخر احتساب</div><div className="mt-2 text-2xl font-black text-white">{formatCurrency(purchasesSinceLastReward)}</div><div className="mt-1 text-xs text-slate-400">{preview?.invoice_count || 0} فاتورة</div></div>
      <div className="rounded-2xl border border-violet-500/30 bg-violet-500/10 p-4"><div className="text-xs font-black text-violet-200">الاستحقاق القادم</div><div className="mt-2 font-black text-white">{setting ? formatDate(setting.next_due_date) : 'الإعداد غير محفوظ'}</div><div className="mt-1 text-xs text-slate-400">كل 3 شهور · نسبة {(rate*100).toFixed(0)}%</div></div>
    </section>

    <section className="dawaa-panel space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="flex items-center gap-2 font-black text-white"><Settings2 className="text-cyan-300"/> إعداد دورة العميل</h2><p className="text-xs text-slate-400">يُحفظ الإعداد للعميل ويُستخدم في الاستحقاقات القادمة.</p></div><button className="btn-secondary" onClick={() => void runAutomaticDue()} disabled={saving}><Sparkles className="ml-1 inline h-4 w-4"/> تشغيل كل الاستحقاقات المستحقة الآن</button></div>
      <div className="grid gap-3 lg:grid-cols-4">
        <select className="input-dark" value={mode} onChange={(e) => setMode(e.target.value as 'automatic'|'manual')}><option value="automatic">تلقائي من فواتير السيستم</option><option value="manual">إدخال إجمالي المبيعات يدويًا</option></select>
        <select className="input-dark" value={rate} onChange={(e) => setRate(Number(e.target.value) as 0.03|0.05)}><option value={0.05}>5% من المشتريات</option><option value={0.03}>3% من المشتريات</option></select>
        <label className="text-xs font-black text-slate-300">بداية أول دورة<input type="date" className="input-dark mt-1 w-full" value={cycleStartDate} onChange={(e) => setCycleStartDate(e.target.value)}/></label>
        <button className="btn-primary self-end" onClick={() => void saveSetting()} disabled={saving}>حفظ إعداد الـ3 شهور</button>
      </div>
    </section>

    <section className="dawaa-panel space-y-4">
      <h2 className="flex items-center gap-2 font-black text-white"><Calculator className="text-emerald-300"/> احتساب دورة نقاط</h2>
      <div className="grid gap-3 lg:grid-cols-4">
        <label className="text-xs font-black text-slate-300">من<input type="date" className="input-dark mt-1 w-full" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)}/></label>
        <label className="text-xs font-black text-slate-300">إلى<input type="date" className="input-dark mt-1 w-full" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)}/></label>
        {mode === 'manual' ? <input className="input-dark self-end" type="number" placeholder="إجمالي مبيعات العميل مثل 10000" value={manualTotal} onChange={(e) => setManualTotal(e.target.value)}/> : <button className="btn-secondary self-end" onClick={() => void previewPeriod()} disabled={loading}><RefreshCw className="ml-1 inline h-4 w-4"/> قراءة فواتير الفترة</button>}
        <div className="rounded-xl bg-white/5 p-3 text-sm text-white"><div>المبيعات: <b>{formatCurrency(calculatedTotal)}</b></div><div>النسبة: <b>{(rate*100).toFixed(0)}%</b></div><div className="text-emerald-200">قيمة النقاط: <b>{formatCurrency(calculatedPoints)}</b></div></div>
      </div>
      <button className="btn-primary w-full" onClick={() => void calculateCycle()} disabled={saving || !setting}><Gift className="ml-1 inline h-4 w-4"/> اعتماد واحتساب هذه الدورة</button>
    </section>

    <section className="dawaa-panel space-y-3">
      <h2 className="flex items-center gap-2 font-black text-white"><Plus className="text-amber-300"/> تعديل يدوي استثنائي على الرصيد</h2>
      <div className="grid gap-3 lg:grid-cols-3"><input className="input-dark" type="number" placeholder="قيمة الإضافة أو الخصم" value={adjustment.points_amount} onChange={(e) => setAdjustment((c) => ({...c,points_amount:e.target.value}))}/><select className="input-dark" value={adjustment.transaction_type} onChange={(e) => setAdjustment((c) => ({...c,transaction_type:e.target.value as typeof c.transaction_type}))}><option value="credit">إضافة</option><option value="debit">خصم</option><option value="correction">تصحيح</option></select><input className="input-dark" placeholder="سبب التعديل" value={adjustment.points_reason} onChange={(e) => setAdjustment((c) => ({...c,points_reason:e.target.value}))}/><textarea className="input-dark lg:col-span-2" placeholder="ملاحظات" value={adjustment.notes} onChange={(e) => setAdjustment((c) => ({...c,notes:e.target.value}))}/><button className="btn-secondary" onClick={() => void saveAdjustment()} disabled={saving}>حفظ التعديل</button></div>
    </section>

    <section className="space-y-3">
      <div className="flex items-center gap-2 text-lg font-black text-white"><History className="text-cyan-300"/> التاريخ الكامل لنقاط العميل</div>
      {rows.length === 0 ? <div className="dawaa-panel text-center text-slate-400">لا توجد حركات نقاط مسجلة لهذا العميل.</div> : rows.map((row) => <article key={row.id} className="rounded-2xl border border-slate-700 bg-slate-950/50 p-4 text-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-2"><b className={row.transaction_type === 'debit' ? 'text-red-300' : 'text-emerald-300'}>{row.transaction_type === 'debit' ? '-' : '+'}{formatCurrency(row.points_amount)}</b><span className="text-xs text-slate-400">{row.created_at ? new Date(row.created_at).toLocaleString('ar-EG') : '-'}</span></div>
        {row.source_type === 'quarterly_loyalty' ? <div className="mt-3 grid gap-2 text-sm md:grid-cols-4"><div>الفترة: <b>{formatDate(row.period_start)} — {formatDate(row.period_end)}</b></div><div>المشتريات: <b>{formatCurrency(row.purchase_total || 0)}</b></div><div>النسبة: <b>{Number(row.reward_rate || 0)*100}%</b></div><div>الفواتير: <b>{row.invoice_count ?? 'يدوي'}</b></div></div> : null}
        <p className="mt-2 text-sm text-slate-300">{row.points_reason || row.source_type} {row.notes ? `- ${row.notes}` : ''}</p>
        <div className="mt-2 text-xs text-slate-500">تم بواسطة: {row.created_by_name || 'النظام'} · طريقة الحساب: {row.calculation_mode === 'automatic' ? 'تلقائي من الفواتير' : row.calculation_mode === 'manual' ? 'إجمالي يدوي' : 'تعديل مباشر'}</div>
      </article>)}
    </section>
  </div>;
}
