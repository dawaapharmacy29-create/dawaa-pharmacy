import { useEffect, useState } from 'react';
import { BarChart3, CalendarDays, Loader2, TrendingDown, TrendingUp, WalletCards } from 'lucide-react';
import type { EvaluationType } from '@/lib/evaluations/managerEvaluationCriteria';
import {
  fetchManagerMonthlyReport,
  type ManagerMonthlyReport,
} from '@/lib/evaluations/managerMonthlyReportService';

function currency(value: number | null) {
  if (value === null) return 'لم تُسوَّ بعد';
  return `${value.toLocaleString('ar-EG')} ج.م`;
}

function scoreTone(score: number | null) {
  if (score === null) return 'text-slate-500';
  if (score >= 80) return 'text-emerald-300';
  if (score >= 60) return 'text-amber-300';
  return 'text-red-300';
}

export function ManagerMonthlyPerformanceReport({
  evaluationType,
  staffId,
  branch,
}: {
  evaluationType: EvaluationType;
  staffId: string | null | undefined;
  branch: string | null;
}) {
  const [cycleCount, setCycleCount] = useState<3 | 6 | 12>(6);
  const [report, setReport] = useState<ManagerMonthlyReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!staffId) return;
    setLoading(true);
    setError(null);
    fetchManagerMonthlyReport(evaluationType, staffId, branch, cycleCount)
      .then((result) => {
        if (!cancelled) setReport(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'تعذّر تحميل التقرير الشهري');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [evaluationType, staffId, branch, cycleCount]);

  if (!staffId) return null;

  return (
    <section className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-base font-black text-white">
            <BarChart3 size={17} className="text-teal-300" /> تقرير أداء وحافز الموظف الشهري
          </h3>
          <p className="mt-1 text-xs text-slate-400">
            كل شهر هو دورة صيدليات دواء من يوم 26 إلى 25، والأسبوع يتبع الدورة التي يقع فيها يوم إغلاقه.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs font-bold text-slate-300">
          عرض
          <select
            value={cycleCount}
            onChange={(event) => setCycleCount(Number(event.target.value) as 3 | 6 | 12)}
            className="rounded-lg border border-white/10 bg-slate-950 px-2 py-1.5 text-white"
          >
            <option value={3}>آخر 3 شهور</option>
            <option value={6}>آخر 6 شهور</option>
            <option value={12}>آخر 12 شهر</option>
          </select>
        </label>
      </div>

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-slate-400">
          <Loader2 size={16} className="animate-spin" /> جاري إعداد التقرير من البيانات الفعلية...
        </div>
      ) : error ? (
        <p className="mt-4 text-sm text-red-300">{error}</p>
      ) : report ? (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-white/5 bg-black/20 p-3">
              <div className="text-xs text-slate-500">متوسط الأداء عبر الدورات</div>
              <div className={`mt-1 text-2xl font-black ${scoreTone(report.averageScoreAcrossCycles)}`}>
                {report.averageScoreAcrossCycles ?? '—'}{report.averageScoreAcrossCycles !== null ? '/100' : ''}
              </div>
            </div>
            <div className="rounded-xl border border-white/5 bg-black/20 p-3">
              <div className="text-xs text-slate-500">إجمالي الحوافز المسوّاة</div>
              <div className="mt-1 text-2xl font-black text-teal-300">{currency(report.totalSettledIncentiveEgp)}</div>
            </div>
            <div className="rounded-xl border border-white/5 bg-black/20 p-3">
              <div className="text-xs text-slate-500">أفضل دورة</div>
              <div className="mt-1 text-sm font-black text-white">
                {report.bestCycle
                  ? `${report.bestCycle.cycleStart} ← ${report.bestCycle.cycleEnd} (${report.bestCycle.averageScore}/100)`
                  : 'لا توجد دورات معتمدة بعد'}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-white/5">
            <table className="w-full min-w-[920px] text-right text-xs">
              <thead className="bg-slate-950/70 text-slate-400">
                <tr>
                  <th className="px-3 py-2.5">الدورة</th>
                  <th className="px-3 py-2.5">الأداء</th>
                  <th className="px-3 py-2.5">التغير</th>
                  <th className="px-3 py-2.5">الأسابيع</th>
                  <th className="px-3 py-2.5">تغطية البيانات</th>
                  <th className="px-3 py-2.5">الشريحة</th>
                  <th className="px-3 py-2.5">الحافز المتوقع</th>
                  <th className="px-3 py-2.5">الحافز المسوّى</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.cycleStart} className="border-t border-white/5 bg-black/10 text-slate-200">
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1 font-bold text-white"><CalendarDays size={12} /> {row.cycleStart}</div>
                      <div className="mt-0.5 text-[10px] text-slate-500">إلى {row.cycleEnd}{row.isCurrentCycle ? ' — جارية' : ''}</div>
                    </td>
                    <td className={`px-3 py-3 font-black ${scoreTone(row.averageScore)}`}>{row.averageScore ?? '—'}{row.averageScore !== null ? '/100' : ''}</td>
                    <td className="px-3 py-3">
                      {row.scoreChangeFromPrevious === null ? <span className="text-slate-600">—</span> : (
                        <span className={`flex items-center gap-1 font-bold ${row.scoreChangeFromPrevious >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                          {row.scoreChangeFromPrevious >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                          {row.scoreChangeFromPrevious > 0 ? '+' : ''}{row.scoreChangeFromPrevious}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">{row.approvedWeeks}</td>
                    <td className="px-3 py-3">{row.dataCoveragePercent === null ? '—' : `${row.dataCoveragePercent}%`}</td>
                    <td className="px-3 py-3">{row.tierLabel} {row.averageScore !== null ? `(${row.payoutPercent}%)` : ''}</td>
                    <td className="px-3 py-3 font-bold text-teal-200">{row.averageScore === null ? '—' : currency(row.estimatedIncentiveEgp)}</td>
                    <td className="px-3 py-3">
                      <span className={`flex items-center gap-1 font-bold ${row.settlementStatus === 'settled' ? 'text-emerald-300' : 'text-slate-500'}`}>
                        <WalletCards size={12} /> {row.settlementStatus === 'no_data' ? 'لا توجد بيانات' : currency(row.settledIncentiveEgp)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2">
            {report.rows.filter((row) => row.averageScore !== null).map((row) => (
              <details key={`details-${row.cycleStart}`} className="rounded-xl border border-white/5 bg-black/15 p-3">
                <summary className="cursor-pointer text-xs font-black text-white">
                  تفاصيل التشغيل للدورة {row.cycleStart} إلى {row.cycleEnd}
                </summary>
                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                  <div><span className="text-slate-500">المبيعات: </span><span className="font-bold text-white">{row.salesTotal.toLocaleString('ar-EG')} ج.م</span></div>
                  <div><span className="text-slate-500">المتابعات: </span><span className="font-bold text-white">{row.followupsClosed}/{row.followupsTotal}</span></div>
                  <div><span className="text-slate-500">طلبات العملاء: </span><span className="font-bold text-white">{row.customerRequestsClosed}/{row.customerRequestsTotal}</span></div>
                  <div><span className="text-slate-500">شراء بعد المتابعة: </span><span className="font-bold text-emerald-300">{row.recoveredSalesEgp.toLocaleString('ar-EG')} ج.م</span></div>
                  <div><span className="text-slate-500">مراجعات الدكاترة: </span><span className="font-bold text-white">{row.conversationReviewsCount}</span></div>
                  <div><span className="text-slate-500">متوسط المراجعات: </span><span className="font-bold text-white">{row.conversationReviewsAverage ?? '—'}</span></div>
                </div>
              </details>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
