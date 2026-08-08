import { useEffect, useMemo, useState } from 'react';
import { TrendingUp, TrendingDown, Users, UserPlus, UserCheck, UserX, AlertTriangle, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { getPharmacyCycleRange } from '@/lib/pharmacy-cycle';
import {
  fetchMonthlyCustomerPerformance,
  type MonthlyPerformanceSummary,
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

export default function CustomerMonthlyPerformance() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canSeeAllBranches = canViewAllBranches(user);
  const [mode, setMode] = useState<PeriodMode>('cycle');
  const [branch, setBranch] = useState<string>(() =>
    canSeeAllBranches ? ALL_BRANCHES_VALUE : user?.branch || BRANCHES?.[0] || 'فرع شكري'
  );
  const [summary, setSummary] = useState<MonthlyPerformanceSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const period = useMemo(
    () => (mode === 'cycle' ? getPharmacyCycleRange(new Date()) : calendarMonthRange(new Date())),
    [mode]
  );
  const prevPeriod = useMemo(() => previousPeriod(mode, period.start), [mode, period.start]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await fetchMonthlyCustomerPerformance(
        branch === ALL_BRANCHES_VALUE ? null : branch,
        period.start,
        period.end,
        prevPeriod.start,
        prevPeriod.end
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
  }, [branch, mode]);

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
        <span className="text-xs text-slate-400">
          {period.start} إلى {period.end} — مقارنة بـ {prevPeriod.start} إلى {prevPeriod.end}
        </span>
        <button type="button" onClick={() => void load()} className="btn-secondary flex items-center gap-2 text-xs" disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> تحديث
        </button>
      </div>

      {error && <p className="text-sm text-red-300">{error}</p>}
      {loading && <p className="text-sm text-slate-400">جارٍ الحساب... (ممكن ياخد لحد 10-15 ثانية لكل التاريخ المطلوب مراجعته)</p>}

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

          <div className="stat-card space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-black text-white">
                عملاء يحتاجون متابعتك النهاردة ({summary.needsAttention.length})
              </h2>
              <span className="text-xs text-slate-500">مرتبين حسب قيمة الخطر — الأعلى قيمة الأول</span>
            </div>
            {summary.needsAttention.length === 0 ? (
              <p className="text-sm text-slate-400">مفيش عملاء مهمين محتاجين تدخّل فوري دلوقتي — 🎉</p>
            ) : (
              <div className="space-y-2">
                {summary.needsAttention.slice(0, 30).map((c, i) => (
                  <div key={`${c.customer_code}-${i}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
                    <div>
                      <div className="font-bold text-white">{c.customer_name || 'غير معروف'} <span className="text-xs text-slate-500">({c.previous_segment})</span></div>
                      <div className="text-xs text-slate-400">
                        آخر شراء: {c.last_purchase_date || '—'} · كان بيصرف {fmtMoney(c.previous_month_sales)}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-sm font-black ${STATE_COLORS[c.customer_state] || 'text-slate-300'}`}>{c.customer_state}</span>
                      <button
                        type="button"
                        onClick={() =>
                          navigate(
                            `/customer-service?quickFollowup=1&code=${encodeURIComponent(c.customer_code || '')}&name=${encodeURIComponent(c.customer_name || '')}`
                          )
                        }
                        className="rounded-lg bg-teal-500 px-3 py-1.5 text-xs font-black text-slate-950"
                      >
                        متابعة الآن
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
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
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-sm font-black ${STATE_COLORS[c.customer_state] || 'text-slate-300'}`}>{c.customer_state}</span>
                      <button
                        type="button"
                        onClick={() =>
                          navigate(
                            `/customer-service?quickFollowup=1&code=${encodeURIComponent(c.customer_code || '')}&name=${encodeURIComponent(c.customer_name || '')}`
                          )
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
        </>
      )}
    </div>
  );
}
