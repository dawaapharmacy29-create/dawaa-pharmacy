import { useEffect, useMemo, useState } from 'react';
import { BadgeDollarSign, Crown, RefreshCw, TrendingDown, TrendingUp, UserCheck } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { supabase } from '@/lib/supabase';
import { getPharmacyCycleRange } from '@/lib/pharmacy-cycle';
import { fetchMonthlyCustomerPerformance, type CustomerMonthlyRow } from '@/lib/customerMonthlyPerformanceService';

const EXCLUDED_CODES = new Set(['5', '10', '54', '170', '12820']);
const GENERIC_NAMES = new Set(['عميل الصيدلية', 'عميل نقدي', 'عميل عابر', 'كاش', 'عميل', '.']);

type QueueCustomer = {
  code: string;
  name: string;
  phone: string;
  branch: string;
  label: string;
  value?: number;
  invoiceCount?: number;
  invoiceValues?: number[];
};

function ymd(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function money(value = 0) {
  return `${Math.round(value).toLocaleString('ar-EG')} ج.م`;
}

function eligible(code: unknown, name: unknown) {
  const c = String(code ?? '').trim();
  const n = String(name ?? '').trim();
  return Boolean(c && !EXCLUDED_CODES.has(c) && n && !GENERIC_NAMES.has(n));
}

function openFollowup(customer: QueueCustomer) {
  window.dispatchEvent(
    new CustomEvent('open-quick-followup', {
      detail: { code: customer.code, name: customer.name, phone: customer.phone },
    })
  );
}

function QueueCard({ customer }: { customer: QueueCustomer }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-black text-white">{customer.name}</div>
          <div className="mt-1 text-[11px] font-bold text-slate-400">كود {customer.code} · {customer.branch}</div>
          <div className="mt-2 text-xs font-black text-cyan-200">{customer.label}</div>
          {customer.invoiceValues?.length ? (
            <div className="mt-1 text-[11px] font-bold text-slate-300">قيم الفواتير: {customer.invoiceValues.map(money).join(' + ')}</div>
          ) : null}
        </div>
        <button type="button" onClick={() => openFollowup(customer)} className="shrink-0 rounded-xl bg-cyan-400 px-3 py-2 text-xs font-black text-slate-950 hover:bg-cyan-300">متابعة</button>
      </div>
    </div>
  );
}

