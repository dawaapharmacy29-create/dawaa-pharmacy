import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, DatabaseZap, RefreshCw, ShieldAlert } from "lucide-react";
import {
  loadAppDataHealthSummary,
  summarizeDataHealth,
  type DataHealthIssue,
} from "@/lib/dataHealth/appDataHealthService";
import { formatNumber } from "@/lib/dawaa2027";

const severityText = {
  danger: "حرج",
  warning: "يحتاج مراجعة",
  info: "معلومة",
};

const severityClass = {
  danger: "border-red-500/30 bg-red-500/10 text-red-200",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-100",
  info: "border-sky-500/25 bg-sky-500/10 text-sky-100",
};

function issueValue(issue: DataHealthIssue) {
  if (issue.count === null) return "غير متاح";
  return formatNumber(issue.count);
}

export default function DataHealthCenter() {
  const [issues, setIssues] = useState<DataHealthIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    loadAppDataHealthSummary()
      .then((result) => {
        setIssues(result);
        setLastUpdated(new Date().toLocaleString("ar-EG"));
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "تعذر تحميل صحة البيانات");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const summary = useMemo(() => summarizeDataHealth(issues), [issues]);
  const orderedIssues = useMemo(() => {
    const rank = { danger: 0, warning: 1, info: 2 };
    return [...issues].sort((a, b) => {
      const bySeverity = rank[a.severity] - rank[b.severity];
      if (bySeverity !== 0) return bySeverity;
      return (b.count || 0) - (a.count || 0);
    });
  }, [issues]);

  return (
    <div className="space-y-5" dir="rtl">
      <section className="rounded-2xl border border-teal-500/20 bg-slate-900/80 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-500/15 text-teal-300">
              <DatabaseZap size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-black text-white">مركز صحة البيانات والربط</h1>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">
                متابعة فورية لمشاكل الربط التي تؤثر على الفواتير، العملاء، الموظفين، النقاط، وصفحات الأداء.
              </p>
              {lastUpdated && <div className="mt-2 text-xs text-slate-500">آخر تحديث: {lastUpdated}</div>}
            </div>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-500 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            تحديث المؤشرات
          </button>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        <SummaryCard label="مشاكل مهمة" value={formatNumber(summary.actionableCount)} tone={summary.status} />
        <SummaryCard label="مستوى حرج" value={formatNumber(summary.dangerCount)} tone="danger" />
        <SummaryCard label="تحذيرات" value={formatNumber(summary.warningCount)} tone="warning" />
        <SummaryCard label="سجلات تحتاج مراجعة" value={formatNumber(summary.totalRecords)} tone={summary.status} />
      </section>

      {error && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-8 text-center text-slate-400">
          جاري تحميل مؤشرات صحة البيانات...
        </div>
      ) : (
        <section className="grid gap-4 xl:grid-cols-2">
          {orderedIssues.map((issue) => (
            <article key={issue.key} className={`rounded-2xl border p-4 ${severityClass[issue.severity]}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="mt-1">
                    {issue.severity === "info" ? <CheckCircle2 size={20} /> : <ShieldAlert size={20} />}
                  </div>
                  <div>
                    <h2 className="text-base font-black text-white">{issue.label}</h2>
                    <p className="mt-1 text-xs opacity-80">المصدر: {issue.source}</p>
                  </div>
                </div>
                <div className="text-left">
                  <div className="text-2xl font-black text-white">{issueValue(issue)}</div>
                  <div className="text-xs opacity-80">{severityText[issue.severity]}</div>
                </div>
              </div>

              {issue.error && (
                <div className="mt-3 rounded-xl border border-red-500/20 bg-red-950/20 p-3 text-xs text-red-100">
                  {issue.error}
                </div>
              )}

              <div className="mt-4 rounded-xl bg-black/15 p-3 text-sm leading-6 text-slate-100">
                {issue.suggestedFix}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {issue.affectedPages.map((page) => (
                  <Link
                    key={page}
                    to={page.replace(":id", "")}
                    className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-200 transition hover:bg-white/10"
                  >
                    {page}
                  </Link>
                ))}
              </div>
            </article>
          ))}
        </section>
      )}

      <section className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm leading-7 text-amber-100">
        <div className="flex items-start gap-2">
          <AlertTriangle size={18} className="mt-1 flex-shrink-0" />
          <p>
            هذه الصفحة للقراءة والتحليل فقط. لا تحذف ولا تعدل أي بيانات، لكنها تحدد الأماكن التي تسبب اختلاف الأرقام بين الصفحات.
          </p>
        </div>
      </section>
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone: "ready" | "warning" | "danger" | "info" }) {
  const toneClass = {
    ready: "border-emerald-500/25 bg-emerald-500/10 text-emerald-200",
    warning: "border-amber-500/25 bg-amber-500/10 text-amber-200",
    danger: "border-red-500/25 bg-red-500/10 text-red-200",
    info: "border-sky-500/25 bg-sky-500/10 text-sky-200",
  };

  return (
    <div className={`rounded-2xl border p-4 ${toneClass[tone]}`}>
      <div className="text-xs opacity-80">{label}</div>
      <div className="mt-2 text-2xl font-black text-white">{value}</div>
    </div>
  );
}
