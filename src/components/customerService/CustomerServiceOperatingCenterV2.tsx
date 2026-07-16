import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, CheckCircle2, Clock3, MessageCircle, Phone, RefreshCw, Search, Sparkles, UserRound } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  calculateFollowupStats,
  fetchCustomerServiceFollowups,
  fetchCustomerServiceInsightPools,
  fetchFollowupPerformanceSummary,
  generateTodayFollowupsSmartReport,
  recommendedAction,
  updateFollowupResult,
  type CustomerServiceInsightPools,
  type FollowupPerformanceRow,
  type FollowupResultPayload,
  type FollowupRow,
  type FollowupStats,
} from '@/lib/api/customerServiceCommandCenter';
import { normalizeBranchName } from '@/lib/branch';
import { CustomerFlagChips } from '@/lib/customerDisplay';
import { formatCurrency } from '@/lib/utils';
import FollowupResultModal, { type FollowupResultData } from '@/components/customerService/FollowupResultModal';

const ALL = 'الكل';
const EMPTY_STATS: FollowupStats = { totalToday: 0, completed: 0, noAnswer: 0, postponed: 0, overdue: 0, needsManager: 0, purchaseAfterCount: 0, purchaseAfterAmount: 0 };
const EMPTY_POOLS: CustomerServiceInsightPools = { important: [], reduced: [], stopped60: [], strong: [], source: '', warnings: [] };
type ViewMode = 'queue' | 'important' | 'reduced' | 'stopped60';

function text(value: unknown, fallback = '') { return String(value ?? '').trim() || fallback; }
function formatDate(value?: string | null) { if (!value) return 'غير محدد'; const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value).slice(0, 16) : date.toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' }); }
function phoneOf(row?: FollowupRow | null) { return row ? String(row.customer_phone || row.phone || row.whatsapp_phone || row.phone_alt || '').trim() : ''; }
function statusOf(row: FollowupRow) { return text(row.followup_status || row.status || row.contact_status, 'معلق'); }
function totalSpent(row: FollowupRow) { return Number(row.customer_metrics?.total_spent || row.total_spent || 0) || 0; }
function avgMonthly(row: FollowupRow) { return Number(row.customer_metrics?.avg_monthly || 0) || 0; }
function invoicesCount(row: FollowupRow) { return Number(row.customer_metrics?.invoices_count || 0) || 0; }
function dueAt(row: FollowupRow) { return row.followup_datetime || row.followup_date || row.next_followup_date || row.date || row.created_at || null; }
function isDone(row: FollowupRow) { return Boolean(row.completed_at) || /تم|completed|closed|done/i.test(statusOf(row)); }
function isOverdue(row: FollowupRow) { const due = dueAt(row); return Boolean(due && !isDone(row) && new Date(due).getTime() < Date.now()); }
function branchLabel(value?: string | null) { return normalizeBranchName(value || '') || text(value, 'غير محدد'); }
function whatsappLink(phone: string) { const cleaned = phone.replace(/\D/g, ''); if (!cleaned) return ''; const normalized = cleaned.startsWith('20') ? cleaned : cleaned.startsWith('0') ? `2${cleaned}` : cleaned; return `https://wa.me/${normalized}`; }
function priorityClass(priority?: string | null) { const raw = text(priority).toLowerCase(); if (/عاجل|urgent|critical/.test(raw)) return 'border-red-400/40 bg-red-500/10 text-red-100'; if (/مهم|high/.test(raw)) return 'border-amber-400/40 bg-amber-500/10 text-amber-100'; return 'border-slate-600 bg-slate-800/50 text-slate-200'; }
function statusClass(row: FollowupRow) { if (isDone(row)) return 'border-teal-400/40 bg-teal-500/10 text-teal-100'; if (isOverdue(row)) return 'border-red-400/40 bg-red-500/10 text-red-100'; if (/لم يرد|no_answer/i.test(statusOf(row))) return 'border-amber-400/40 bg-amber-500/10 text-amber-100'; return 'border-sky-400/40 bg-sky-500/10 text-sky-100'; }

