import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Bell,
  ClipboardList,
  FileSpreadsheet,
  Headphones,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';

type SectionKey =
  | 'sales'
  | 'branches'
  | 'customers'
  | 'staff'
  | 'operations'
  | 'incentives'
  | 'alerts'
  | 'invoices';

type SectionState<T> = {
  loading: boolean;
  data: T | null;
  error: string | null;
  updatedAt: string | null;
};

type SalesData = {
  totalSales: number;
  invoiceCount: number;
  avgInvoice: number;
  linkedInvoices: number;
  cashInvoices: number;
  deliveryInvoices: number;
  sampleSize: number;
};

type BranchData = Array<{ branch: string; sales: number; invoices: number; avg: number }>;
type CustomerData = { followups: number; completed: number; needsManager: number; owners: Array<{ name: string; count: number }> };
type StaffData = { staff: number; activeAccounts: number; disabledAccounts: number; doctors: number; delivery: number };
type OperationsData = { attendanceRows: number; recentActivities: number; importedInvoices: number };
type IncentiveData = { rows: number; stagnant: number; incentiveItems: number };
type AlertData = Array<{ title: string; body: string; createdAt?: string | null }>;
type InvoiceData = Array<{ number: string; branch: string; amount: number; date: string; seller: string }>;

type DashboardSections = {
  sales: SectionState<SalesData>;
  branches: SectionState<BranchData>;
  customers: SectionState<CustomerData>;
  staff: SectionState<StaffData>;
  operations: SectionState<OperationsData>;
  incentives: SectionState<IncentiveData>;
  alerts: SectionState<AlertData>;
  invoices: SectionState<InvoiceData>;
};

const ALL_BRANCHES = 'كل الفروع';
const SECTION_TIMEOUT_MS = 7000;

function emptySection<T>(): SectionState<T> {
  return { loading: true, data: null, error: null, updatedAt: null };
}

const initialSections: DashboardSections = {
  sales: emptySection<SalesData>(),
  branches: emptySection<BranchData>(),
  customers: emptySection<CustomerData>(),
  staff: emptySection<StaffData>(),
  operations: emptySection<OperationsData>(),
  incentives: emptySection<IncentiveData>(),
  alerts: emptySection<AlertData>(),
  invoices: emptySection<InvoiceData>(),
};

function n(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown) {
  return n(value).toLocaleString('ar-EG', { maximumFractionDigits: 0 });
}

function count(value: unknown) {
  return n(value).toLocaleString('ar-EG', { maximumFractionDigits: 0 });
}

function asArray<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

function branchName(value: unknown) {
  return normalizeBranchName(String(value || '').trim()) || 'غير محدد';
}

function getAmount(row: Record<string, unknown>) {
  return n(row.net_amount ?? row.amount ?? row.total_amount ?? row.sales_total ?? row.value ?? row.total ?? 0);
}

function getInvoiceDate(row: Record<string, unknown>) {
  return String(row.invoice_date ?? row.sale_date ?? row.date ?? row.created_at ?? '').slice(0, 10);
}

function getInvoiceNumber(row: Record<string, unknown>) {
  return String(row.invoice_number ?? row.invoice_no ?? row.number ?? row.id ?? '-');
}

function getSeller(row: Record<string, unknown>) {
  return String(row.seller_name ?? row.doctor_name ?? row.staff_name ?? row.created_by ?? 'غير محدد');
}

function isLinkedInvoice(row: Record<string, unknown>) {
  const customerCode = String(row.customer_code ?? '').trim();
  const customerName = String(row.customer_name ?? '').trim();
  return Boolean(customerCode && customerCode !== '0' && !customerName.includes('غير مسجل'));
}

function isInSelectedBranch(row: Record<string, unknown>, branch: string) {
  if (branch === ALL_BRANCHES) return true;
  return branchName(row.branch) === branchName(branch);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs = SECTION_TIMEOUT_MS, label = 'section'): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) window.clearTimeout(timeoutId);
  });
}

