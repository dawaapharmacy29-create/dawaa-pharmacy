import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clipboard,
  Eye,
  Loader2,
  MessageSquare,
  PhoneCall,
  Plus,
  RefreshCw,
  Search,
  UserCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { ALL_FILTER } from '@/lib/api/customers';
import {
  calculateFollowupStats,
  calculateTeamPerformance,
  createExceptionalFollowup,
  fetchCustomerServiceFollowups,
  generateTodayFollowupsFromCustomerMetrics,
  recommendedAction,
  riskLevel,
  updateFollowupResult,
  type FollowupRow,
} from '@/lib/api/customerServiceCommandCenter';
import { generateWhatsAppLink } from '@/lib/whatsapp';
import { whatsappTemplates } from '@/lib/whatsappTemplates';
import { normalizeBranchName } from '@/lib/branch';
import { BRANCHES } from '@/lib/constants';
import { canSeeAllBranches, effectiveBranchFilter } from '@/lib/security/permissionScopes';
import { CustomerFlagsBadges } from '@/components/CustomerFlagsBadges';
import { createNotification } from '@/lib/notificationService';
import type { Customer, DailyFollowup } from '@/types/database';
import type { FollowupResultData } from '@/components/customerService/FollowupResultModal';

const FollowupResultModal = lazy(() => import('@/components/customerService/FollowupResultModal'));
const CustomerQuickDetailsModal = lazy(() => import('@/components/customers/CustomerQuickDetailsModal'));
const CustomerWelcomeTasksPanel = lazy(() => import('@/components/customer-service/CustomerWelcomeTasksPanel'));
const CustomerDataReview = lazy(() => import('@/pages/CustomerDataReview'));
const TeamPerformanceAnalytics = lazy(() => import('@/components/customerService/TeamPerformanceAnalytics'));
const DoctorPerformanceAnalysis = lazy(() => import('@/components/customerService/DoctorPerformanceAnalysis'));
const CustomerDecisionAnalysis = lazy(() => import('@/components/customerService/CustomerDecisionAnalysis'));
const ContinuousImprovement = lazy(() => import('@/components/customerService/ContinuousImprovement'));

const PAGE_SIZE = 18;
const FETCH_LIMIT = 80;
const TABS = [
  ['today', 'متابعات اليوم'],
  ['assigned', 'المتابعات المسندة'],
  ['requests', 'طلبات المتابعة'],
  ['add', 'إضافة متابعة'],
  ['finish', 'إنهاء متابعة'],
  ['notes', 'ملاحظات العميل'],
  ['evaluation', 'تقييم محادثة'],
  ['scripts', 'قوالب واتساب'],
  ['data-review', 'مراجعة البيانات'],
  ['welcome', 'الرسائل الترحيبية'],
  ['performance', 'تحليل خدمة العملاء'],
  ['doctor', 'أداء الدكتور'],
  ['team', 'أداء الفريق'],
  ['decision', 'تحليل قرار العميل'],
  ['improvements', 'اقتراحات التحسين'],
  ['alerts', 'تنبيهات العملاء'],
  ['history', 'سجل المتابعات'],
] as const;
type TabId = (typeof TABS)[number][0];

