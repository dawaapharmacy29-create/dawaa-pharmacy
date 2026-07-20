import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw, Trophy } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import {
  getDoctorCompetitionMetrics,
  normalizeDoctorName,
  rangeForDoctorCompetition,
  type DoctorCompetitionPeriod,
  type DoctorCompetitionScore,
} from '@/lib/doctorCompetitionMetrics';
import { useAuth } from '@/hooks/useAuth';
import { BRANCHES } from '@/lib/constants';
import { rowMatchesCurrentDoctor } from '@/lib/security/userDataScope';
import { normalizeBranchName } from '@/lib/branch';
import { getCurrentCycle, formatCycleDate } from '@/lib/pharmacy-cycle';
import { loadSalesAnalyticsSummary } from '@/lib/salesAnalyticsSummaryService';
import { supabase } from '@/lib/supabase';

const ALL_BRANCHES = 'كل الفروع';
type RankingMode = 'points' | 'sales' | 'invoices' | 'average';
type IdentityLookup = Map<string, string>;
type ReviewRow = {
  staff_id?: string | null;
  doctor_id?: string | null;
  staff_name?: string | null;
  doctor_name?: string | null;
  branch?: string | null;
  final_score?: number | string | null;
  total_score?: number | string | null;
  score?: number | string | null;
};

function money(value: number) {
  return `${Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 0 })} ج`;
}

function csvCell(value: unknown) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function currentDoctor(user: ReturnType<typeof useAuth>['user'], row: DoctorCompetitionScore) {
  if (user?.staffId && row.staffId === user.staffId) return true;
  return rowMatchesCurrentDoctor(user, { staff_id: row.staffId, doctor_name: row.name, branch: row.branch });
}

function normalizedIdentityName(name: string) {
  return normalizeDoctorName(name || '').trim();
}

function buildUniqueStaffLookup(rows: Array<Pick<DoctorCompetitionScore, 'staffId' | 'name'>>) {
  const candidates = new Map<string, Set<string>>();
  rows.forEach((row) => {
    if (!row.staffId) return;
    const name = normalizedIdentityName(row.name);
    if (!name || name === 'غير محدد') return;
    const set = candidates.get(name) || new Set<string>();
    set.add(row.staffId);
    candidates.set(name, set);
  });
  const lookup: IdentityLookup = new Map();
  candidates.forEach((staffIds, name) => {
    if (staffIds.size === 1) lookup.set(name, [...staffIds][0]);
  });
  return lookup;
}

function identityKey(row: Pick<DoctorCompetitionScore, 'staffId' | 'name'>, lookup: IdentityLookup) {
  if (row.staffId) return `staff:${row.staffId}`;
  const normalizedName = normalizedIdentityName(row.name);
  const resolvedStaffId = lookup.get(normalizedName);
  return resolvedStaffId ? `staff:${resolvedStaffId}` : `name:${normalizedName}`;
}

function scoreKey(row: Pick<DoctorCompetitionScore, 'staffId' | 'name'>) {
  return row.staffId ? `staff:${row.staffId}` : `name:${normalizedIdentityName(row.name)}`;
}

function emptyCompetitionRow(input: {
  staffId?: string | null;
  name: string;
  branch: string;
  totalSales: number;
  invoices: number;
  avgInvoice: number;
}): DoctorCompetitionScore {
  return {
    name: normalizeDoctorName(input.name),
    branch: normalizeBranchName(input.branch) || input.branch,
    staffId: input.staffId || null,
    totalSales: input.totalSales,
    invoices: input.invoices,
    avgInvoice: input.avgInvoice,
    growthRate: null,
    growthRateStatus: 'unavailable',
    listItems: 0,
    stagnantItems: 0,
    stagnantStatus: 'disabled',
    incentiveValue: 0,
    totalQuantity: 0,
    linkedInvoiceCount: input.invoices,
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
    overallScore: 0,
    competitionPoints: 0,
    leaderboardEligible: true,
    avgInvoiceEligible: input.invoices > 0,
    ineligibleReasons: [],
    reviewIssues: [],
  };
}

