import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  BarChart3,
  DollarSign,
  FileText,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { fetchDashboardSalesTruth } from "@/lib/dashboard/dashboardTruthService";
import { getCurrentCycle } from "@/lib/pharmacy-cycle";
import { clearInvoiceCache } from "@/lib/invoiceCache";
import { cn } from "@/lib/utils";

const BRANCHES = ["فرع شكري", "فرع الشامي"];
const ALL = "كل الفروع";

function money(v: number) {
  return new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 0 }).format(v ?? 0);
}
function pct(v: number) {
  return `${(v ?? 0).toFixed(1)}%`;
}

interface BranchStats {
  branch: string;
  sales_total: number;
  invoices_count: number;
  avg_invoice: number;
  linked_customers: number;
  link_rate: number;
  daily_avg: number;
}

const TONES: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  "فرع شكري": {
    bg: "bg-cyan-500/10",
    border: "border-cyan-400/30",
    text: "text-cyan-300",
    badge: "bg-cyan-500/20 text-cyan-100",
  },
  "فرع الشامي": {
    bg: "bg-violet-500/10",
    border: "border-violet-400/30",
    text: "text-violet-300",
    badge: "bg-violet-500/20 text-violet-100",
  },
};
const DEFAULT_TONE = {
  bg: "bg-slate-500/10",
  border: "border-slate-400/30",
  text: "text-slate-300",
  badge: "bg-slate-500/20 text-slate-100",
};

const CHART_COLORS: Record<string, string> = {
  "فرع شكري": "#22d3ee",
  "فرع الشامي": "#a78bfa",
};

