import { useMemo, useState } from "react";
import { Crown, Star, Award, Shield, Users, RefreshCw, Search, Download } from "lucide-react";
import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import { cn } from "@/lib/utils";
import { exportLoyaltyToExcel } from "@/lib/exportExcel";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface Customer {
  id: string;
  name: string;
  phone?: string | null;
  branch?: string | null;
  total_purchases?: number | null;
  avg_monthly?: number | null;
  total_invoices?: number | null;
  retention_status?: string | null;
  last_purchase?: string | null;
}

type Tier = "بلاتيني" | "ذهبي" | "فضي" | "برونزي" | "جديد";

const TIER_CONFIG: Record<Tier, { min: number; label: string; color: string; badge: string; icon: typeof Crown; iconColor: string; description: string }> = {
  بلاتيني: { min: 5000, label: "بلاتيني", color: "bg-violet-100 border-violet-300 text-violet-900", badge: "bg-violet-600 text-white", icon: Crown, iconColor: "text-violet-600", description: "أكثر من 5,000 جنيه" },
  ذهبي: { min: 2000, label: "ذهبي", color: "bg-amber-100 border-amber-300 text-amber-900", badge: "bg-amber-500 text-white", icon: Star, iconColor: "text-amber-500", description: "2,000 - 5,000 جنيه" },
  فضي: { min: 800, label: "فضي", color: "bg-slate-100 border-slate-300 text-slate-900", badge: "bg-slate-500 text-white", icon: Award, iconColor: "text-slate-500", description: "800 - 2,000 جنيه" },
  برونزي: { min: 200, label: "برونزي", color: "bg-orange-100 border-orange-300 text-orange-900", badge: "bg-orange-600 text-white", icon: Shield, iconColor: "text-orange-600", description: "200 - 800 جنيه" },
  جديد: { min: 0, label: "جديد", color: "bg-sky-100 border-sky-300 text-sky-900", badge: "bg-sky-600 text-white", icon: Users, iconColor: "text-sky-600", description: "أقل من 200 جنيه" },
};

function getTier(totalPurchases: number | null | undefined): Tier {
  const v = Number(totalPurchases || 0);
  if (v >= 5000) return "بلاتيني";
  if (v >= 2000) return "ذهبي";
  if (v >= 800) return "فضي";
  if (v >= 200) return "برونزي";
  return "جديد";
}

function money(v: number) {
  return new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 0 }).format(v);
}

const CHART_COLORS: Record<Tier, string> = {
  بلاتيني: "#7c3aed",
  ذهبي: "#f59e0b",
  فضي: "#64748b",
  برونزي: "#ea580c",
  جديد: "#0284c7",
};