function mergeRows(existing: DoctorCompetitionScore | undefined, incoming: DoctorCompetitionScore) {
  if (!existing) return { ...incoming };
  const totalSales = existing.totalSales + incoming.totalSales;
  const invoices = existing.invoices + incoming.invoices;
  const preferred = incoming.staffId && !existing.staffId ? incoming : existing;
  return {
    ...existing,
    name: preferred.name,
    branch: preferred.branch,
    staffId: existing.staffId || incoming.staffId || null,
    totalSales,
    invoices,
    avgInvoice: invoices > 0 ? totalSales / invoices : Math.max(existing.avgInvoice, incoming.avgInvoice),
    listItems: existing.listItems + incoming.listItems,
    stagnantItems: existing.stagnantItems + incoming.stagnantItems,
    incentiveValue: existing.incentiveValue + incoming.incentiveValue,
    totalQuantity: existing.totalQuantity + incoming.totalQuantity,
    linkedInvoiceCount: existing.linkedInvoiceCount + incoming.linkedInvoiceCount,
    reviewCount: existing.reviewCount + incoming.reviewCount,
    reviewTotal: existing.reviewTotal + incoming.reviewTotal,
    excellentReviews: existing.excellentReviews + incoming.excellentReviews,
    negativeReviews: existing.negativeReviews + incoming.negativeReviews,
    followups: existing.followups + incoming.followups,
    completedFollowups: existing.completedFollowups + incoming.completedFollowups,
    recoveredCustomers: existing.recoveredCustomers + incoming.recoveredCustomers,
    followupSales: existing.followupSales + incoming.followupSales,
    satisfactionTotal: existing.satisfactionTotal + incoming.satisfactionTotal,
    satisfactionCount: existing.satisfactionCount + incoming.satisfactionCount,
    leaderboardEligible: existing.leaderboardEligible || incoming.leaderboardEligible,
    avgInvoiceEligible: invoices > 0,
    ineligibleReasons: [...new Set([...existing.ineligibleReasons, ...incoming.ineligibleReasons])],
    reviewIssues: [...existing.reviewIssues, ...incoming.reviewIssues],
  };
}

function combineCompetitionWithSales(competition: DoctorCompetitionScore | undefined, sales: DoctorCompetitionScore) {
  if (!competition) return sales;
  const totalSales = Math.max(competition.totalSales, sales.totalSales);
  const invoices = Math.max(competition.invoices, sales.invoices);
  return {
    ...competition,
    name: competition.staffId ? competition.name : sales.name,
    branch: competition.staffId ? competition.branch : sales.branch,
    staffId: competition.staffId || sales.staffId || null,
    totalSales,
    invoices,
    linkedInvoiceCount: Math.max(competition.linkedInvoiceCount, sales.linkedInvoiceCount),
    avgInvoice: invoices > 0 ? totalSales / invoices : Math.max(competition.avgInvoice, sales.avgInvoice),
    avgInvoiceEligible: invoices > 0,
  };
}

function recalculatePoints(rows: DoctorCompetitionScore[]) {
  const maxSales = Math.max(1, ...rows.map((row) => row.totalSales));
  const maxAverage = Math.max(1, ...rows.map((row) => row.avgInvoice));
  const maxIncentive = Math.max(1, ...rows.map((row) => row.incentiveValue + row.listItems * 20 + row.stagnantItems * 20));
  return rows.map((row) => {
    const salesScore = row.totalSales / maxSales * 50;
    const averageScore = row.avgInvoice / maxAverage * 20;
    const reviewScore = row.reviewCount ? row.reviewTotal / row.reviewCount / 100 * 15 : 0;
    const serviceScore = Math.min(10, row.completedFollowups * 2 + row.recoveredCustomers * 3);
    const incentiveScore = Math.min(5, (row.incentiveValue + row.listItems * 20 + row.stagnantItems * 20) / maxIncentive * 5);
    const overallScore = salesScore + averageScore + reviewScore + serviceScore + incentiveScore;
    return { ...row, overallScore, competitionPoints: Math.round(overallScore * 10) / 10 };
  });
}

function reviewAverage(row: DoctorCompetitionScore) {
  return row.reviewCount ? row.reviewTotal / row.reviewCount : null;
}