function text(value: unknown, fallback = 'غير محدد') {
  return String(value ?? '').trim() || fallback;
}
function phoneOf(row: FollowupRow) {
  return String(row.customer_phone || row.phone || row.whatsapp_phone || row.phone_alt || '').trim();
}
function nameOf(row: FollowupRow) {
  return text(row.customer_name || row.name, 'عميل');
}
function statusOf(row: FollowupRow) {
  if (row.completed_at) return row.followup_status || 'تم';
  if (row.postponed_until) return 'مؤجل';
  if (row.needs_manager) return 'يحتاج مدير';
  return text(row.followup_status || row.status || row.contact_status, 'معلق');
}
function dateText(value?: string | null) {
  if (!value) return 'غير محدد';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value).slice(0, 16) : date.toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
}
function money(value: unknown) {
  return `${Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 0 })} ج`;
}
function isCompleted(row: FollowupRow) {
  return Boolean(row.completed_at) || /تم|completed|done/i.test(statusOf(row));
}
function isOverdue(row: FollowupRow) {
  if (isCompleted(row) || row.postponed_until) return false;
  const due = row.followup_datetime || row.followup_date || row.date;
  return Boolean(due && new Date(due).getTime() < Date.now());
}
function avgMonthly(row: FollowupRow) {
  return Number(row.customer_metrics?.avg_monthly || 0);
}
function totalSpent(row: FollowupRow) {
  return Number(row.customer_metrics?.total_spent || row.total_spent || 0);
}
function invoicesCount(row: FollowupRow) {
  return Number(row.customer_metrics?.invoices_count || 0);
}
function customerFrom(row: FollowupRow): Customer {
  return {
    id: row.customer_id || row.id,
    customer_code: row.customer_code,
    name: nameOf(row),
    phone: phoneOf(row),
    branch: row.branch,
    type: row.segment || row.classification,
    avg_monthly: avgMonthly(row),
    total_purchases: totalSpent(row),
    total_invoices: invoicesCount(row),
    avg_invoice: invoicesCount(row) ? totalSpent(row) / invoicesCount(row) : 0,
    clv: totalSpent(row),
    risk_score: riskLevel(row) === 'عالي' ? 90 : riskLevel(row) === 'متوسط' ? 60 : 25,
    retention_status: row.customer_status,
    last_purchase: row.customer_metrics?.last_purchase || row.last_purchase_date,
    first_purchase: row.customer_metrics?.first_purchase || null,
    notes: row.notes,
    whatsapp_notes: row.whatsapp_notes,
    customer_notes: row.customer_notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
function asDailyFollowup(row: FollowupRow) {
  return row as unknown as DailyFollowup;
}

function LazyState({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="dawaa-panel flex min-h-56 items-center justify-center gap-2 text-sm font-bold text-slate-500"><Loader2 className="h-5 w-5 animate-spin" /> جاري تحميل القسم...</div>}>{children}</Suspense>;
}

export default function CustomerService() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get('tab') as TabId | null;
  const [activeTab, setActiveTabState] = useState<TabId>(TABS.some(([id]) => id === requestedTab) ? requestedTab! : 'today');
  const [rows, setRows] = useState<FollowupRow[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [branch, setBranch] = useState(ALL_FILTER);
  const [status, setStatus] = useState(ALL_FILTER);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [resultRow, setResultRow] = useState<FollowupRow | null>(null);
  const [detailsRow, setDetailsRow] = useState<FollowupRow | null>(null);
  const [selectedRow, setSelectedRow] = useState<FollowupRow | null>(null);
  const [doctorName, setDoctorName] = useState('');
  const [form, setForm] = useState({ customerName: '', phone: '', branch: user?.branch || '', reason: '', priority: 'مهم', due: new Date().toISOString().slice(0, 16) });
  const mountedRef = useRef(true);
  const firstLoadRef = useRef(true);
  const userId = user?.id || '';
  const userName = user?.name || '';
  const userRole = user?.role || '';
  const userBranch = user?.branch || '';
  const canAllBranches = canSeeAllBranches(userRole);

  const setActiveTab = (tab: TabId) => {
    setActiveTabState(tab);
    const next = new URLSearchParams(params);
    next.set('tab', tab);
    setParams(next, { replace: true });
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchInput.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [searchInput]);
  useEffect(() => {
    if (!canAllBranches && userBranch) setBranch(normalizeBranchName(userBranch));
  }, [canAllBranches, userBranch]);

  const load = useCallback(async (soft = false) => {
    if (soft || !firstLoadRef.current) setRefreshing(true);
    else setInitialLoading(true);
    setError(null);
    try {
      const scopedUser = { role: userRole, branch: userBranch };
      const scopedBranch = effectiveBranchFilter(scopedUser, branch, ALL_FILTER);
      const data = await fetchCustomerServiceFollowups({ branch: scopedBranch, status, search: debouncedSearch, limit: FETCH_LIMIT });
      if (!mountedRef.current) return;
      setRows(data);
      setSelectedRow((current) => current && data.some((row) => row.id === current.id) ? current : data[0] || null);
      firstLoadRef.current = false;
    } catch (loadError) {
      console.warn('[customer-service] load failed', loadError);
      if (mountedRef.current) setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل المتابعات');
    } finally {
      if (mountedRef.current) {
        setInitialLoading(false);
        setRefreshing(false);
      }
    }
  }, [branch, debouncedSearch, status, userBranch, userRole]);

  useEffect(() => { void load(!firstLoadRef.current); }, [load]);
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [activeTab, branch, status, debouncedSearch]);

  const stats = useMemo(() => calculateFollowupStats(rows), [rows]);
  const assignedRows = useMemo(() => rows.filter((row) => !userName || [row.responsible_name, row.assigned_to, row.assigned_doctor].some((name) => String(name || '').includes(userName))), [rows, userName]);
  const tabRows = useMemo(() => {
    if (activeTab === 'assigned') return assignedRows;
    if (activeTab === 'requests') return rows.filter((row) => Boolean(row.request_type || row.request_details || row.request_status));
    if (activeTab === 'finish') return rows.filter((row) => !isCompleted(row));
    if (activeTab === 'notes') return rows.filter((row) => row.notes || row.customer_notes || row.handling_notes || row.whatsapp_notes);
    if (activeTab === 'alerts') return rows.filter((row) => row.needs_manager || isOverdue(row) || riskLevel(row) !== 'منخفض' || Object.values(row.customer_flags || {}).some(Boolean));
    if (activeTab === 'history') return rows;
    return rows.filter((row) => !isCompleted(row));
  }, [activeTab, assignedRows, rows]);
  const visibleRows = tabRows.slice(0, visibleCount);
  const staff = useMemo(() => [...new Map(rows.map((row) => {
    const name = text(row.responsible_name || row.assigned_to || row.assigned_doctor, 'غير محدد');
    return [name, { id: row.assigned_staff_id || name, name, role: 'خدمة عملاء', branch: row.branch || 'غير محدد' }];
  })).values()], [rows]);
  const doctorOptions = useMemo(() => staff.map((item) => item.name).filter((name) => name !== 'غير محدد'), [staff]);
  const performance = useMemo(() => calculateTeamPerformance(rows), [rows]);

  const createEventNotification = (row: FollowupRow, type: string, priority: 'normal' | 'high' | 'urgent', title: string) => {
    void createNotification({ title, message: `${nameOf(row)} — ${text(row.followup_reason || row.request_details, 'متابعة عميل')}`, type, priority, branch: row.branch, target_type: 'customer_followup', target_id: row.id, target_route: `/customer-service?tab=today&followupId=${row.id}`, recipient_role: priority === 'urgent' ? 'customer_service_manager' : null, created_by: userId, created_by_name: userName }).catch((notificationError) => console.warn('[customer-service] notification skipped', notificationError));
  };

  const saveResult = async (result: FollowupResultData) => {
    if (!resultRow) return;
    const needsManager = result.result === 'يحتاج متابعة مدير' || result.result === 'تم الرد ويوجد شكوى';
    const purchase = result.result === 'تم الشراء بعد المتابعة';
    const updated = await updateFollowupResult(resultRow.id, {
      followup_status: result.result,
      status: result.result,
      contact_result: result.result,
      followup_result: result.result,
      followup_notes: result.notes,
      quality_rating: result.qualityRating,
      customer_satisfaction: result.customerSatisfied ? 'راضي' : null,
      needs_manager: needsManager,
      purchase_after_followup: purchase,
      purchase_amount: result.purchaseAmount,
      purchase_invoice_no: result.invoiceNumber || null,
      next_followup_date: result.needsNextFollowup ? result.nextFollowupDate : null,
      completed_at: ['لم يرد', 'يحتاج متابعة مدير'].includes(result.result) ? null : new Date().toISOString(),
      updated_by: userId || userName,
    });
    setRows((current) => current.map((row) => row.id === updated.id ? updated : row));
    if (needsManager) createEventNotification(updated, result.result.includes('شكوى') ? 'manager_alert' : 'customer_followup', result.result.includes('شكوى') ? 'urgent' : 'high', result.result.includes('شكوى') ? 'شكوى عميل تحتاج تدخلًا عاجلًا' : 'متابعة عميل تحتاج مدير');
  };

  const postpone = async (row: FollowupRow) => {
    const next = new Date();
    next.setDate(next.getDate() + 1);
    try {
      const updated = await updateFollowupResult(row.id, { status: 'مؤجل', followup_status: 'مؤجل', postponed_until: next.toISOString(), next_followup_date: next.toISOString(), updated_by: userId || userName });
      setRows((current) => current.map((item) => item.id === updated.id ? updated : item));
      toast.success('تم تأجيل المتابعة للغد');
    } catch (saveError) { toast.error(saveError instanceof Error ? saveError.message : 'تعذر التأجيل'); }
  };
  const needsManager = async (row: FollowupRow) => {
    try {
      const updated = await updateFollowupResult(row.id, { status: 'يحتاج مدير', followup_status: 'يحتاج مدير', needs_manager: true, updated_by: userId || userName });
      setRows((current) => current.map((item) => item.id === updated.id ? updated : item));
      createEventNotification(updated, 'customer_followup', 'high', 'متابعة عميل تحتاج مدير');
      toast.success('تم إرسال المتابعة للمدير');
    } catch (saveError) { toast.error(saveError instanceof Error ? saveError.message : 'تعذر التصعيد'); }
  };
  const generateToday = async () => {
    setGenerating(true);
    try {
      const scopedBranch = effectiveBranchFilter({ role: userRole, branch: userBranch }, branch, ALL_FILTER);
      const created = await generateTodayFollowupsFromCustomerMetrics(scopedBranch, userName);
      toast.success(created.length ? `تم إنشاء ${created.length} متابعة` : 'لا توجد متابعات جديدة');
      await load(true);
    } catch (generateError) { toast.error(generateError instanceof Error ? generateError.message : 'تعذر إنشاء قائمة اليوم'); }
    finally { setGenerating(false); }
  };
  const addFollowup = async () => {
    if (!form.customerName.trim()) return toast.error('اكتب اسم العميل');
    try {
      const created = await createExceptionalFollowup({ customerName: form.customerName, customerPhone: form.phone, branch: form.branch, priority: form.priority, requestType: 'متابعة استثنائية', followupReason: form.reason, followupDatetime: form.due, createdBy: userId, createdByName: userName });
      setRows((current) => [created, ...current]);
      createEventNotification(created, 'customer_request', form.priority === 'عاجل' ? 'high' : 'normal', 'طلب متابعة جديد');
      setForm({ customerName: '', phone: '', branch: userBranch, reason: '', priority: 'مهم', due: new Date().toISOString().slice(0, 16) });
      toast.success('تمت إضافة المتابعة');
      setActiveTab('today');
    } catch (saveError) { toast.error(saveError instanceof Error ? saveError.message : 'تعذر إضافة المتابعة'); }
  };

  if (initialLoading && !rows.length) return <div className="flex min-h-[60vh] items-center justify-center"><div className="dawaa-panel text-center"><RefreshCw className="mx-auto mb-4 h-8 w-8 animate-spin text-teal-500" /><div className="font-black">جاري تحميل مركز خدمة العملاء...</div></div></div>;

  const cardsTabs: TabId[] = ['today', 'assigned', 'requests', 'finish', 'notes', 'alerts', 'history'];
  return <div className="space-y-5" dir="rtl">
    <section className="dawaa-hero"><div><span className="dawaa-brand-chip">Customer Service Command Center</span><h1 className="mt-3 text-2xl font-black text-slate-950 dark:text-white">مركز خدمة العملاء</h1><p className="mt-1 text-sm font-semibold text-slate-600 dark:text-slate-300">متابعات وتفاصيل وتحليلات كاملة، بتحميل تدريجي يحافظ على سرعة التطبيق.</p></div><div className="flex flex-wrap gap-2"><button onClick={() => void load(true)} disabled={refreshing} className="btn-secondary"><RefreshCw className={`ml-2 inline h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> تحديث</button><button onClick={() => void generateToday()} disabled={generating} className="dawaa-button-primary">{generating ? 'جاري الإنشاء...' : 'إنشاء قائمة اليوم'}</button></div></section>
    <section className="grid gap-3 md:grid-cols-4"><Stat label="إجمالي المتابعات" value={stats.totalToday} /><Stat label="مكتملة" value={stats.completed} tone="green" /><Stat label="متأخرة" value={stats.overdue} tone="amber" /><Stat label="تحتاج مدير" value={stats.needsManager} tone="red" /></section>
    <section className="dawaa-panel p-3"><div className="flex gap-2 overflow-x-auto pb-1">{TABS.map(([id, label]) => <button key={id} onClick={() => setActiveTab(id)} className={`whitespace-nowrap rounded-xl px-4 py-2 text-xs font-black transition ${activeTab === id ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'}`}>{label}</button>)}</div></section>
    {cardsTabs.includes(activeTab) && <><section className="dawaa-panel"><div className="grid gap-3 md:grid-cols-4"><select value={branch} onChange={(e) => setBranch(e.target.value)} disabled={!canAllBranches} className="dawaa-input"><option value={ALL_FILTER}>كل الفروع</option>{BRANCHES.map((item) => <option key={item}>{item}</option>)}</select><select value={status} onChange={(e) => setStatus(e.target.value)} className="dawaa-input">{[ALL_FILTER, 'معلق', 'تم', 'لم يرد', 'مؤجل', 'متأخرة', 'يحتاج مدير'].map((item) => <option key={item}>{item}</option>)}</select><div className="relative md:col-span-2"><Search className="absolute right-3 top-3 h-4 w-4 text-slate-400" /><input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="بحث بالاسم أو الكود أو الهاتف" className="dawaa-input w-full pr-10" /></div></div>{refreshing && <div className="mt-2 text-xs font-bold text-teal-500">جاري تحديث البيانات والقائمة ما زالت متاحة...</div>}</section>{error && <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm font-bold text-amber-700">{error}</div>}<section className="grid gap-4 xl:grid-cols-2">{visibleRows.map((row) => <FollowupCard key={row.id} row={row} onResult={() => setResultRow(row)} onDetails={() => { setDetailsRow(row); setSelectedRow(row); }} onPostpone={() => void postpone(row)} onManager={() => void needsManager(row)} />)}</section>{!tabRows.length && <div className="dawaa-panel text-center text-sm font-bold text-slate-500">لا توجد متابعات مطابقة حاليًا</div>}{visibleCount < tabRows.length && <div className="text-center"><button onClick={() => setVisibleCount((count) => count + PAGE_SIZE)} className="btn-secondary">عرض المزيد ({Math.min(PAGE_SIZE, tabRows.length - visibleCount)})</button></div>}</>}
    {activeTab === 'add' && <section className="dawaa-panel"><h2 className="mb-4 text-lg font-black">إضافة متابعة جديدة</h2><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"><input className="dawaa-input" placeholder="اسم العميل" value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} /><input className="dawaa-input" placeholder="رقم الهاتف" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /><input className="dawaa-input" placeholder="الفرع" value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} /><select className="dawaa-input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>{['عاجل', 'مهم', 'متوسط', 'عادي'].map((item) => <option key={item}>{item}</option>)}</select><input className="dawaa-input" type="datetime-local" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} /><textarea className="dawaa-input md:col-span-2 xl:col-span-3" rows={3} placeholder="سبب المتابعة والمطلوب" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div><button onClick={() => void addFollowup()} className="dawaa-button-primary mt-4 inline-flex items-center gap-2"><Plus size={16} /> حفظ المتابعة</button></section>}
    {activeTab === 'evaluation' && <SimpleLink title="تقييم المحادثات" description="افتح نموذج تقييم المحادثة وسجل البنود والنقاط من صفحة التقييم المتخصصة." href="/reviews" />}
    {activeTab === 'scripts' && <section className="grid gap-3 md:grid-cols-2">{whatsappTemplates.map((template) => <article key={template.id} className="dawaa-panel"><h3 className="font-black">{template.name}</h3><p className="mt-1 text-xs text-slate-500">{template.description}</p><pre className="mt-3 whitespace-pre-wrap rounded-xl bg-slate-950 p-3 text-xs leading-6 text-slate-200">{template.template}</pre><button onClick={() => void navigator.clipboard.writeText(template.template).then(() => toast.success('تم نسخ القالب'))} className="btn-secondary mt-3"><Clipboard className="ml-1 inline h-4 w-4" /> نسخ</button></article>)}</section>}
    {activeTab === 'welcome' && <LazyState><CustomerWelcomeTasksPanel /></LazyState>}
    {activeTab === 'data-review' && <LazyState><CustomerDataReview /></LazyState>}
    {activeTab === 'performance' && <section className="dawaa-panel overflow-x-auto"><table className="min-w-full text-sm"><thead><tr>{['المسؤول', 'الفرع', 'المسند', 'المكتمل', 'المتأخر', 'نسبة الإنجاز', 'الشراء بعد المتابعة'].map((head) => <th key={head} className="p-3 text-right">{head}</th>)}</tr></thead><tbody>{performance.slice(0, 60).map((item) => <tr key={`${item.responsible}-${item.branch}`} className="border-t"><td className="p-3 font-bold">{item.responsible}</td><td className="p-3">{item.branch}</td><td className="p-3">{item.assigned}</td><td className="p-3">{item.completed}</td><td className="p-3">{item.overdue}</td><td className="p-3">{item.completionRate}%</td><td className="p-3">{money(item.purchaseAfterAmount)}</td></tr>)}</tbody></table></section>}
    {activeTab === 'team' && <LazyState><TeamPerformanceAnalytics followups={rows.map(asDailyFollowup)} staff={staff} /></LazyState>}
    {activeTab === 'doctor' && <section className="space-y-4"><div className="dawaa-panel"><select className="dawaa-input w-full md:w-80" value={doctorName} onChange={(e) => setDoctorName(e.target.value)}><option value="">اختر الدكتور/المسؤول</option>{doctorOptions.map((name) => <option key={name}>{name}</option>)}</select></div>{doctorName ? <LazyState><DoctorPerformanceAnalysis followups={rows.map(asDailyFollowup)} doctorName={doctorName} /></LazyState> : <div className="dawaa-panel text-center text-slate-500">اختر اسمًا لعرض الأداء</div>}</section>}
    {activeTab === 'decision' && <section className="grid gap-4 lg:grid-cols-[320px_1fr]"><aside className="dawaa-panel max-h-[600px] overflow-auto">{rows.slice(0, 50).map((row) => <button key={row.id} onClick={() => setSelectedRow(row)} className={`mb-2 w-full rounded-xl border p-3 text-right ${selectedRow?.id === row.id ? 'border-teal-500 bg-teal-500/10' : 'border-slate-200 dark:border-slate-700'}`}><div className="font-bold">{nameOf(row)}</div><div className="text-xs text-slate-500">{riskLevel(row)}</div></button>)}</aside><div>{selectedRow ? <LazyState><CustomerDecisionAnalysis customer={customerFrom(selectedRow)} followups={rows.filter((row) => row.customer_id === selectedRow.customer_id).map(asDailyFollowup)} /></LazyState> : <div className="dawaa-panel text-center">اختر عميلًا</div>}</div></section>}
    {activeTab === 'improvements' && <LazyState><ContinuousImprovement followups={rows.map(asDailyFollowup)} /></LazyState>}
    {resultRow && <LazyState><FollowupResultModal followup={asDailyFollowup(resultRow)} onClose={() => setResultRow(null)} onSave={saveResult} /></LazyState>}
    {detailsRow && <LazyState><CustomerQuickDetailsModal customerCode={detailsRow.customer_code} customerPhone={phoneOf(detailsRow)} customerName={nameOf(detailsRow)} branch={detailsRow.branch} onClose={() => setDetailsRow(null)} /></LazyState>}
  </div>;
}

function Stat({ label, value, tone = 'teal' }: { label: string; value: number; tone?: 'teal' | 'green' | 'amber' | 'red' }) {
  const colors = { teal: 'text-teal-500', green: 'text-emerald-500', amber: 'text-amber-500', red: 'text-red-500' };
  return <div className="dawaa-card"><div className="text-xs font-bold text-slate-500">{label}</div><div className={`mt-2 text-2xl font-black ${colors[tone]}`}>{value}</div></div>;
}

function FollowupCard({ row, onResult, onDetails, onPostpone, onManager }: { row: FollowupRow; onResult: () => void; onDetails: () => void; onPostpone: () => void; onManager: () => void }) {
  const phone = phoneOf(row);
  const message = `أهلاً ${nameOf(row)}، مع حضرتك صيدليات دواء. بنتابع مع حضرتك بخصوص ${text(row.followup_reason || row.request_details, 'احتياجات حضرتك')}.`;
  const flags = { ...(row.customer_flags || {}), vip: /مهم جدًا|vip/i.test(text(row.segment || row.classification, '')), needs_manager: Boolean(row.needs_manager), overdue: isOverdue(row), invalid_phone: !/^01\d{9}$/.test(phone), purchase_after_followup: Boolean(row.purchase_after_followup) };
  const handlingNote = text(row.handling_notes || row.service_notes || row.whatsapp_notes || row.customer_notes || row.notes, 'لا توجد ملاحظة خاصة قبل التواصل');
  return <article className="dawaa-card border-slate-200 dark:border-slate-700"><div className="flex flex-col gap-4"><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-black text-slate-950 dark:text-white">{nameOf(row)}</h3><span className="badge-info">{statusOf(row)}</span><span className={riskLevel(row) === 'عالي' ? 'badge-danger' : riskLevel(row) === 'متوسط' ? 'badge-warning' : 'badge-success'}>{riskLevel(row)}</span></div><div className="mt-2"><CustomerFlagsBadges customerFlags={flags} limit={6} compact /></div></div><button onClick={onDetails} className="rounded-xl p-2 text-teal-600 hover:bg-teal-50"><Eye size={19} /></button></div><div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300 md:grid-cols-4"><Info label="الكود" value={text(row.customer_code)} /><Info label="الهاتف" value={text(phone, 'رقم غير صحيح')} /><Info label="الفرع" value={text(row.branch)} /><Info label="آخر شراء" value={dateText(row.customer_metrics?.last_purchase || row.last_purchase_date)} /><Info label="المتوسط الشهري" value={money(avgMonthly(row))} /><Info label="إجمالي المشتريات" value={money(totalSpent(row))} /><Info label="عدد الفواتير" value={String(invoicesCount(row))} /><Info label="التصنيف/الحالة" value={`${text(row.segment || row.classification)} · ${text(row.customer_status)}`} /></div><div className="grid gap-2 md:grid-cols-2"><div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><b>سبب المتابعة:</b> {text(row.followup_reason || row.request_details || recommendedAction(row))}</div><div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-800"><b>مهم قبل التواصل:</b> {handlingNote}</div></div><div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500"><span><UserCheck className="ml-1 inline h-4 w-4" />{text(row.responsible_name || row.assigned_to || row.assigned_doctor)}</span><span><CalendarClock className="ml-1 inline h-4 w-4" />{dateText(row.followup_datetime || row.followup_date || row.created_at)}</span></div><div className="flex flex-wrap gap-2">{phone && <><a href={generateWhatsAppLink(phone, message)} target="_blank" rel="noreferrer" className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white"><MessageSquare className="ml-1 inline h-4 w-4" /> واتساب</a><a href={`tel:${phone}`} className="btn-secondary px-3 py-2 text-xs"><PhoneCall className="ml-1 inline h-4 w-4" /> اتصال</a></>}<button onClick={() => void navigator.clipboard.writeText(message).then(() => toast.success('تم نسخ السكريبت'))} className="btn-secondary px-3 py-2 text-xs"><Clipboard className="ml-1 inline h-4 w-4" /> نسخ سكريبت</button><button onClick={onDetails} className="btn-secondary px-3 py-2 text-xs"><Eye className="ml-1 inline h-4 w-4" /> ملف العميل</button><button onClick={onResult} className="rounded-xl bg-teal-600 px-3 py-2 text-xs font-black text-white"><CheckCircle2 className="ml-1 inline h-4 w-4" /> تسجيل نتيجة</button><button onClick={onPostpone} className="btn-secondary px-3 py-2 text-xs">تأجيل</button><button onClick={onManager} className="rounded-xl bg-red-500/10 px-3 py-2 text-xs font-black text-red-600"><AlertTriangle className="ml-1 inline h-4 w-4" /> يحتاج مدير</button></div></div></article>;
}
function Info({ label, value }: { label: string; value: string }) { return <div><span className="block text-[10px] font-bold text-slate-400">{label}</span><b>{value}</b></div>; }
function SimpleLink({ title, description, href }: { title: string; description: string; href: string }) { return <section className="dawaa-panel text-center"><h2 className="text-xl font-black">{title}</h2><p className="mt-2 text-sm text-slate-500">{description}</p><a href={href} className="dawaa-button-primary mt-4 inline-block">فتح الصفحة</a></section>; }
