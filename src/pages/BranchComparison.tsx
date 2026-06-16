import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, BarChart3, DollarSign, FileText, RefreshCw, ShieldCheck, TrendingUp, Users, AlertTriangle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from "recharts";
import { getCurrentCycle } from "@/lib/pharmacy-cycle";
import { clearInvoiceCache } from "@/lib/invoiceCache";
import { dashboardInvoiceAmount, dashboardNumber, type DashboardInvoiceRow } from "@/lib/dashboard/dashboardTruthService";
import { fetchSalesInvoicesPagedSafe } from "@/lib/salesInvoiceQueries";
import { normalizeBranchName } from "@/lib/branch";
import { cn } from "@/lib/utils";

const ALL = "كل الفروع";
const CHART_COLORS = ["#22d3ee", "#a78bfa", "#34d399", "#f59e0b"];

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
  return new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 0 }).format(v || 0);
}
function pct(v: number) { return `${(v || 0).toFixed(1)}%`; }
function day(row: DashboardInvoiceRow) { return String(row.invoice_date || "").slice(0, 10); }
function invoiceKey(row: DashboardInvoiceRow) { return String(row.invoice_no ?? row.invoice_number ?? row.id ?? "").trim(); }
function customerKey(row: DashboardInvoiceRow) { return String(row.customer_code ?? row.customer_name ?? "").trim(); }

