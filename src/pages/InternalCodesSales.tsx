import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

type Flag = { customer_code: string; flag_key: string; flag_label?: string | null };
type Invoice = { id: string; invoice_number: string | null; invoice_date: string | null; customer_code: string | null; branch: string | null; customer_name: string | null; net_amount: number | null; net_total: number | null; amount: number | null; seller_name: string | null };
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
  const allowed = isAdmin || checkPermission('view_sales_reports');
  useEffect(() => {
    if (!allowed) return;
    let alive = true;
    supabase.from('customer_flags').select('customer_code,flag_key,flag_label')
      .eq('flag_key', 'system_generic_code').eq('is_active', true)
      .then(({ data, error }) => { if (!alive) return; if (error) setError(error.message); else setFlags((data || []) as Flag[]); });
    return () => { alive = false; };
  }, [allowed]);
  const codes = useMemo(() => [...new Set(flags.map(f => String(f.customer_code).trim()).filter(Boolean))].sort((a,b) => Number(a)-Number(b)), [flags]);
  useEffect(() => {
    if (!allowed || codes.length === 0 || !from || !to) return;
    if (to < from) { setError('تاريخ النهاية يجب أن يكون بعد البداية'); return; }
    let alive = true;
    (async () => {
      setBusy(true); setError('');
      const loaded: Invoice[] = [];
      const pageSize = 500;
      for (let offset = 0; ; offset += pageSize) {
        let query = supabase.from('sales_invoices')
          .select('id,invoice_number,invoice_date,customer_code,branch,customer_name,net_amount,net_total,amount,seller_name')
          .in('customer_code', codes)
          .gte('invoice_date', previousDay(from) + 'T00:00:00Z')
          .lt('invoice_date', nextDay(to) + 'T00:00:00Z')
          .order('invoice_date', { ascending: true }).order('id', { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (branch !== 'all') query = query.eq('branch', branch);
        const result = await query;
        if (!alive) return;
        if (result.error) { setError('تعذر قراءة كل الفواتير: ' + result.error.message); setRows([]); setBusy(false); return; }
        const page = (result.data || []) as Invoice[];
        loaded.push(...page);
        if (page.length < pageSize) break;
        if (offset >= 100000) { setError('حجم النتائج كبير. قلل الفترة ثم أعد المحاولة.'); setBusy(false); return; }
      }
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
      <label className="text-sm">الفرع<select className="w-full rounded-lg border p-2 mt-1 bg-transparent" value={branch} onChange={e => setBranch(e.target.value)}><option value="all">الفرعان</option><option value="فرع شكري">شكري</option><option value="فرع الشامي">الشامي</option></select></label>
      <label className="text-sm">الكود الداخلي<select className="w-full rounded-lg border p-2 mt-1 bg-transparent" value={code} onChange={e => setCode(e.target.value)}><option value="all">جميع الأكواد</option>{codes.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
    </div>
    {error && <div role="alert" className="border rounded-lg p-3 text-red-600">{error}</div>}
    {busy && <p role="status">جاري تحميل الفواتير والتحقق من اكتمال جميع الصفحات…</p>}
    {!busy && <div className="grid grid-cols-2 gap-3"><div className="rounded-xl border p-4"><div className="opacity-70 text-sm">إجمالي السحب</div><strong className="text-xl">{money(total)} ج</strong></div><div className="rounded-xl border p-4"><div className="opacity-70 text-sm">عدد الفواتير</div><strong className="text-xl">{filtered.length.toLocaleString('ar-EG')}</strong></div></div>}
    <section className="rounded-xl border overflow-x-auto"><h2 className="font-bold p-3">ملخص كل كود</h2><table className="w-full text-sm text-right"><thead><tr className="border-y"><th className="p-3">الكود</th><th className="p-3">عدد الفواتير</th><th className="p-3">إجمالي السحب</th><th className="p-3">التفاصيل</th></tr></thead><tbody>{summary.filter(r=> code==='all'||r.code===code).map(r=><tr key={r.code} className="border-b"><td className="p-3 font-bold">{r.code}</td><td className="p-3">{r.invoices}</td><td className="p-3">{money(r.total)} ج</td><td className="p-3"><button className="underline" onClick={()=>setCode(r.code)}>عرض الفواتير</button></td></tr>)}</tbody></table></section>
    <section className="rounded-xl border overflow-x-auto"><h2 className="font-bold p-3">تفاصيل الفواتير {code !== 'all' ? 'للكود ' + code : 'لجميع الأكواد'}</h2><table className="w-full text-sm text-right"><thead><tr className="border-y"><th className="p-3">التاريخ</th><th className="p-3">الكود</th><th className="p-3">رقم الفاتورة</th><th className="p-3">الفرع</th><th className="p-3">المستخدم</th><th className="p-3">الصافي</th></tr></thead><tbody>{filtered.map(r=><tr key={r.id} className="border-b"><td className="p-3">{day(r.invoice_date)}</td><td className="p-3">{r.customer_code}</td><td className="p-3">{r.invoice_number}</td><td className="p-3">{r.branch}</td><td className="p-3">{r.seller_name || '—'}</td><td className="p-3">{money(invoiceAmount(r))} ج</td></tr>)}</tbody></table>{!busy && filtered.length===0 && <p className="p-4 opacity-70">لا توجد فواتير ضمن الفترة والفلتر المحددين.</p>}</section>
  </main>;
}
