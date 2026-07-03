import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Medal, RefreshCw, Trophy } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import {
  getDoctorCompetitionMetrics,
  normalizeDoctorName,
  pickInvoiceAmount,
  type DoctorCompetitionScore,
  type DoctorCompetitionMetrics,
} from '@/lib/doctorCompetitionMetrics';
import { useAuth } from '@/hooks/useAuth';
import { BRANCHES } from '@/lib/constants';
import { getPharmacyCycleRange } from '@/lib/pharmacy-cycle';
import { canViewAllBranches, isDoctorRole, rowMatchesCurrentDoctor } from '@/lib/security/userDataScope';
import { getBranchScope } from '@/lib/security/permissionScopes';
import { normalizeBranchName } from '@/lib/branch';

type Period = 'last30' | 'last90' | 'last_3_months' | 'cycle' | 'custom';
type RankingTab = 'sales' | 'avgInvoice' | 'incentive' | 'reviews' | 'service' | 'overall';
type DoctorScore = DoctorCompetitionScore;

const MIN_AVG_INVOICE_THRESHOLD = 30;
const ALL_BRANCHES = 'كل الفروع';

function num(value: unknown) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function text(value: unknown) {
  return String(value || '').trim();
}

function money(value: number) {
  return `${value.toLocaleString('ar-EG', { maximumFractionDigits: 0 })} ج`;
}

function invoiceDate(row: Record<string, unknown>) {
  const value = text(row.invoice_date || row.invoice_datetime || row.date || row.sale_date || row.created_at);
  return value.slice(0, 10);
}

function invoiceAmount(row: Record<string, unknown>) {
  return pickInvoiceAmount(row);
}

function invoiceDoctor(row: Record<string, unknown>) {
  const name = text(
    row.doctor_name ||
      row.seller_name ||
      row.staff_name ||
      row.pharmacist_name ||
      row.cashier_name ||
      row.created_by_name ||
      row.user_name
  );
  if (!name && import.meta.env.DEV) console.warn('[DoctorCompetition] missing doctor column in invoice', row);
  return normalizeDoctorName(name);
}

