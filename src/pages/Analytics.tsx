import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, RefreshCw, Store, TrendingUp, Users } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { formatCycleDate, getCurrentCycle, getPreviousCycle } from '@/lib/pharmacy-cycle';
import { canSeeAllBranches } from '@/lib/security/permissionScopes';
import { dashboardInvoiceAmount } from '@/lib/dashboard/dashboardTruthService';
import { fetchSalesInvoicesPagedSafe, INVOICE_SELECT_FULL } from '@/lib/salesInvoiceQueries';
import BranchTargetEditor from '@/components/dashboard/BranchTargetEditor';

const ALL = 'الكل';
const BRANCHES = ['فرع الشامي', 'فرع شكري'] as const;
type PeriodType = 'cycle' | 'previous_cycle' | 'month' | 'last_30_days' | 'custom';
type InvoiceRow = Record<string, unknown>;
type DailyRow = { date: string; branch: string; sales: number; invoiceIds: Set<string>; customers: Set<string> };
type DoctorRow = { doctor: string; branch: string; sales: number; invoiceIds: Set<string>; customers: Set<string> };

function n(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown) {
  return `${n(value).toLocaleString('ar-EG', { maximumFractionDigits: 0 })} ج.م`;
}

function count(value: unknown) {
  return n(value).toLocaleString('ar-EG', { maximumFractionDigits: 0 });
}

function validBranch(value: unknown) {
  const normalized = normalizeBranchName(String(value || ''));
  return BRANCHES.includes(normalized as (typeof BRANCHES)[number]) ? normalized : ALL;
}

function invoiceDate(row: InvoiceRow) {
  return String(row.invoice_date ?? row.sale_date ?? row.date ?? row.created_at ?? '').slice(0, 10);
}

function invoiceBranch(row: InvoiceRow) {
  return normalizeBranchName(String(row.branch_name ?? row.branch ?? '')) || 'غير محدد';
}

function invoiceDoctor(row: InvoiceRow) {
  return String(row.normalized_seller_name ?? row.seller_name ?? row.staff_name ?? row.doctor_name ?? '').trim();
}

function invoiceId(row: InvoiceRow, index: number) {
  return String(row.invoice_no ?? row.invoice_number ?? row.id ?? `${invoiceDate(row)}-${index}`);
}

function customerId(row: InvoiceRow) {
  return String(row.customer_code ?? row.customer_phone ?? row.customer_name ?? '').trim();
}

async function fetchInvoicePages(start: string, end: string, forceRefresh = false) {
  const errors: string[] = [];
  const rows = await fetchSalesInvoicesPagedSafe({
    startDate: start,
    endDate: end,
    branch: 'كل الفروع',
    selectOptions: [INVOICE_SELECT_FULL],
    errors,
    pageSize: 1000,
    maxPages: 500,
    noCache: forceRefresh,
  });
  return { rows: rows as InvoiceRow[], errors };
}

