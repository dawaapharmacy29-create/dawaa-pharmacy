import { useEffect, useMemo, useState } from 'react';
import { Download, Medal, RefreshCw, Trophy } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { BRANCHES } from '@/lib/constants';

type Period = 'last30' | 'last90' | 'cycle' | 'custom';
type RankingTab = 'sales' | 'avgInvoice' | 'incentive' | 'reviews' | 'service' | 'overall';
type DoctorScore = {
  name: string;
  branch: string;
  totalSales: number;
  invoices: number;
  avgInvoice: number;
  growthRate: number;
  listItems: number;
  stagnantItems: number;
  incentiveValue: number;
  totalQuantity: number;
  linkedInvoiceCount: number;
  reviewCount: number;
  reviewTotal: number;
  excellentReviews: number;
  negativeReviews: number;
  followups: number;
  completedFollowups: number;
  recoveredCustomers: number;
  followupSales: number;
  satisfactionTotal: number;
  satisfactionCount: number;
};

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
  return num(row.net_total || row.total || row.amount || row.invoice_total || row.total_amount || row.final_total);
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
  return name || 'غير محدد';
}

function currentCycle() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 26);
  if (now.getDate() < 26) start.setMonth(start.getMonth() - 1);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  end.setDate(25);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function rangeFor(period: Period, customStart: string, customEnd: string) {
  const now = new Date();
  if (period === 'last30') {
    const start = new Date(now);
    start.setDate(start.getDate() - 30);
    return { start: start.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
  }
  if (period === 'last90') {
    const start = new Date(now);
    start.setMonth(start.getMonth() - 3);
    return { start: start.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
  }
  if (period === 'custom') return { start: customStart, end: customEnd || customStart };
  return currentCycle();
}

function emptyDoctor(name: string, branch: string): DoctorScore {
  return {
    name,
    branch,
    totalSales: 0,
    invoices: 0,
    avgInvoice: 0,
    growthRate: 0,
    listItems: 0,
    stagnantItems: 0,
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
  };
}

function avgReview(row: DoctorScore) {
  return row.reviewCount ? row.reviewTotal / row.reviewCount : 0;
}

function customerServiceAvg(row: DoctorScore) {
  return row.satisfactionCount ? row.satisfactionTotal / row.satisfactionCount : 0;
}

function normalizeScores(rows: DoctorScore[]) {
  const max = {
    sales: Math.max(1, ...rows.map((row) => row.totalSales)),
    avgInvoice: Math.max(1, ...rows.filter((row) => row.invoices >= MIN_AVG_INVOICE_THRESHOLD).map((row) => row.avgInvoice)),
    incentive: Math.max(1, ...rows.map((row) => row.incentiveValue + row.listItems * 100 + row.stagnantItems * 100)),
    review: Math.max(1, ...rows.map(avgReview)),
    service: Math.max(1, ...rows.map((row) => row.completedFollowups + row.recoveredCustomers * 2 + customerServiceAvg(row))),
  };
  return rows.map((row) => {
    const salesScore = (row.totalSales / max.sales) * 100;
    const avgInvoiceScore = row.invoices >= MIN_AVG_INVOICE_THRESHOLD ? (row.avgInvoice / max.avgInvoice) * 100 : 0;
    const incentiveScore = ((row.incentiveValue + row.listItems * 100 + row.stagnantItems * 100) / max.incentive) * 100;
    const reviewScore = (avgReview(row) / max.review) * 100;
    const serviceScore = ((row.completedFollowups + row.recoveredCustomers * 2 + customerServiceAvg(row)) / max.service) * 100;
    return {
      ...row,
      overallScore: salesScore * 0.3 + avgInvoiceScore * 0.2 + incentiveScore * 0.2 + reviewScore * 0.2 + serviceScore * 0.1,
    };
  });
}

export default function DoctorCompetition() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Array<DoctorScore & { overallScore: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('last90');
  const [branchFilter, setBranchFilter] = useState(ALL_BRANCHES);
  const [customStart, setCustomStart] = useState(new Date().toISOString().slice(0, 10));
  const [customEnd, setCustomEnd] = useState(new Date().toISOString().slice(0, 10));
  const [rankingTab, setRankingTab] = useState<RankingTab>('overall');
  const [selectedDoctor, setSelectedDoctor] = useState<(DoctorScore & { overallScore: number }) | null>(null);
  const cycle = useMemo(() => rangeFor(period, customStart, customEnd), [customEnd, customStart, period]);

  const load = async () => {
    setLoading(true);
    try {
      const [invoiceResult, reviewResult, followupResult] = await Promise.all([
        supabase.from('sales_invoices').select('*').gte('invoice_date', cycle.start).lte('invoice_date', cycle.end).limit(12000),
        supabase.from('conversation_sales_reviews').select('*').gte('conversation_date', cycle.start).lte('conversation_date', cycle.end).limit(4000),
        supabase.from('daily_followups').select('*').gte('created_at', cycle.start).lte('created_at', `${cycle.end}T23:59:59`).limit(7000),
      ]);
      const map = new Map<string, DoctorScore>();
      const allowBranch = (branch: string) => {
        if (branchFilter !== ALL_BRANCHES && branch !== branchFilter) return false;
        if (user?.branch && user.role !== 'general_manager' && user.role !== 'branches_manager' && branch && branch !== user.branch) return false;
        return true;
      };
      const upsert = (name: string, branch: string) => {
        const key = `${name}|${branch}`;
        const current = map.get(key) || emptyDoctor(name, branch);
        map.set(key, current);
        return current;
      };

      const periodMidpoint = new Date(cycle.start);
      periodMidpoint.setTime((new Date(cycle.start).getTime() + new Date(cycle.end).getTime()) / 2);
      const firstHalfSales = new Map<string, number>();
      const secondHalfSales = new Map<string, number>();

      for (const invoice of (invoiceResult.data || []) as Record<string, unknown>[]) {
        const name = invoiceDoctor(invoice);
        const branch = text(invoice.branch || invoice.branch_name || invoice.store_branch) || 'غير محدد';
        if (!allowBranch(branch)) continue;
        const current = upsert(name, branch);
        const amount = invoiceAmount(invoice);
        current.totalSales += amount;
        current.invoices += 1;
        current.totalQuantity += num(invoice.quantity || invoice.qty || invoice.total_quantity);
        if (invoice.is_list_item || invoice.list_item || invoice.incentive_item) current.listItems += 1;
        if (invoice.is_stagnant || invoice.stagnant_item || invoice.slow_moving) current.stagnantItems += 1;
        if (invoice.is_list_item || invoice.list_item || invoice.incentive_item || invoice.is_stagnant || invoice.stagnant_item) {
          current.incentiveValue += amount;
          current.linkedInvoiceCount += 1;
        }
        const key = `${name}|${branch}`;
        if (new Date(invoiceDate(invoice)).getTime() <= periodMidpoint.getTime()) firstHalfSales.set(key, (firstHalfSales.get(key) || 0) + amount);
        else secondHalfSales.set(key, (secondHalfSales.get(key) || 0) + amount);
      }

      for (const review of (reviewResult.data || []) as Record<string, unknown>[]) {
        const name = text(review.staff_name || review.doctor_name || review.employee_name || review.created_by_name) || 'غير محدد';
        const branch = text(review.branch) || 'غير محدد';
        if (!allowBranch(branch)) continue;
        const current = upsert(name, branch);
        const score = num(review.final_score || review.score || review.quality_rating);
        if (score > 0) {
          current.reviewCount += 1;
          current.reviewTotal += score;
          if (score >= 90) current.excellentReviews += 1;
          if (score < 70) current.negativeReviews += 1;
        }
      }

      for (const followup of (followupResult.data || []) as Record<string, unknown>[]) {
        const name = text(followup.responsible_name || followup.assigned_doctor || followup.assigned_to || followup.evaluated_by_name || followup.updated_by) || 'غير محدد';
        const branch = text(followup.branch) || 'غير محدد';
        if (!allowBranch(branch)) continue;
        const current = upsert(name, branch);
        current.followups += 1;
        if (followup.completed_at || /تم|completed|closed/i.test(text(followup.status || followup.followup_status))) current.completedFollowups += 1;
        if (followup.purchase_after_followup) {
          current.recoveredCustomers += 1;
          current.followupSales += num(followup.purchase_amount);
        }
        const satisfaction = text(followup.customer_satisfaction);
        if (satisfaction === 'نعم' || satisfaction === 'راضي') {
          current.satisfactionTotal += 5;
          current.satisfactionCount += 1;
        } else if (satisfaction === 'لا') {
          current.satisfactionTotal += 1;
          current.satisfactionCount += 1;
        }
      }

      const withAverages = [...map.entries()].map(([key, row]) => {
        const first = firstHalfSales.get(key) || 0;
        const second = secondHalfSales.get(key) || 0;
        return {
          ...row,
          avgInvoice: row.invoices ? row.totalSales / row.invoices : 0,
          growthRate: first ? ((second - first) / first) * 100 : second > 0 ? 100 : 0,
        };
      });
      setRows(normalizeScores(withAverages).sort((a, b) => b.overallScore - a.overallScore));
    } catch (error) {
      console.warn('[DoctorCompetition] failed', error);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [period, branchFilter, customStart, customEnd]);

  const topSales = [...rows].sort((a, b) => b.totalSales - a.totalSales)[0];
  const topAvgInvoice = [...rows].filter((row) => row.invoices >= MIN_AVG_INVOICE_THRESHOLD).sort((a, b) => b.avgInvoice - a.avgInvoice)[0];
  const topIncentive = [...rows].sort((a, b) => b.incentiveValue + b.listItems + b.stagnantItems - (a.incentiveValue + a.listItems + a.stagnantItems))[0];
  const topReviews = [...rows].filter((row) => row.reviewCount > 0).sort((a, b) => avgReview(b) - avgReview(a))[0];
  const topService = [...rows].sort((a, b) => b.recoveredCustomers + b.completedFollowups - (a.recoveredCustomers + a.completedFollowups))[0];
  const topOverall = rows[0];
  const rankingRows = useMemo(() => {
    const sorted = [...rows];
    if (rankingTab === 'sales') return sorted.sort((a, b) => b.totalSales - a.totalSales);
    if (rankingTab === 'avgInvoice') return sorted.sort((a, b) => (b.invoices >= MIN_AVG_INVOICE_THRESHOLD ? b.avgInvoice : 0) - (a.invoices >= MIN_AVG_INVOICE_THRESHOLD ? a.avgInvoice : 0));
    if (rankingTab === 'incentive') return sorted.sort((a, b) => b.incentiveValue + b.listItems + b.stagnantItems - (a.incentiveValue + a.listItems + a.stagnantItems));
    if (rankingTab === 'reviews') return sorted.sort((a, b) => avgReview(b) - avgReview(a));
    if (rankingTab === 'service') return sorted.sort((a, b) => b.completedFollowups + b.recoveredCustomers - (a.completedFollowups + a.recoveredCustomers));
    return sorted.sort((a, b) => b.overallScore - a.overallScore);
  }, [rankingTab, rows]);

  const exportCsv = () => {
    const header = ['doctor', 'branch', 'overall_score', 'total_sales', 'invoices', 'avg_invoice', 'growth_rate', 'stagnant_items', 'list_items', 'review_avg', 'completed_followups', 'recovered_customers'];
    const body = rows.map((row) =>
      [
        row.name,
        row.branch,
        row.overallScore.toFixed(2),
        row.totalSales,
        row.invoices,
        row.avgInvoice.toFixed(2),
        row.growthRate.toFixed(2),
        row.stagnantItems,
        row.listItems,
        avgReview(row).toFixed(2),
        row.completedFollowups,
        row.recoveredCustomers,
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

  return (
    <div className="space-y-5" dir="rtl">
      <section className="rounded-3xl border border-amber-400/30 bg-slate-950 p-5 text-slate-100">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-black text-white">مسابقة الدكاترة</h1>
            <p className="mt-2 text-sm text-slate-300">تحليل أداء آخر 3 شهور افتراضيًا من الفواتير، التقييمات، والمتابعات.</p>
            <p className="mt-1 text-xs text-amber-200">الفترة: {cycle.start} إلى {cycle.end}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={exportCsv} disabled={!rows.length}><Download className="ml-1 inline h-4 w-4" /> Export CSV</button>
            <button className="btn-primary" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? 'ml-1 inline h-4 w-4 animate-spin' : 'ml-1 inline h-4 w-4'} /> تحديث</button>
          </div>
        </div>
      </section>

      <section className="dawaa-panel grid gap-3 md:grid-cols-4">
        <select className="input-dark" value={period} onChange={(event) => setPeriod(event.target.value as Period)}>
          <option value="last30">آخر 30 يوم</option>
          <option value="last90">آخر 3 شهور</option>
          <option value="cycle">الدورة الحالية 26 إلى 25</option>
          <option value="custom">تاريخ مخصص</option>
        </select>
        <select className="input-dark" value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}>
          <option>{ALL_BRANCHES}</option>
          {BRANCHES.map((branch) => <option key={branch}>{branch}</option>)}
        </select>
        <input className="input-dark" type="date" value={customStart} disabled={period !== 'custom'} onChange={(event) => setCustomStart(event.target.value)} />
        <input className="input-dark" type="date" value={customEnd} disabled={period !== 'custom'} onChange={(event) => setCustomEnd(event.target.value)} />
      </section>

      <section className="rounded-3xl border border-amber-400/30 bg-slate-950/80 p-5">
        <h2 className="text-2xl font-black text-white">لوحة مسابقات الدكاترة</h2>
        <p className="mt-1 text-sm text-slate-300">أبطال الفترة حسب المبيعات، متوسط الفاتورة، الرواكد واللستة، تقييم المحادثات، وخدمة العملاء.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Winner title="بطل المبيعات" row={topSales} value={topSales ? money(topSales.totalSales) : 'لا يوجد'} reason={topSales ? `${topSales.invoices} فاتورة · متوسط ${money(topSales.avgInvoice)}` : 'لا توجد بيانات كافية'} />
          <Winner title="بطل متوسط الفاتورة" row={topAvgInvoice} value={topAvgInvoice ? money(topAvgInvoice.avgInvoice) : `يتطلب ${MIN_AVG_INVOICE_THRESHOLD} فاتورة`} reason={topAvgInvoice ? `${topAvgInvoice.invoices} فاتورة مؤهلة` : 'لا يوجد دكتور تجاوز الحد الأدنى'} />
          <Winner title="بطل الرواكد واللستة" row={topIncentive} value={topIncentive?.incentiveValue ? money(topIncentive.incentiveValue) : 'لا توجد بيانات كافية للرواكد واللستة بعد'} reason={topIncentive?.incentiveValue ? `${topIncentive.stagnantItems} رواكد · ${topIncentive.listItems} لستة` : 'القسم يعمل ويعرض Empty State عند نقص البيانات'} />
          <Winner title="بطل تقييم المحادثات" row={topReviews} value={topReviews ? `${avgReview(topReviews).toFixed(1)}/100` : 'لا توجد بيانات تقييم كافية'} reason={topReviews ? `${topReviews.reviewCount} تقييم · ${topReviews.excellentReviews} ممتاز` : 'لا توجد مراجعات كافية'} />
          <Winner title="البطل الشامل" row={topOverall} value={topOverall ? `${topOverall.overallScore.toFixed(1)} نقطة` : 'لا يوجد'} reason="المبيعات 30% · المتوسط 20% · الرواكد 20% · التقييم 20% · خدمة العملاء 10%" />
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Winner title="أفضل شامل" row={topOverall} value={topOverall ? `${topOverall.overallScore.toFixed(1)} نقطة` : 'لا يوجد'} />
        <Winner title="أفضل مبيعات" row={topSales} value={topSales ? money(topSales.totalSales) : 'لا يوجد'} />
        <Winner title="أفضل متوسط فاتورة" row={topAvgInvoice} value={topAvgInvoice ? money(topAvgInvoice.avgInvoice) : `يتطلب ${MIN_AVG_INVOICE_THRESHOLD} فاتورة`} />
        <Winner title="أفضل رواكد ولستة" row={topIncentive} value={topIncentive ? money(topIncentive.incentiveValue) : 'لا يوجد'} />
        <Winner title="أفضل تقييم محادثات" row={topReviews} value={topReviews ? `${avgReview(topReviews).toFixed(1)}/100` : 'لا يوجد'} />
        <Winner title="أفضل خدمة عملاء" row={topService} value={topService ? `${topService.completedFollowups} متابعة` : 'لا يوجد'} />
      </section>

      <section className="dawaa-panel overflow-x-auto">
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
        <table className="min-w-full text-sm">
          <thead className="border-y border-slate-600/50 bg-slate-800/80 text-slate-100">
            <tr className="text-right">
              <th className="p-3 text-right">#</th>
              <th className="p-3 text-right">الدكتور</th>
              <th className="p-3 text-right">الفرع</th>
              <th className="p-3 text-right">الشامل</th>
              <th className="p-3 text-right">المبيعات</th>
              <th className="p-3 text-right">الفواتير</th>
              <th className="p-3 text-right">متوسط الفاتورة</th>
              <th className="p-3 text-right">النمو</th>
              <th className="p-3 text-right">الرواكد/اللستة</th>
              <th className="p-3 text-right">تقييم المحادثات</th>
              <th className="p-3 text-right">خدمة العملاء</th>
              <th className="p-3 text-right">سبب الفوز / فرصة التحسين</th>
            </tr>
          </thead>
          <tbody>
            {rankingRows.map((row, index) => (
              <tr key={`${row.name}-${row.branch}`} onClick={() => setSelectedDoctor(row)} className="cursor-pointer border-t border-slate-800 text-slate-200 transition hover:bg-slate-800/50">
                <td className="p-3 font-black">{index + 1}</td>
                <td className="p-3 font-black text-white">{row.name}</td>
                <td className="p-3">{row.branch}</td>
                <td className="p-3">{row.overallScore.toFixed(1)}</td>
                <td className="p-3">{money(row.totalSales)}</td>
                <td className="p-3">{row.invoices}</td>
                <td className="p-3">{row.invoices >= MIN_AVG_INVOICE_THRESHOLD ? money(row.avgInvoice) : `خارج ترتيب المتوسط (${row.invoices})`}</td>
                <td className="p-3">{row.growthRate.toFixed(1)}%</td>
                <td className="p-3">{row.stagnantItems + row.listItems} / {money(row.incentiveValue)}</td>
                <td className="p-3">{row.reviewCount ? `${avgReview(row).toFixed(1)} (${row.reviewCount})` : 'غير متاح'}</td>
                <td className="p-3">{row.completedFollowups} مكتملة · {row.recoveredCustomers} مسترجع</td>
                <td className="p-3">{row.totalSales === topSales?.totalSales ? 'قوة في إجمالي المبيعات' : row.invoices < MIN_AVG_INVOICE_THRESHOLD ? 'يحتاج عدد فواتير أعلى لدخول متوسط الفاتورة' : 'فرصة تحسين في المزيج أو المتابعة'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && !rows.length && <div className="p-10 text-center text-slate-400">لا توجد بيانات كافية للفترة الحالية.</div>}
      </section>
      {selectedDoctor && <DoctorDetailsModal row={selectedDoctor} onClose={() => setSelectedDoctor(null)} />}
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
          <Mini label="متوسط الفاتورة" value={money(row.avgInvoice)} />
          <Mini label="التقييم الشامل" value={row.overallScore.toFixed(1)} />
          <Mini label="تقييم المحادثات" value={row.reviewCount ? `${avgReview(row).toFixed(1)}/100` : 'غير متاح'} />
          <Mini label="خدمة العملاء" value={`${row.completedFollowups} متابعة`} />
          <Mini label="الرواكد/اللستة" value={`${row.stagnantItems + row.listItems}`} />
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
