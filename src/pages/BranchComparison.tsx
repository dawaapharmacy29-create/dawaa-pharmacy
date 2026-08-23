import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  BarChart3,
  DollarSign,
  FileText,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Users,
  AlertTriangle,
} from 'lucide-react';
import { getCurrentCycle } from '@/lib/pharmacy-cycle';
import { clearInvoiceCache } from '@/lib/invoiceCache';
import {
  dashboardInvoiceAmount,
  type DashboardInvoiceRow,
} from '@/lib/dashboard/dashboardTruthService';
import { fetchSalesInvoicesPagedSafe } from '@/lib/salesInvoiceQueries';
import { normalizeBranchName } from '@/lib/branch';

const ALL = 'كل الفروع';
const CHART_COLORS = [
  'var(--dawaa-chart-series-1)',
  'var(--dawaa-chart-series-2)',
  'var(--dawaa-chart-series-3)',
  'var(--dawaa-chart-series-4)',
];

type BranchStats = {
  branch: string;
  sales_total: number;
  invoices_count: number;
  avg_invoice: number;
  linked_customers: number;
  daily_avg: number;
  link_rate: number;
  best_day: string | null;
  best_day_sales: number;
};

function money(v: number) {
  return new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 0 }).format(v || 0);
}
function pct(v: number) {
  return `${(v || 0).toFixed(1)}%`;
}
function day(row: DashboardInvoiceRow) {
  return String(row.invoice_date || '').slice(0, 10);
}
function invoiceKey(row: DashboardInvoiceRow) {
  return String(row.invoice_no ?? row.invoice_number ?? row.id ?? '').trim();
}
function customerKey(row: DashboardInvoiceRow) {
  return String(row.customer_code ?? row.customer_name ?? '').trim();
}

function buildStats(rows: DashboardInvoiceRow[]) {
  const branches = new Map<
    string,
    { total: number; keys: Set<string>; customers: Set<string>; days: Map<string, number> }
  >();
  for (const row of rows) {
    const branch = normalizeBranchName(row.branch || '') || 'غير محدد';
    const current = branches.get(branch) || {
      total: 0,
      keys: new Set<string>(),
      customers: new Set<string>(),
      days: new Map<string, number>(),
    };
    const amount = dashboardInvoiceAmount(row);
    const k = invoiceKey(row);
    const c = customerKey(row);
    const d = day(row);
    current.total += amount;
    if (k) current.keys.add(k);
    if (c) current.customers.add(c);
    if (d) current.days.set(d, (current.days.get(d) || 0) + amount);
    branches.set(branch, current);
  }
  const grand = [...branches.values()].reduce((sum, row) => sum + row.total, 0) || 1;
  return [...branches.entries()]
    .map(([branch, row]) => {
      const dayRows = [...row.days.entries()].sort((a, b) => b[1] - a[1]);
      return {
        branch,
        sales_total: row.total,
        invoices_count: row.keys.size,
        avg_invoice: row.keys.size ? row.total / row.keys.size : 0,
        linked_customers: row.customers.size,
        daily_avg: row.days.size ? row.total / row.days.size : row.total,
        link_rate: (row.total / grand) * 100,
        best_day: dayRows[0]?.[0] || null,
        best_day_sales: dayRows[0]?.[1] || 0,
      } satisfies BranchStats;
    })
    .sort((a, b) => b.sales_total - a.sales_total);
}

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="dawaa-card dawaa-card--soft p-3 shadow-none">
      <div className="dawaa-caption mb-1 flex items-center gap-2 text-xs font-bold">
        {icon}
        {label}
      </div>
      <div className="dawaa-title text-sm">{value}</div>
    </div>
  );
}