function applyLiveReviews(rows: DoctorCompetitionScore[], reviews: ReviewRow[]) {
  const byStaff = new Map<string, number>();
  const byBranchAndName = new Map<string, number>();
  const byUniqueName = new Map<string, number>();
  const nameCounts = new Map<string, number>();

  rows.forEach((row, index) => {
    if (row.staffId) byStaff.set(row.staffId, index);
    const name = normalizedIdentityName(row.name);
    const branch = normalizeBranchName(row.branch) || row.branch;
    byBranchAndName.set(`${branch}|${name}`, index);
    nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
  });
  rows.forEach((row, index) => {
    const name = normalizedIdentityName(row.name);
    if (nameCounts.get(name) === 1) byUniqueName.set(name, index);
  });

  const aggregates = new Map<number, { count: number; total: number; excellent: number; negative: number }>();
  reviews.forEach((review) => {
    const directId = String(review.staff_id || review.doctor_id || '').trim();
    const name = normalizedIdentityName(String(review.staff_name || review.doctor_name || ''));
    const branch = normalizeBranchName(review.branch || '') || String(review.branch || '').trim();
    const index = (directId && byStaff.get(directId)) ?? byBranchAndName.get(`${branch}|${name}`) ?? byUniqueName.get(name);
    if (index === undefined) return;
    const score = Number(review.final_score ?? review.total_score ?? review.score ?? 0);
    if (!Number.isFinite(score) || score <= 0) return;
    const current = aggregates.get(index) || { count: 0, total: 0, excellent: 0, negative: 0 };
    current.count += 1;
    current.total += score;
    if (score >= 90) current.excellent += 1;
    if (score < 70) current.negative += 1;
    aggregates.set(index, current);
  });

  return rows.map((row, index) => {
    const review = aggregates.get(index);
    if (!review) return row;
    return {
      ...row,
      reviewCount: review.count,
      reviewTotal: review.total,
      excellentReviews: review.excellent,
      negativeReviews: review.negative,
    };
  });
}