function TableSkeleton() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="border-b border-slate-100 px-5 py-3">
        <Skeleton className="h-5 w-24" />
      </div>
      <div className="p-4 space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-4 w-1/6" />
            <Skeleton className="h-4 w-1/6" />
            <Skeleton className="h-4 w-1/8" />
            <Skeleton className="h-4 w-1/8" />
            <Skeleton className="h-4 w-1/8" />
            <Skeleton className="h-4 w-1/8" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LoyaltyTiers() {
  const [activeTier, setActiveTier] = useState<Tier | "all">("all");
  const [branchFilter, setBranchFilter] = useState("الكل");
  const [search, setSearch] = useState("");

  const { data: customers, loading, error, refetch } = useSupabaseQuery<Customer>({
    table: "customers",
    select: "id,name,phone,branch,total_purchases,avg_monthly,total_invoices,retention_status,last_purchase",
    orderBy: { column: "total_purchases", ascending: false },
    limit: 1000,
    realtimeEnabled: false,
  });

  const branches = useMemo(() => {
    const set = new Set<string>();
    customers.forEach((c) => { if (c.branch) set.add(c.branch); });
    return ["الكل", ...Array.from(set).sort()];
  }, [customers]);

  const enriched = useMemo(() => customers.map((c) => ({ ...c, tier: getTier(c.total_purchases) })), [customers]);

  const tierCounts = useMemo(() => {
    const counts: Record<Tier, number> = { بلاتيني: 0, ذهبي: 0, فضي: 0, برونزي: 0, جديد: 0 };
    enriched
      .filter((c) => branchFilter === "الكل" || c.branch === branchFilter)
      .forEach((c) => { counts[c.tier]++; });
    return counts;
  }, [enriched, branchFilter]);

  const chartData = useMemo(() => (Object.keys(TIER_CONFIG) as Tier[]).map((t) => ({
    name: t,
    عدد: tierCounts[t],
    fill: CHART_COLORS[t],
  })), [tierCounts]);

  const filtered = useMemo(() => enriched.filter((c) => {
    if (activeTier !== "all" && c.tier !== activeTier) return false;
    if (branchFilter !== "الكل" && c.branch !== branchFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!c.name.toLowerCase().includes(q) && !(c.phone || "").includes(q)) return false;
    }
    return true;
  }), [enriched, activeTier, branchFilter, search]);

  const totalPurchasesSum = useMemo(() =>
    enriched.filter((c) => branchFilter === "الكل" || c.branch === branchFilter).reduce((s, c) => s + Number(c.total_purchases || 0), 0),
    [enriched, branchFilter]);

  const tierOrder: Tier[] = ["بلاتيني", "ذهبي", "فضي", "برونزي", "جديد"];

  function handleExport() {
    exportLoyaltyToExcel(filtered.map((c) => ({ ...c, tier: c.tier })));
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900">مستويات ولاء العملاء</h1>
          <p className="mt-1 text-sm font-bold text-slate-500">تصنيف العملاء حسب إجمالي مشترياتهم إلى مستويات: بلاتيني / ذهبي / فضي / برونزي / جديد.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"
          >
            <Download size={16} /> Excel
          </button>
          <button
            onClick={() => void refetch()}
            className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-black text-white hover:bg-teal-700"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> تحديث
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tierOrder.map((tier) => {
          const cfg = TIER_CONFIG[tier];
          const Icon = cfg.icon;
          const isActive = activeTier === tier;
          return (
            <button
              key={tier}
              type="button"
              onClick={() => setActiveTier(isActive ? "all" : tier)}
              className={cn("flex flex-col items-start gap-2 rounded-2xl border p-4 shadow-sm text-right transition hover:shadow-md", cfg.color, isActive && "ring-2 ring-teal-400 ring-offset-1")}
            >
              <Icon size={22} className={cfg.iconColor} />
              <div>
                <div className="text-xs font-bold">{cfg.description}</div>
                {loading
                  ? <Skeleton className="h-8 w-10 mt-1" />
                  : <div className="text-3xl font-black">{tierCounts[tier].toLocaleString("ar-EG")}</div>
                }
                <div className={cn("mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-black", cfg.badge)}>{tier}</div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
          <h2 className="mb-3 text-sm font-black text-slate-700">توزيع العملاء بالمستوى</h2>
          {loading
            ? <Skeleton className="h-48 w-full rounded-xl" />
            : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fontFamily: "Cairo" }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => [v, "عدد العملاء"]} />
                  <Bar dataKey="عدد" radius={[6, 6, 0, 0]}>
                    {chartData.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-black text-slate-700">إجمالي الإنفاق</h2>
          <div className="space-y-3">
            {tierOrder.map((tier) => {
              const cfg = TIER_CONFIG[tier];
              const tierTotal = enriched
                .filter((c) => c.tier === tier && (branchFilter === "الكل" || c.branch === branchFilter))
                .reduce((s, c) => s + Number(c.total_purchases || 0), 0);
              const pct = totalPurchasesSum > 0 ? (tierTotal / totalPurchasesSum) * 100 : 0;
              return (
                <div key={tier}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className={cn("rounded-full px-2 py-0.5 font-black", cfg.badge)}>{tier}</span>
                    {loading
                      ? <Skeleton className="h-3 w-20" />
                      : <span className="font-bold text-slate-700">{money(tierTotal)} ج</span>
                    }
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: loading ? "0%" : `${pct}%`, backgroundColor: CHART_COLORS[tier] }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 border-t border-slate-100 pt-3 text-center">
            <div className="text-xs font-bold text-slate-500">إجمالي الإنفاق</div>
            {loading
              ? <Skeleton className="h-6 w-32 mx-auto mt-1" />
              : <div className="text-xl font-black text-slate-900">{money(totalPurchasesSum)} ج</div>
            }
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center">
        <div className="flex items-center gap-2 flex-1 rounded-xl border border-slate-200 px-3 py-2">
          <Search size={16} className="text-slate-400 shrink-0" />
          <input type="text" placeholder="بحث بالاسم أو الهاتف..." value={search} onChange={(e) => setSearch(e.target.value)} className="flex-1 bg-transparent text-sm outline-none" />
        </div>
        <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold">
          {branches.map((b) => <option key={b}>{b}</option>)}
        </select>
        <select value={activeTier} onChange={(e) => setActiveTier(e.target.value as Tier | "all")} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold">
          <option value="all">كل المستويات</option>
          {tierOrder.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">⚠️ {error}</div>}

      {loading && <TableSkeleton />}

      {!loading && customers.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8 text-center">
          <Users size={40} className="mx-auto mb-3 text-slate-300" />
          <div className="text-sm font-bold text-slate-500">لا توجد بيانات عملاء. راجع جدول customers في Supabase.</div>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-3 flex items-center justify-between">
            <h2 className="text-base font-black text-slate-900">{filtered.length} عميل</h2>
            {filtered.length > 200 && (
              <span className="text-xs font-bold text-slate-500">يُعرض أول 200 — استخدم الفلاتر لتضييق النتائج</span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-600 text-right">
                  <th className="p-3 font-bold">الاسم</th>
                  <th className="p-3 font-bold">الهاتف</th>
                  <th className="p-3 font-bold">الفرع</th>
                  <th className="p-3 font-bold">إجمالي الشراء</th>
                  <th className="p-3 font-bold">عدد الفواتير</th>
                  <th className="p-3 font-bold">آخر شراء</th>
                  <th className="p-3 font-bold">المستوى</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 200).map((c) => {
                  const cfg = TIER_CONFIG[c.tier];
                  return (
                    <tr key={c.id} className="border-t hover:bg-slate-50 transition">
                      <td className="p-3 font-black text-slate-900">{c.name}</td>
                      <td className="p-3 text-slate-700 font-mono text-xs">{c.phone || "-"}</td>
                      <td className="p-3 text-slate-700">{c.branch || "-"}</td>
                      <td className="p-3 font-black text-teal-700">{money(Number(c.total_purchases || 0))} ج</td>
                      <td className="p-3 text-slate-700">{c.total_invoices || "-"}</td>
                      <td className="p-3 text-slate-600 text-xs">{c.last_purchase ? new Date(c.last_purchase).toLocaleDateString("ar-EG") : "-"}</td>
                      <td className="p-3">
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-black", cfg.badge)}>{c.tier}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