function modalPayload(result: FollowupResultData): FollowupResultPayload {
  const completed = result.result !== 'لم يرد' && result.result !== 'الرقم غير صحيح';
  return {
    contact_result: result.result,
    followup_result: result.result,
    followup_summary: result.notes,
    followup_notes: result.notes,
    quality_rating: result.qualityRating,
    internal_rating: result.internalRating,
    needs_next_followup: result.needsNextFollowup,
    next_followup_date: result.nextFollowupDate || null,
    purchase_after_followup: Boolean(result.invoiceNumber || result.purchaseAmount > 0),
    purchase_invoice_no: result.invoiceNumber || null,
    purchase_amount: result.purchaseAmount || null,
    customer_satisfaction: result.customerSatisfaction,
    need_understood: result.needUnderstood,
    cross_sell_offered: result.crossSellOffered,
    up_sell_offered: result.upSellOffered,
    no_purchase_reason: result.noPurchaseReason || null,
    doctor_internal_note: result.doctorInternalNote || null,
    completed_at: completed && !result.needsNextFollowup ? new Date().toISOString() : null,
    status: completed && !result.needsNextFollowup ? 'تم' : result.needsNextFollowup ? 'مؤجل' : result.result,
    followup_status: completed && !result.needsNextFollowup ? 'تم' : result.needsNextFollowup ? 'مؤجل' : result.result,
  };
}