export default function DoctorCompetition() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const requestedBranch = params.get('branch') || ALL_BRANCHES;
  const [branchFilter, setBranchFilter] = useState(requestedBranch);
  const [period, setPeriod] = useState<DoctorCompetitionPeriod>('cycle');
  const [mode, setMode] = useState<RankingMode>('points');
  const [rows, setRows] = useState<DoctorCompetitionScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');

  const effectiveBranch = branchFilter === ALL_BRANCHES ? '' : normalizeBranchName(branchFilter);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setWarning('');
    try {
      const cycle = getCurrentCycle();
      const competitionRange = rangeForDoctorCompetition(period);
      const [competition, reviewResponse] = await Promise.all([
        getDoctorCompetitionMetrics({
          period,
          branch: effectiveBranch || ALL_BRANCHES,
          userBranch: user?.branch,
          canSeeAllBranches: true,
        }),
        supabase
          .from('conversation_sales_reviews')
          .select('staff_id,doctor_id,staff_name,doctor_name,branch,final_score,total_score')
          .gte('conversation_date', competitionRange.start)
          .lte('conversation_date', `${competitionRange.end}T23:59:59`)
          .limit(10000),
      ]);

      const branchesToLoad = effectiveBranch ? [effectiveBranch] : BRANCHES;
      const summaries = await Promise.all(branchesToLoad.map(async (branch) => {
        try {
          return await loadSalesAnalyticsSummary({
            startDate: formatCycleDate(cycle.start),
            endDate: formatCycleDate(cycle.end),
            branch,
          }, true);
        } catch {
          return null;
        }
      }));

      const salesRows = summaries.flatMap((summary) => summary?.doctorRows.map((doctor) => emptyCompetitionRow({
        staffId: doctor.staffId,
        name: doctor.doctor,
        branch: doctor.branch || effectiveBranch || user?.branch || '',
        totalSales: doctor.netSales,
        invoices: doctor.invoicesCount,
        avgInvoice: doctor.avgInvoice,
      })) || []);

      const identityLookup = buildUniqueStaffLookup([...competition.rows, ...salesRows]);
      const competitionMerged = new Map<string, DoctorCompetitionScore>();
      competition.rows.forEach((row) => {
        const key = identityKey(row, identityLookup);
        competitionMerged.set(key, mergeRows(competitionMerged.get(key), row));
      });

      const salesMerged = new Map<string, DoctorCompetitionScore>();
      salesRows.forEach((row) => {
        const key = identityKey(row, identityLookup);
        salesMerged.set(key, mergeRows(salesMerged.get(key), row));
      });

      const merged = new Map(competitionMerged);
      salesMerged.forEach((salesRow, key) => {
        merged.set(key, combineCompetitionWithSales(merged.get(key), salesRow));
      });

      const mergedRows = [...merged.values()].filter((row) => row.name && row.name !== 'غير محدد');
      const reviewRows = reviewResponse.error ? [] : (reviewResponse.data || []) as ReviewRow[];
      const rowsWithLiveReviews = applyLiveReviews(mergedRows, reviewRows);
      setRows(recalculatePoints(rowsWithLiveReviews));

      const warnings: string[] = [];
      if (competition.status === 'partial') warnings.push('تم استكمال قائمة الدكاترة من بيانات المبيعات.');
      if (reviewResponse.error) warnings.push('تعذر تحديث تقييمات المحادثات من المصدر الحي؛ تم استخدام البيانات المجمعة المتاحة.');
      setWarning(warnings.join(' '));
    } catch (loadError) {
      console.error('[DoctorCompetition] load failed', loadError);
      setRows([]);
      setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل مسابقة الدكاترة.');
    } finally {
      setLoading(false);
    }
  }, [effectiveBranch, period, user?.branch]);

  useEffect(() => { void load(); }, [load]);

  const visibleRows = useMemo(() => {
    const sorted = [...rows];
    if (mode === 'sales') return sorted.sort((a, b) => b.totalSales - a.totalSales || b.competitionPoints - a.competitionPoints);
    if (mode === 'invoices') return sorted.sort((a, b) => b.invoices - a.invoices || b.totalSales - a.totalSales);
    if (mode === 'average') return sorted.sort((a, b) => b.avgInvoice - a.avgInvoice || b.invoices - a.invoices);
    return sorted.sort((a, b) => b.competitionPoints - a.competitionPoints || b.totalSales - a.totalSales);
  }, [mode, rows]);

  const exportCsv = () => {
    const lines = [
      ['الترتيب', 'اسم الدكتور', 'الفرع الحالي', 'إجمالي المبيعات', 'عدد الفواتير', 'متوسط الفاتورة', 'تقييم المحادثات', 'عدد التقييمات', 'المتابعات المكتملة', 'نقاط المسابقة'].map(csvCell).join(','),
      ...visibleRows.map((row, index) => [
        index + 1,
        row.name,
        row.branch,
        row.totalSales.toFixed(2),
        row.invoices,
        row.avgInvoice.toFixed(2),
        reviewAverage(row)?.toFixed(1) ?? 'غير متاح',
        row.reviewCount,
        row.completedFollowups,
        row.competitionPoints.toFixed(1),
      ].map(csvCell).join(',')),
    ];
    const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `doctor-competition-${effectiveBranch || 'all'}-${period}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return <div className="space-y-5" dir="rtl">
    <section className="rounded-3xl border border-amber-400/25 bg-slate-950/80 p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><div className="flex items-center gap-2 text-amber-200"><Trophy size={22} /><span className="font-black">مسابقة الدكاترة</span></div><h1 className="mt-2 text-3xl font-black text-white">ترتيب جميع الدكاترة في المسابقة</h1><p className="mt-2 text-sm text-slate-300">تقييم المحادثات يُحسب من كل التقييمات الفعلية خلال الفترة المختارة، مع المطابقة بالمعرف ثم الاسم والفرع.</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={exportCsv} disabled={!visibleRows.length} className="btn-secondary disabled:opacity-50"><Download className="ml-1 inline h-4 w-4" /> تصدير CSV</button><button type="button" onClick={() => void load()} disabled={loading} className="btn-primary disabled:opacity-50"><RefreshCw className={`ml-1 inline h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> تحديث</button></div></div></section>

    <section className="grid gap-3 rounded-3xl border border-slate-800 bg-slate-900/70 p-4 md:grid-cols-3"><select className="input-dark" value={period} onChange={(event) => setPeriod(event.target.value as DoctorCompetitionPeriod)}><option value="cycle">الدورة الحالية 26 إلى 25</option><option value="last30">آخر 30 يومًا</option><option value="last90">آخر 3 شهور</option></select><select className="input-dark" value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}><option value={ALL_BRANCHES}>{ALL_BRANCHES}</option>{BRANCHES.map((branch) => <option key={branch} value={branch}>{branch}</option>)}</select><select className="input-dark" value={mode} onChange={(event) => setMode(event.target.value as RankingMode)}><option value="points">الترتيب حسب نقاط المسابقة</option><option value="sales">الترتيب حسب المبيعات</option><option value="invoices">الترتيب حسب عدد الفواتير</option><option value="average">الترتيب حسب متوسط الفاتورة</option></select></section>

    {warning ? <div className="rounded-2xl border border-amber-300/25 bg-amber-400/10 p-4 text-sm font-bold text-amber-100">{warning}</div> : null}
    {error ? <div className="rounded-2xl border border-red-300/25 bg-red-500/10 p-4 text-sm font-bold text-red-100">{error}</div> : null}

    <section className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/80"><div className="border-b border-slate-800 p-5"><h2 className="text-2xl font-black text-white">قائمة الدكاترة المؤهلين</h2><p className="mt-1 text-sm text-slate-400">{loading ? 'جارٍ التحميل…' : `${visibleRows.length} دكتور داخل المسابقة`}</p></div><div className="overflow-x-auto"><table className="w-full min-w-[1250px] text-right text-sm"><thead className="bg-slate-950 text-slate-300"><tr><th className="p-3">الترتيب</th><th className="p-3">الدكتور</th><th className="p-3">الفرع الحالي</th><th className="p-3">المبيعات</th><th className="p-3">الفواتير</th><th className="p-3">متوسط الفاتورة</th><th className="p-3">تقييم المحادثات</th><th className="p-3">عدد التقييمات</th><th className="p-3">المتابعات المكتملة</th><th className="p-3">نقاط المسابقة</th></tr></thead><tbody>{loading && !visibleRows.length ? Array.from({ length: 6 }).map((_, index) => <tr key={index} className="border-t border-slate-800"><td colSpan={10} className="p-3"><div className="h-9 animate-pulse rounded-lg bg-slate-800" /></td></tr>) : visibleRows.map((row, index) => { const mine = currentDoctor(user, row); const review = reviewAverage(row); return <tr key={scoreKey(row)} className={`border-t border-slate-800 ${mine ? 'bg-teal-500/15 ring-1 ring-inset ring-teal-400/40' : 'hover:bg-slate-800/50'}`}><td className="p-3 text-xl font-black text-amber-200">{index + 1}</td><td className="p-3 font-black text-white">{row.name}{mine ? <span className="mr-2 rounded-full bg-teal-400 px-2 py-1 text-[11px] text-slate-950">أنت هنا</span> : null}</td><td className="p-3 text-slate-300">{row.branch}</td><td className="p-3 font-black text-white">{money(row.totalSales)}</td><td className="p-3">{row.invoices}</td><td className="p-3">{money(row.avgInvoice)}</td><td className="p-3 font-bold text-sky-200">{review === null ? 'غير متاح' : `${review.toFixed(1)}/100`}</td><td className="p-3">{row.reviewCount || '—'}</td><td className="p-3">{row.completedFollowups}</td><td className="p-3 font-black text-teal-200">{row.competitionPoints.toFixed(1)}</td></tr>; })}</tbody></table></div>{!loading && !visibleRows.length ? <div className="p-12 text-center"><div className="text-xl font-black text-white">لا توجد بيانات للمسابقة</div><p className="mt-2 text-sm text-slate-400">لا توجد فواتير مرتبطة بالفترة المختارة.</p></div> : null}</section>
  </div>;
}