export default function BranchComparison() {
  const navigate = useNavigate();
  const cycle = getCurrentCycle();
  const [startDate] = useState(() => cycle.start.toISOString().slice(0, 10));
  const [endDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [stats, setStats] = useState<BranchStats[]>([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [rowsRead, setRowsRead] = useState(0);

  const load = useCallback(
    async (noCache = false) => {
      setLoading(true);
      setErrors([]);
      try {
        if (noCache) clearInvoiceCache();
        const errs: string[] = [];
        const rows = (await fetchSalesInvoicesPagedSafe({
          startDate,
          endDate,
          branch: ALL,
          errors: errs,
          noCache,
          pageSize: 1000,
          maxPages: 80,
        })) as DashboardInvoiceRow[];
        setRowsRead(rows.length);
        setStats(buildStats(rows));
        setErrors(errs);
        setLoadedAt(new Date().toLocaleTimeString('ar-EG'));
      } catch (err) {
        setErrors([err instanceof Error ? err.message : 'تعذر تحميل مقارنة الفروع']);
        setStats([]);
      } finally {
        setLoading(false);
      }
    },
    [startDate, endDate]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const [R, setR] = useState<any>(null);
  useEffect(() => {
    let mounted = true;
    import('recharts').then((m) => {
      if (mounted) setR(m);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const BarChart = R?.BarChart ?? (() => <div className="dawaa-card dawaa-card--soft h-56 animate-pulse shadow-none" />);
  const Bar = R?.Bar ?? (() => null);
  const XAxis = R?.XAxis ?? (() => null);
  const YAxis = R?.YAxis ?? (() => null);
  const CartesianGrid = R?.CartesianGrid ?? (() => null);
  const Tooltip = R?.Tooltip ?? (() => null);
  const ResponsiveContainer = R?.ResponsiveContainer ?? (({ children }: any) => <div>{children}</div>);
  const Cell = R?.Cell ?? (() => null);
  const PieChart = R?.PieChart ?? (() => <div className="dawaa-card dawaa-card--soft h-56 animate-pulse shadow-none" />);
  const Pie = R?.Pie ?? (() => null);

  const total = stats.reduce((sum, row) => sum + row.sales_total, 0);
  const winner = stats[0] || null;
  const chartData = stats.map((row) => ({
    name: row.branch,
    المبيعات: row.sales_total,
    الفواتير: row.invoices_count,
    متوسط: Math.round(row.avg_invoice),
  }));

  const tooltipStyle = {
    background: 'var(--dawaa-chart-tooltip-bg)',
    border: '1px solid var(--dawaa-chart-tooltip-border)',
    borderRadius: 12,
    color: 'var(--dawaa-chart-tooltip-text)',
  };

  return (
    <div className="space-y-6 p-4 md:p-6" dir="rtl">
      <section className="dawaa-card dawaa-card--raised">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="dawaa-button dawaa-button--secondary min-h-0 px-3 py-2 text-sm">
              <ArrowLeft className="h-4 w-4" /> رجوع
            </button>
            <div>
              <h1 className="dawaa-title flex items-center gap-2 text-xl">
                <span className="dawaa-icon-tile h-9 w-9"><BarChart3 className="h-5 w-5" /></span>
                مقارنة الفروع
              </h1>
              <p className="dawaa-caption mt-1 text-xs">
                {startDate} → {endDate}
                {loadedAt ? <span className="mr-2">• آخر تحديث: {loadedAt}</span> : null} • مصدر الحقيقة: sales_invoices • قراءة {rowsRead.toLocaleString('ar-EG')} صف
              </p>
            </div>
          </div>
          <button onClick={() => void load(true)} disabled={loading} className="dawaa-button dawaa-button--primary disabled:opacity-60">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> تحديث
          </button>
        </div>
      </section>

      {errors.length > 0 ? (
        <div className="dawaa-alert dawaa-alert--warning text-sm font-bold">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            <div>ملاحظات تحميل</div>
            <ul className="mt-2 list-disc pr-5">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="dawaa-card p-5 md:col-span-2">
          <div className="dawaa-caption text-xs font-bold">إجمالي مبيعات الفترة</div>
          <div className="dawaa-title mt-2 text-4xl">{money(total)} جنيه</div>
          <div className="dawaa-caption mt-2 text-sm font-bold">عدد الفروع المحمّلة: {stats.length}</div>
        </div>
        <div className="dawaa-card p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="dawaa-caption text-xs font-bold">أفضل فرع</div>
            {winner ? <span className="dawaa-badge dawaa-badge--success">متصدر</span> : null}
          </div>
          <div className="dawaa-title mt-2 text-3xl">{winner?.branch || '-'}</div>
          <div className="dawaa-body mt-2 text-sm font-bold">{winner ? `${money(winner.sales_total)} جنيه` : 'لا توجد بيانات'}</div>
        </div>
      </div>

      {loading && !loadedAt ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1].map((i) => <div key={i} className="dawaa-card dawaa-card--soft h-80 animate-pulse shadow-none" />)}
        </div>
      ) : null}

      {stats.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          {stats.map((s, index) => (
            <section key={s.branch} className={`dawaa-card space-y-5 p-6 ${index === 0 ? 'dawaa-card--raised' : ''}`}>
              <div className="flex items-center justify-between gap-3">
                <span className="dawaa-title text-sm">{s.branch}</span>
                <div className="flex items-center gap-2">
                  {index === 0 ? <span className="dawaa-badge dawaa-badge--success">الأعلى</span> : null}
                  <span className="dawaa-source-badge">{pct(s.link_rate)} من الإجمالي</span>
                </div>
              </div>
              <div>
                <p className="dawaa-caption text-xs">صافي المبيعات</p>
                <p className="dawaa-title mt-1 text-3xl">{money(s.sales_total)} <span className="dawaa-caption text-base">جنيه</span></p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Kpi icon={<FileText className="h-4 w-4" />} label="الفواتير" value={money(s.invoices_count)} />
                <Kpi icon={<DollarSign className="h-4 w-4" />} label="متوسط الفاتورة" value={`${money(s.avg_invoice)} ج`} />
                <Kpi icon={<Users className="h-4 w-4" />} label="عملاء مشترين" value={money(s.linked_customers)} />
                <Kpi icon={<TrendingUp className="h-4 w-4" />} label="متوسط يومي" value={`${money(s.daily_avg)} ج`} />
              </div>
              <Kpi icon={<ShieldCheck className="h-4 w-4" />} label="أفضل يوم" value={s.best_day ? `${s.best_day} — ${money(s.best_day_sales)} ج` : '-'} />
            </section>
          ))}
        </div>
      ) : null}

      {stats.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="dawaa-card p-6 lg:col-span-2">
            <h2 className="dawaa-title mb-4 flex items-center gap-2 text-base"><BarChart3 className="h-5 w-5" /> مقارنة المبيعات بين الفروع</h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--dawaa-chart-grid)" />
                <XAxis dataKey="name" tick={{ fill: 'var(--dawaa-chart-axis)', fontSize: 12 }} />
                <YAxis tick={{ fill: 'var(--dawaa-chart-axis)', fontSize: 11 }} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={tooltipStyle} formatter={(value: number, name: string) => [name === 'المبيعات' ? `${money(value)} ج` : money(value), name]} />
                <Bar dataKey="المبيعات" radius={[8, 8, 0, 0]}>
                  {chartData.map((entry, i) => <Cell key={entry.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </section>

          <section className="dawaa-card p-6">
            <h2 className="dawaa-title mb-4 text-base">نسبة مساهمة الفروع</h2>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={stats.map((s) => ({ name: s.branch, value: s.sales_total }))} dataKey="value" nameKey="name" outerRadius={95} label={(row) => `${row.name} ${pct((Number(row.value) / (total || 1)) * 100)}`}>
                  {stats.map((entry, i) => <Cell key={entry.branch} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => `${money(value)} ج`} />
              </PieChart>
            </ResponsiveContainer>
          </section>
        </div>
      ) : null}

      {stats.length > 0 ? (
        <section className="dawaa-card p-6">
          <h2 className="dawaa-title mb-4 flex items-center gap-2 text-base"><ShieldCheck className="h-5 w-5" /> مقارنة تفصيلية دقيقة</h2>
          <div className="dawaa-table-shell shadow-none">
            <table className="dawaa-table-semantic min-w-[900px] text-sm">
              <thead><tr><th className="text-right">المؤشر</th>{stats.map((s) => <th key={s.branch} className="text-right">{s.branch}</th>)}</tr></thead>
              <tbody>
                {[
                  ['المبيعات (جنيه)', (s: BranchStats) => money(s.sales_total)],
                  ['عدد الفواتير', (s: BranchStats) => money(s.invoices_count)],
                  ['متوسط الفاتورة', (s: BranchStats) => `${money(s.avg_invoice)} ج`],
                  ['العملاء المشترين', (s: BranchStats) => money(s.linked_customers)],
                  ['متوسط يومي', (s: BranchStats) => `${money(s.daily_avg)} ج`],
                  ['نسبة المساهمة', (s: BranchStats) => pct(s.link_rate)],
                  ['أفضل يوم', (s: BranchStats) => s.best_day || '-'],
                ].map(([label, fn]) => (
                  <tr key={String(label)}><td className="font-black">{String(label)}</td>{stats.map((s) => <td key={s.branch} className="font-bold">{(fn as (s: BranchStats) => string)(s)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