async function queryRows<T = Record<string, unknown>>(table: string, limit = 250, orderColumn?: string) {
  let query = supabase.from(table).select('*').limit(limit);
  if (orderColumn) query = query.order(orderColumn, { ascending: false });
  const { data, error } = await query;
  if (error) throw error;
  return asArray<T>(data);
}

function buildCycleRange() {
  const now = new Date();
  const cycleStart = new Date(now);
  if (now.getDate() >= 26) {
    cycleStart.setDate(26);
  } else {
    cycleStart.setMonth(cycleStart.getMonth() - 1, 26);
  }
  const cycleEnd = new Date(cycleStart);
  cycleEnd.setMonth(cycleEnd.getMonth() + 1, 25);
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { start: fmt(cycleStart), end: fmt(cycleEnd) };
}

function sectionLabel(key: SectionKey) {
  const labels: Record<SectionKey, string> = {
    sales: 'المبيعات',
    branches: 'أداء الفروع',
    customers: 'خدمة العملاء',
    staff: 'الموظفين',
    operations: 'التشغيل والحضور',
    incentives: 'الحوافز والرواكد',
    alerts: 'التنبيهات',
    invoices: 'الفواتير',
  };
  return labels[key];
}

function LoadingLine() {
  return <div className="h-4 w-32 animate-pulse rounded-full bg-slate-700" />;
}

function StatusPill({ state }: { state: SectionState<unknown> }) {
  if (state.loading) return <span className="rounded-full bg-sky-400/10 px-3 py-1 text-xs font-black text-sky-200">تحميل</span>;
  if (state.error) return <span className="rounded-full bg-rose-400/10 px-3 py-1 text-xs font-black text-rose-200">تعذر التحميل</span>;
  return <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-black text-emerald-200">جاهز</span>;
}

function SectionCard({
  title,
  icon,
  state,
  onRetry,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  state: SectionState<unknown>;
  onRetry: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-cyan-300/10 bg-[#0b1d31]/90 p-5 shadow-[0_18px_80px_rgba(0,0,0,0.22)]" dir="rtl">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-cyan-400/10 p-3 text-cyan-200">{icon}</div>
          <div>
            <h2 className="text-lg font-black text-white">{title}</h2>
            <p className="mt-1 text-xs font-bold text-slate-400">آخر تحديث: {state.updatedAt ? new Date(state.updatedAt).toLocaleTimeString('ar-EG') : 'لم يكتمل بعد'}</p>
          </div>
        </div>
        <StatusPill state={state} />
      </div>
      {state.error ? (
        <div className="rounded-2xl border border-rose-300/20 bg-rose-500/10 p-4 text-sm font-bold text-rose-100">
          تعذر تحميل بيانات {title}: {state.error}
          <button onClick={onRetry} className="mt-3 block rounded-xl bg-rose-500 px-4 py-2 text-xs font-black text-white hover:bg-rose-400">
            إعادة المحاولة
          </button>
        </div>
      ) : state.loading ? (
        <div className="space-y-3">
          <LoadingLine />
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="h-24 animate-pulse rounded-2xl bg-slate-800" />
            <div className="h-24 animate-pulse rounded-2xl bg-slate-800" />
            <div className="h-24 animate-pulse rounded-2xl bg-slate-800" />
          </div>
        </div>
      ) : (
        children
      )}
    </section>
  );
}

function MiniMetric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-cyan-300/10 bg-slate-950/40 p-4">
      <div className="text-xs font-bold text-slate-400">{label}</div>
      <div className="mt-2 text-2xl font-black text-white">{value}</div>
      {hint ? <div className="mt-1 text-xs font-bold text-emerald-300">{hint}</div> : null}
    </div>
  );
}