export default function CustomerDailyPriorityQueues() {
  const { user } = useAuth();
  const managerView = canViewAllBranches(user);
  const scopedBranch = normalizeBranchName(user?.branch || '');
  const [largeInvoices, setLargeInvoices] = useState<QueueCustomer[]>([]);
  const [vipDaily, setVipDaily] = useState<QueueCustomer[]>([]);
  const [mixed, setMixed] = useState<QueueCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const yesterday = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d;
  }, []);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const saleDay = ymd(yesterday);
      let invoiceQuery = supabase
        .from('sales_invoices')
        .select('customer_code,customer_name,customer_phone,branch,branch_name,invoice_no,invoice_number,invoice_date,sale_date,net_amount,net_total,total_amount,amount')
        .eq('sale_date', saleDay);
      if (!managerView && scopedBranch) invoiceQuery = invoiceQuery.eq('branch', scopedBranch);
      const { data: invoices, error: invoiceError } = await invoiceQuery;
      if (invoiceError) throw invoiceError;

      const byCustomer = new Map<string, QueueCustomer>();
      for (const row of invoices || []) {
        const amount = Number(row.net_amount ?? row.net_total ?? row.total_amount ?? row.amount ?? 0);
        if (amount < 500 || !eligible(row.customer_code, row.customer_name)) continue;
        const code = String(row.customer_code || '').trim();
        const branch = normalizeBranchName(row.branch_name || row.branch || '');
        const current = byCustomer.get(code) || {
          code,
          name: String(row.customer_name || '').trim(),
          phone: String(row.customer_phone || '').trim(),
          branch,
          label: '',
          value: 0,
          invoiceCount: 0,
          invoiceValues: [],
        };
        current.value = Number(current.value || 0) + amount;
        current.invoiceCount = Number(current.invoiceCount || 0) + 1;
        current.invoiceValues = [...(current.invoiceValues || []), amount].sort((a, b) => b - a);
        current.label = `${current.invoiceCount} فاتورة مؤهلة · إجمالي ${money(current.value)}`;
        byCustomer.set(code, current);
      }
      setLargeInvoices([...byCustomer.values()].sort((a, b) => Number(b.value || 0) - Number(a.value || 0)));

      let vipQuery = supabase
        .from('customer_metrics_summary')
        .select('customer_code,customer_name,customer_phone,branch,avg_monthly,total_spent,last_purchase,segment')
        .eq('segment', 'مهم جدًا')
        .order('avg_monthly', { ascending: false, nullsFirst: false })
        .limit(80);
      if (!managerView && scopedBranch) vipQuery = vipQuery.eq('branch', scopedBranch);
      const { data: vipRows, error: vipError } = await vipQuery;
      if (vipError) throw vipError;
      const vipEligible = (vipRows || []).filter((r) => eligible(r.customer_code, r.customer_name));
      const dayOffset = Math.floor((Date.now() / 86400000) % Math.max(1, vipEligible.length));
      const rotated = [...vipEligible.slice(dayOffset), ...vipEligible.slice(0, dayOffset)].slice(0, 10);
      setVipDaily(rotated.map((r) => ({
        code: String(r.customer_code),
        name: String(r.customer_name),
        phone: String(r.customer_phone || ''),
        branch: normalizeBranchName(r.branch || ''),
        value: Number(r.avg_monthly || 0),
        label: `VIP · متوسط شهري ${money(Number(r.avg_monthly || 0))}`,
      })));

      const period = getPharmacyCycleRange(new Date());
      const prevAnchor = new Date(period.start);
      prevAnchor.setDate(prevAnchor.getDate() - 1);
      const prev = getPharmacyCycleRange(prevAnchor);
      const perf = await fetchMonthlyCustomerPerformance(managerView ? null : scopedBranch, period.start, period.end, prev.start, prev.end, 'cycle');
      const rows = perf.rows.filter((r) => eligible(r.customer_code, r.customer_name));
      const pick = (states: string[], limit = 5, sorter?: (a: CustomerMonthlyRow, b: CustomerMonthlyRow) => number) =>
        rows.filter((r) => states.includes(r.customer_state)).sort(sorter || ((a, b) => Number(b.sales_amount || 0) - Number(a.sales_amount || 0))).slice(0, limit);
      const selected = [
        ...pick(['مستقر'], 5),
        ...pick(['تراجع قوي', 'تراجع'], 5, (a, b) => Number(b.previous_month_sales || 0) - Number(a.previous_month_sales || 0)),
        ...pick(['نمو قوي', 'نمو', 'مستعاد'], 5, (a, b) => Number(b.sales_change_amount || 0) - Number(a.sales_change_amount || 0)),
      ];
      setMixed(selected.map((r) => ({
        code: String(r.customer_code || ''),
        name: String(r.customer_name || ''),
        phone: String(r.phone || ''),
        branch: normalizeBranchName(r.branch || ''),
        value: Number(r.sales_amount || 0),
        label: `${r.customer_state} · الحالي ${money(Number(r.sales_amount || 0))}`,
      })));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل القوائم اليومية');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [managerView, scopedBranch]);

  return (
    <section className="mx-4 mt-4 space-y-3 rounded-3xl border border-cyan-300/15 bg-[#0b2035] p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black text-cyan-300">قوائم المتابعة الذكية</p>
          <h2 className="mt-1 text-lg font-black text-white">أولويات اليوم لخدمة العملاء</h2>
          <p className="mt-1 text-xs font-bold text-slate-400">تتحدث تلقائيًا بعد استيراد الفواتير — +500 من يوم {ymd(yesterday)}، و10 VIP، وعينة من المستقرين والمتراجعين والمتحسنين.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-black text-slate-200 hover:bg-white/10">
          <RefreshCw size={14} className={`ml-1 inline ${loading ? 'animate-spin' : ''}`} /> تحديث
        </button>
      </div>
      {error ? <div className="rounded-xl border border-rose-300/20 bg-rose-500/10 p-3 text-xs font-bold text-rose-200">{error}</div> : null}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-black text-emerald-200"><BadgeDollarSign size={17}/> +500 أمس ({largeInvoices.length})</div>
          <div className="max-h-[460px] space-y-2 overflow-auto pr-1">{largeInvoices.length ? largeInvoices.map((c) => <QueueCard key={`500-${c.code}`} customer={c}/>) : <div className="rounded-xl border border-white/10 p-3 text-xs text-slate-400">لا توجد فواتير مؤهلة أو لم يتم استيراد فواتير أمس بعد.</div>}</div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-black text-amber-200"><Crown size={17}/> 10 عملاء VIP اليوم</div>
          <div className="max-h-[460px] space-y-2 overflow-auto pr-1">{vipDaily.map((c) => <QueueCard key={`vip-${c.code}`} customer={c}/>)}</div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-black text-cyan-200"><UserCheck size={17}/> عينة النشاط والتغير ({mixed.length})</div>
          <div className="mb-2 flex gap-3 text-[11px] font-bold text-slate-400"><span><UserCheck size={12} className="inline"/> مستقر</span><span><TrendingDown size={12} className="inline"/> متراجع</span><span><TrendingUp size={12} className="inline"/> متحسن</span></div>
          <div className="max-h-[430px] space-y-2 overflow-auto pr-1">{mixed.map((c, i) => <QueueCard key={`mix-${c.code}-${i}`} customer={c}/>)}</div>
        </div>
      </div>
    </section>
  );
}
