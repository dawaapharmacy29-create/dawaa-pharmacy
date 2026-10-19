import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

type Flag = { customer_code: string; flag_key: string; flag_label?: string | null };
const KNOWN_INTERNAL_CODES = ['5','7','10','20','54','170','4902','12820'];
import { loadInternalCodeInvoices, type Invoice } from '@/lib/internalCodesSalesService';
const money = (value: number) => value.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (value: string | null) => value ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)) : '';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const monthStart = () => today().slice(0, 7) + '-01';
const previousDay = (date: string) => { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
const nextDay = (date: string) => { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const invoiceAmount = (r: Invoice) => Number(r.net_amount ?? r.net_total ?? r.amount ?? 0);

export default function InternalCodesSales() {
  const { isAdmin, checkPermission } = useAuth();
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [branch, setBranch] = useState('all');
  const [code, setCode] = useState('all');
  const [flags, setFlags] = useState<Flag[]>([]);
  const [rows, setRows] = useState<Invoice[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [registryWarning, setRegistryWarning] = useState('');
  const allowed = isAdmin || checkPermission('view_sales_reports');
  useEffect(() => {
    if (!allowed) return;
    let alive = true;
    supabase.from('customer_flags').select('customer_code,flag_key,flag_label')
      .eq('flag_key', 'system_generic_code').eq('is_active', true)
      .then(({ data, error }) => { if (!alive) return; if (error || !data?.length) { setFlags(KNOWN_INTERNAL_CODES.map(customer_code => ({customer_code,flag_key:'system_generic_code'}))); setRegistryWarning('تعذر تحميل قائمة الأكواد الحية؛ يتم عرض القائمة الداخلية المعروفة. قد تحتاج صلاحية قراءة الأكواد.'); } else { setRegistryWarning(''); setFlags((data || []) as Flag[]); } });
    return () => { alive = false; };
  }, [allowed]);
  const codes = useMemo(() => [...new Set(flags.map(f => String(f.customer_code).trim()).filter(Boolean))].sort((a,b) => Number(a)-Number(b)), [flags]);
  useEffect(() => {
    if (!allowed || codes.length === 0 || !from || !to) return;
    if (to < from) { setError('تاريخ النهاية يجب أن يكون بعد البداية'); return; }
    let alive = true;
    (async () => {
      setBusy(true); setError('');
      let loaded: Invoice[];
      try { loaded = await loadInternalCodeInvoices(codes, from, to, branch); }
      catch (cause) { if (alive) { setError('تعذر قراءة كل الفواتير: ' + (cause as Error).message); setRows([]); setBusy(false); } return; }
      if (alive) { setRows(loaded.filter(r => day(r.invoice_date) >= from && day(r.invoice_date) <= to)); setBusy(false); }
    })();
    return () => { alive = false; };
  }, [allowed, codes.join('|'), from, to, branch]);
  const filtered = useMemo(() => code === 'all' ? rows : rows.filter(r => String(r.customer_code).trim() === code), [rows, code]);
  const summary = useMemo(() => codes.map(c => {
    const own = rows.filter(r => String(r.customer_code).trim() === c);
    return { code: c, invoices: own.length, total: own.reduce((s,r) => s + invoiceAmount(r), 0), label: flags.find(f=>f.customer_code===c)?.flag_label || '' };
  }), [codes, rows, flags]);
  const total = filtered.reduce((sum,r) => sum + invoiceAmount(r), 0);
  if (!allowed) return <main dir="rtl" className="p-6">ليس لديك صلاحية عرض تقارير المبيعات.</main>;
  return <main dir="rtl" className="p-4 md:p-6 space-y-5">
    <header><h1 className="text-2xl font-bold">الأكواد الداخلية</h1><p className="text-sm opacity-70 mt-1">سجل مالي مستقل للأكواد الداخلية، بدون حذف فواتيرها من المبيعات أو احتسابها كعملاء متابعة عاديين.</p></header>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <label className="text-sm">من تاريخ<input className="w-full rounded-lg border p-2 mt-1 bg-transparent" type="date" value={from} onChange={e => setFrom(e.target.value)}/></label>
      <label className="text-sm">إلى تاريخ<input className="w-full rounded-lg border p-2 mt-1 bg-transparent" type="date" value={to} onChange={e => setTo(e.target.value)}/></label>
      <fieldset className="text-sm min-w-0"><legend className="mb-1">الفرع</legend><div className="grid grid-cols-3 gap-1 rounded-lg border p-1" role="group" aria-label="تصفية حسب الفرع">{[{value:'all',label:'الفرعان'},{value:'فرع شكري',label:'شكري'},{value:'فرع الشامي',label:'الشامي'}].map(option=><button key={option.value} type="button" aria-pressed={branch===option.value} onClick={()=>setBranch(option.value)} className={`min-w-0 rounded-md px-1 py-2 text-center text-xs font-semibold transition-colors ${branch===option.value?'bg-emerald-600 text-white shadow-sm':'hover:bg-white/10'}`}>{option.label}</button>)}</div></fieldset>
      <label className="text-sm">الكود الداخلي<select className="w-full rounded-lg border p-2 mt-1 bg-transparent" value={code} onChange={e => setCode(e.target.value)}><option value="all">جميع الأكواد</option>{codes.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
    </div>
    {registryWarning && <div role="alert" className="rounded-lg border p-3 text-amber-700">{registryWarning}</div>}
    {error && <div role="alert" className="border rounded-lg p-3 text-red-600">{error}</div>}
    {busy && <p role="status">جاري تحميل الفواتير والتحقق من اكتمال جميع الصفحات…</p>}
    {!busy && <div className="grid grid-cols-2 gap-3"><div className="rounded-xl border p-4"><div className="opacity-70 text-sm">إجمالي السحب</div><strong className="text-xl">{money(total)} ج</strong></div><div className="rounded-xl border p-4"><div className="opacity-70 text-sm">عدد الفواتير</div><strong className="text-xl">{filtered.length.toLocaleString('ar-EG')}</strong></div></div>}
    <section className="rounded-xl border overflow-x-auto"><h2 className="font-bold p-3">ملخص كل كود</h2><table className="w-full text-sm text-right"><thead><tr className="border-y"><th className="p-3">الكود</th><th className="p-3">عدد الفواتير</th><th className="p-3">إجمالي السحب</th><th className="p-3">التفاصيل</th></tr></thead><tbody>{summary.filter(r=> code==='all'||r.code===code).map(r=><tr key={r.code} className="border-b"><td className="p-3 font-bold">{r.code}</td><td className="p-3">{r.invoices}</td><td className="p-3">{money(r.total)} ج</td><td className="p-3"><button className="underline" onClick={()=>setCode(r.code)}>عرض الفواتير</button></td></tr>)}</tbody></table></section>
    <section className="rounded-xl border overflow-x-auto"><h2 className="font-bold p-3">تفاصيل الفواتير {code !== 'all' ? 'للكود ' + code : 'لجميع الأكواد'}</h2><table className="w-full text-sm text-right"><thead><tr className="border-y"><th className="p-3">التاريخ</th><th className="p-3">الكود</th><th className="p-3">رقم الفاتورة</th><th className="p-3">الفرع</th><th className="p-3">المستخدم</th><th className="p-3">الصافي</th></tr></thead><tbody>{filtered.map(r=><tr key={r.id} className="border-b"><td className="p-3">{day(r.invoice_date)}</td><td className="p-3">{r.customer_code}</td><td className="p-3">{r.invoice_number}</td><td className="p-3">{r.branch}</td><td className="p-3">{r.seller_name || '—'}</td><td className="p-3">{money(invoiceAmount(r))} ج</td></tr>)}</tbody></table>{!busy && filtered.length===0 && <p className="p-4 opacity-70">لا توجد فواتير ضمن الفترة والفلتر المحددين.</p>}</section>
  </main>;
}