function rangeFor(period: Period, customStart: string, customEnd: string) {
  const now = new Date();
  if (period === 'last30') {
    const start = new Date(now);
    start.setDate(start.getDate() - 30);
    return { start: start.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
  }
  if (period === 'last90' || period === 'last_3_months') {
    const start = new Date(now);
    start.setMonth(start.getMonth() - 3);
    return { start: start.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
  }
  if (period === 'custom') return { start: customStart, end: customEnd || customStart };
  return getPharmacyCycleRange(now);
}

function emptyDoctor(name: string, branch: string): DoctorScore {
  return {
    name,
    branch,
    totalSales: 0,
    invoices: 0,
    avgInvoice: 0,
    growthRate: null,
    growthRateStatus: 'unavailable',
    listItems: 0,
    stagnantItems: 0,
    stagnantStatus: 'disabled',
    incentiveValue: 0,
    totalQuantity: 0,
    linkedInvoiceCount: 0,
    reviewCount: 0,
    reviewTotal: 0,
    excellentReviews: 0,
    negativeReviews: 0,
    followups: 0,
    completedFollowups: 0,
    recoveredCustomers: 0,
    followupSales: 0,
    satisfactionTotal: 0,
    satisfactionCount: 0,
    reviewIssues: [],
    overallScore: 0,
    leaderboardEligible: false,
    avgInvoiceEligible: false,
    ineligibleReasons: [],
  };
}

function avgReview(row: DoctorScore) {
  return row.reviewCount ? row.reviewTotal / row.reviewCount : 0;
}

function customerServiceAvg(row: DoctorScore) {
  return row.satisfactionCount ? row.satisfactionTotal / row.satisfactionCount : 0;
}

function normalizeScores(rows: DoctorScore[]) {
  const hasIncentiveData = rows.some((row) => row.stagnantStatus === 'available');
  const max = {
    sales: Math.max(1, ...rows.map((row) => row.totalSales)),
    avgInvoice: Math.max(1, ...rows.filter((row) => row.invoices >= MIN_AVG_INVOICE_THRESHOLD).map((row) => row.avgInvoice)),
    incentive: Math.max(1, ...rows.map((row) => row.stagnantStatus === 'available' ? row.incentiveValue + row.listItems * 100 + row.stagnantItems * 100 : 0)),
    review: Math.max(1, ...rows.map(avgReview)),
    service: Math.max(1, ...rows.map((row) => row.completedFollowups + row.recoveredCustomers * 2 + customerServiceAvg(row))),
  };
  return rows.map((row) => {
    const salesScore = (row.totalSales / max.sales) * 100;
    const avgInvoiceScore = row.invoices >= MIN_AVG_INVOICE_THRESHOLD ? (row.avgInvoice / max.avgInvoice) * 100 : 0;
    const incentiveScore = hasIncentiveData && row.stagnantStatus === 'available' ? ((row.incentiveValue + row.listItems * 100 + row.stagnantItems * 100) / max.incentive) * 100 : 0;
    const reviewScore = (avgReview(row) / max.review) * 100;
    const serviceScore = ((row.completedFollowups + row.recoveredCustomers * 2 + customerServiceAvg(row)) / max.service) * 100;
    const incentiveWeight = hasIncentiveData ? 0.2 : 0;
    const totalWeight = 0.3 + 0.2 + incentiveWeight + 0.2 + 0.1;
    return {
      ...row,
      overallScore: (salesScore * 0.3 + avgInvoiceScore * 0.2 + incentiveScore * incentiveWeight + reviewScore * 0.2 + serviceScore * 0.1) / totalWeight,
    };
  });
}

function growthText(row: Pick<DoctorScore, 'growthRate' | 'growthRateStatus'>) {
  return row.growthRateStatus === 'available' && row.growthRate != null ? `${row.growthRate.toFixed(1)}%` : 'غير متاح';
}

function incentiveText(row: Pick<DoctorScore, 'stagnantStatus' | 'stagnantItems' | 'listItems' | 'incentiveValue'>) {
  return row.stagnantStatus === 'available' ? `${row.stagnantItems + row.listItems} / ${money(row.incentiveValue)}` : 'غير مفعل';
}

export default function DoctorCompetition() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const requestedBranch = params.get('branch')?.trim() || ALL_BRANCHES;
  const initialPeriod = params.get('period')?.trim() as Period | null;
  const initialFocus = params.get('focus')?.trim() || '';
  const canAllBranches = canViewAllBranches(user);
  const [period, setPeriod] = useState<Period>(['last30', 'last90', 'last_3_months', 'cycle', 'custom'].includes(initialPeriod || '') ? (initialPeriod as Period) : 'cycle');
  const [branchFilter, setBranchFilter] = useState(
    () => (canAllBranches ? requestedBranch : normalizeBranchName(user?.branch || requestedBranch) || ALL_BRANCHES)
  );
  const [rows, setRows] = useState<Array<DoctorScore & { overallScore: number }>>([]);
  const [reviewRows, setReviewRows] = useState<Array<DoctorScore & { overallScore: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempted, setLoadAttempted] = useState(false);
  const [metricsMetadata, setMetricsMetadata] = useState<DoctorCompetitionMetrics['metadata'] | null>(null);
  const lastGoodRowsRef = useRef<Array<DoctorScore & { overallScore: number }>>([]);
  const [scopeWarning, setScopeWarning] = useState<string | null>(null);
  const [last90Available, setLast90Available] = useState(true);
  const [reviewSourceAvailable, setReviewSourceAvailable] = useState(true);
  const [followupSourceAvailable, setFollowupSourceAvailable] = useState(true);
  const [stagnantSourceAvailable, setStagnantSourceAvailable] = useState(false);
  const currentCycle = getPharmacyCycleRange(new Date());
  const [customStart, setCustomStart] = useState(currentCycle.start);
  const [customEnd, setCustomEnd] = useState(currentCycle.end);
  const allBranchesAllowed = canViewAllBranches(user);
  const doctorScoped = isDoctorRole(user);
  const effectiveBranch = getBranchScope(user, branchFilter, ALL_BRANCHES);
  useEffect(() => {
    if (!allBranchesAllowed) {
      setBranchFilter(normalizeBranchName(user?.branch || requestedBranch) || ALL_BRANCHES);
    }
  }, [allBranchesAllowed, requestedBranch, user?.branch]);
  const [rankingTab, setRankingTab] = useState<RankingTab>(
    initialFocus === 'sales'
      ? 'sales'
      : initialFocus === 'average_invoice'
        ? 'avgInvoice'
        : initialFocus === 'incentive'
          ? 'incentive'
          : initialFocus === 'reviews'
            ? 'reviews'
            : 'overall'
  );
  const [selectedDoctor, setSelectedDoctor] = useState<(DoctorScore & { overallScore: number }) | null>(null);
  const cycle = useMemo(() => rangeFor(period, customStart, customEnd), [customEnd, customStart, period]);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    setLoadAttempted(true);
    try {
      const metrics = await getDoctorCompetitionMetrics({
        period,
        customStart,
        customEnd,
        branch: effectiveBranch,
        userBranch: user?.branch,
        canSeeAllBranches: allBranchesAllowed,
      });
      const allRows = metrics.rows;
      setReviewRows(metrics.reviewRows);
      setMetricsMetadata(metrics.metadata);
      const doctorRows = doctorScoped
        ? allRows.filter((row) => rowMatchesCurrentDoctor(user, { ...row, doctor_name: row.name }))
        : allRows;
      const scopedRows = doctorScoped && !doctorRows.length && allRows.length ? allRows : doctorRows;
      setScopeWarning(
        doctorScoped && !doctorRows.length && allRows.length
          ? 'Sales exist, but the current doctor account is not linked exactly to invoice seller_name. Showing branch ranking temporarily.'
          : null
      );
      if (scopedRows.length) {
        lastGoodRowsRef.current = scopedRows;
        setRows(scopedRows);
      } else {
        setRows(lastGoodRowsRef.current.length ? lastGoodRowsRef.current : scopedRows);
      }
      setReviewSourceAvailable(metrics.sourceHealth.conversation_sales_reviews !== 'unavailable');
      setFollowupSourceAvailable(metrics.sourceHealth.daily_followups !== 'unavailable');
      setLast90Available(metrics.sourceHealth.sales_invoices !== 'unavailable');
      setStagnantSourceAvailable(
        metrics.sourceHealth.stagnant_medicine_dispenses === 'ready' ||
          metrics.sourceHealth.incentive_medicine_sales === 'ready'
      );
      if (Object.keys(metrics.errors).length && import.meta.env.DEV) {
        console.warn('[DoctorCompetition] source errors', {
          range: metrics.range,
          branch: effectiveBranch,
          errors: metrics.errors,
        });
      }
    } catch (error) {
      console.warn('[DoctorCompetition] failed', error);
      setLoadError('تعذر تحميل بيانات المسابقات الآن. سيتم عرض آخر بيانات ناجحة إن وجدت.');
      setScopeWarning('Competition refresh failed temporarily. Keeping the last successful data if available.');
      setRows(lastGoodRowsRef.current);
      setMetricsMetadata(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [period, effectiveBranch, customStart, customEnd, allBranchesAllowed, doctorScoped, user?.id, user?.staffId, user?.name, user?.username, user?.branch]);

  const topSales = [...rows].sort((a, b) => b.totalSales - a.totalSales)[0];
  const topAvgInvoice = [...rows].filter((row) => row.invoices >= MIN_AVG_INVOICE_THRESHOLD).sort((a, b) => b.avgInvoice - a.avgInvoice)[0];
  const topIncentive = [...rows].filter((row) => row.stagnantStatus === 'available').sort((a, b) => b.incentiveValue + b.listItems + b.stagnantItems - (a.incentiveValue + a.listItems + a.stagnantItems))[0];
  const topReviews = [...rows].filter((row) => row.reviewCount > 0).sort((a, b) => avgReview(b) - avgReview(a))[0];
  const topService = [...rows].sort((a, b) => b.recoveredCustomers + b.completedFollowups - (a.recoveredCustomers + a.completedFollowups))[0];
  const topOverall = rows[0];
  const rankingRows = useMemo(() => {
    const sorted = [...rows];
    if (rankingTab === 'sales') return sorted.sort((a, b) => b.totalSales - a.totalSales);
    if (rankingTab === 'avgInvoice') return sorted.sort((a, b) => (b.invoices >= MIN_AVG_INVOICE_THRESHOLD ? b.avgInvoice : 0) - (a.invoices >= MIN_AVG_INVOICE_THRESHOLD ? a.avgInvoice : 0));
    if (rankingTab === 'incentive') return sorted.sort((a, b) => (b.stagnantStatus === 'available' ? b.incentiveValue + b.listItems + b.stagnantItems : -1) - (a.stagnantStatus === 'available' ? a.incentiveValue + a.listItems + a.stagnantItems : -1));
    if (rankingTab === 'reviews') return sorted.sort((a, b) => avgReview(b) - avgReview(a));
    if (rankingTab === 'service') return sorted.sort((a, b) => b.completedFollowups + b.recoveredCustomers - (a.completedFollowups + a.recoveredCustomers));
    return sorted.sort((a, b) => b.overallScore - a.overallScore);
  }, [rankingTab, rows]);

  const exportCsv = () => {
    const exportRows = [...rows, ...reviewRows.filter((reviewRow) => !rows.some((row) => row.name === reviewRow.name && row.branch === reviewRow.branch))];
    const header = [
      'doctor_name',
      'branch',
      'staff_id',
      'total_sales',
      'invoices_count',
      'average_invoice',
      'overall_score',
      'leaderboard_eligible',
      'ineligible_reason',
      'avg_invoice_eligible',
      'growth_rate',
      'growth_rate_status',
      'stagnant_status',
      'review_flags',
    ];
    const body = exportRows.map((row) =>
      [
        row.name,
        row.branch,
        row.staffId || '',
        row.totalSales,
        row.invoices,
        row.avgInvoice.toFixed(2),
        row.overallScore.toFixed(2),
        row.leaderboardEligible ? 'true' : 'false',
        row.ineligibleReasons.join(' | '),
        row.avgInvoiceEligible ? 'true' : 'false',
        row.growthRate != null ? row.growthRate.toFixed(2) : '',
        row.growthRateStatus === 'available' ? 'available' : 'unavailable',
        row.stagnantStatus === 'available' ? 'available' : 'disabled',
        row.reviewIssues.join(' | '),
      ].join(',')
    );
    const blob = new Blob([[header.join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `doctor-competition-${cycle.start}-${cycle.end}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const showInitialSkeleton = loading && !loadAttempted && !rows.length && !lastGoodRowsRef.current.length;

  return (
    <div className="space-y-5" dir="rtl">
      <section className="rounded-3xl border border-amber-400/30 bg-slate-950 p-5 text-slate-100">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-black text-white">مسابقة الدكاترة</h1>
            <p className="mt-2 text-sm text-slate-300">تحليل أداء الدورة الحالية افتراضيًا من الفواتير، التقييمات، والمتابعات.</p>
            <p className="mt-1 text-xs text-amber-200">الفترة: {cycle.start} إلى {cycle.end}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={exportCsv} disabled={!rows.length}><Download className="ml-1 inline h-4 w-4" /> Export CSV</button>
            <button className="btn-primary" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? 'ml-1 inline h-4 w-4 animate-spin' : 'ml-1 inline h-4 w-4'} /> تحديث</button>
          </div>
        </div>
      </section>

      {scopeWarning && (
        <div className="rounded-2xl border border-amber-300/30 bg-amber-400/10 px-4 py-3 text-sm font-bold text-amber-100">
          {scopeWarning}
        </div>
      )}
      {loadError && (
        <div className="rounded-2xl border border-rose-300/30 bg-rose-400/10 px-4 py-3 text-sm font-bold text-rose-100">
          {loadError}
        </div>
      )}

      {showInitialSkeleton ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="h-32 animate-pulse rounded-3xl border border-slate-700 bg-slate-900/70" />
            ))}
          </div>
          <div className="dawaa-panel overflow-hidden">
            <div className="mb-4 h-10 w-48 animate-pulse rounded-xl bg-slate-800" />
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="h-12 animate-pulse rounded-xl bg-slate-800/80" />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <>
      <section className="dawaa-panel grid gap-3 md:grid-cols-4">
        <select className="input-dark" value={period} onChange={(event) => setPeriod(event.target.value as Period)}>
          <option value="last30">آخر 30 يوم</option>
          <option value="last90">آخر 3 شهور</option>
          <option value="cycle">الدورة الحالية 26 إلى 25</option>
          <option value="custom">تاريخ مخصص</option>
        </select>
        {allBranchesAllowed ? (
          <select className="input-dark" value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}>
            <option>{ALL_BRANCHES}</option>
            {BRANCHES.map((branch) => <option key={branch}>{branch}</option>)}
          </select>
        ) : (
          <div className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-bold text-slate-200">
            {effectiveBranch}
          </div>
        )}
        <input className="input-dark" type="date" value={customStart} disabled={period !== 'custom'} onChange={(event) => setCustomStart(event.target.value)} />
        <input className="input-dark" type="date" value={customEnd} disabled={period !== 'custom'} onChange={(event) => setCustomEnd(event.target.value)} />
      </section>

      <section className="rounded-3xl border border-amber-400/30 bg-slate-950/80 p-5">
        <h2 className="text-2xl font-black text-white">لوحة مسابقات الدكاترة</h2>
        <p className="mt-1 text-sm text-slate-300">أبطال الفترة حسب المبيعات، متوسط الفاتورة، الرواكد واللستة، تقييم المحادثات، وخدمة العملاء.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Winner title="بطل المبيعات" row={topSales} value={topSales ? money(topSales.totalSales) : 'لا يوجد'} reason={topSales ? `${topSales.invoices} فاتورة · متوسط ${money(topSales.avgInvoice)}` : 'لا توجد بيانات كافية'} />
          <Winner title="بطل متوسط الفاتورة" row={topAvgInvoice} value={topAvgInvoice ? money(topAvgInvoice.avgInvoice) : `يتطلب ${MIN_AVG_INVOICE_THRESHOLD} فاتورة`} reason={topAvgInvoice ? `${topAvgInvoice.invoices} فاتورة مؤهلة` : 'لا يوجد دكتور تجاوز الحد الأدنى'} />
          <Winner title="بطل الرواكد واللستة" row={topIncentive} value={stagnantSourceAvailable && topIncentive ? money(topIncentive.incentiveValue) : 'غير مفعل'} reason={stagnantSourceAvailable && topIncentive ? `${topIncentive.stagnantItems} رواكد · ${topIncentive.listItems} لستة` : 'بيانات الرواكد واللستة غير مربوطة حاليًا بالمسابقة'} />
          <Winner title="بطل تقييم المحادثات" row={topReviews} value={topReviews ? `${avgReview(topReviews).toFixed(1)}/100` : 'لا توجد بيانات تقييم كافية'} reason={topReviews ? `${topReviews.reviewCount} تقييم · ${topReviews.excellentReviews} ممتاز` : 'لا توجد مراجعات كافية'} />
          <Winner title="البطل الشامل" row={topOverall} value={topOverall ? `${topOverall.overallScore.toFixed(1)} نقطة` : 'لا يوجد'} reason="المبيعات 30% · المتوسط 20% · الرواكد 20% · التقييم 20% · خدمة العملاء 10%" />
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Winner title="أفضل شامل" row={topOverall} value={topOverall ? `${topOverall.overallScore.toFixed(1)} نقطة` : 'لا يوجد'} />
        <Winner title="أفضل مبيعات" row={topSales} value={topSales ? money(topSales.totalSales) : 'لا يوجد'} />
        <Winner title="أفضل متوسط فاتورة" row={topAvgInvoice} value={topAvgInvoice ? money(topAvgInvoice.avgInvoice) : `يتطلب ${MIN_AVG_INVOICE_THRESHOLD} فاتورة`} />
        <Winner title="أفضل رواكد ولستة" row={topIncentive} value={stagnantSourceAvailable && topIncentive ? money(topIncentive.incentiveValue) : 'غير مفعل'} />
        <Winner title="أفضل تقييم محادثات" row={topReviews} value={topReviews ? `${avgReview(topReviews).toFixed(1)}/100` : 'لا يوجد'} />
        <Winner title="أفضل خدمة عملاء" row={topService} value={topService ? `${topService.completedFollowups} متابعة` : 'لا يوجد'} />
      </section>

      <section className="dawaa-panel max-w-full min-w-0 overflow-x-auto">
        <div className="mb-4 flex flex-wrap gap-2">
          {[
            ['sales', 'ترتيب المبيعات'],
            ['avgInvoice', 'ترتيب متوسط الفاتورة'],
            ['incentive', 'ترتيب الرواكد واللستة'],
            ['reviews', 'ترتيب تقييم المحادثات'],
            ['service', 'ترتيب خدمة العملاء'],
            ['overall', 'الترتيب الشامل'],
          ].map(([key, label]) => (
            <button key={key} className={rankingTab === key ? 'btn-primary' : 'btn-secondary'} onClick={() => setRankingTab(key as RankingTab)}>
              {label}
            </button>
          ))}
        </div>
        <table className="w-full min-w-[980px] table-fixed text-xs md:text-sm">
          <thead className="border-y-2 border-cyan-300/80" style={{ backgroundColor: '#020617' }}>
            <tr className="text-right" style={{ backgroundColor: '#020617' }}>
              <th className="w-12 border-l border-cyan-300/30 px-2 py-3 text-right align-middle text-xs font-black leading-5" style={{ backgroundColor: '#020617' }}>
                <span className="block" style={{ color: '#ffffff', textShadow: '0 1px 2px rgba(0,0,0,0.9)' }}>#</span>
              </th>
              <th className="border-l border-cyan-300/30 px-2 py-3 text-right align-middle text-xs font-black leading-5" style={{ backgroundColor: '#020617' }}>
                <span className="block" style={{ color: '#ffffff', textShadow: '0 1px 2px rgba(0,0,0,0.9)' }}>الدكتور</span>
              </th>
              <th className="border-l border-cyan-300/30 px-2 py-3 text-right align-middle text-xs font-black leading-5" style={{ backgroundColor: '#020617' }}>
                <span className="block" style={{ color: '#ffffff', textShadow: '0 1px 2px rgba(0,0,0,0.9)' }}>الفرع</span>
              </th>
              <th className="border-l border-cyan-300/30 px-2 py-3 text-right align-middle text-xs font-black leading-5" style={{ backgroundColor: '#020617' }}>
                <span className="block" style={{ color: '#ffffff', textShadow: '0 1px 2px rgba(0,0,0,0.9)' }}>الشامل</span>
              </th>
              <th className="border-l border-cyan-300/30 px-2 py-3 text-right align-middle text-xs font-black leading-5" style={{ backgroundColor: '#020617' }}>
                <span className="block" style={{ color: '#ffffff', textShadow: '0 1px 2px rgba(0,0,0,0.9)' }}>صافي مبيعات الدورة</span>
              </th>
              <th className="border-l border-cyan-300/30 px-2 py-3 text-right align-middle text-xs font-black leading-5" style={{ backgroundColor: '#020617' }}>
                <span className="block" style={{ color: '#ffffff', textShadow: '0 1px 2px rgba(0,0,0,0.9)' }}>الفواتير</span>
              </th>
              <th className="border-l border-cyan-300/30 px-2 py-3 text-right align-middle text-xs font-black leading-5" style={{ backgroundColor: '#020617' }}>
                <span className="block" style={{ color: '#ffffff', textShadow: '0 1px 2px rgba(0,0,0,0.9)' }}>متوسط الفاتورة</span>
              </th>
              <th className="border-l border-cyan-300/30 px-2 py-3 text-right align-middle text-xs font-black leading-5" style={{ backgroundColor: '#020617' }}>
                <span className="block" style={{ color: '#ffffff', textShadow: '0 1px 2px rgba(0,0,0,0.9)' }}>النمو</span>
              </th>
              <th className="border-l border-cyan-300/30 px-2 py-3 text-right align-middle text-xs font-black leading-5" style={{ backgroundColor: '#020617' }}>
                <span className="block" style={{ color: '#ffffff', textShadow: '0 1px 2px rgba(0,0,0,0.9)' }}>الرواكد/اللستة</span>
              </th>
              <th className="border-l border-cyan-300/30 px-2 py-3 text-right align-middle text-xs font-black leading-5" style={{ backgroundColor: '#020617' }}>
                <span className="block" style={{ color: '#ffffff', textShadow: '0 1px 2px rgba(0,0,0,0.9)' }}>تقييم المحادثات</span>
              </th>
              <th className="border-l border-cyan-300/30 px-2 py-3 text-right align-middle text-xs font-black leading-5" style={{ backgroundColor: '#020617' }}>
                <span className="block" style={{ color: '#ffffff', textShadow: '0 1px 2px rgba(0,0,0,0.9)' }}>خدمة العملاء</span>
              </th>
              <th className="border-l border-cyan-300/30 px-2 py-3 text-right align-middle text-xs font-black leading-5" style={{ backgroundColor: '#020617' }}>
                <span className="block" style={{ color: '#ffffff', textShadow: '0 1px 2px rgba(0,0,0,0.9)' }}>سبب الفوز / فرصة التحسين</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && !rows.length ? (
              Array.from({ length: 6 }).map((_, index) => (
                <tr key={`loading-row-${index}`} className="border-t border-slate-800">
                  <td colSpan={12} className="p-3">
                    <div className="h-8 animate-pulse rounded-lg bg-slate-800/80" />
                  </td>
                </tr>
              ))
            ) : rankingRows.map((row, index) => (
              <tr key={`${row.name}-${row.branch}`} onClick={() => setSelectedDoctor(row)} className="cursor-pointer border-t border-slate-800 text-slate-100 transition hover:bg-slate-800/50 dark:text-slate-100">
                <td className="p-3 font-black">{index + 1}</td>
                <td className="p-3 font-black text-white">{row.name}</td>
                <td className="p-3">{row.branch}</td>
                <td className="p-3">{row.overallScore.toFixed(1)}</td>
                <td className="p-3">{money(row.totalSales)}</td>
                <td className="p-3">{row.invoices}</td>
                <td className="p-3">
                  {row.invoices >= MIN_AVG_INVOICE_THRESHOLD ? (
                    money(row.avgInvoice)
                  ) : (
                    <span className="rounded-full bg-amber-400/15 px-2 py-1 text-xs font-bold text-amber-100">
                      عدد فواتير غير كافٍ للمقارنة ({row.invoices})
                    </span>
                  )}
                </td>
                <td className="p-3">{growthText(row)}</td>
                <td className="p-3">{incentiveText(row)}</td>
                <td className="p-3">{row.reviewCount ? `${avgReview(row).toFixed(1)} (${row.reviewCount})` : 'غير متاح'}</td>
                <td className="p-3">{row.completedFollowups} مكتملة · {row.recoveredCustomers} مسترجع</td>
                <td className="p-3">{row.reviewIssues.length ? row.reviewIssues.slice(0, 2).join(' · ') : row.totalSales === topSales?.totalSales ? 'قوة في إجمالي المبيعات' : row.invoices < MIN_AVG_INVOICE_THRESHOLD ? 'يحتاج عدد فواتير أعلى لدخول متوسط الفاتورة' : 'فرصة تحسين في المزيج أو المتابعة'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && !rows.length && <div className="p-10 text-center text-slate-400">لا توجد بيانات كافية للفترة الحالية.</div>}
      </section>
      <ReviewDataSection rows={reviewRows} />
      {import.meta.env.DEV && metricsMetadata && (
        <section className="dawaa-panel mt-6">
          <div className="mb-4">
            <h2 className="text-xl font-black text-white">بيانات تصحيح المطور</h2>
            <p className="mt-1 text-sm text-slate-400">عرض معلومات من مصدر sales_invoices وفحوصات التجميع.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4">
              <p className="text-sm text-slate-400">فواتير تم جلبها</p>
              <p className="mt-2 text-2xl font-black text-white">{metricsMetadata.salesInvoicesFetchedCount}</p>
            </div>
            <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4">
              <p className="text-sm text-slate-400">صفوف مبيعات دكاترة</p>
              <p className="mt-2 text-2xl font-black text-white">{metricsMetadata.doctorSalesRowsCount}</p>
            </div>
            <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4">
              <p className="text-sm text-slate-400">إجمالي مبيعات الدكاترة</p>
              <p className="mt-2 text-2xl font-black text-white">{money(metricsMetadata.totalDoctorSales)}</p>
            </div>
            <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4">
              <p className="text-sm text-slate-400">فواتير بدون ربط دكتور</p>
              <p className="mt-2 text-2xl font-black text-white">{metricsMetadata.invoiceRowsWithoutDoctorCount}</p>
            </div>
          </div>
          <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-900 p-4 text-sm text-slate-300">
            <p className="font-semibold text-white">أعلى 5 دكاترة حسب المبيعات الخام</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {metricsMetadata.topRawDoctorSalesPreview.map((preview) => (
                <li key={preview}>{preview}</li>
              ))}
            </ul>
            {metricsMetadata.noWinnersReasons.length > 0 && (
              <p className="mt-3 text-amber-200">أسباب عدم وجود بطل مؤهل: {metricsMetadata.noWinnersReasons.join(' · ')}</p>
            )}
          </div>
        </section>
      )}
      {selectedDoctor && <DoctorDetailsModal row={selectedDoctor} onClose={() => setSelectedDoctor(null)} />}
      </>
      )}
    </div>
  );
}

function Winner({ title, row, value, reason }: { title: string; row?: DoctorScore; value: string; reason?: string }) {
  return (
    <div className="rounded-3xl border border-amber-400/30 bg-amber-500/10 p-5">
      <div className="flex items-center gap-2 text-amber-200"><Trophy className="h-5 w-5" /> {title}</div>
      <div className="mt-3 text-2xl font-black text-white">{row?.name || 'لا يوجد'}</div>
      <div className="mt-1 text-sm text-slate-300">{row?.branch || ''}</div>
      <div className="mt-3 inline-flex rounded-full bg-amber-400/15 px-3 py-1 text-sm font-black text-amber-100">
        <Medal className="ml-1 h-4 w-4" /> {value}
      </div>
      {reason && <p className="mt-3 text-xs leading-6 text-slate-300">{reason}</p>}
    </div>
  );
}

function ReviewDataSection({ rows }: { rows: Array<DoctorScore & { overallScore: number }> }) {
  if (!rows.length) return null;
  return (
    <section className="dawaa-panel">
      <div className="mb-4">
        <h2 className="text-xl font-black text-white">بيانات تحتاج مراجعة</h2>
        <p className="mt-1 text-sm text-slate-400">
          هذه الصفوف لا تدخل تلقائيًا في الليدربورد الأساسي إذا كانت غير صالحة، أو تظهر هنا كتوضيح لجودة الربط.
        </p>
      </div>
      <div className="max-w-full overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-y border-slate-700 text-slate-300">
            <tr>
              <th className="p-3 text-right">الدكتور</th>
              <th className="p-3 text-right">الفرع</th>
              <th className="p-3 text-right">المبيعات</th>
              <th className="p-3 text-right">الفواتير</th>
              <th className="p-3 text-right">الملاحظة</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.name}-${row.branch}-${row.reviewIssues.join('|')}`} className="border-t border-slate-800 text-slate-100">
                <td className="p-3 font-bold">{row.name}</td>
                <td className="p-3">{row.branch}</td>
                <td className="p-3">{money(row.totalSales)}</td>
                <td className="p-3">{row.invoices}</td>
                <td className="p-3 text-amber-100">{row.reviewIssues.length ? row.reviewIssues.join(' · ') : 'تحتاج مراجعة ربط دكتور'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DoctorDetailsModal({ row, onClose }: { row: DoctorScore & { overallScore: number }; onClose: () => void }) {
  const strengths = [
    row.totalSales > 0 ? 'مبيعات نشطة خلال الفترة' : '',
    row.avgInvoice > 0 ? 'متوسط فاتورة قابل للقياس' : '',
    row.reviewCount > 0 ? 'لديه تقييمات محادثات' : '',
    row.completedFollowups > 0 ? 'مشارك في خدمة العملاء' : '',
  ].filter(Boolean);
  const improvements = [
    row.invoices < MIN_AVG_INVOICE_THRESHOLD ? `زيادة عدد الفواتير إلى ${MIN_AVG_INVOICE_THRESHOLD} لدخول ترتيب متوسط الفاتورة` : '',
    !row.reviewCount ? 'زيادة عدد تقييمات المحادثات' : '',
    !row.recoveredCustomers ? 'تحسين تحويل المتابعات إلى شراء' : '',
    row.growthRateStatus === 'unavailable' ? 'لا توجد فترة سابقة كافية لحساب النمو' : '',
    row.stagnantStatus === 'disabled' ? 'بيانات الرواكد غير مفعلة في المسابقة حاليًا' : '',
  ].filter(Boolean);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" dir="rtl">
      <div className="w-full max-w-3xl rounded-3xl border border-slate-700 bg-slate-950 p-5 text-slate-100">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black text-white">{row.name}</h2>
            <p className="mt-1 text-sm text-slate-400">{row.branch} · آخر فترة مختارة</p>
          </div>
          <button className="btn-secondary" onClick={onClose}>إغلاق</button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Mini label="إجمالي المبيعات" value={money(row.totalSales)} />
          <Mini label="عدد الفواتير" value={String(row.invoices)} />
          <Mini label="متوسط الفاتورة" value={row.invoices >= MIN_AVG_INVOICE_THRESHOLD ? money(row.avgInvoice) : 'عدد فواتير غير كافٍ'} />
          <Mini label="التقييم الشامل" value={row.overallScore.toFixed(1)} />
          <Mini label="النمو" value={growthText(row)} />
          <Mini label="تقييم المحادثات" value={row.reviewCount ? `${avgReview(row).toFixed(1)}/100` : 'غير متاح'} />
          <Mini label="خدمة العملاء" value={`${row.completedFollowups} متابعة`} />
          <Mini label="الرواكد/اللستة" value={row.stagnantStatus === 'available' ? `${row.stagnantItems + row.listItems}` : 'غير مفعل'} />
          <Mini label="مبيعات المتابعة" value={money(row.followupSales)} />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <TextBox title="نقاط القوة" items={strengths} fallback="لا توجد نقاط قوة كافية بعد." />
          <TextBox title="فرص التحسين" items={improvements} fallback="الأداء متوازن للفترة الحالية." />
          <TextBox title="توصية للمدير" items={[row.overallScore >= 70 ? 'اعتماد نموذج الأداء الحالي ومشاركته مع الفريق.' : 'متابعة مؤشرات المبيعات والتقييم أسبوعيًا مع خطة تحسين قصيرة.']} />
        </div>
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-slate-700 bg-slate-900 p-3"><div className="text-xs text-slate-400">{label}</div><div className="mt-1 text-lg font-black text-white">{value}</div></div>;
}

function TextBox({ title, items, fallback }: { title: string; items: string[]; fallback?: string }) {
  return <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4"><h3 className="font-black text-white">{title}</h3><ul className="mt-2 space-y-2 text-sm leading-6 text-slate-300">{(items.length ? items : [fallback || 'غير محدد']).map((item) => <li key={item}>{item}</li>)}</ul></div>;
}
