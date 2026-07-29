import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, RefreshCw, Save, Store, TrendingUp, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { normalizeBranchName } from '@/lib/branch';
import { formatCycleDate, getCurrentCycle, getPreviousCycle } from '@/lib/pharmacy-cycle';
import { canSeeAllBranches } from '@/lib/security/permissionScopes';
import {
  DASHBOARD_ALL_BRANCHES,
  fetchDashboardSalesTruth,
} from '@/lib/dashboard/dashboardTruthService';

const ALL = 'الكل';
const TARGET_BRANCHES = ['فرع الشامي', 'فرع شكري'] as const;
type PeriodType = 'cycle' | 'previous_cycle' | 'month' | 'last_30_days' | 'custom';
type BranchTarget = { id?: string; branch_name: string; target_amount: number };
type DailyRow = { date: string; branch: string; netSales: number; invoicesCount: number };
type DoctorRow = { doctor: string; branch: string; netSales: number; invoicesCount: number; uniqueCustomers: number };

function n(value: unknown) {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

function money(value: unknown) {
  return `${n(value).toLocaleString('ar-EG', { maximumFractionDigits: 0 })} ج.م`;
}

function count(value: unknown) {
  return n(value).toLocaleString('ar-EG', { maximumFractionDigits: 0 });
}

function safeBranch(value: unknown) {
  const normalized = normalizeBranchName(String(value || ''));
  return TARGET_BRANCHES.includes(normalized as (typeof TARGET_BRANCHES)[number]) ? normalized : ALL;
}

function validDoctor(value: unknown) {
  const text = String(value || '').trim();
  return text && text !== 'غير محدد' ? text : ALL;
}

export default function Analytics() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const cycle = getCurrentCycle();
  const previousCycle = getPreviousCycle();
  const canAll = canSeeAllBranches(user?.role);
  const ownBranch = safeBranch(user?.branch);

  const [periodType, setPeriodType] = useState<PeriodType>('cycle');
  const [start, setStart] = useState(() => params.get('start') || formatCycleDate(cycle.start));
  const [end, setEnd] = useState(() => params.get('end') || formatCycleDate(cycle.end));
  const [branch, setBranch] = useState(() => {
    const requested = safeBranch(params.get('branch'));
    return canAll ? requested : ownBranch !== ALL ? ownBranch : requested;
  });
  const [doctor, setDoctor] = useState(() => validDoctor(params.get('doctor')));
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

  const load = useCallback(async (noCache = false) => {
    setLoading(true);
    setErrors([]);
    const nextErrors: string[] = [];
    try {
      const salesBranch = branch === ALL ? DASHBOARD_ALL_BRANCHES : branch;
      const [truthResult, targetResult] = await Promise.allSettled([
        fetchDashboardSalesTruth({
          startDate: start,
          endDate: end,
          branch: salesBranch,
          errors: nextErrors,
          noCache,
        }),
        supabase.from('branch_sales_targets').select('id,branch_name,target_amount').limit(100),
      ]);

      if (truthResult.status === 'fulfilled') {
        const truth = truthResult.value as any;
        const daily = Array.isArray(truth.dailySales) ? truth.dailySales : [];
        setDailyRows(
          daily
            .map((row: any) => ({
              date: String(row.sale_date || row.date || '').slice(0, 10),
              branch: normalizeBranchName(row.branch || '') || 'غير محدد',
              netSales: n(row.daily_sales ?? row.sales_total ?? row.net_total),
              invoicesCount: n(row.invoices_count ?? row.invoice_count),
            }))
            .filter((row: DailyRow) => row.date)
        );

        const doctors = Array.isArray(truth.doctorSales) ? truth.doctorSales : [];
        setDoctorRows(
          doctors
            .map((row: any) => ({
              doctor: String(row.doctor_name || row.seller_name || row.staff_name || '').trim(),
              branch: normalizeBranchName(row.branch || '') || 'غير محدد',
              netSales: n(row.sales_total ?? row.net_total),
              invoicesCount: n(row.invoices_count ?? row.invoice_count),
              uniqueCustomers: n(row.unique_customers ?? row.customers_count),
            }))
            .filter((row: DoctorRow) => row.doctor)
            .sort((a: DoctorRow, b: DoctorRow) => b.netSales - a.netSales)
        );
      } else {
        setDailyRows([]);
        setDoctorRows([]);
        nextErrors.push(truthResult.reason instanceof Error ? truthResult.reason.message : String(truthResult.reason));
      }

      if (targetResult.status === 'fulfilled' && !targetResult.value.error) {
        const loaded = (targetResult.value.data || []) as BranchTarget[];
        setTargets(loaded);
        setTargetDrafts((current) => {
          const next = { ...current };
          for (const target of loaded) {
            const key = normalizeBranchName(target.branch_name);
            if (key) next[key] = String(target.target_amount || '');
          }
          return next;
        });
      } else {
        const message = targetResult.status === 'rejected'
          ? String(targetResult.reason)
          : targetResult.value.error?.message || 'تعذر تحميل تارجت الفروع';
        nextErrors.push(message);
      }

      setErrors([...new Set(nextErrors.filter(Boolean))]);
      setLastUpdated(new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }));
    } catch (error) {
      setDailyRows([]);
      setDoctorRows([]);
      setErrors([error instanceof Error ? error.message : 'تعذر تحميل التحليلات']);
    } finally {
      setLoading(false);
    }
  }, [branch, end, start]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(false), 200);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const cleanBranch = safeBranch(branch);
    const cleanDoctor = validDoctor(doctor);
    if (cleanBranch !== branch) setBranch(cleanBranch);
    if (cleanDoctor !== doctor) setDoctor(cleanDoctor);
    setParams({ period: periodType, start, end, branch: cleanBranch, doctor: cleanDoctor }, { replace: true });
  }, [branch, doctor, end, periodType, setParams, start]);

  const filteredDoctors = useMemo(
    () => doctor === ALL ? doctorRows : doctorRows.filter((row) => row.doctor === doctor),
    [doctor, doctorRows]
  );

  const kpis = useMemo(() => {
    const netSales = dailyRows.reduce((sum, row) => sum + row.netSales, 0);
    const invoicesCount = dailyRows.reduce((sum, row) => sum + row.invoicesCount, 0);
    return {
      netSales,
      invoicesCount,
      avgInvoice: invoicesCount ? netSales / invoicesCount : 0,
      uniqueCustomers: filteredDoctors.reduce((sum, row) => sum + row.uniqueCustomers, 0),
    };
  }, [dailyRows, filteredDoctors]);

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
    const targetAmount = n(target?.target_amount);
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
    const targetAmount = n(targetDrafts[row.branch]);
    if (targetAmount <= 0) {
      toast.error('اكتب تارجت صحيح أكبر من صفر');
      return;
    }
    setSavingTarget(row.branch);
    const payload = {
      branch_name: row.branch,
      target_amount: targetAmount,
      cycle_start_day: 26,
      active: true,
      updated_at: new Date().toISOString(),
    };
    const result = row.targetId
      ? await supabase.from('branch_sales_targets').update(payload).eq('id', row.targetId)
      : await supabase.from('branch_sales_targets').insert(payload);
    setSavingTarget(null);
    if (result.error) {
      toast.error(`تعذر حفظ التارجت: ${result.error.message}`);
      return;
    }
    toast.success(`تم حفظ تارجت ${row.branch}`);
    await load(true);
  };

  return (
    <div className="space-y-5" dir="rtl">
      <section className="rounded-3xl border border-cyan-300/20 bg-slate-900/80 p-5 text-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black">التحليلات والمبيعات</h1>
            <p className="mt-1 text-sm font-bold text-slate-300">مرتبطة بنفس مصدر المبيعات المعتمد في الداشبورد التنفيذي.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">آخر تحديث: {lastUpdated || '—'}</span>
            <button onClick={() => void load(true)} disabled={loading} className="inline-flex items-center gap-2 rounded-xl bg-teal-500 px-4 py-2 text-sm font-black text-slate-950 disabled:opacity-50">
              <RefreshCw size={17} className={loading ? 'animate-spin' : ''} /> تحديث
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 text-white">
        <div className="grid gap-3 md:grid-cols-5">
          <Filter label="نوع الفترة"><select className="input-dark" value={periodType} onChange={(e) => applyPeriod(e.target.value as PeriodType)}><option value="cycle">الدورة الحالية</option><option value="previous_cycle">الدورة السابقة</option><option value="month">هذا الشهر</option><option value="last_30_days">آخر 30 يوم</option><option value="custom">مخصص</option></select></Filter>
          <Filter label="بداية الفترة"><input className="input-dark" type="date" value={start} onChange={(e) => { setStart(e.target.value); setPeriodType('custom'); }} /></Filter>
          <Filter label="نهاية الفترة"><input className="input-dark" type="date" value={end} onChange={(e) => { setEnd(e.target.value); setPeriodType('custom'); }} /></Filter>
          <Filter label="الفرع"><select className="input-dark" value={branch} disabled={!canAll} onChange={(e) => setBranch(safeBranch(e.target.value))}><option value={ALL}>{ALL}</option>{TARGET_BRANCHES.map((item) => <option key={item} value={item}>{item}</option>)}</select></Filter>
          <Filter label="الدكتور"><select className="input-dark" value={doctor} onChange={(e) => setDoctor(validDoctor(e.target.value))}><option value={ALL}>{ALL}</option>{doctorNames.map((item) => <option key={item} value={item}>{item}</option>)}</select></Filter>
        </div>
      </section>

      {errors.length > 0 && <section className="rounded-2xl border border-amber-300/30 bg-amber-500/10 p-4 text-sm font-bold text-amber-100"><div className="flex gap-2"><AlertTriangle size={18} /><div><div>تم عرض البيانات المتاحة، وهذه ملاحظات المصادر:</div>{errors.map((item, index) => <div key={`${item}-${index}`} className="mt-1 text-xs text-amber-200">• {item}</div>)}</div></div></section>}

      <section className="grid gap-3 md:grid-cols-4">
        <Kpi icon={TrendingUp} title="صافي المبيعات" value={money(kpis.netSales)} />
        <Kpi icon={CalendarDays} title="عدد الفواتير" value={count(kpis.invoicesCount)} />
        <Kpi icon={Store} title="متوسط الفاتورة" value={money(kpis.avgInvoice)} />
        <Kpi icon={Users} title="العملاء المشترون" value={count(kpis.uniqueCustomers)} />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Panel title="تطور المبيعات اليومي">
          <div className="space-y-2">{dailyTrend.slice(-31).map((row) => {
            const max = Math.max(1, ...dailyTrend.map((item) => item.netSales));
            return <div key={row.date} className="rounded-xl border border-white/10 bg-white/[0.03] p-3"><div className="flex justify-between gap-3 text-sm font-bold"><span>{row.date}</span><span>{money(row.netSales)} · {count(row.invoicesCount)} فاتورة</span></div><div className="mt-2 h-2 rounded-full bg-slate-800"><div className="h-2 rounded-full bg-teal-400" style={{ width: `${Math.max(2, (row.netSales / max) * 100)}%` }} /></div></div>;
          })}{!dailyTrend.length && <Empty text={loading ? 'جارٍ تحميل بيانات المبيعات...' : 'لا توجد بيانات مبيعات للفترة المحددة'} />}</div>
        </Panel>
        <Panel title="أداء الفروع">
          <div className="space-y-3">{branches.map((row) => <div key={row.branch} className="rounded-xl border border-white/10 bg-white/[0.03] p-4"><div className="flex items-center justify-between"><span className="font-black">{row.branch}</span><span className="font-black text-teal-300">{money(row.netSales)}</span></div><div className="mt-2 text-xs text-slate-400">{count(row.invoicesCount)} فاتورة · متوسط {money(row.invoicesCount ? row.netSales / row.invoicesCount : 0)}</div></div>)}{!branches.length && <Empty text={loading ? 'جارٍ تحميل بيانات الفروع...' : 'لا توجد بيانات فروع'} />}</div>
        </Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Panel title="أفضل الدكاترة">
          <div className="space-y-2">{filteredDoctors.slice(0, 15).map((row, index) => <div key={`${row.doctor}-${row.branch}`} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] p-3"><div><div className="font-black">{index + 1}. {row.doctor}</div><div className="mt-1 text-xs text-slate-400">{row.branch} · {count(row.invoicesCount)} فاتورة · {count(row.uniqueCustomers)} عميل</div></div><div className="font-black text-teal-300">{money(row.netSales)}</div></div>)}{!filteredDoctors.length && <Empty text={loading ? 'جارٍ تحميل بيانات الدكاترة...' : 'لا توجد بيانات دكاترة'} />}</div>
        </Panel>
        <Panel title="تحديد تارجت الفروع يدويًا">
          <div className="space-y-3">{targetRows.map((row) => <div key={row.branch} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><div className="flex items-center justify-between"><div className="font-black">{row.branch}</div><div className="text-sm font-black text-teal-300">{row.targetAmount ? `إنجاز ${row.percent}%` : 'لم يتم تحديد هدف'}</div></div><div className="mt-3 flex gap-2"><input type="number" min="1" step="1000" value={targetDrafts[row.branch] ?? ''} onChange={(e) => setTargetDrafts((current) => ({ ...current, [row.branch]: e.target.value }))} placeholder="اكتب تارجت الدورة بالجنيه" className="input-dark min-w-0 flex-1" /><button disabled={savingTarget === row.branch} onClick={() => void saveTarget(row)} className="inline-flex items-center gap-2 rounded-xl bg-teal-500 px-4 py-2 font-black text-slate-950 disabled:opacity-50"><Save size={16} />{savingTarget === row.branch ? 'حفظ...' : 'حفظ'}</button></div><div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold text-slate-300"><span>المبيعات: {money(row.sales)}</span><span>المتبقي: {row.targetAmount ? money(row.remaining) : '—'}</span></div>{row.targetAmount > 0 && <div className="mt-3 h-2 rounded-full bg-slate-800"><div className="h-2 rounded-full bg-emerald-400" style={{ width: `${Math.min(100, row.percent)}%` }} /></div>}</div>)}</div>
        </Panel>
      </section>
    </div>
  );
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="space-y-1 text-xs font-bold text-slate-300"><span>{label}</span>{children}</label>;
}

function Kpi({ icon: Icon, title, value }: { icon: typeof TrendingUp; title: string; value: string }) {
  return <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 text-white"><div className="flex items-center justify-between"><div className="text-sm font-bold text-slate-400">{title}</div><Icon size={20} className="text-teal-300" /></div><div className="mt-3 text-2xl font-black">{value}</div></div>;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 text-white"><h2 className="mb-4 text-lg font-black">{title}</h2>{children}</section>;
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-white/15 p-6 text-center text-sm font-bold text-slate-500">{text}</div>;
}
