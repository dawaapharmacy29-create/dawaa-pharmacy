import { useEffect, useState } from 'react';
import { BarChart3, CalendarDays, FileDown, Lightbulb, Loader2, TrendingDown, TrendingUp, WalletCards } from 'lucide-react';
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

function csvCell(value: string | number | null) {
  const text = value === null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function exportReport(report: ManagerMonthlyReport) {
  const headers = ['بداية الدورة','نهاية الدورة','الدرجة','التغير','الأسابيع المعتمدة','تغطية البيانات','الشريحة','نسبة الصرف','الحافز المتوقع','الحافز المسوى','المبيعات','المتابعات','المتابعات المغلقة','طلبات العملاء','الطلبات المغلقة','شراء بعد المتابعة','مراجعات الدكاترة','متوسط المراجعات'];
  const rows = report.rows.map((row) => [
    row.cycleStart,row.cycleEnd,row.averageScore,row.scoreChangeFromPrevious,row.approvedWeeks,
    row.dataCoveragePercent,row.tierLabel,row.payoutPercent,row.estimatedIncentiveEgp,
    row.settledIncentiveEgp,row.salesTotal,row.followupsTotal,row.followupsClosed,
    row.customerRequestsTotal,row.customerRequestsClosed,row.recoveredSalesEgp,
    row.conversationReviewsCount,row.conversationReviewsAverage,
  ]);
  const csv = `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `manager-performance-${report.rows[0]?.cycleStart || 'report'}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function recommendations(report: ManagerMonthlyReport): string[] {
  const current = report.rows[0];
  if (!current) return [];
  const items: string[] = [];
  if (!current.approvedWeeks) items.push('اعتماد تقييم أسبوعي واحد على الأقل حتى يتحول الأداء التشغيلي إلى درجة حافز قابلة للتسوية.');
  if ((current.dataCoveragePercent ?? 0) < 80) items.push(`رفع تغطية البيانات من ${current.dataCoveragePercent ?? 0}%، خصوصًا الحضور والمشتريات والتارجت وملاحظات الشيفت.`);
  if (current.followupsTotal > 0 && current.followupsClosed / current.followupsTotal < 0.6) items.push('نسبة إغلاق المتابعات أقل من 60%؛ الأولوية لإغلاق الحالات بنتيجة شراء أو سبب نهائي موثق.');
  if (current.customerRequestsTotal > 0 && current.customerRequestsClosed / current.customerRequestsTotal < 0.8) items.push('نسبة إغلاق طلبات العملاء أقل من 80%؛ راجع المتأخر والمسؤول عن الشراء والتواصل مع العميل.');
  if (current.averageScore !== null && current.averageScore < 60) items.push('الدرجة الحالية دون حد استحقاق الحافز؛ ركّز على أعلى البنود وزنًا قبل نهاية الدورة.');
  if (!items.length) items.push('الأداء والتغطية في وضع جيد؛ استمر على نفس معدل التنفيذ حتى إغلاق الدورة.');
  return items.slice(0, 4);
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
        <div className="flex items-center gap-2">
          {report && (
            <button type="button" onClick={() => exportReport(report)} className="flex items-center gap-1 rounded-lg border border-teal-500/30 px-2.5 py-1.5 text-xs font-bold text-teal-200 hover:bg-teal-500/10">
              <FileDown size={13} /> تصدير التقرير
            </button>
          )}
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

          <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
            <div className="rounded-xl border border-white/5 bg-black/20 p-3">
              <div className="text-xs font-black text-white">اتجاه المبيعات حسب الدورة</div>
              <div className="mt-3 flex h-36 items-end gap-2">
                {[...report.rows].reverse().map((row) => {
                  const maxSales = Math.max(1, ...report.rows.map((item) => item.salesTotal));
                  const height = row.operationalDataAvailable ? Math.max(4, Math.round((row.salesTotal / maxSales) * 100)) : 2;
                  return (
                    <div key={`chart-${row.cycleStart}`} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
                      <span className="text-[9px] font-bold text-slate-400">{row.salesTotal ? Math.round(row.salesTotal / 1000).toLocaleString('ar-EG') + 'ك' : '—'}</span>
                      <div className={`w-full max-w-10 rounded-t-md ${row.isCurrentCycle ? 'bg-teal-400' : 'bg-blue-500/70'}`} style={{ height: `${height}%` }} />
                      <span className="max-w-full truncate text-[8px] text-slate-500">{row.cycleStart.slice(5)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="rounded-xl border border-amber-400/15 bg-amber-950/10 p-3">
              <div className="flex items-center gap-1.5 text-xs font-black text-amber-200"><Lightbulb size={14} /> ملخص تنفيذي آلي</div>
              <ul className="mt-2 space-y-2 text-[11px] leading-5 text-slate-300">
                {recommendations(report).map((item) => <li key={item}>• {item}</li>)}
              </ul>
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
                      <div className={`mt-1 text-[9px] font-bold ${row.operationalDataAvailable ? 'text-emerald-300' : 'text-slate-600'}`}>
                        {row.operationalDataAvailable ? 'بيانات التشغيل متاحة' : 'لا توجد بيانات تشغيل'}
                      </div>
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
            {report.rows.filter((row) => row.operationalDataAvailable || row.averageScore !== null).map((row) => (
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
