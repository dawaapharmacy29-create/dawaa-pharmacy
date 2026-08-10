import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, ListChecks, CheckCircle2, Sparkles, ExternalLink, Database, AlertTriangle, ShieldCheck } from 'lucide-react';
import { fetchManagerScoreBreakdown, type ManagerScoreBreakdown } from '@/lib/evaluations/managerScoreBreakdown';
import { ManagerLiveIncentiveCard } from '@/components/evaluations/ManagerLiveIncentiveCard';
import { ManagerMonthlyPerformanceReport } from '@/components/evaluations/ManagerMonthlyPerformanceReport';
import type { EvaluationType } from '@/lib/evaluations/managerEvaluationCriteria';

const MODE_META: Record<string, { label: string; icon: any; tone: string }> = {
  auto: { label: 'تلقائي من البيانات', icon: Sparkles, tone: 'text-teal-300' },
  checklist: { label: 'من المهام اليومية', icon: ListChecks, tone: 'text-blue-300' },
};

export function ManagerScoreBreakdownTab({
  evaluationType,
  staffId,
  branch,
}: {
  evaluationType: EvaluationType;
  staffId: string | null | undefined;
  branch: string | null;
}) {
  const [data, setData] = useState<ManagerScoreBreakdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!staffId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetchManagerScoreBreakdown(evaluationType, staffId, branch)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'تعذّر تحميل التفاصيل');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [evaluationType, staffId, branch]);

  if (!staffId) return null;

  return (
    <div className="space-y-4">
      <ManagerLiveIncentiveCard evaluationType={evaluationType} staffId={staffId} branch={branch} />
      <ManagerMonthlyPerformanceReport evaluationType={evaluationType} staffId={staffId} branch={branch} />

      <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
        <h3 className="text-base font-black text-white">تقييم كل جزء — الأسبوع الجاري</h3>
        <p className="mt-1 text-xs text-slate-400">
          كل بند بيوضح مصدره: تلقائي من بيانات التطبيق أو من مهمة تشغيلية موثقة؛ لا توجد درجة مبنية على رأي شخصي.
        </p>

        {loading ? (
          <div className="mt-3 flex items-center gap-2 text-sm text-slate-400">
            <Loader2 size={16} className="animate-spin" /> جارٍ التحميل...
          </div>
        ) : error ? (
          <p className="mt-3 text-sm text-red-400">{error}</p>
        ) : !data ? null : (
          <div className="mt-3 space-y-4">
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-black text-white">
                  <Database size={15} className="text-teal-300" /> تغطية مصادر بيانات الحافز
                </div>
                <span className={data.coveragePercent === 100 ? 'text-emerald-300' : 'text-amber-300'}>
                  {data.coveragePercent}% متاح هذا الأسبوع
                </span>
              </div>
              <p className="mt-1 text-[11px] text-slate-400">
                المصدر غير المتاح لا يُحسب صفرًا ولا يُقدّر بالرأي؛ يظهر كمحايد لحين تسجيل بيانات فعلية.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {data.coverage.map((item) => (
                  <Link key={item.key} to={item.route} className="flex items-center justify-between rounded-lg border border-white/5 bg-slate-950/40 px-2.5 py-2 text-xs hover:border-teal-500/30">
                    <span className="text-slate-200">{item.label}</span>
                    <span className={`flex items-center gap-1 font-bold ${item.available ? 'text-emerald-300' : 'text-amber-300'}`}>
                      {item.available ? <ShieldCheck size={12} /> : <AlertTriangle size={12} />}
                      {item.available ? 'متاح' : 'محايد'}
                    </span>
                  </Link>
                ))}
              </div>
            </div>

            <div className="space-y-2">
            {data.rows.map((row) => {
              const meta = MODE_META[row.mode];
              const Icon = meta.icon;
              return (
                <div key={row.key} className="rounded-xl border border-white/5 bg-black/20 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Icon size={14} className={meta.tone} />
                      <span className="text-sm font-black text-white">{row.label}</span>
                    </div>
                    <span className="text-xs text-slate-400">وزن {Math.round(row.weight * 100)}%</span>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-teal-400 to-emerald-500"
                        style={{ width: `${(row.score10 / 10) * 100}%` }}
                      />
                    </div>
                    <span className="w-16 shrink-0 text-left text-xs font-black text-emerald-300">{row.score10}/10</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                    <span>{meta.label}</span>
                    <span className="flex items-center gap-1">
                      <CheckCircle2 size={11} /> مساهمة {row.contribution} نقطة من 100
                    </span>
                  </div>
                  <div className={`mt-2 flex items-center gap-1 text-[11px] font-bold ${
                    row.coverageState === 'neutral_missing_data' ? 'text-amber-300' : 'text-emerald-300'
                  }`}>
                    {row.coverageState === 'neutral_missing_data' ? <AlertTriangle size={11} /> : <ShieldCheck size={11} />}
                    {row.coverageMessage}
                  </div>
                  {row.hint && <div className="mt-1 text-[11px] text-slate-500">{row.hint}</div>}
                  {row.sourceRoute && (
                    <Link to={row.sourceRoute} className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-teal-300 hover:text-teal-200">
                      <ExternalLink size={11} /> فتح {row.sourceLabel || 'مصدر البيانات'}
                    </Link>
                  )}
                </div>
              );
            })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