export default function ExecutiveDashboardAdvancedStable() {
  const { user } = useAuth();
  const range = useMemo(() => buildCycleRange(), []);
  const [branch, setBranch] = useState(ALL_BRANCHES);
  const [sections, setSections] = useState<DashboardSections>(initialSections);
  const loadTokenRef = useRef(0);

  const setSection = useCallback(<K extends SectionKey>(key: K, patch: Partial<DashboardSections[K]>) => {
    setSections((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }, []);

  const loadSalesAndBranches = useCallback(async (token: number) => {
    setSection('sales', { loading: true, error: null });
    setSection('branches', { loading: true, error: null });
    setSection('invoices', { loading: true, error: null });
    try {
      const rows = await withTimeout(queryRows<Record<string, unknown>>('sales_invoices', 700, 'created_at'), SECTION_TIMEOUT_MS, 'sales_invoices');
      if (loadTokenRef.current !== token) return;
      const filtered = rows.filter((row) => isInSelectedBranch(row, branch)).filter((row) => getAmount(row) >= 0);
      const invoiceCount = filtered.length;
      const totalSales = filtered.reduce((sum, row) => sum + getAmount(row), 0);
      const linkedInvoices = filtered.filter(isLinkedInvoice).length;
      const cashInvoices = filtered.filter((row) => !String(row.delivery_type ?? row.order_type ?? '').includes('توصيل')).length;
      const deliveryInvoices = Math.max(0, invoiceCount - cashInvoices);
      const branchMap = new Map<string, { branch: string; sales: number; invoices: number; avg: number }>();
      filtered.forEach((row) => {
        const b = branchName(row.branch);
        const current = branchMap.get(b) || { branch: b, sales: 0, invoices: 0, avg: 0 };
        current.sales += getAmount(row);
        current.invoices += 1;
        current.avg = current.invoices ? current.sales / current.invoices : 0;
        branchMap.set(b, current);
      });
      const now = new Date().toISOString();
      setSection('sales', {
        loading: false,
        data: { totalSales, invoiceCount, avgInvoice: invoiceCount ? totalSales / invoiceCount : 0, linkedInvoices, cashInvoices, deliveryInvoices, sampleSize: rows.length },
        updatedAt: now,
      });
      setSection('branches', { loading: false, data: [...branchMap.values()].sort((a, b) => b.sales - a.sales), updatedAt: now });
      setSection('invoices', {
        loading: false,
        updatedAt: now,
        data: filtered.slice(0, 12).map((row) => ({
          number: getInvoiceNumber(row),
          branch: branchName(row.branch),
          amount: getAmount(row),
          date: getInvoiceDate(row),
          seller: getSeller(row),
        })),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setSection('sales', { loading: false, error: msg });
      setSection('branches', { loading: false, error: msg });
      setSection('invoices', { loading: false, error: msg });
    }
  }, [branch, setSection]);

  const loadCustomers = useCallback(async (token: number) => {
    setSection('customers', { loading: true, error: null });
    try {
      const rows = await withTimeout(queryRows<Record<string, unknown>>('daily_followups', 500, 'created_at'), SECTION_TIMEOUT_MS, 'daily_followups');
      if (loadTokenRef.current !== token) return;
      const filtered = rows.filter((row) => isInSelectedBranch(row, branch));
      const completed = filtered.filter((row) => String(row.status ?? row.followup_status ?? '').includes('تم') || row.completed_at).length;
      const needsManager = filtered.filter((row) => row.needs_manager === true || String(row.status ?? '').includes('مدير')).length;
      const ownerMap = new Map<string, number>();
      filtered.forEach((row) => {
        const name = String(row.responsible_name ?? row.assigned_to ?? row.assigned_doctor ?? 'غير محدد');
        ownerMap.set(name, (ownerMap.get(name) || 0) + 1);
      });
      setSection('customers', {
        loading: false,
        updatedAt: new Date().toISOString(),
        data: { followups: filtered.length, completed, needsManager, owners: [...ownerMap.entries()].map(([name, count]) => ({ name, count })).slice(0, 8) },
      });
    } catch (error) {
      setSection('customers', { loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  }, [branch, setSection]);

  const loadStaff = useCallback(async (token: number) => {
    setSection('staff', { loading: true, error: null });
    try {
      const [staffRows, accountsRows] = await withTimeout(
        Promise.all([
          queryRows<Record<string, unknown>>('staff', 500, 'created_at'),
          queryRows<Record<string, unknown>>('staff_accounts', 500, 'created_at'),
        ]),
        SECTION_TIMEOUT_MS,
        'staff and accounts'
      );
      if (loadTokenRef.current !== token) return;
      const scopedStaff = staffRows.filter((row) => isInSelectedBranch(row, branch));
      const doctors = scopedStaff.filter((row) => /صيد|دكتور|doctor|pharmacist/i.test(String(row.role ?? row.staff_role ?? ''))).length;
      const delivery = scopedStaff.filter((row) => /توصيل|دليفري|delivery/i.test(String(row.role ?? row.staff_role ?? ''))).length;
      const activeAccounts = accountsRows.filter((row) => row.active !== false && row.can_login !== false).length;
      setSection('staff', {
        loading: false,
        updatedAt: new Date().toISOString(),
        data: { staff: scopedStaff.length, activeAccounts, disabledAccounts: Math.max(0, accountsRows.length - activeAccounts), doctors, delivery },
      });
    } catch (error) {
      setSection('staff', { loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  }, [branch, setSection]);

  const loadOperations = useCallback(async (token: number) => {
    setSection('operations', { loading: true, error: null });
    try {
      const [attendanceRows, activityRows] = await withTimeout(
        Promise.allSettled([
          queryRows<Record<string, unknown>>('attendance', 200, 'created_at'),
          queryRows<Record<string, unknown>>('activity_log', 100, 'created_at'),
        ]),
        SECTION_TIMEOUT_MS,
        'operations'
      );
      if (loadTokenRef.current !== token) return;
      const attendance = attendanceRows.status === 'fulfilled' ? attendanceRows.value.filter((row) => isInSelectedBranch(row, branch)).length : 0;
      const activities = activityRows.status === 'fulfilled' ? activityRows.value.length : 0;
      setSection('operations', { loading: false, updatedAt: new Date().toISOString(), data: { attendanceRows: attendance, recentActivities: activities, importedInvoices: 0 } });
    } catch (error) {
      setSection('operations', { loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  }, [branch, setSection]);

  const loadIncentives = useCallback(async (token: number) => {
    setSection('incentives', { loading: true, error: null });
    try {
      const results = await withTimeout(
        Promise.allSettled([
          queryRows<Record<string, unknown>>('stagnant_medicines', 100, 'created_at'),
          queryRows<Record<string, unknown>>('incentive_medicines', 100, 'created_at'),
        ]),
        SECTION_TIMEOUT_MS,
        'incentives'
      );
      if (loadTokenRef.current !== token) return;
      const stagnant = results[0].status === 'fulfilled' ? results[0].value.length : 0;
      const incentiveItems = results[1].status === 'fulfilled' ? results[1].value.length : 0;
      setSection('incentives', { loading: false, updatedAt: new Date().toISOString(), data: { rows: stagnant + incentiveItems, stagnant, incentiveItems } });
    } catch (error) {
      setSection('incentives', { loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  }, [setSection]);

  const loadAlerts = useCallback(async (token: number) => {
    setSection('alerts', { loading: true, error: null });
    try {
      const rows = await withTimeout(queryRows<Record<string, unknown>>('notifications', 50, 'created_at'), SECTION_TIMEOUT_MS, 'notifications');
      if (loadTokenRef.current !== token) return;
      setSection('alerts', {
        loading: false,
        updatedAt: new Date().toISOString(),
        data: rows.slice(0, 8).map((row) => ({
          title: String(row.title ?? row.type ?? 'تنبيه'),
          body: String(row.body ?? row.message ?? row.description ?? 'بدون تفاصيل'),
          createdAt: String(row.created_at ?? ''),
        })),
      });
    } catch (error) {
      setSection('alerts', { loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  }, [setSection]);

  const loadAll = useCallback(() => {
    const token = ++loadTokenRef.current;
    setSections(initialSections);
    void loadSalesAndBranches(token);
    void loadCustomers(token);
    void loadStaff(token);
    void loadOperations(token);
    void loadIncentives(token);
    void loadAlerts(token);
  }, [loadAlerts, loadCustomers, loadIncentives, loadOperations, loadSalesAndBranches, loadStaff]);

  useEffect(() => {
    loadAll();
    return () => {
      loadTokenRef.current += 1;
    };
  }, [loadAll]);

  const failedSections = (Object.keys(sections) as SectionKey[]).filter((key) => Boolean(sections[key].error));
  const readySections = (Object.keys(sections) as SectionKey[]).filter((key) => Boolean(sections[key].updatedAt));
  const loadingSections = (Object.keys(sections) as SectionKey[]).filter((key) => sections[key].loading);
  const sales = sections.sales.data;
  const customers = sections.customers.data;
  const staff = sections.staff.data;
  const operations = sections.operations.data;

  return (
    <main className="space-y-6 text-slate-100" dir="rtl">
      <section className="rounded-3xl border border-cyan-300/15 bg-[#0b1d31]/95 p-6 shadow-[0_18px_80px_rgba(0,0,0,0.28)]">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-300/15 bg-cyan-400/10 px-4 py-2 text-xs font-black text-cyan-100">
              Dawaa Pharmacy 2027 · Advanced Stable
            </div>
            <h1 className="text-4xl font-black tracking-tight text-white md:text-5xl">مركز القيادة التشغيلي</h1>
            <p className="mt-3 max-w-3xl text-sm font-bold leading-7 text-slate-300">
              نسخة متقدمة مستقرة: كل قسم يحمل بياناته مستقلًا، وأي خطأ يظهر داخل القسم فقط بدون تعطيل التطبيق.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[420px]">
            <select value={branch} onChange={(event) => setBranch(event.target.value)} className="rounded-2xl border border-cyan-300/15 bg-slate-950 px-4 py-3 text-sm font-black text-white">
              <option>{ALL_BRANCHES}</option>
              <option>فرع شكري</option>
              <option>فرع الشامي</option>
            </select>
            <button onClick={loadAll} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-teal-600 px-4 py-3 text-sm font-black text-white hover:bg-teal-500">
              <RefreshCw size={16} /> تحديث كل الأقسام
            </button>
            <Link to="/diagnostics" className="rounded-2xl border border-slate-700 px-4 py-3 text-center text-sm font-black text-slate-200 hover:bg-slate-800">
              فتح التشخيص
            </Link>
            <Link to="/executive-2027?_safe=1" className="rounded-2xl border border-amber-400/30 px-4 py-3 text-center text-sm font-black text-amber-100 hover:bg-amber-400/10">
              وضع الأمان
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MiniMetric label="إجمالي المبيعات" value={sales ? `${money(sales.totalSales)} ج` : '...'} hint="من عينة محدودة آمنة" />
        <MiniMetric label="عدد الفواتير" value={sales ? count(sales.invoiceCount) : '...'} hint={`الدورة ${range.start} إلى ${range.end}`} />
        <MiniMetric label="متوسط الفاتورة" value={sales ? `${money(sales.avgInvoice)} ج` : '...'} hint="محسوب تدريجيًا" />
        <MiniMetric label="متابعات العملاء" value={customers ? count(customers.followups) : '...'} hint="تحميل مستقل" />
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <SectionCard title="المبيعات والفواتير" icon={<TrendingUp size={22} />} state={sections.sales} onRetry={() => loadSalesAndBranches(++loadTokenRef.current)}>
          <div className="grid gap-3 sm:grid-cols-3">
            <MiniMetric label="مبيعات" value={`${money(sales?.totalSales)} ج`} />
            <MiniMetric label="فواتير" value={count(sales?.invoiceCount)} />
            <MiniMetric label="ربط العملاء" value={`${sales?.invoiceCount ? Math.round((n(sales.linkedInvoices) / n(sales.invoiceCount)) * 100) : 0}%`} />
          </div>
        </SectionCard>

        <SectionCard title="أداء الفروع" icon={<ShieldCheck size={22} />} state={sections.branches} onRetry={() => loadSalesAndBranches(++loadTokenRef.current)}>
          <div className="space-y-3">
            {(sections.branches.data || []).slice(0, 5).map((row) => (
              <div key={row.branch} className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                <span className="font-black text-white">{row.branch}</span>
                <span className="text-sm font-bold text-teal-200">{money(row.sales)} ج · {count(row.invoices)} فاتورة</span>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="خدمة العملاء" icon={<Headphones size={22} />} state={sections.customers} onRetry={() => loadCustomers(++loadTokenRef.current)}>
          <div className="grid gap-3 sm:grid-cols-3">
            <MiniMetric label="متابعات" value={count(customers?.followups)} />
            <MiniMetric label="مكتملة" value={count(customers?.completed)} />
            <MiniMetric label="تحتاج مدير" value={count(customers?.needsManager)} />
          </div>
        </SectionCard>

        <SectionCard title="الموظفين والحسابات" icon={<Users size={22} />} state={sections.staff} onRetry={() => loadStaff(++loadTokenRef.current)}>
          <div className="grid gap-3 sm:grid-cols-3">
            <MiniMetric label="الموظفين" value={count(staff?.staff)} />
            <MiniMetric label="حسابات نشطة" value={count(staff?.activeAccounts)} />
            <MiniMetric label="الدكاترة" value={count(staff?.doctors)} />
          </div>
        </SectionCard>

        <SectionCard title="التشغيل والحضور" icon={<ClipboardList size={22} />} state={sections.operations} onRetry={() => loadOperations(++loadTokenRef.current)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <MiniMetric label="سجلات حضور" value={count(operations?.attendanceRows)} />
            <MiniMetric label="آخر أنشطة" value={count(operations?.recentActivities)} />
          </div>
        </SectionCard>

        <SectionCard title="الحوافز والرواكد" icon={<Wallet size={22} />} state={sections.incentives} onRetry={() => loadIncentives(++loadTokenRef.current)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <MiniMetric label="رواكد" value={count(sections.incentives.data?.stagnant)} />
            <MiniMetric label="أصناف حافز" value={count(sections.incentives.data?.incentiveItems)} />
          </div>
        </SectionCard>
      </div>

      <section className="grid gap-5 xl:grid-cols-2">
        <SectionCard title="آخر التنبيهات" icon={<Bell size={22} />} state={sections.alerts} onRetry={() => loadAlerts(++loadTokenRef.current)}>
          <div className="space-y-3">
            {(sections.alerts.data || []).length ? (sections.alerts.data || []).map((alert, index) => (
              <div key={`${alert.title}-${index}`} className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                <div className="font-black text-white">{alert.title}</div>
                <div className="mt-1 text-xs font-bold text-slate-400">{alert.body}</div>
              </div>
            )) : <div className="text-sm font-bold text-slate-400">لا توجد تنبيهات حديثة.</div>}
          </div>
        </SectionCard>

        <SectionCard title="أحدث الفواتير" icon={<FileSpreadsheet size={22} />} state={sections.invoices} onRetry={() => loadSalesAndBranches(++loadTokenRef.current)}>
          <div className="space-y-3">
            {(sections.invoices.data || []).slice(0, 6).map((row) => (
              <div key={`${row.number}-${row.date}`} className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/40 p-3 text-sm">
                <div>
                  <div className="font-black text-white">#{row.number}</div>
                  <div className="text-xs font-bold text-slate-400">{row.branch} · {row.seller}</div>
                </div>
                <div className="font-black text-teal-200">{money(row.amount)} ج</div>
              </div>
            ))}
          </div>
        </SectionCard>
      </section>

      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
        <div className="mb-4 flex items-center gap-2 text-white">
          <AlertTriangle size={20} className="text-amber-200" />
          <h2 className="text-lg font-black">حالة تحميل لوحة القيادة</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <MiniMetric label="أقسام جاهزة" value={count(readySections.length)} />
          <MiniMetric label="أقسام تحمل" value={count(loadingSections.length)} />
          <MiniMetric label="أقسام فشلت" value={count(failedSections.length)} />
          <MiniMetric label="المستخدم" value={user?.name || 'غير محدد'} />
        </div>
        {failedSections.length ? (
          <div className="mt-4 rounded-2xl border border-rose-300/20 bg-rose-500/10 p-4 text-sm font-bold text-rose-100">
            الأقسام التي تحتاج مراجعة: {failedSections.map(sectionLabel).join('، ')}
          </div>
        ) : null}
      </section>
    </main>
  );
}
