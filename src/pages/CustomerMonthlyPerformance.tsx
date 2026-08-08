import { useEffect, useMemo, useState } from 'react';
import { TrendingUp, TrendingDown, Users, UserPlus, UserCheck, UserX, AlertTriangle, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { getPharmacyCycleRange } from '@/lib/pharmacy-cycle';
import {
  fetchMonthlyCustomerPerformance,
  type MonthlyPerformanceSummary,
  type CustomerMonthlyRow,
} from '@/lib/customerMonthlyPerformanceService';
import { BRANCHES } from '@/lib/constants';

type PeriodMode = 'cycle' | 'calendar';

const ALL_BRANCHES_VALUE = 'كل الفروع';

function calendarMonthRange(date: Date): { start: string; end: string } {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

function previousPeriod(mode: PeriodMode, start: string): { start: string; end: string } {
  const d = new Date(start);
  if (mode === 'cycle') {
    d.setDate(d.getDate() - 1); // يوم قبل بداية الدورة الحالية = آخر يوم في الدورة السابقة
    return getPharmacyCycleRange(d);
  }
  d.setDate(0); // آخر يوم في الشهر السابق
  return calendarMonthRange(d);
}

function fmtMoney(n: number) {
  return Math.round(n).toLocaleString('ar-EG') + ' ج.م';
}

const STATE_COLORS: Record<string, string> = {
  'جديد': 'text-emerald-300',
  'مستعاد': 'text-teal-300',
  'نمو قوي': 'text-emerald-400',
  'نمو': 'text-emerald-300',
  'مستقر': 'text-sky-300',
  'تراجع': 'text-amber-300',
  'تراجع قوي': 'text-red-400',
  'مختفي هذا الشهر': 'text-red-500',
};

function followupUrl(c: CustomerMonthlyRow) {
  const params = new URLSearchParams({ quickFollowup: '1' });
  if (c.customer_code) params.set('code', c.customer_code);
  if (c.customer_name) params.set('name', c.customer_name);
  if (c.phone) params.set('phone', c.phone);
  const payload = { code: c.customer_code || '', name: c.customer_name || '', phone: c.phone || '' };
  console.log('[dawaa-debug] followupUrl building for customer:', payload);
  try {
    sessionStorage.setItem('dawaa_pending_followup_customer', JSON.stringify(payload));
    console.log('[dawaa-debug] sessionStorage write OK, readback:', sessionStorage.getItem('dawaa_pending_followup_customer'));
  } catch (err) {
    console.log('[dawaa-debug] sessionStorage write FAILED:', err);
  }
  const url = `/customer-service?${params.toString()}`;
  console.log('[dawaa-debug] navigating to:', url);
  return url;
}

const STATE_FILTER_OPTIONS = ['الكل', 'تراجع قوي', 'مختفي هذا الشهر', 'تراجع'];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function CustomerMonthlyPerformance() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canSeeAllBranches = canViewAllBranches(user);
  const [mode, setMode] = useState<PeriodMode>('cycle');
  const [refDate, setRefDate] = useState<string>(() => todayStr());
  const [stateFilter, setStateFilter] = useState<string>('الكل');
  const [listTab, setListTab] = useState<'declining' | 'improving'>('declining');
  const [branch, setBranch] = useState<string>(() =>
    canSeeAllBranches ? ALL_BRANCHES_VALUE : user?.branch || BRANCHES?.[0] || 'فرع شكري'
  );
  const [summary, setSummary] = useState<
    (MonthlyPerformanceSummary & { computedAt: string | null; fromCache: boolean }) | null
  >(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const period = useMemo(
    () => (mode === 'cycle' ? getPharmacyCycleRange(new Date(refDate)) : calendarMonthRange(new Date(refDate))),
    [mode, refDate]
  );
  const prevPeriod = useMemo(() => previousPeriod(mode, period.start), [mode, period.start]);
  const isCurrentPeriod = refDate === todayStr();

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await fetchMonthlyCustomerPerformance(
        branch === ALL_BRANCHES_VALUE ? null : branch,
        period.start,
        period.end,
        prevPeriod.start,
        prevPeriod.end,
        mode
      );
      setSummary(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل البيانات');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch, mode, refDate]);

  const salesChangePct =
    summary && summary.previousTotalSales > 0
      ? Math.round(((summary.totalSales - summary.previousTotalSales) / summary.previousTotalSales) * 1000) / 10
      : null;

  return (
    <div dir="rtl" className="space-y-6 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <Users className="h-6 w-6 text-teal-300" />
        <div>
          <h1 className="text-xl font-black text-white">أداء العملاء الشهري</h1>
          <p className="text-sm text-slate-400">كسبنا كام عميل، فقدنا كام، مين محتاج متابعة النهاردة — في أقل من دقيقة.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex overflow-hidden rounded-xl border border-white/10">
          <button
            type="button"
            onClick={() => setMode('cycle')}
            className={`px-4 py-2 text-sm font-bold ${mode === 'cycle' ? 'bg-teal-500 text-slate-950' : 'text-slate-300'}`}
          >
            دورة دواء 26-25
          </button>
          <button
            type="button"
            onClick={() => setMode('calendar')}
            className={`px-4 py-2 text-sm font-bold ${mode === 'calendar' ? 'bg-teal-500 text-slate-950' : 'text-slate-300'}`}
          >
            الشهر الميلادي
          </button>
        </div>
        {canSeeAllBranches ? (
          <select className="input-dark" value={branch} onChange={(e) => setBranch(e.target.value)}>
            <option value={ALL_BRANCHES_VALUE}>{ALL_BRANCHES_VALUE}</option>
            {(BRANCHES || ['فرع شكري', 'فرع الشامي']).map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        ) : (
          <span className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-white">
            {branch}
          </span>
        )}
        <div className="flex items-center gap-1">
          <input
            type="date"
            className="input-dark"
            value={refDate}
            max={todayStr()}
            onChange={(e) => setRefDate(e.target.value || todayStr())}
          />
          {!isCurrentPeriod && (
            <button type="button" onClick={() => setRefDate(todayStr())} className="btn-secondary text-xs">
              الفترة الحالية
            </button>
          )}
        </div>
        <span className="text-xs text-slate-400">
          {period.start} إلى {period.end} — مقارنة بـ {prevPeriod.start} إلى {prevPeriod.end}
        </span>
        {summary?.computedAt && (
          <span className="rounded-full bg-teal-500/10 px-3 py-1 text-xs font-bold text-teal-300">
            آخر تحديث: {new Date(summary.computedAt).toLocaleString('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
        <button type="button" onClick={() => void load()} className="btn-secondary flex items-center gap-2 text-xs" disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> تحديث
        </button>
      </div>

      {error && <p className="text-sm text-red-300">{error}</p>}
      {loading && (
        <p className="text-sm text-slate-400">
          جارٍ التحميل...{!isCurrentPeriod && ' (فترة تاريخية مش مخزّنة، ممكن تاخد لحد 10-15 ثانية)'}
        </p>
      )}

      {summary && !loading && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="stat-card space-y-1">
              <div className="flex items-center gap-2 text-emerald-300"><UserPlus size={18} /><span className="text-xs font-bold">عملاء جدد</span></div>
              <div className="text-3xl font-black text-white">{summary.newCount}</div>
            </div>
            <div className="stat-card space-y-1">
              <div className="flex items-center gap-2 text-teal-300"><UserCheck size={18} /><span className="text-xs font-bold">عملاء مستعادين</span></div>
              <div className="text-3xl font-black text-white">{summary.reactivatedCount}</div>
            </div>
            <div className="stat-card space-y-1">
              <div className="flex items-center gap-2 text-red-400"><UserX size={18} /><span className="text-xs font-bold">اختفوا تمامًا</span></div>
              <div className="text-3xl font-black text-white">{summary.lostCount}</div>
            </div>
            <div className="stat-card space-y-1">
              <div className="flex items-center gap-2 text-amber-300"><TrendingDown size={18} /><span className="text-xs font-bold">تراجعوا بقوة</span></div>
              <div className="text-3xl font-black text-white">{summary.strongDeclineCount}</div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="stat-card space-y-1">
              <div className="text-xs font-bold text-slate-400">صافي نمو العملاء (جدد + مستعادين - مختفين)</div>
              <div className={`text-3xl font-black ${summary.netCustomerGrowth >= 0 ? 'text-emerald-300' : 'text-red-400'}`}>
                {summary.netCustomerGrowth >= 0 ? '+' : ''}{summary.netCustomerGrowth}
              </div>
            </div>
            <div className="stat-card space-y-1">
              <div className="text-xs font-bold text-slate-400">إجمالي المبيعات (مقارنة بالفترة السابقة)</div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-black text-white">{fmtMoney(summary.totalSales)}</span>
                {salesChangePct !== null && (
                  <span className={`flex items-center gap-1 text-xs font-bold ${salesChangePct >= 0 ? 'text-emerald-300' : 'text-red-400'}`}>
                    {salesChangePct >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                    {salesChangePct}%
                  </span>
                )}
              </div>
            </div>
            <div className="stat-card space-y-1">
              <div className="flex items-center gap-2 text-red-300 text-xs font-bold"><AlertTriangle size={14} /> إيراد معرّض للخطر</div>
              <div className="text-2xl font-black text-red-300">{fmtMoney(summary.revenueAtRisk)}</div>
              <div className="text-[11px] text-slate-500">من عملاء اختفوا أو تراجعوا بقوة</div>
            </div>
          </div>

          <div className="flex overflow-hidden rounded-xl border border-white/10 w-fit">
            <button
              type="button"
              onClick={() => setListTab('declining')}
              className={`flex items-center gap-2 px-5 py-2.5 text-sm font-bold ${listTab === 'declining' ? 'bg-red-500 text-slate-950' : 'text-slate-300'}`}
            >
              <TrendingDown size={16} /> العملاء المتراجعين ({summary.needsAttention.length})
            </button>
            <button
              type="button"
              onClick={() => setListTab('improving')}
              className={`flex items-center gap-2 px-5 py-2.5 text-sm font-bold ${listTab === 'improving' ? 'bg-emerald-500 text-slate-950' : 'text-slate-300'}`}
            >
              <TrendingUp size={16} /> العملاء المتحسنين ({summary.improving.length})
            </button>
          </div>

          {listTab === 'declining' && (
          <div className="stat-card space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-black text-white">
                عملاء يحتاجون متابعتك النهاردة ({summary.needsAttention.filter((c) => stateFilter === 'الكل' || c.customer_state === stateFilter).length})
              </h2>
              <div className="flex items-center gap-2">
                <select className="input-dark text-xs" value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}>
                  {STATE_FILTER_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s === 'الكل' ? 'كل الحالات' : s}</option>
                  ))}
                </select>
                <span className="text-xs text-slate-500">مرتبين حسب قيمة الخطر</span>
              </div>
            </div>
            {(() => {
              const filtered = summary.needsAttention.filter((c) => stateFilter === 'الكل' || c.customer_state === stateFilter);
              return filtered.length === 0 ? (
                <p className="text-sm text-slate-400">مفيش عملاء مطابقين للفلتر ده دلوقتي — 🎉</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-right text-xs text-slate-500">
                        <th className="pb-2 font-bold">العميل</th>
                        <th className="pb-2 font-bold">قبل 3 شهور</th>
                        <th className="pb-2 font-bold">قبل شهرين</th>
                        <th className="pb-2 font-bold">الشهر السابق</th>
                        <th className="pb-2 font-bold">الشهر الحالي</th>
                        <th className="pb-2 font-bold">الحالة</th>
                        <th className="pb-2 font-bold"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.slice(0, 30).map((c, i) => (
                        <tr key={`${c.customer_code}-${i}`} className="border-t border-white/5">
                          <td className="py-2">
                            <div className="font-bold text-white">{c.customer_name || 'غير معروف'}</div>
                            <div className="text-[11px] text-slate-500">
                              ({c.previous_segment}) · آخر شراء: {c.last_purchase_date || '—'}
                              {branch === ALL_BRANCHES_VALUE && <span className="text-teal-400"> · {c.branch}</span>}
                              {c.customer_code && <span> · كود {c.customer_code}</span>}
                            </div>
                          </td>
                          <td className="py-2 text-slate-300">{fmtMoney(c.month_3_ago_sales)}</td>
                          <td className="py-2 text-slate-300">{fmtMoney(c.month_2_ago_sales)}</td>
                          <td className="py-2 text-slate-300">{fmtMoney(c.previous_month_sales)}</td>
                          <td className="py-2 text-slate-300">{fmtMoney(c.sales_amount)}</td>
                          <td className="py-2"><span className={`text-xs font-black ${STATE_COLORS[c.customer_state] || 'text-slate-300'}`}>{c.customer_state}</span></td>
                          <td className="py-2">
                            <button
                              type="button"
                              onClick={() => navigate(followupUrl(c))}
                              className="rounded-lg bg-teal-500 px-3 py-1.5 text-xs font-black text-slate-950"
                            >
                              متابعة الآن
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
          )}
          {listTab === 'improving' && (
          <div className="stat-card space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-black text-white">
                عملاء متحسنين محتاجين شكر واهتمام ({summary.improving.length})
              </h2>
              <span className="text-xs text-slate-500">مرتبين حسب أعلى زيادة في المبيعات</span>
            </div>
            {summary.improving.length === 0 ? (
              <p className="text-sm text-slate-400">مفيش عملاء مهمين بيتحسنوا بشكل ملحوظ في الفترة دي دلوقتي.</p>
            ) : (
              <div className="space-y-2">
                {summary.improving.slice(0, 30).map((c, i) => (
                  <div key={`${c.customer_code}-${i}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/5 p-3">
                    <div>
                      <div className="font-bold text-white">{c.customer_name || 'غير معروف'} <span className="text-xs text-slate-500">({c.current_segment})</span></div>
                      <div className="text-xs text-slate-400">
                        آخر شراء: {c.last_purchase_date || '—'} · دلوقتي بيصرف {fmtMoney(c.sales_amount)}
                        {c.sales_change_amount > 0 && <span className="text-emerald-300"> (+{fmtMoney(c.sales_change_amount)})</span>}
                        {branch === ALL_BRANCHES_VALUE && <span className="text-teal-400"> · {c.branch}</span>}
                        {c.customer_code && <span> · كود {c.customer_code}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-sm font-black ${STATE_COLORS[c.customer_state] || 'text-slate-300'}`}>{c.customer_state}</span>
                      <button
                        type="button"
                        onClick={() =>
                          navigate(followupUrl(c))
                        }
                        className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-black text-slate-950"
                      >
                        اتصال شكر
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          )}
        </>
      )}
    </div>
  );
}