export default function BranchComparison() {
  const navigate = useNavigate();
  const cycle = getCurrentCycle();
  const [startDate] = useState(() => cycle.start.toISOString().slice(0, 10));
  const [endDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [stats, setStats] = useState<BranchStats[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const load = useCallback(async (noCache = false) => {
    setLoading(true);
    setErrors([]);
    try {
      if (noCache) clearInvoiceCache();
      const errs: string[] = [];
      const truth = await fetchDashboardSalesTruth({
        startDate,
        endDate,
        branch: ALL,
        errors: errs,
        noCache,
      });
      setErrors(errs);
      const dist = truth.branchDistribution;
      const daysCount = new Set(
        truth.dailySales.map((r) => String(r.sale_date || "").slice(0, 10)).filter(Boolean),
      ).size || 1;
      const totalSales = dist.reduce((s, r) => s + r.sales_total, 0) || 1;

      setStats(
        dist.map((r) => ({
          branch: r.branch,
          sales_total: r.sales_total,
          invoices_count: r.invoices_count,
          avg_invoice: r.avg_invoice || (r.invoices_count ? r.sales_total / r.invoices_count : 0),
          linked_customers: r.linked_customers,
          link_rate: totalSales ? (r.sales_total / totalSales) * 100 : 0,
          daily_avg: r.sales_total / daysCount,
        })),
      );
      setLoadedAt(new Date().toLocaleTimeString("ar-EG"));
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => { void load(); }, [load]);

  const chartData = useMemo(() => {
    const keys = ["sales_total", "invoices_count", "avg_invoice", "linked_customers"] as const;
    return keys.map((key) => {
      const row: Record<string, string | number> = { name: key };
      stats.forEach((s) => { row[s.branch] = s[key]; });
      return row;
    });
  }, [stats]);

  const salesChartData = useMemo(() =>
    stats.map((s) => ({
      name: s.branch,
      "المبيعات": s.sales_total,
      "الفواتير": s.invoices_count,
      "متوسط الفاتورة": Math.round(s.avg_invoice),
    })), [stats]);

  const winner = useMemo(() =>
    stats.length ? stats.reduce((a, b) => a.sales_total > b.sales_total ? a : b) : null,
  [stats]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4 md:p-6 space-y-6" dir="rtl">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="flex items-center gap-1 rounded-xl bg-slate-800/60 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700/60">
            <ArrowLeft className="h-4 w-4" />
            رجوع
          </button>
          <div>
            <h1 className="text-xl font-black text-white flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-cyan-400" />
              مقارنة الفروع
            </h1>
            <p className="text-xs text-slate-400">
              {startDate} → {endDate}
              {loadedAt && <span className="mr-2 text-slate-500">• آخر تحديث: {loadedAt}</span>}
            </p>
          </div>
        </div>
        <button
          onClick={() => void load(true)}
          disabled={loading}
          className="flex items-center gap-2 rounded-xl bg-cyan-500/20 px-4 py-2 text-sm font-bold text-cyan-100 ring-1 ring-cyan-300/30 hover:bg-cyan-500/30 disabled:opacity-60"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          تحديث
        </button>
      </div>

      {/* Skeleton */}
      {loading && !loadedAt && (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-3xl border border-slate-700/50 bg-slate-800/40 p-6 animate-pulse space-y-4">
              <div className="h-4 w-24 rounded-full bg-slate-700/70" />
              <div className="h-8 w-40 rounded-xl bg-slate-700/70" />
              <div className="grid grid-cols-2 gap-3">
                {[0,1,2,3].map((j) => <div key={j} className="h-16 rounded-2xl bg-slate-700/40" />)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Branch Cards */}
      {(!loading || loadedAt) && stats.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {stats.map((s) => {
            const tone = TONES[s.branch] ?? DEFAULT_TONE;
            const isWinner = winner?.branch === s.branch;
            return (
              <div key={s.branch} className={cn("rounded-3xl border p-6 space-y-5 transition-all", tone.bg, tone.border, isWinner && "ring-2 ring-amber-400/40")}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={cn("rounded-2xl px-3 py-1 text-sm font-black", tone.badge)}>{s.branch}</span>
                    {isWinner && (
                      <span className="rounded-xl bg-amber-400/20 px-2 py-0.5 text-xs font-bold text-amber-300">🏆 الأفضل</span>
                    )}
                  </div>
                  <span className={cn("text-xs font-bold", tone.text)}>{pct(s.link_rate)} من الإجمالي</span>
                </div>

                {/* Big number */}
                <div>
                  <p className="text-xs text-slate-400">صافي المبيعات</p>
                  <p className={cn("text-3xl font-black", tone.text)}>{money(s.sales_total)} <span className="text-base font-bold text-slate-400">جنيه</span></p>
                </div>

                {/* KPIs grid */}
                <div className="grid grid-cols-2 gap-3">
                  <Kpi icon={<FileText className="h-4 w-4" />} label="الفواتير" value={money(s.invoices_count)} tone={tone.text} />
                  <Kpi icon={<DollarSign className="h-4 w-4" />} label="متوسط الفاتورة" value={`${money(s.avg_invoice)} ج`} tone={tone.text} />
                  <Kpi icon={<Users className="h-4 w-4" />} label="عملاء مشترين" value={money(s.linked_customers)} tone={tone.text} />
                  <Kpi icon={<TrendingUp className="h-4 w-4" />} label="متوسط يومي" value={`${money(s.daily_avg)} ج`} tone={tone.text} />
                </div>

                {/* Progress bar */}
                <div>
                  <p className="mb-1 text-xs text-slate-400">نسبة المساهمة في إجمالي المبيعات</p>
                  <div className="h-2 rounded-full bg-slate-700/60">
                    <div
                      className={cn("h-2 rounded-full transition-all duration-1000", tone.text.replace("text-", "bg-").replace("/300", "/500"))}
                      style={{ width: `${Math.min(100, s.link_rate)}%` }}
                    />
                  </div>
                  <p className={cn("mt-1 text-xs font-bold text-left", tone.text)}>{pct(s.link_rate)}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {!loading && stats.length === 0 && (
        <div className="rounded-3xl border border-slate-700/50 bg-slate-800/40 p-12 text-center">
          <BarChart3 className="mx-auto mb-3 h-10 w-10 text-slate-600" />
          <p className="font-bold text-slate-400">لا توجد بيانات للمقارنة في هذه الفترة</p>
          <p className="mt-1 text-sm text-slate-500">تأكد من إعداد Supabase وتوفر بيانات الفواتير</p>
        </div>
      )}

      {/* Bar Chart: Sales Comparison */}
      {stats.length > 0 && (
        <div className="rounded-3xl border border-slate-700/50 bg-slate-900/60 p-6">
          <h2 className="mb-4 font-black text-white flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-cyan-400" />
            مقارنة المبيعات بين الفروع
          </h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={salesChartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 12 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 12, color: "#f1f5f9" }}
                formatter={(value: number, name: string) => [money(value), name]}
              />
              <Bar dataKey="المبيعات" fill="#22d3ee" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Metrics Comparison Table */}
      {stats.length > 0 && (
        <div className="rounded-3xl border border-slate-700/50 bg-slate-900/60 p-6 overflow-x-auto">
          <h2 className="mb-4 font-black text-white flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-cyan-400" />
            مقارنة تفصيلية
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700/50">
                <th className="py-2 text-right text-slate-400 font-bold">المؤشر</th>
                {stats.map((s) => (
                  <th key={s.branch} className="py-2 text-center text-slate-300 font-black">{s.branch}</th>
                ))}
                {stats.length > 1 && <th className="py-2 text-center text-amber-300 font-black">الفارق</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {[
                { label: "المبيعات (جنيه)", key: "sales_total" as const, fmt: money },
                { label: "عدد الفواتير", key: "invoices_count" as const, fmt: money },
                { label: "متوسط الفاتورة (جنيه)", key: "avg_invoice" as const, fmt: money },
                { label: "العملاء المشترين", key: "linked_customers" as const, fmt: money },
                { label: "متوسط يومي (جنيه)", key: "daily_avg" as const, fmt: money },
              ].map(({ label, key, fmt }) => {
                const values = stats.map((s) => s[key]);
                const maxVal = Math.max(...values);
                const diff = values.length >= 2 ? Math.abs(values[0] - values[1]) : 0;
                return (
                  <tr key={key} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 pr-1 text-slate-300 font-bold">{label}</td>
                    {stats.map((s, i) => (
                      <td key={s.branch} className={cn("py-3 text-center font-black tabular-nums", s[key] === maxVal ? "text-amber-300" : "text-slate-200")}>
                        {fmt(s[key])}
                      </td>
                    ))}
                    {stats.length > 1 && (
                      <td className="py-3 text-center text-cyan-300 font-bold tabular-nums">{fmt(diff)}</td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4">
          <p className="font-bold text-amber-300 mb-1">ملاحظات التحميل:</p>
          <ul className="text-sm text-amber-200/80 space-y-0.5">
            {errors.map((e, i) => <li key={i}>• {e}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function Kpi({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: string }) {
  return (
    <div className="rounded-2xl bg-slate-800/40 p-3 space-y-1">
      <div className={cn("flex items-center gap-1.5 text-xs", tone)}>
        {icon}
        <span>{label}</span>
      </div>
      <p className="font-black text-white text-base tabular-nums">{value}</p>
    </div>
  );
}