export default function CustomerServiceOperatingCenterV2() {
  const { user } = useAuth();
  const canSeeAll = ['general_manager', 'executive_manager', 'branches_manager', 'customer_service_manager'].includes(String(user?.role || ''));
  const [branch, setBranch] = useState(canSeeAll ? ALL : branchLabel(user?.branch));
  const [status, setStatus] = useState(ALL);
  const [responsible, setResponsible] = useState(ALL);
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('queue');
  const [rows, setRows] = useState<FollowupRow[]>([]);
  const [stats, setStats] = useState<FollowupStats>(EMPTY_STATS);
  const [pools, setPools] = useState<CustomerServiceInsightPools>(EMPTY_POOLS);
  const [performance, setPerformance] = useState<FollowupPerformanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<FollowupRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const scopedBranch = branch === ALL ? undefined : branch;
      const [loadedRows, loadedPools, loadedPerformance] = await Promise.all([
        fetchCustomerServiceFollowups({ branch: scopedBranch, status, responsible, search, limit: 250 }),
        fetchCustomerServiceInsightPools(scopedBranch),
        fetchFollowupPerformanceSummary(scopedBranch),
      ]);
      setRows(loadedRows); setStats(calculateFollowupStats(loadedRows)); setPools(loadedPools); setPerformance((loadedPerformance || []) as FollowupPerformanceRow[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل مركز خدمة العملاء.');
      setRows([]); setStats(EMPTY_STATS);
    } finally { setLoading(false); }
  }, [branch, responsible, search, status]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(timer); }, [load]);

  const responsibleOptions = useMemo(() => Array.from(new Set(rows.map((row) => text(row.responsible_name || row.assigned_to || row.assigned_doctor)).filter(Boolean))), [rows]);
  const visibleRows = useMemo(() => viewMode === 'important' ? pools.important : viewMode === 'reduced' ? pools.reduced : viewMode === 'stopped60' ? pools.stopped60 : rows, [pools, rows, viewMode]);
  const performanceTotals = useMemo(() => performance.reduce((acc, row) => ({ assigned: acc.assigned + row.assigned, completed: acc.completed + row.completed, overdue: acc.overdue + row.overdue, recovered: acc.recovered + row.recoveredCustomers, sales: acc.sales + row.purchaseAfterAmount }), { assigned: 0, completed: 0, overdue: 0, recovered: 0, sales: 0 }), [performance]);

  const generate = async () => {
    setGenerating(true);
    try {
      const report = await generateTodayFollowupsSmartReport(branch === ALL ? undefined : branch, user?.name || null);
      window.dispatchEvent(new CustomEvent('toast', { detail: { type: report.created_count ? 'success' : 'info', message: report.created_count ? `تم إنشاء ${report.created_count} متابعة ذكية جديدة.` : 'لا توجد متابعات جديدة صالحة للإنشاء.' } }));
      await load();
    } catch { window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'error', message: 'تعذر إنشاء المتابعات الذكية.' } })); }
    finally { setGenerating(false); }
  };

  const saveSelected = async (result: FollowupResultData) => {
    if (!selected) return;
    await updateFollowupResult(selected.id, modalPayload(result));
    setSelected(null);
    window.dispatchEvent(new CustomEvent('dataChanged', { detail: { table: 'daily_followups' } }));
    await load();
  };

  return <div className="space-y-5" dir="rtl">
    <section className="rounded-3xl border border-teal-400/20 bg-gradient-to-l from-teal-500/10 via-slate-950 to-sky-500/10 p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><div className="flex items-center gap-2 text-teal-300"><Sparkles size={22} /><span className="font-black">مركز تشغيل خدمة العملاء</span></div><h1 className="mt-2 text-3xl font-black text-white">قائمة المتابعات ونتائج التواصل</h1><p className="mt-2 text-sm text-slate-300">قائمة موحدة للمتابعات اليومية والسريعة والمجدولة مع بيانات العميل والنتيجة.</p></div><div className="flex gap-2"><button onClick={() => void generate()} disabled={generating} className="btn-primary disabled:opacity-50"><Sparkles className={`ml-1 inline h-4 w-4 ${generating ? 'animate-spin' : ''}`} /> إنشاء القائمة الذكية</button><button onClick={() => void load()} disabled={loading} className="btn-secondary disabled:opacity-50"><RefreshCw className={`ml-1 inline h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> تحديث</button></div></div></section>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><Stat icon={UserRound} label="إجمالي المتابعات" value={stats.totalToday} /><Stat icon={CheckCircle2} label="تم التواصل" value={stats.completed} /><Stat icon={Phone} label="لم يرد" value={stats.noAnswer} /><Stat icon={Clock3} label="متأخرة" value={stats.overdue} /><Stat icon={AlertTriangle} label="تحتاج مدير" value={stats.needsManager} /><Stat icon={BarChart3} label="مبيعات بعد المتابعة" value={formatCurrency(stats.purchaseAfterAmount)} /></section>

    <section className="rounded-3xl border border-slate-800 bg-slate-900/75 p-4"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">{canSeeAll ? <select className="input-dark" value={branch} onChange={(event) => setBranch(event.target.value)}><option value={ALL}>كل الفروع</option><option value="فرع الشامي">فرع الشامي</option><option value="فرع شكري">فرع شكري</option></select> : <div className="rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-3 font-bold text-slate-200">{branch}</div>}<select className="input-dark" value={status} onChange={(event) => setStatus(event.target.value)}><option value={ALL}>كل الحالات</option><option value="معلق">معلقة</option><option value="تم">تم التواصل</option><option value="لم يرد">لم يرد</option><option value="مؤجل">مؤجلة</option><option value="متأخرة">متأخرة</option><option value="يحتاج مدير">تحتاج مدير</option></select><select className="input-dark" value={responsible} onChange={(event) => setResponsible(event.target.value)}><option value={ALL}>كل المسؤولين</option>{responsibleOptions.map((name) => <option key={name}>{name}</option>)}</select><label className="relative xl:col-span-2"><Search className="absolute right-3 top-3.5 h-4 w-4 text-slate-500" /><input className="input-dark pr-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="اسم العميل أو الكود أو الهاتف" /></label></div></section>

    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><Mode active={viewMode === 'queue'} onClick={() => setViewMode('queue')} title="قائمة المتابعات" count={rows.length} /><Mode active={viewMode === 'important'} onClick={() => setViewMode('important')} title="العملاء المهمون" count={pools.important.length} /><Mode active={viewMode === 'reduced'} onClick={() => setViewMode('reduced')} title="قللوا التعامل" count={pools.reduced.length} /><Mode active={viewMode === 'stopped60'} onClick={() => setViewMode('stopped60')} title="متوقفون أكثر من شهرين" count={pools.stopped60.length} /></section>

    {error ? <div className="rounded-2xl border border-red-400/25 bg-red-500/10 p-4 text-red-100">{error}</div> : null}
    <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5"><div className="flex justify-between"><div><h2 className="text-2xl font-black text-white">المتابعات الحالية</h2><p className="mt-1 text-sm text-slate-400">اضغط تسجيل النتيجة لاستكمال المتابعة.</p></div><div className="font-black text-teal-200">{visibleRows.length} عميل</div></div>{loading ? <div className="mt-6 text-slate-300">جارٍ التحميل…</div> : null}<div className="mt-4 grid gap-3 xl:grid-cols-2">{visibleRows.map((row) => { const phone = phoneOf(row); const wa = whatsappLink(phone); return <article key={row.id} className="rounded-2xl border border-slate-700 bg-slate-950/45 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:justify-between"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-black text-white">{row.customer_name || row.name || 'عميل غير محدد'}</h3><span className={`rounded-full border px-2 py-1 text-xs font-black ${priorityClass(row.priority)}`}>{row.priority || 'عادي'}</span><span className={`rounded-full border px-2 py-1 text-xs font-black ${statusClass(row)}`}>{statusOf(row)}</span></div><div className="mt-2 text-sm text-slate-300">الكود: {row.customer_code || 'غير مسجل'} · الفرع: {branchLabel(row.branch)} · الهاتف: {phone || 'غير مسجل'}</div><CustomerFlagChips row={row} className="mt-2" /><div className="mt-3 grid gap-2 sm:grid-cols-2 text-xs text-slate-400"><span>إجمالي المشتريات: {formatCurrency(totalSpent(row))}</span><span>متوسط شهري: {formatCurrency(avgMonthly(row))}</span><span>عدد الفواتير: {invoicesCount(row)}</span><span>الموعد: {formatDate(dueAt(row))}</span></div><div className="mt-3 rounded-xl bg-slate-900 p-3 text-sm text-slate-200"><b>سبب المتابعة:</b> {row.followup_reason || row.request_details || recommendedAction(row)}</div>{row.followup_result || row.contact_result ? <div className="mt-2 rounded-xl bg-sky-500/10 p-3 text-sm text-sky-100"><b>آخر نتيجة:</b> {row.followup_result || row.contact_result}</div> : null}</div><div className="flex shrink-0 flex-wrap gap-2 sm:flex-col">{wa ? <a href={wa} target="_blank" rel="noreferrer" className="btn-secondary"><MessageCircle className="ml-1 inline h-4 w-4" /> واتساب</a> : null}{phone ? <a href={`tel:${phone}`} className="btn-secondary"><Phone className="ml-1 inline h-4 w-4" /> اتصال</a> : null}<button onClick={() => setSelected(row)} className="btn-primary">تسجيل النتيجة</button></div></div></article>; })}</div>{!loading && !visibleRows.length ? <div className="mt-6 rounded-2xl border border-slate-700 p-8 text-center text-slate-400">لا توجد متابعات مطابقة.</div> : null}</section>

    <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5"><h2 className="text-2xl font-black text-white">ملخص أداء خدمة العملاء</h2><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Stat icon={UserRound} label="تم إسنادها" value={performanceTotals.assigned} /><Stat icon={CheckCircle2} label="تم إنجازها" value={performanceTotals.completed} /><Stat icon={Clock3} label="متأخرة" value={performanceTotals.overdue} /><Stat icon={Sparkles} label="عملاء مسترجعون" value={performanceTotals.recovered} /><Stat icon={BarChart3} label="مبيعات مسترجعة" value={formatCurrency(performanceTotals.sales)} /></div></section>

    {selected ? <FollowupResultModal followup={selected as never} onClose={() => setSelected(null)} onSave={saveSelected} /> : null}
  </div>;
}

function Stat({ icon: Icon, label, value }: { icon: typeof UserRound; label: string; value: string | number }) { return <div className="rounded-2xl border border-slate-700 bg-slate-950/45 p-4"><Icon className="text-teal-300" size={19} /><div className="mt-2 text-xs text-slate-400">{label}</div><div className="mt-1 text-2xl font-black text-white">{value}</div></div>; }
function Mode({ active, onClick, title, count }: { active: boolean; onClick: () => void; title: string; count: number }) { return <button type="button" onClick={onClick} className={`rounded-2xl border p-4 text-right ${active ? 'border-teal-400 bg-teal-500/15 text-teal-100' : 'border-slate-700 bg-slate-900 text-slate-300'}`}><div className="font-black">{title}</div><div className="mt-1 text-2xl font-black">{count}</div></button>; }
