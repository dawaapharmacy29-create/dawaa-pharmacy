import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, DatabaseZap, RefreshCw, ShieldAlert } from 'lucide-react';
import { loadAppDataHealthSummary, summarizeDataHealth, type DataHealthIssue } from '@/lib/dataHealth/appDataHealthService';
import { formatNumber } from '@/lib/dawaa2027';
import OperationalReadinessPanel from '@/components/system/OperationalReadinessPanel';

const severityText = { danger: 'حرج', warning: 'يحتاج مراجعة', info: 'معلومة' } as const;
const severityClass = {
  danger: 'dawaa-status-danger',
  warning: 'dawaa-status-warning',
  info: 'dawaa-status-info',
} as const;

function issueValue(issue: DataHealthIssue) {
  return issue.count === null ? 'غير متاح' : formatNumber(issue.count);
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
        setLastUpdated(new Date().toLocaleString('ar-EG'));
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'تعذر تحميل صحة البيانات'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const summary = useMemo(() => summarizeDataHealth(issues), [issues]);
  const orderedIssues = useMemo(() => {
    const rank = { danger: 0, warning: 1, info: 2 };
    return [...issues].sort(
      (a, b) => rank[a.severity] - rank[b.severity] || (b.count || 0) - (a.count || 0)
    );
  }, [issues]);

  return (
    <div className="space-y-5" dir="rtl">
      <section className="dawaa-card dawaa-card--raised">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="dawaa-status-info flex h-12 w-12 items-center justify-center rounded-2xl border">
              <DatabaseZap size={24} />
            </div>
            <div>
              <h1 className="dawaa-title text-2xl">مركز صحة البيانات والتشغيل</h1>
              <p className="dawaa-caption mt-1 max-w-3xl leading-6">
                مراجعة الربط بين الفواتير والعملاء والموظفين والنقاط، مع اختبار الجاهزية التشغيلية وتغطية صلاحيات الأدوار.
              </p>
              {lastUpdated ? <div className="dawaa-caption mt-2 text-xs">آخر تحديث: {lastUpdated}</div> : null}
            </div>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="dawaa-button dawaa-button--primary disabled:opacity-60"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
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

      <OperationalReadinessPanel />

      {error ? <div className="dawaa-alert dawaa-alert--danger text-sm">{error}</div> : null}

      {loading ? (
        <div className="dawaa-card dawaa-card--soft p-8 text-center">
          <span className="dawaa-caption">جاري تحميل مؤشرات صحة البيانات...</span>
        </div>
      ) : (
        <section className="grid gap-4 xl:grid-cols-2">
          {orderedIssues.map((issue) => (
            <article key={issue.key} className={`rounded-2xl border p-4 ${severityClass[issue.severity]}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="mt-1">
                    {issue.severity === 'info' ? <CheckCircle2 size={20} /> : <ShieldAlert size={20} />}
                  </div>
                  <div>
                    <h2 className="text-base font-black">{issue.label}</h2>
                    <p className="mt-1 text-xs opacity-75">المصدر: {issue.source}</p>
                  </div>
                </div>
                <div className="text-left">
                  <div className="text-2xl font-black">{issueValue(issue)}</div>
                  <div className="text-xs opacity-75">{severityText[issue.severity]}</div>
                </div>
              </div>

              {issue.error ? <div className="dawaa-alert dawaa-alert--danger mt-3 text-xs">{issue.error}</div> : null}

              <div className="dawaa-card dawaa-card--soft mt-4 p-3 text-sm leading-6">
                {issue.suggestedFix}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {issue.affectedPages.map((page) => (
                  <Link
                    key={page}
                    to={page.replace(':id', '')}
                    className="dawaa-button dawaa-button--secondary min-h-0 px-2.5 py-1 text-xs"
                  >
                    {page}
                  </Link>
                ))}
              </div>
            </article>
          ))}
        </section>
      )}

      <section className="dawaa-alert dawaa-alert--warning text-sm leading-7">
        <AlertTriangle size={18} className="mt-1 flex-shrink-0" />
        <p>
          هذه الصفحة للقراءة والتحليل فقط. لا تحذف ولا تعدل البيانات، وتستخدم الجداول والخدمات الموجودة بالفعل بدون إنشاء جداول جديدة.
        </p>
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'ready' | 'warning' | 'danger' | 'info';
}) {
  const toneClass = {
    ready: 'dawaa-status-success',
    warning: 'dawaa-status-warning',
    danger: 'dawaa-status-danger',
    info: 'dawaa-status-info',
  } as const;

  return (
    <div className={`rounded-2xl border p-4 ${toneClass[tone]}`}>
      <div className="text-xs opacity-75">{label}</div>
      <div className="mt-2 text-2xl font-black">{value}</div>
    </div>
  );
}
