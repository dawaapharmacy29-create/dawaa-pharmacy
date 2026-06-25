import { useEffect, useMemo, useState } from 'react';
import { Medal, RefreshCw, Trophy } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { BRANCHES } from '@/lib/constants';

type Period = 'today' | 'month' | 'cycle';
type DoctorScore = {
  name: string;
  branch: string;
  sales: number;
  invoices: number;
  avgInvoice: number;
  listItems: number;
  stagnantItems: number;
  reviewCount: number;
  reviewTotal: number;
  excellentReviews: number;
  negativeReviews: number;
  followups: number;
  convertedFollowups: number;
  followupSales: number;
};
function currentCycle() { const now = new Date(); const start = new Date(now.getFullYear(), now.getMonth(), 26); if (now.getDate() < 26) start.setMonth(start.getMonth() - 1); const end = new Date(start); end.setMonth(end.getMonth() + 1); end.setDate(25); return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }; }
function currentRange(period: Period) {
  const now = new Date();
  if (period === 'today') return { start: now.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
  if (period === 'month') return { start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10), end: new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10) };
  return currentCycle();
}
function num(value: unknown) { const n = Number(value || 0); return Number.isFinite(n) ? n : 0; }
function money(value: number) { return value.toLocaleString('ar-EG', { maximumFractionDigits: 0 }) + ' ج'; }
function scoreOf(row: DoctorScore) { return row.sales + row.convertedFollowups * 500 + row.excellentReviews * 100 - row.negativeReviews * 100; }
function avgReview(row: DoctorScore) { return row.reviewCount ? Math.round(row.reviewTotal / row.reviewCount) : 0; }
function emptyDoctor(name: string, branch: string): DoctorScore {
  return { name, branch, sales: 0, invoices: 0, avgInvoice: 0, listItems: 0, stagnantItems: 0, reviewCount: 0, reviewTotal: 0, excellentReviews: 0, negativeReviews: 0, followups: 0, convertedFollowups: 0, followupSales: 0 };
}

