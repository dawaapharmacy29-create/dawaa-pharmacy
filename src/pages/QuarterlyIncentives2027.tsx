import { useEffect, useState, type ElementType, type ReactNode } from "react";
import { Award, Crown, FileText, TrendingUp, Users } from "lucide-react";
import { formatMoney, formatNumber } from "@/lib/dawaa2027";
import {
  loadQuarterlyIncentiveSummary,
  type QuarterlyIncentiveSummary,
} from "@/lib/incentives/quarterlyIncentiveService";

export default function QuarterlyIncentives2027() {
  const [summary, setSummary] = useState<QuarterlyIncentiveSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadQuarterlyIncentiveSummary()
      .then((result) => {
        if (!cancelled) {
          setSummary(result);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || "تعذر تحميل الحافز الربع سنوي");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = summary?.rows || [];

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="page-title">الحافز الربع سنوي 2027</h1>
          <p className="mt-2 text-sm leading-7 text-slate-400">
            حافز منفصل بقيمة 2000 جنيه كل 3 أشهر. لا يختلط مع حافز الشهر: 500 نقطة = 1500 جنيه.
          </p>
        </div>
        <div className="rounded-2xl border border-teal-500/20 bg-teal-500/10 px-4 py-3 text-teal-200">
          {summary?.quarter.label || "الربع الحالي"}
        </div>
      </div>

      {loading && <div className="stat-card text-center">جاري تحميل الحافز الربع سنوي...</div>}
      {error && <div className="stat-card text-red-200">{error}</div>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={Crown} label="قيمة الحافز الكامل" value="2000 جنيه" hint="منفصل عن الحافز الشهري" />
        <Kpi icon={TrendingUp} label="دكاترة لهم نشاط" value={formatNumber(rows.length)} hint="حسب مصادر الربع" />
        <Kpi icon={Award} label="أعلى حافز متوقع" value={formatMoney(Math.max(0, ...rows.map((r) => r.quarterlyFinalValue)))} hint="قبل اعتماد المدير" />
        <Kpi icon={Users} label="أعلى عميل بالقيمة" value={rows[0]?.topCustomer?.[0] || "-"} hint={rows[0] ? formatMoney(rows[0].topCustomer?.[1] || 0) : ""} />
      </div>

      <div className="stat-card">
        <h2 className="section-title mb-4">محاور التقييم الربع سنوي</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(summary?.pillars || []).map((pillar) => (
            <div key={pillar.key} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between">
                <div className="font-bold text-white">{pillar.label}</div>
                <span className="badge-purple">{pillar.points}</span>
              </div>
              <p className="mt-2 text-xs leading-6 text-slate-400">{pillar.description}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="stat-card overflow-x-auto">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="section-title">ترتيب الدكاترة في الربع الحالي</h2>
          <button onClick={() => window.print()} className="btn-secondary inline-flex items-center gap-2">
            <FileText className="h-4 w-4" /> طباعة/تصدير
          </button>
        </div>
        <table className="data-table min-w-[980px]">
          <thead>
            <tr>
              <th>الدكتور</th>
              <th>المبيعات</th>
              <th>الفواتير</th>
              <th>متوسط الفاتورة</th>
              <th>أفضل عميل</th>
              <th>اللستة</th>
              <th>رواكد</th>
              <th>المبيعات</th>
              <th>المتوسط</th>
              <th>العملاء</th>
              <th>اللستة</th>
              <th>الرواكد</th>
              <th>الجودة</th>
              <th>الدرجة</th>
              <th>الحافز</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="font-bold text-white">{row.name}</td>
                <td>{formatMoney(row.sales)}</td>
                <td>{row.invoices}</td>
                <td>{formatMoney(row.avgInvoice)}</td>
                <td>{row.topCustomer?.[0] || "-"}</td>
                <td>{row.achievedQty}/{row.targetQty || "-"}</td>
                <td>{row.stagnantCount}</td>
                <td>{row.scoreSales}/25</td>
                <td>{row.scoreAvg}/20</td>
                <td>{row.scoreCustomers}/20</td>
                <td>{row.scoreList}/15</td>
                <td>{row.scoreStock}/10</td>
                <td>{row.scoreQuality}/10</td>
                <td className="font-black text-teal-300">{row.score}/100</td>
                <td className="font-black text-white">{formatMoney(row.quarterlyFinalValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && !loading && <div className="p-8 text-center text-slate-400">لا توجد بيانات ربع سنوية كافية في الفترة الحالية.</div>}
      </div>

      <details className="stat-card">
        <summary className="cursor-pointer text-sm font-black">مصادر الحافز الربع سنوي</summary>
        <div className="mt-3 grid gap-2 text-sm text-slate-400">
          {(summary?.sourceBreakdown || []).map((source) => <div key={source}>{source}</div>)}
          {(summary?.warnings || []).map((warning) => <div key={warning} className="text-amber-300">{warning}</div>)}
        </div>
      </details>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, hint }: { icon: ElementType; label: string; value: ReactNode; hint: string }) {
  return (
    <div className="stat-card">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-slate-400">{label}</div>
          <div className="mt-2 text-2xl font-black text-white">{value}</div>
          <div className="mt-1 text-xs text-slate-500">{hint}</div>
        </div>
        <div className="rounded-2xl bg-purple-500/15 p-3 text-purple-300">
          <Icon className="h-6 w-6" />
        </div>
      </div>
    </div>
  );
}