export default function Analytics() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const cycle = getCurrentCycle();
  const previousCycle = getPreviousCycle();
  const canAll = canSeeAllBranches(user?.role);
  const ownBranch = validBranch(user?.branch);
  const [periodType, setPeriodType] = useState<PeriodType>('cycle');
  const [start, setStart] = useState(() => params.get('start') || formatCycleDate(cycle.start));
  const [end, setEnd] = useState(() => params.get('end') || formatCycleDate(cycle.end));
  const [branch, setBranch] = useState(() => canAll ? validBranch(params.get('branch')) : ownBranch);
  const [doctor, setDoctor] = useState(() => {
    const value = String(params.get('doctor') || ALL).trim();
    return !value || value === 'غير محدد' ? ALL : value;
  });
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(false);
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
      setStart(formatCycleDate(new Date(now.getTime() - 29 * 86400000)));
      setEnd(formatCycleDate(now));
    }
  };

  const load = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setErrors([]);
    try {
      const result = await fetchInvoicePages(start, end, forceRefresh);
      setInvoices(result.rows);
      setErrors(result.errors);
      setLastUpdated(new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }));
    } catch (error) {
      setInvoices([]);
      setErrors([error instanceof Error ? error.message : 'تعذر تحميل فواتير المبيعات']);
    } finally {
      setLoading(false);
    }
  }, [end, start]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(false), 150);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const cleanBranch = canAll ? validBranch(branch) : ownBranch;
    if (cleanBranch !== branch) setBranch(cleanBranch);
    setParams({ period: periodType, start, end, branch: cleanBranch, doctor }, { replace: true });
  }, [branch, canAll, doctor, end, ownBranch, periodType, setParams, start]);

  const scopedInvoices = useMemo(() => invoices.filter((row) => {
    const rowBranch = invoiceBranch(row);
    const rowDoctor = invoiceDoctor(row);
    if (branch !== ALL && rowBranch !== branch) return false;
    if (doctor !== ALL && rowDoctor !== doctor) return false;
    return dashboardInvoiceAmount(row as any) > 0 && Boolean(invoiceDate(row));
  }), [branch, doctor, invoices]);

  const dailyRows = useMemo(() => {
    const map = new Map<string, DailyRow>();
    scopedInvoices.forEach((row, index) => {
      const date = invoiceDate(row);
      const rowBranch = invoiceBranch(row);
      const key = `${date}|${rowBranch}`;
      const current = map.get(key) || { date, branch: rowBranch, sales: 0, invoiceIds: new Set<string>(), customers: new Set<string>() };
      current.sales += dashboardInvoiceAmount(row as any);
      current.invoiceIds.add(invoiceId(row, index));
      const customer = customerId(row);
      if (customer) current.customers.add(customer);
      map.set(key, current);
    });
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [scopedInvoices]);

  const doctorRows = useMemo(() => {
    const map = new Map<string, DoctorRow>();
    scopedInvoices.forEach((row, index) => {
      const name = invoiceDoctor(row);
      if (!name) return;
      const rowBranch = invoiceBranch(row);
      const key = `${name}|${rowBranch}`;
      const current = map.get(key) || { doctor: name, branch: rowBranch, sales: 0, invoiceIds: new Set<string>(), customers: new Set<string>() };
      current.sales += dashboardInvoiceAmount(row as any);
      current.invoiceIds.add(invoiceId(row, index));
      const customer = customerId(row);
      if (customer) current.customers.add(customer);
      map.set(key, current);
    });
    return [...map.values()].sort((a, b) => b.sales - a.sales);
  }, [scopedInvoices]);

  const doctors = useMemo(() => [...new Set(invoices.map(invoiceDoctor).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar')), [invoices]);

  const kpis = useMemo(() => {
    const invoiceIds = new Set<string>();
    const customers = new Set<string>();
    let sales = 0;
    scopedInvoices.forEach((row, index) => {
      sales += dashboardInvoiceAmount(row as any);
      invoiceIds.add(invoiceId(row, index));
      const customer = customerId(row);
      if (customer) customers.add(customer);
    });
    return { sales, invoices: invoiceIds.size, customers: customers.size, average: invoiceIds.size ? sales / invoiceIds.size : 0 };
  }, [scopedInvoices]);

  const branchRows = useMemo(() => {
    const map = new Map<string, { branch: string; sales: number; invoiceIds: Set<string> }>();
    dailyRows.forEach((row) => {
      const current = map.get(row.branch) || { branch: row.branch, sales: 0, invoiceIds: new Set<string>() };
      current.sales += row.sales;
      row.invoiceIds.forEach((id) => current.invoiceIds.add(id));
      map.set(row.branch, current);
    });
    return [...map.values()].sort((a, b) => b.sales - a.sales);
  }, [dailyRows]);

  const dailyTrend = useMemo(() => {
    const map = new Map<string, { date: string; sales: number; invoiceIds: Set<string> }>();
    dailyRows.forEach((row) => {
      const current = map.get(row.date) || { date: row.date, sales: 0, invoiceIds: new Set<string>() };
      current.sales += row.sales;
      row.invoiceIds.forEach((id) => current.invoiceIds.add(id));
      map.set(row.date, current);
    });
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [dailyRows]);

  return (
    <div className="space-y-5" dir="rtl">
      <section className="dawaa-card dawaa-card--raised">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="dawaa-title text-2xl">التحليلات والمبيعات</h1>
            <p className="dawaa-caption mt-1 font-bold">قراءة تحليلية موحدة من مصدر المبيعات المعتمد، بنفس مسار الداشبورد.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="dawaa-caption text-xs">آخر تحديث: {lastUpdated || '—'}</span>
            <button onClick={() => void load(true)} disabled={loading} className="dawaa-button dawaa-button--primary disabled:opacity-50">
              <RefreshCw size={17} className={loading ? 'animate-spin' : ''} /> تحديث
            </button>
          </div>
        </div>
      </section>

      <section className="dawaa-card">
        <div className="grid gap-3 md:grid-cols-5">
          <Filter label="نوع الفترة"><select className="dawaa-select" value={periodType} onChange={(event) => applyPeriod(event.target.value as PeriodType)}><option value="cycle">الدورة الحالية</option><option value="previous_cycle">الدورة السابقة</option><option value="month">هذا الشهر</option><option value="last_30_days">آخر 30 يوم</option><option value="custom">مخصص</option></select></Filter>
          <Filter label="بداية الفترة"><input className="dawaa-input" type="date" value={start} onChange={(event) => { setStart(event.target.value); setPeriodType('custom'); }} /></Filter>
          <Filter label="نهاية الفترة"><input className="dawaa-input" type="date" value={end} onChange={(event) => { setEnd(event.target.value); setPeriodType('custom'); }} /></Filter>
          <Filter label="الفرع"><select className="dawaa-select" value={branch} disabled={!canAll} onChange={(event) => setBranch(validBranch(event.target.value))}><option value={ALL}>{ALL}</option>{BRANCHES.map((item) => <option key={item} value={item}>{item}</option>)}</select></Filter>
          <Filter label="الدكتور"><select className="dawaa-select" value={doctor} onChange={(event) => setDoctor(event.target.value)}><option value={ALL}>{ALL}</option>{doctors.map((item) => <option key={item} value={item}>{item}</option>)}</select></Filter>
        </div>
      </section>

      {errors.length > 0 ? (
        <section className="dawaa-alert dawaa-alert--warning text-sm font-bold">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <div><div>ملاحظات التحميل:</div>{errors.map((item, index) => <div key={`${item}-${index}`} className="mt-1 text-xs">• {item}</div>)}</div>
        </section>
      ) : null}

      <section className="grid gap-3 md:grid-cols-4">
        <Kpi icon={TrendingUp} title="صافي المبيعات" value={money(kpis.sales)} />
        <Kpi icon={CalendarDays} title="عدد الفواتير" value={count(kpis.invoices)} />
        <Kpi icon={Store} title="متوسط الفاتورة" value={money(kpis.average)} />
        <Kpi icon={Users} title="العملاء المشترون" value={count(kpis.customers)} />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Panel title="تطور المبيعات اليومي">
          <div className="space-y-2">
            {dailyTrend.slice(-31).map((row) => {
              const max = Math.max(1, ...dailyTrend.map((item) => item.sales));
              return (
                <div key={row.date} className="dawaa-card dawaa-card--soft p-3 shadow-none">
                  <div className="flex justify-between gap-3 text-sm font-bold">
                    <span>{row.date}</span>
                    <span>{money(row.sales)} · {count(row.invoiceIds.size)} فاتورة</span>
                  </div>
                  <div className="progress-bar mt-2"><div className="progress-fill" style={{ width: `${Math.max(2, (row.sales / max) * 100)}%` }} /></div>
                </div>
              );
            })}
            {!dailyTrend.length ? <Empty text={loading ? 'جارٍ تحميل الفواتير...' : 'لا توجد بيانات في الفترة المحددة'} /> : null}
          </div>
        </Panel>

        <Panel title="أداء الفروع">
          <div className="space-y-3">
            {branchRows.map((row) => (
              <div key={row.branch} className="dawaa-card dawaa-card--soft p-4 shadow-none">
                <div className="flex items-center justify-between gap-3">
                  <span className="dawaa-title text-sm">{row.branch}</span>
                  <span className="font-black">{money(row.sales)}</span>
                </div>
                <div className="dawaa-caption mt-2 text-xs">{count(row.invoiceIds.size)} فاتورة · متوسط {money(row.invoiceIds.size ? row.sales / row.invoiceIds.size : 0)}</div>
              </div>
            ))}
            {!branchRows.length ? <Empty text="لا توجد بيانات فروع" /> : null}
          </div>
        </Panel>
      </section>

      <Panel title="أفضل الدكاترة">
        <div className="space-y-2">
          {doctorRows.slice(0, 20).map((row, index) => (
            <div key={`${row.doctor}-${row.branch}`} className="dawaa-card dawaa-card--soft flex items-center justify-between gap-3 p-3 shadow-none">
              <div>
                <div className="dawaa-title text-sm">{index + 1}. {row.doctor}</div>
                <div className="dawaa-caption mt-1 text-xs">{row.branch} · {count(row.invoiceIds.size)} فاتورة · {count(row.customers.size)} عميل</div>
              </div>
              <div className="font-black">{money(row.sales)}</div>
            </div>
          ))}
          {!doctorRows.length ? <Empty text="لا توجد بيانات دكاترة" /> : null}
        </div>
      </Panel>

      <BranchTargetEditor />
    </div>
  );
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="dawaa-caption space-y-1 text-xs font-bold"><span>{label}</span>{children}</label>;
}

function Kpi({ icon: Icon, title, value }: { icon: typeof TrendingUp; title: string; value: string }) {
  return (
    <div className="dawaa-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="dawaa-caption text-sm font-bold">{title}</div>
        <span className="dawaa-icon-tile h-10 w-10"><Icon size={20} /></span>
      </div>
      <div className="dawaa-title mt-3 text-2xl">{value}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="dawaa-card"><h2 className="dawaa-title mb-4 text-lg">{title}</h2>{children}</section>;
}

function Empty({ text }: { text: string }) {
  return <div className="dawaa-empty-state p-6 text-sm font-bold">{text}</div>;
}