function buildStats(rows: DashboardInvoiceRow[]) {
  const branches = new Map<string, { total: number; keys: Set<string>; customers: Set<string>; days: Map<string, number> }>();
  for (const row of rows) {
    const branch = normalizeBranchName(row.branch || "") || "غير محدد";
    const current = branches.get(branch) || { total: 0, keys: new Set<string>(), customers: new Set<string>(), days: new Map<string, number>() };
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
  return [...branches.entries()].map(([branch, row]) => {
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
  }).sort((a, b) => b.sales_total - a.sales_total);
}

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="rounded-2xl bg-slate-950/30 p-3"><div className="mb-1 flex items-center gap-2 text-xs font-bold text-slate-400">{icon}{label}</div><div className="font-black text-white">{value}</div></div>;
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

  const load = useCallback(async (noCache = false) => {
    setLoading(true);
    setErrors([]);
    try {
      if (noCache) clearInvoiceCache();
      const errs: string[] = [];
      const rows = await fetchSalesInvoicesPagedSafe({ startDate, endDate, branch: ALL, errors: errs, noCache, pageSize: 1000, maxPages: 80 }) as DashboardInvoiceRow[];
      setRowsRead(rows.length);
      setStats(buildStats(rows));
      setErrors(errs);
      setLoadedAt(new Date().toLocaleTimeString("ar-EG"));
    } catch (err) {
      setErrors([err instanceof Error ? err.message : "تعذر تحميل مقارنة الفروع"]);
      setStats([]);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => { void load(); }, [load]);

  const total = stats.reduce((sum, row) => sum + row.sales_total, 0);
  const winner = stats[0] || null;
  const chartData = stats.map((row) => ({ name: row.branch, المبيعات: row.sales_total, الفواتير: row.invoices_count, متوسط: Math.round(row.avg_invoice) }));

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4 md:p-6 space-y-6" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="flex items-center gap-1 rounded-xl bg-slate-800/60 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700/60"><ArrowLeft className="h-4 w-4" />رجوع</button>
          <div>
            <h1 className="flex items-center gap-2 text-xl font-black text-white"><BarChart3 className="h-5 w-5 text-cyan-400" />مقارنة الفروع</h1>
            <p className="text-xs text-slate-400">{startDate} → {endDate}{loadedAt && <span className="mr-2">• آخر تحديث: {loadedAt}</span>} • مصدر الحقيقة: sales_invoices • قراءة {rowsRead.toLocaleString("ar-EG")} صف</p>
          </div>
        </div>
        <button onClick={() => void load(true)} disabled={loading} className="flex items-center gap-2 rounded-xl bg-cyan-500/20 px-4 py-2 text-sm font-bold text-cyan-100 ring-1 ring-cyan-300/30 hover:bg-cyan-500/30 disabled:opacity-60"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />تحديث</button>
      </div>

      {errors.length > 0 && <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm font-bold text-amber-100"><div className="flex items-center gap-2"><AlertTriangle size={16} />ملاحظات تحميل</div><ul className="mt-2 list-disc pr-5">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-3xl border border-teal-400/30 bg-teal-500/10 p-5 md:col-span-2"><div className="text-xs font-bold text-slate-400">إجمالي مبيعات الفترة</div><div className="mt-2 text-4xl font-black text-teal-200">{money(total)} جنيه</div><div className="mt-2 text-sm font-bold text-slate-400">عدد الفروع المحمّلة: {stats.length}</div></div>
        <div className="rounded-3xl border border-amber-400/30 bg-amber-500/10 p-5"><div className="text-xs font-bold text-slate-400">أفضل فرع</div><div className="mt-2 text-3xl font-black text-amber-200">{winner?.branch || "-"}</div><div className="mt-2 text-sm font-bold text-slate-300">{winner ? `${money(winner.sales_total)} جنيه` : "لا توجد بيانات"}</div></div>
      </div>

      {loading && !loadedAt ? <div className="grid gap-4 md:grid-cols-2">{[0, 1].map((i) => <div key={i} className="h-80 animate-pulse rounded-3xl bg-slate-800/60" />)}</div> : null}

      {stats.length > 0 && <div className="grid gap-4 md:grid-cols-2">{stats.map((s, index) => (
        <div key={s.branch} className={cn("rounded-3xl border p-6 space-y-5", index === 0 ? "border-cyan-400/50 bg-cyan-500/10 ring-2 ring-amber-400/25" : "border-violet-400/40 bg-violet-500/10")}>
          <div className="flex items-center justify-between"><span className="rounded-2xl bg-white/10 px-3 py-1 text-sm font-black text-white">{s.branch}</span><span className="text-xs font-bold text-teal-200">{pct(s.link_rate)} من الإجمالي</span></div>
          <div><p className="text-xs text-slate-400">صافي المبيعات</p><p className="text-3xl font-black text-white">{money(s.sales_total)} <span className="text-base text-slate-400">جنيه</span></p></div>
          <div className="grid grid-cols-2 gap-3">
            <Kpi icon={<FileText className="h-4 w-4" />} label="الفواتير" value={money(s.invoices_count)} />
            <Kpi icon={<DollarSign className="h-4 w-4" />} label="متوسط الفاتورة" value={`${money(s.avg_invoice)} ج`} />
            <Kpi icon={<Users className="h-4 w-4" />} label="عملاء مشترين" value={money(s.linked_customers)} />
            <Kpi icon={<TrendingUp className="h-4 w-4" />} label="متوسط يومي" value={`${money(s.daily_avg)} ج`} />
          </div>
          <Kpi icon={<ShieldCheck className="h-4 w-4" />} label="أفضل يوم" value={s.best_day ? `${s.best_day} — ${money(s.best_day_sales)} ج` : "-"} />
        </div>
      ))}</div>}

      {stats.length > 0 && <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-3xl border border-slate-700/50 bg-slate-900/60 p-6 lg:col-span-2"><h2 className="mb-4 flex items-center gap-2 font-black text-white"><BarChart3 className="h-5 w-5 text-cyan-400" />مقارنة المبيعات بين الفروع</h2><ResponsiveContainer width="100%" height={300}><BarChart data={chartData}><CartesianGrid strokeDasharray="3 3" stroke="#334155" /><XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 12 }} /><YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} /><Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 12, color: "#f1f5f9" }} formatter={(value: number, name: string) => [name === "المبيعات" ? `${money(value)} ج` : money(value), name]} /><Bar dataKey="المبيعات" radius={[8, 8, 0, 0]}>{chartData.map((entry, i) => <Cell key={entry.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}</Bar></BarChart></ResponsiveContainer></div>
        <div className="rounded-3xl border border-slate-700/50 bg-slate-900/60 p-6"><h2 className="mb-4 font-black text-white">نسبة مساهمة الفروع</h2><ResponsiveContainer width="100%" height={250}><PieChart><Pie data={stats.map((s) => ({ name: s.branch, value: s.sales_total }))} dataKey="value" nameKey="name" outerRadius={95} label={(row) => `${row.name} ${pct((Number(row.value) / (total || 1)) * 100)}`}>{stats.map((entry, i) => <Cell key={entry.branch} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}</Pie><Tooltip formatter={(value: number) => `${money(value)} ج`} /></PieChart></ResponsiveContainer></div>
      </div>}

      {stats.length > 0 && <div className="overflow-x-auto rounded-3xl border border-slate-700/50 bg-slate-900/60 p-6"><h2 className="mb-4 flex items-center gap-2 font-black text-white"><ShieldCheck className="h-5 w-5 text-cyan-400" />مقارنة تفصيلية دقيقة</h2><table className="w-full min-w-[900px] text-sm"><thead><tr className="border-b border-slate-700 text-right text-slate-400"><th className="p-3">المؤشر</th>{stats.map((s) => <th key={s.branch} className="p-3">{s.branch}</th>)}</tr></thead><tbody>{[
        ["المبيعات (جنيه)", (s: BranchStats) => money(s.sales_total)], ["عدد الفواتير", (s: BranchStats) => money(s.invoices_count)], ["متوسط الفاتورة", (s: BranchStats) => `${money(s.avg_invoice)} ج`], ["العملاء المشترين", (s: BranchStats) => money(s.linked_customers)], ["متوسط يومي", (s: BranchStats) => `${money(s.daily_avg)} ج`], ["نسبة المساهمة", (s: BranchStats) => pct(s.link_rate)], ["أفضل يوم", (s: BranchStats) => s.best_day || "-"]].map(([label, fn]) => <tr key={String(label)} className="border-b border-slate-800"><td className="p-3 font-black text-white">{String(label)}</td>{stats.map((s) => <td key={s.branch} className="p-3 font-bold text-slate-200">{(fn as (s: BranchStats) => string)(s)}</td>)}</tr>)}</tbody></table></div>}
    </div>
  );
}
