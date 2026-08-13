import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import {
  Activity,
  AlertTriangle,
  RefreshCw,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react';
import {
  fetchCustomerCycleCohorts,
  fetchWatchlistPerformance,
  type CustomerCycleCohort,
  type WatchlistCustomerPerformance,
} from '@/lib/customerService/customerCohortIntelligenceService';

const money = (value: number) => `${Math.round(value || 0).toLocaleString('ar-EG')} ج.م`;
const percentChange = (current: number, previous: number) =>
  previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null;

function Change({ current, previous }: { current: number; previous: number }) {
  const value = percentChange(current, previous);
  if (value === null)
    return <span className="text-[10px] text-slate-500">لا توجد قاعدة مقارنة</span>;
  return (
    <span
      className={`flex items-center gap-1 text-[10px] font-black ${value >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}
    >
      {value >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      {value > 0 ? '+' : ''}
      {value}%
    </span>
  );
}

export default function CustomerCycleCohortPanel({ branch }: { branch: string }) {
  const { user } = useAuth();
  const [cohorts, setCohorts] = useState<CustomerCycleCohort[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistCustomerPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const asOfDate = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const load = useCallback(async () => {
    if (!branch) return;
    setLoading(true);
    setError('');
    const [cohortResult, watchlistResult] = await Promise.allSettled([
      fetchCustomerCycleCohorts(branch, asOfDate, user?.id),
      fetchWatchlistPerformance(branch, asOfDate, user?.id),
    ]);
    if (cohortResult.status === 'fulfilled') setCohorts(cohortResult.value);
    else {
      const rawMessage =
        cohortResult.reason instanceof Error ? cohortResult.reason.message : '';
      const isTimeout = /timeout|statement/i.test(rawMessage);
      setError(
        isTimeout
          ? 'المقارنة دي بتاخد وقت أطول من المتوقع لازدحام السيرفر مؤقتًا. جرّبي تضغطي تحديث تاني بعد شوية.'
          : 'تعذر تحميل مقارنة الدورات. جرّبي تحدّثي.'
      );
    }
    if (watchlistResult.status === 'fulfilled') setWatchlist(watchlistResult.value);
    setLoading(false);
  }, [asOfDate, branch]);

  useEffect(() => {
    void load();
  }, [load]);
  const current = cohorts[0];
  const previous = cohorts[1];

  return (
    <section
      className="space-y-4 rounded-3xl border border-cyan-400/20 bg-cyan-950/10 p-5"
      dir="rtl"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-black text-cyan-200">
            <Activity size={18} /> ذكاء أداء العملاء — نفس المدة من كل دورة
          </h2>
          <p className="mt-1 text-xs leading-5 text-slate-400">
            مقارنة عادلة من يوم 26 حتى نفس اليوم التشغيلي في الدورة الحالية والسابقتين، وليست مقارنة
            دورة جارية بدورة مكتملة.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-1 rounded-lg border border-cyan-400/20 px-3 py-1.5 text-xs font-bold text-cyan-200 disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> تحديث
        </button>
      </div>

      {error ? (
        <p className="rounded-xl border border-rose-400/20 bg-rose-500/10 p-3 text-xs text-rose-200">
          <AlertTriangle className="ml-1 inline" size={13} />
          {error}
        </p>
      ) : null}
      {current && previous ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ['إجمالي العملاء', current.customers_count, previous.customers_count],
            ['العملاء الجدد', current.new_count, previous.new_count],
            ['المهمون جدًا', current.very_important_count, previous.very_important_count],
            ['العملاء المستمرون', current.continuing_count, previous.continuing_count],
          ].map(([label, value, old]) => (
            <div key={String(label)} className="rounded-xl border border-white/5 bg-black/20 p-3">
              <div className="text-xs font-bold text-slate-400">{label}</div>
              <div className="mt-1 text-2xl font-black text-white">
                {Number(value).toLocaleString('ar-EG')}
              </div>
              <Change current={Number(value)} previous={Number(old)} />
            </div>
          ))}
        </div>
      ) : null}

      {cohorts.length ? (
        <div className="overflow-x-auto rounded-xl border border-white/5">
          <table className="w-full min-w-[1050px] text-right text-xs">
            <thead className="bg-slate-950/80 text-slate-400">
              <tr>
                {[
                  'الفترة المتطابقة',
                  'العملاء',
                  'مهم',
                  'مهم جدًا',
                  'جدد',
                  'مستمرون',
                  'مستعادون',
                  'الفواتير',
                  'المبيعات',
                  'المتابعات',
                  'عملاء تمت متابعتهم',
                  'إغلاق المتابعات',
                  'شراء بعد المتابعة',
                ].map((label) => (
                  <th key={label} className="p-3">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cohorts.map((row) => (
                <tr key={row.cycle_start} className="border-t border-white/5 text-slate-200">
                  <td className="p-3 font-bold text-white">
                    {row.cycle_start} ← {row.period_end}
                    <div className="text-[9px] text-slate-500">{row.elapsed_days} يوم</div>
                  </td>
                  <td className="p-3">{row.customers_count}</td>
                  <td className="p-3">{row.important_count}</td>
                  <td className="p-3">{row.very_important_count}</td>
                  <td className="p-3 text-emerald-300">{row.new_count}</td>
                  <td className="p-3">{row.continuing_count}</td>
                  <td className="p-3">{row.reactivated_count}</td>
                  <td className="p-3">{row.invoices_count}</td>
                  <td className="p-3 font-bold">{money(row.sales_total)}</td>
                  <td className="p-3">{row.followups_count}</td>
                  <td className="p-3">{row.followed_customers}</td>
                  <td className="p-3">
                    {row.followup_completion_rate === null
                      ? 'لا توجد متابعات'
                      : `${row.followup_completion_rate}%`}
                  </td>
                  <td className="p-3 text-teal-300">
                    {row.purchase_after_followup_count} · {money(row.recovered_sales)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : loading ? (
        <p className="text-xs text-slate-400">جاري إعداد المقارنة المتطابقة...</p>
      ) : null}

      <div className="rounded-2xl border border-amber-400/15 bg-amber-500/5 p-4">
        <h3 className="flex items-center gap-2 text-sm font-black text-amber-200">
          <ShieldCheck size={16} /> مراقبة أهم 20 عميل
        </h3>
        <p className="mt-1 text-[11px] text-slate-400">
          القائمة تُرفع من صفحة «أداء العملاء الشهري»، وهنا يظهر أداء كل عميل تلقائيًا في نفس المدة
          من الدورات الثلاث.
        </p>
        {watchlist.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[820px] text-right text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="p-2">الترتيب</th>
                  <th className="p-2">العميل</th>
                  {cohorts.map((cycle) => (
                    <th key={cycle.cycle_start} className="p-2">
                      {cycle.cycle_start}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {watchlist.map((customer) => (
                  <tr key={customer.customer_code} className="border-t border-white/5">
                    <td className="p-2 font-black text-amber-300">#{customer.rank}</td>
                    <td className="p-2">
                      <div className="font-bold text-white">
                        {customer.customer_name || customer.customer_code}
                      </div>
                      <div className="text-[9px] text-slate-500">كود {customer.customer_code}</div>
                    </td>
                    {customer.cycles.map((cycle) => (
                      <td key={cycle.cycle_start} className="p-2">
                        <div className="font-bold text-white">{money(cycle.sales_total)}</div>
                        <div className="text-[9px] text-slate-500">
                          {cycle.invoice_count} فاتورة · {cycle.followups_count} متابعة
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
            <Users size={14} /> لم تُرفع قائمة مراقبة لهذا الفرع بعد.
          </div>
        )}
      </div>
    </section>
  );
}
