import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, RefreshCw, Save, Store, TrendingUp, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { normalizeBranchName } from '@/lib/branch';
import { formatCycleDate, getCurrentCycle, getPreviousCycle } from '@/lib/pharmacy-cycle';
import { canSeeAllBranches } from '@/lib/security/permissionScopes';

const ALL = 'الكل';
const TARGET_BRANCHES = ['فرع الشامي', 'فرع شكري'];
type PeriodType = 'cycle' | 'previous_cycle' | 'month' | 'last_30_days' | 'custom';
type SummaryRow = Record<string, unknown>;
type BranchTarget = { id?: string; branch_name: string; target_amount: number };
type DailyRow = { date: string; branch: string; netSales: number; invoicesCount: number; uniqueCustomers: number };
type DoctorRow = { doctor: string; branch: string; netSales: number; invoicesCount: number; uniqueCustomers: number };

function number(value: unknown) {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

function money(value: unknown) {
  return `${number(value).toLocaleString('ar-EG', { maximumFractionDigits: 0 })} ج.م`;
}

function count(value: unknown) {
  return number(value).toLocaleString('ar-EG', { maximumFractionDigits: 0 });
}

function dayAfter(value: string) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

async function withTimeout<T>(promise: PromiseLike<T>, label: string, ms = 12000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: انتهت مهلة التحميل`)), ms);
  });
  try {
    return await Promise.race([Promise.resolve(promise), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function read(row: SummaryRow, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return null;
}

export default function Analytics() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const cycle = getCurrentCycle();
  const previousCycle = getPreviousCycle();
  const canAll = canSeeAllBranches(user?.role);
  const ownBranch = normalizeBranchName(user?.branch || '');

  const [periodType, setPeriodType] = useState<PeriodType>('cycle');
  const [start, setStart] = useState(() => params.get('start') || formatCycleDate(cycle.start));
  const [end, setEnd] = useState(() => params.get('end') || formatCycleDate(cycle.end));
  const [branch, setBranch] = useState(() => {
    const requested = normalizeBranchName(params.get('branch') || '');
    return canAll ? requested || ALL : ownBranch || requested || ALL;
  });
  const [doctor, setDoctor] = useState(() => params.get('doctor') || ALL);
  const [dailyRows, setDailyRows] = useState<DailyRow[]>([]);
  const [doctorRows, setDoctorRows] = useState<DoctorRow[]>([]);
  const [targets, setTargets] = useState<BranchTarget[]>([]);
  const [targetDrafts, setTargetDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [savingTarget, setSavingTarget] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const applyPeriod = (type: PeriodType) => {
    setPeriodType(type);
    if (type === 'cycle') {
      setStart(formatCycleDate(cycle.start));
      setEnd(formatCycleDate(cycle.end));
    } else if (type === 'previous_cycle') {
      setStart(formatCycleDate(previousCycle.start));
      setEnd(formatCycleDate(previousCycle.end));
    } else if (type === 'month') {
      const now = new Date();
      setStart(formatCycleDate(new Date(now.getFullYear(), now.getMonth(), 1)));
      setEnd(formatCycleDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)));
    } else if (type === 'last_30_days') {
      const now = new Date();
      setEnd(formatCycleDate(now));
      setStart(formatCycleDate(new Date(now.getTime() - 29 * 86400000)));
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setErrors([]);
    const nextErrors: string[] = [];
    try {
      let salesQuery = supabase
        .from('sales_daily_summary')
        .select('sale_date,branch,net_total,invoices_count,invoice_count,unique_customers,customers_count')
        .gte('sale_date', start)
        .lt('sale_date', dayAfter(end))
        .order('sale_date', { ascending: true })
        .limit(500);
      if (branch !== ALL) salesQuery = salesQuery.eq('branch', branch);

      let doctorsQuery = supabase
        .from('staff_sales_summary')
        .select('sale_date,branch,seller_name,doctor_name,net_total,invoices_count,invoice_count,unique_customers,customers_count')
        .gte('sale_date', start)
        .lt('sale_date', dayAfter(end))
        .limit(2000);
      if (branch !== ALL) doctorsQuery = doctorsQuery.eq('branch', branch);
      if (doctor !== ALL) doctorsQuery = doctorsQuery.or(`seller_name.eq.${doctor},doctor_name.eq.${doctor}`);

      const [salesResult, doctorsResult, targetResult] = await Promise.allSettled([
        withTimeout(salesQuery, 'ملخص المبيعات'),
        withTimeout(doctorsQuery, 'ملخص الدكاترة'),
        withTimeout(supabase.from('branch_sales_targets').select('id,branch_name,target_amount').limit(100), 'تارجت الفروع', 8000),
      ]);

      if (salesResult.status === 'fulfilled' && !salesResult.value.error) {
        const rows = (salesResult.value.data || []) as SummaryRow[];
        setDailyRows(rows.map((row) => ({
          date: String(read(row, ['sale_date']) || '').slice(0, 10),
          branch: normalizeBranchName(read(row, ['branch'])) || 'غير محدد',
          netSales: number(read(row, ['net_total'])),
          invoicesCount: number(read(row, ['invoices_count', 'invoice_count'])),
          uniqueCustomers: number(read(row, ['unique_customers', 'customers_count'])),
        })).filter((row) => row.date));
      } else {
        setDailyRows([]);
        nextErrors.push(salesResult.status === 'rejected' ? String(salesResult.reason) : salesResult.value.error?.message || 'تعذر تحميل ملخص المبيعات');
      }

      if (doctorsResult.status === 'fulfilled' && !doctorsResult.value.error) {
        const rows = (doctorsResult.value.data || []) as SummaryRow[];
        const grouped = new Map<string, DoctorRow>();
        for (const row of rows) {
          const name = String(read(row, ['seller_name', 'doctor_name']) || '').trim();
          if (!name) continue;
          const rowBranch = normalizeBranchName(read(row, ['branch'])) || 'غير محدد';
          const key = `${name}|${rowBranch}`;
          const current = grouped.get(key) || { doctor: name, branch: rowBranch, netSales: 0, invoicesCount: 0, uniqueCustomers: 0 };
          current.netSales += number(read(row, ['net_total']));
          current.invoicesCount += number(read(row, ['invoices_count', 'invoice_count']));
          current.uniqueCustomers += number(read(row, ['unique_customers', 'customers_count']));
          grouped.set(key, current);
        }
        setDoctorRows([...grouped.values()].sort((a, b) => b.netSales - a.netSales));
      } else {
        setDoctorRows([]);
        nextErrors.push(doctorsResult.status === 'rejected' ? String(doctorsResult.reason) : doctorsResult.value.error?.message || 'تعذر تحميل ملخص الدكاترة');
      }

      if (targetResult.status === 'fulfilled' && !targetResult.value.error) {
        const loaded = (targetResult.value.data || []) as BranchTarget[];
        setTargets(loaded);
        setTargetDrafts((current) => {
          const next = { ...current };
          for (const target of loaded) next[normalizeBranchName(target.branch_name)] = String(target.target_amount || '');
          return next;
        });
      } else {
        setTargets([]);
        nextErrors.push(targetResult.status === 'rejected' ? String(targetResult.reason) : targetResult.value.error?.message || 'تعذر تحميل تارجت الفروع');
      }
      setErrors(nextErrors);
      setLastUpdated(new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }));
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'تعذر تحميل التحليلات']);
    } finally {
      setLoading(false);
    }
  }, [branch, doctor, end, start]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 200);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    setParams({ period: periodType, start, end, branch, doctor }, { replace: true });
  }, [branch, doctor, end, periodType, setParams, start]);

  const kpis = useMemo(() => {
    const netSales = dailyRows.reduce((sum, row) => sum + row.netSales, 0);
    const invoicesCount = dailyRows.reduce((sum, row) => sum + row.invoicesCount, 0);
    const uniqueCustomers = dailyRows.reduce((sum, row) => sum + row.uniqueCustomers, 0);
    return { netSales, invoicesCount, uniqueCustomers, avgInvoice: invoicesCount ? netSales / invoicesCount : 0 };
  }, [dailyRows]);

  const branches = useMemo(() => {
    const grouped = new Map<string, { branch: string; netSales: number; invoicesCount: number }>();
    for (const row of dailyRows) {
      const current = grouped.get(row.branch) || { branch: row.branch, netSales: 0, invoicesCount: 0 };
      current.netSales += row.netSales;
      current.invoicesCount += row.invoicesCount;
      grouped.set(row.branch, current);
    }
    return [...grouped.values()].sort((a, b) => b.netSales - a.netSales);
  }, [dailyRows]);

  const dailyTrend = useMemo(() => {
    const grouped = new Map<string, { date: string; netSales: number; invoicesCount: number }>();
    for (const row of dailyRows) {
      const current = grouped.get(row.date) || { date: row.date, netSales: 0, invoicesCount: 0 };
      current.netSales += row.netSales;
      current.invoicesCount += row.invoicesCount;
      grouped.set(row.date, current);
    }
    return [...grouped.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [dailyRows]);

  const doctorNames = useMemo(() => [...new Set(doctorRows.map((row) => row.doctor))].sort(), [doctorRows]);
  const targetRows = useMemo(() => TARGET_BRANCHES.map((branchName) => {
    const target = targets.find((row) => normalizeBranchName(row.branch_name) === branchName);
    const sales = branches.find((row) => row.branch === branchName)?.netSales || 0;
    const targetAmount = number(target?.target_amount);
    return {
      branch: branchName,
      targetId: target?.id,
      sales,
      targetAmount,
      percent: targetAmount ? Math.round((sales / targetAmount) * 1000) / 10 : 0,
      remaining: Math.max(0, targetAmount - sales),
    };
  }), [branches, targets]);

  const saveTarget = async (row: (typeof targetRows)[number]) => {
    const targetAmount = number(targetDrafts[row.branch]);
    if (targetAmount <= 0) {
      toast.error('اكتب تارجت صحيح أكبر من صفر');
      return;
    }
    setSavingTarget(row.branch);
    const payload = { branch_name: row.branch, target_amount: targetAmount, cycle_start_day: 26, active: true, updated_at: new Date().toISOString() };
    const result = row.targetId
      ? await supabase.from('branch_sales_targets').update(payload).eq('id', row.targetId)
      : await supabase.from('branch_sales_targets').insert(payload);
    setSavingTarget(null);
    if (result.error) {
      toast.error(`تعذر حفظ التارجت: ${result.error.message}`);
      return;
    }
    toast.success(`تم حفظ تارجت ${row.branch}`);
    await load();
  };

  return <div className="space-y-5" dir="rtl">
    <section className="rounded-3xl border border-cyan-300/20 bg-slate-900/80 p-5 text-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div><h1 className="text-2xl font-black">التحليلات والمبيعات</h1><p className="mt-1 text-sm font-bold text-slate-300">نسخة خفيفة مستقرة تعتمد على ملخصات المبيعات فقط، بدون Views ثقيلة أو تحميل الفواتير الخام.</p></div>
        <div className="flex items-center gap-3"><span className="text-xs text-slate-400">آخر تحديث: {lastUpdated || '—'}</span><button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl bg-teal-500 px-4 py-2 text-sm font-black text-slate-950 disabled:opacity-50"><RefreshCw size={17} className={loading ? 'animate-spin' : ''}/> تحديث</button></div>
      </div>
    </section>

    <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 text-white">
      <div className="grid gap-3 md:grid-cols-5">
        <Filter label="نوع الفترة"><select className="input-dark" value={periodType} onChange={(e) => applyPeriod(e.target.value as PeriodType)}><option value="cycle">الدورة الحالية</option><option value="previous_cycle">الدورة السابقة</option><option value="month">هذا الشهر</option><option value="last_30_days">آخر 30 يوم</option><option value="custom">مخصص</option></select></Filter>
        <Filter label="بداية الفترة"><input className="input-dark" type="date" value={start} onChange={(e) => { setStart(e.target.value); setPeriodType('custom'); }}/></Filter>
        <Filter label="نهاية الفترة"><input className="input-dark" type="date" value={end} onChange={(e) => { setEnd(e.target.value); setPeriodType('custom'); }}/></Filter>
        <Filter label="الفرع"><select className="input-dark" value={branch} disabled={!canAll} onChange={(e) => setBranch(e.target.value)}><option>{ALL}</option>{TARGET_BRANCHES.map((item) => <option key={item}>{item}</option>)}</select></Filter>
        <Filter label="الدكتور"><select className="input-dark" value={doctor} onChange={(e) => setDoctor(e.target.value)}><option>{ALL}</option>{doctorNames.map((item) => <option key={item}>{item}</option>)}</select></Filter>
      </div>
    </section>

    {errors.length > 0 && <section className="rounded-2xl border border-amber-300/30 bg-amber-500/10 p-4 text-sm font-bold text-amber-100"><div className="flex gap-2"><AlertTriangle size={18}/><div><div>بعض المصادر لم تستجب، لكن الصفحة ستعرض أي بيانات متاحة:</div>{errors.map((item, index) => <div key={index} className="mt-1 text-xs text-amber-200">• {item}</div>)}</div></div></section>}

    <section className="grid gap-3 md:grid-cols-4">
      <Kpi icon={TrendingUp} title="صافي المبيعات" value={money(kpis.netSales)}/>
      <Kpi icon={CalendarDays} title="عدد الفواتير" value={count(kpis.invoicesCount)}/>
      <Kpi icon={Store} title="متوسط الفاتورة" value={money(kpis.avgInvoice)}/>
      <Kpi icon={Users} title="العملاء المشترون" value={count(kpis.uniqueCustomers)}/>
    </section>

    <section className="grid gap-4 xl:grid-cols-2">
      <Panel title="تطور المبيعات اليومي">
        <div className="space-y-2">{dailyTrend.slice(-31).map((row) => {
          const max = Math.max(1, ...dailyTrend.map((item) => item.netSales));
          return <div key={row.date} className="rounded-xl border border-white/10 bg-white/[0.03] p-3"><div className="flex justify-between gap-3 text-sm font-bold"><span>{row.date}</span><span>{money(row.netSales)} · {count(row.invoicesCount)} فاتورة</span></div><div className="mt-2 h-2 rounded-full bg-slate-800"><div className="h-2 rounded-full bg-teal-400" style={{ width: `${Math.max(2, (row.netSales / max) * 100)}%` }}/></div></div>;
        })}{!dailyTrend.length && <Empty text="لا توجد بيانات مبيعات للفترة المحددة"/>}</div>
      </Panel>
      <Panel title="أداء الفروع">
        <div className="space-y-3">{branches.map((row) => <div key={row.branch} className="rounded-xl border border-white/10 bg-white/[0.03] p-4"><div className="flex items-center justify-between"><span className="font-black">{row.branch}</span><span className="font-black text-teal-300">{money(row.netSales)}</span></div><div className="mt-2 text-xs text-slate-400">{count(row.invoicesCount)} فاتورة · متوسط {money(row.invoicesCount ? row.netSales / row.invoicesCount : 0)}</div></div>)}{!branches.length && <Empty text="لا توجد بيانات فروع"/>}</div>
      </Panel>
    </section>

    <section className="grid gap-4 xl:grid-cols-2">
      <Panel title="أفضل الدكاترة">
        <div className="space-y-2">{doctorRows.slice(0, 15).map((row, index) => <div key={`${row.doctor}-${row.branch}`} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] p-3"><div><div className="font-black">{index + 1}. {row.doctor}</div><div className="mt-1 text-xs text-slate-400">{row.branch} · {count(row.invoicesCount)} فاتورة · {count(row.uniqueCustomers)} عميل</div></div><div className="font-black text-teal-300">{money(row.netSales)}</div></div>)}{!doctorRows.length && <Empty text="لا توجد بيانات دكاترة"/>}</div>
      </Panel>
      <Panel title="تحديد تارجت الفروع يدويًا">
        <div className="space-y-3">{targetRows.map((row) => <div key={row.branch} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><div className="flex items-center justify-between"><div className="font-black">{row.branch}</div><div className="text-sm font-black text-teal-300">{row.targetAmount ? `إنجاز ${row.percent}%` : 'لم يتم تحديد هدف'}</div></div><div className="mt-3 flex gap-2"><input type="number" min="1" step="1000" value={targetDrafts[row.branch] ?? ''} onChange={(e) => setTargetDrafts((current) => ({ ...current, [row.branch]: e.target.value }))} placeholder="اكتب التارجت بالجنيه" className="input-dark min-w-0 flex-1"/><button disabled={savingTarget === row.branch} onClick={() => void saveTarget(row)} className="inline-flex items-center gap-2 rounded-xl bg-teal-500 px-4 py-2 font-black text-slate-950 disabled:opacity-50"><Save size={16}/>{savingTarget === row.branch ? 'حفظ...' : 'حفظ'}</button></div><div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold text-slate-300"><span>المبيعات: {money(row.sales)}</span><span>المتبقي: {row.targetAmount ? money(row.remaining) : '—'}</span></div>{row.targetAmount > 0 && <div className="mt-3 h-2 rounded-full bg-slate-800"><div className="h-2 rounded-full bg-emerald-400" style={{ width: `${Math.min(100, row.percent)}%` }}/></div>}</div>)}</div>
      </Panel>
    </section>
  </div>;
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="space-y-1 text-xs font-bold text-slate-300"><span>{label}</span>{children}</label>;
}

function Kpi({ icon: Icon, title, value }: { icon: typeof TrendingUp; title: string; value: string }) {
  return <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 text-white"><div className="flex items-center justify-between"><div className="text-sm font-bold text-slate-400">{title}</div><Icon size={20} className="text-teal-300"/></div><div className="mt-3 text-2xl font-black">{value}</div></div>;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 text-white"><h2 className="mb-4 text-lg font-black">{title}</h2>{children}</section>;
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-white/15 p-6 text-center text-sm font-bold text-slate-500">{text}</div>;
}