export default function DoctorCompetition() {
  const { user } = useAuth();
  const [rows, setRows] = useState<DoctorScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('cycle');
  const [branchFilter, setBranchFilter] = useState('كل الفروع');
  const cycle = useMemo(() => currentRange(period), [period]);
  const load = async () => {
    setLoading(true);
    try {
      const [invoiceResult, reviewResult, followupResult] = await Promise.all([
        supabase.from('sales_invoices').select('*').gte('invoice_date', cycle.start).lte('invoice_date', cycle.end).limit(8000),
        supabase.from('conversation_sales_reviews').select('*').gte('conversation_date', cycle.start).lte('conversation_date', cycle.end).limit(3000),
        supabase.from('daily_followups').select('*').gte('created_at', cycle.start).lte('created_at', cycle.end + 'T23:59:59').limit(5000),
      ]);
      const map = new Map<string, DoctorScore>();
      const allowBranch = (branch: string) => {
        if (branchFilter !== 'كل الفروع' && branch !== branchFilter) return false;
        if (user?.branch && user.role !== 'general_manager' && user.role !== 'branches_manager' && branch && branch !== user.branch) return false;
        return true;
      };
      const upsert = (name: string, branch: string) => {
        const key = name + '|' + branch;
        const current = map.get(key) || emptyDoctor(name, branch);
        map.set(key, current);
        return current;
      };
      for (const invoice of (invoiceResult.data || []) as any[]) {
        const name = String(invoice.seller_name || invoice.doctor_name || invoice.staff_name || invoice.created_by_name || 'غير محدد').trim();
        const branch = String(invoice.branch || 'غير محدد').trim();
        if (!allowBranch(branch)) continue;
        const current = upsert(name, branch);
        current.sales += num(invoice.net_total || invoice.total || invoice.amount || invoice.invoice_total);
        current.invoices += 1;
        if (invoice.is_list_item || invoice.list_item || invoice.incentive_item) current.listItems += 1;
        if (invoice.is_stagnant || invoice.stagnant_item || invoice.slow_moving) current.stagnantItems += 1;
      }
      for (const review of (reviewResult.data || []) as any[]) {
        const name = String(review.staff_name || review.doctor_name || review.employee_name || 'غير محدد').trim();
        const branch = String(review.branch || 'غير محدد').trim();
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
      for (const followup of (followupResult.data || []) as any[]) {
        const name = String(followup.responsible_name || followup.assigned_doctor || followup.assigned_to || followup.updated_by || 'غير محدد').trim();
        const branch = String(followup.branch || 'غير محدد').trim();
        if (!allowBranch(branch)) continue;
        const current = upsert(name, branch);
        current.followups += 1;
        if (followup.purchase_after_followup) {
          current.convertedFollowups += 1;
          current.followupSales += num(followup.purchase_amount);
        }
      }
      setRows([...map.values()].map((row) => ({ ...row, avgInvoice: row.invoices ? row.sales / row.invoices : 0 })).sort((a, b) => scoreOf(b) - scoreOf(a)));
    } catch (error) { console.warn('[DoctorCompetition] failed', error); setRows([]); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [period, branchFilter]);
  const topSales = rows[0];
  const topList = [...rows].sort((a, b) => b.listItems - a.listItems)[0];
  const topStagnant = [...rows].sort((a, b) => b.stagnantItems - a.stagnantItems)[0];
  const topReviews = [...rows].sort((a, b) => avgReview(b) - avgReview(a))[0];
  const topConversion = [...rows].sort((a, b) => b.convertedFollowups - a.convertedFollowups)[0];
  return (
    <div className="space-y-5" dir="rtl">
      <section className="rounded-3xl border border-amber-400/30 bg-gradient-to-l from-amber-950/30 via-slate-950 to-slate-900 p-5 text-slate-100">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-3xl font-black text-white">مسابقة الدكاترة</h1><p className="mt-2 text-sm text-slate-300">ترتيب يومي وشهري ودورة 26 إلى 25 للمبيعات، تقييم المحادثات، والتحويل من المتابعة إلى شراء.</p><p className="mt-1 text-xs text-amber-200">الفترة الحالية: {cycle.start} إلى {cycle.end}</p></div><button className="btn-primary" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? 'ml-1 inline h-4 w-4 animate-spin' : 'ml-1 inline h-4 w-4'} /> تحديث</button></div>
      </section>
      <section className="dawaa-panel grid gap-3 md:grid-cols-3">
        <select className="input-dark" value={period} onChange={(event) => setPeriod(event.target.value as Period)}><option value="today">اليوم</option><option value="month">الشهر الحالي</option><option value="cycle">دورة 26 إلى 25</option></select>
        <select className="input-dark" value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}><option>كل الفروع</option>{BRANCHES.map((branch) => <option key={branch}>{branch}</option>)}</select>
        <div className="rounded-2xl border border-slate-700 bg-slate-950/50 p-3 text-sm font-bold text-slate-300">لو بيانات اللستة/الرواكد غير موجودة في الفواتير، ستظهر صفر بدون افتراض.</div>
      </section>
      <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-5"><Winner title="بطل المبيعات" row={topSales} value={topSales ? money(topSales.sales) : 'لا يوجد'} /><Winner title="بطل اللستة" row={topList} value={topList?.listItems ? String(topList.listItems) : 'لا توجد بيانات كافية'} /><Winner title="بطل الرواكد" row={topStagnant} value={topStagnant?.stagnantItems ? String(topStagnant.stagnantItems) : 'لا توجد بيانات كافية'} /><Winner title="أفضل تقييم محادثة" row={topReviews} value={topReviews?.reviewCount ? `${avgReview(topReviews)}/100` : 'لا توجد بيانات كافية'} /><Winner title="أفضل تحويل" row={topConversion} value={topConversion?.convertedFollowups ? String(topConversion.convertedFollowups) : 'لا توجد بيانات كافية'} /></section>
      <section className="dawaa-panel overflow-x-auto"><table className="min-w-full text-sm"><thead className="text-slate-400"><tr><th className="p-3 text-right">#</th><th className="p-3 text-right">الدكتور</th><th className="p-3 text-right">الفرع</th><th className="p-3 text-right">المبيعات</th><th className="p-3 text-right">الفواتير</th><th className="p-3 text-right">متوسط الفاتورة</th><th className="p-3 text-right">اللستة</th><th className="p-3 text-right">الرواكد</th><th className="p-3 text-right">متوسط التقييم</th><th className="p-3 text-right">تحويلات المتابعة</th><th className="p-3 text-right">مبيعات المتابعة</th></tr></thead><tbody>{rows.map((row, index) => (<tr key={row.name + row.branch} className="border-t border-slate-800 text-slate-200"><td className="p-3 font-black">{index + 1}</td><td className="p-3 font-black text-white">{row.name}</td><td className="p-3">{row.branch}</td><td className="p-3">{money(row.sales)}</td><td className="p-3">{row.invoices}</td><td className="p-3">{money(row.avgInvoice)}</td><td className="p-3">{row.listItems || 'غير متاح'}</td><td className="p-3">{row.stagnantItems || 'غير متاح'}</td><td className="p-3">{row.reviewCount ? `${avgReview(row)}/100` : 'غير متاح'}</td><td className="p-3">{row.convertedFollowups}</td><td className="p-3">{money(row.followupSales)}</td></tr>))}</tbody></table>{!loading && !rows.length && <div className="p-10 text-center text-slate-400">لا توجد بيانات كافية للفترة الحالية.</div>}</section>
    </div>
  );
}
function Winner({ title, row, value }: { title: string; row?: DoctorScore; value: string }) { return <div className="rounded-3xl border border-amber-400/30 bg-amber-500/10 p-5"><div className="flex items-center gap-2 text-amber-200"><Trophy className="h-5 w-5" /> {title}</div><div className="mt-3 text-2xl font-black text-white">{row?.name || 'لا يوجد'}</div><div className="mt-1 text-sm text-slate-300">{row?.branch || ''}</div><div className="mt-3 inline-flex rounded-full bg-amber-400/15 px-3 py-1 text-sm font-black text-amber-100"><Medal className="ml-1 h-4 w-4" /> {value}</div></div>; }
