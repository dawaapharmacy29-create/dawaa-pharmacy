import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clipboard,
/* Alternate legacy branch retained temporarily for reference:
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
*/
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
  ['crm', 'CRM والمتابعة الآمنة'],
  ['cashback', 'نقاط العملاء والكاش باك'],
  ['credit', 'كريدت خدمة العملاء'],
  ['customer-requests', 'طلبات العملاء'],
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
/* Alternate legacy helpers retained temporarily for reference:
import { getBestCustomerPhone, isValidEgyptPhone } from '@/lib/customerAnalyticsService';
import { normalizeBranchName } from '@/lib/branch';
import { BRANCHES } from '@/lib/constants';
import { canSeeAllBranches, effectiveBranchFilter, scopeDescription } from '@/lib/security/permissionScopes';

const PAGE_TABS = [
  { id: 'today', label: 'متابعات اليوم' },
  { id: 'requests', label: 'المتابعات المسندة' },
  { id: 'history', label: 'سجل المتابعات' },
  { id: 'performance', label: 'تحليل أداء خدمة العملاء' },
] as const;

type PageTab = (typeof PAGE_TABS)[number]['id'];
const STATUS_OPTIONS = [ALL_FILTER, 'معلق', 'تم', 'لم يرد', 'مؤجل', 'متأخرة', 'يحتاج مدير'];
const CUSTOMER_CARE_RESPONSIBLES = [
  { branch: 'فرع الشامي', name: 'د ضحى' },
  { branch: 'فرع شكري', name: 'د دنيا' },
];

function text(value: unknown, fallback = 'غير محدد') {
  const v = String(value ?? '').trim();
  return v || fallback;
}

function money(value: unknown) {
  const n = Number(value ?? 0);
  return `${Number.isFinite(n) ? n.toLocaleString('ar-EG', { maximumFractionDigits: 0 }) : '0'} جنيه`;
}

function formatDate(value?: string | null) {
  if (!value) return 'غير محدد';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleDateString('ar-EG');
*/
}
function phoneOf(row: FollowupRow) {
  return String(row.customer_phone || row.phone || row.whatsapp_phone || row.phone_alt || '').trim();
}
function nameOf(row: FollowupRow) {
  return text(row.customer_name || row.name, 'عميل');
}
function statusOf(row: FollowupRow) {
  if (row.completed_at) return row.followup_status || 'تم';
/* Alternate legacy status helpers retained temporarily for reference:

function customerName(row: FollowupRow) {
  return text(row.customer_name || row.name, 'عميل بدون اسم');
}

function phoneOf(row: FollowupRow) {
  return getBestCustomerPhone(row, row.customer_metrics, row) || text(row.customer_phone || row.phone || row.whatsapp_phone || row.phone_alt, '');
}

function statusOf(row: FollowupRow) {
  if (row.completed_at) return row.followup_status || row.status || 'تم';
*/
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
/* Alternate legacy customer helpers retained temporarily for reference:

function segmentOf(row: FollowupRow) {
  return row.customer_metrics?.segment || row.segment || row.classification || 'غير محدد';
}

function customerStatusOf(row: FollowupRow) {
  return row.customer_metrics?.customer_status || row.customer_status || 'غير محدد';
}

function lastPurchaseOf(row: FollowupRow) {
  return row.customer_metrics?.last_purchase || row.last_purchase_date || null;
}

function avgMonthlyOf(row: FollowupRow) {
  return row.customer_metrics?.avg_monthly ?? null;
}

function responsibleOf(row: FollowupRow) {
  if (row.responsible_name || row.assigned_to || row.assigned_doctor) return row.responsible_name || row.assigned_to || row.assigned_doctor || 'غير محدد';
  const branch = normalizeBranchName(row.branch);
  return CUSTOMER_CARE_RESPONSIBLES.find((item) => normalizeBranchName(item.branch) === branch)?.name || 'غير محدد';
}

function scriptFor(row: FollowupRow) {
  const name = customerName(row);
  const reason = row.request_details || row.followup_reason || row.suggested_action || recommendedAction(row);
  return `السلام عليكم ${name}\nمع حضرتك صيدليات دواء.\nكنا بنتابع مع حضرتك بخصوص ${reason}.\nهل في أي حاجة نقدر نساعد حضرتك فيها؟`;
}

function isOverdue(row: FollowupRow) {
  if (row.completed_at || row.postponed_until) return false;
*/
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
  const dashboardBranch = params.get('branch')?.trim() || '';
  const requestedFollowupId = params.get('followupId') || params.get('requestId') || '';
  const [activeTab, setActiveTabState] = useState<TabId>(TABS.some(([id]) => id === requestedTab) ? requestedTab! : 'today');
  const [rows, setRows] = useState<FollowupRow[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [branch, setBranch] = useState(dashboardBranch ? normalizeBranchName(dashboardBranch) : ALL_FILTER);
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
  useEffect(() => {
    if (!requestedFollowupId || !rows.length) return;
    const requested = rows.find((row) => row.id === requestedFollowupId);
    if (requested) {
      setSelectedRow(requested);
      setDetailsRow(requested);
    }
  }, [requestedFollowupId, rows]);

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
  return <div className="w-full max-w-full space-y-5 overflow-hidden" dir="rtl">
    <section className="rounded-3xl border border-cyan-500/30 bg-gradient-to-l from-[#102640] via-slate-900 to-slate-950 p-5 text-slate-100 shadow-xl"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><span className="inline-flex rounded-full border border-cyan-400/30 bg-cyan-500/15 px-3 py-1 text-xs font-black text-cyan-100">Customer Service Command Center</span><h1 className="mt-3 text-2xl font-black text-white">مركز خدمة العملاء</h1><p className="mt-1 text-sm font-semibold text-slate-200">متابعات وتفاصيل وتحليلات كاملة، بتحميل تدريجي يحافظ على سرعة التطبيق.</p>{dashboardBranch && <p className="mt-2 text-xs font-bold text-cyan-200">عرض مرتبط من لوحة القيادة · الفرع: {dashboardBranch}</p>}</div><div className="flex flex-wrap gap-2"><button onClick={() => void load(true)} disabled={refreshing} className="inline-flex items-center rounded-xl border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-black text-white hover:bg-slate-700"><RefreshCw className={`ml-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> تحديث</button><button onClick={() => void generateToday()} disabled={generating} className="dawaa-button-primary">{generating ? 'جاري الإنشاء...' : 'إنشاء قائمة اليوم'}</button></div></div></section>
    <section className="grid gap-3 md:grid-cols-4"><Stat label="إجمالي المتابعات" value={stats.totalToday} /><Stat label="مكتملة" value={stats.completed} tone="green" /><Stat label="متأخرة" value={stats.overdue} tone="amber" /><Stat label="تحتاج مدير" value={stats.needsManager} tone="red" /></section>
    <nav aria-label="أقسام مركز خدمة العملاء" className="w-full max-w-full overflow-hidden rounded-3xl border border-slate-700 bg-[#102640] p-3 shadow-lg"><div className="flex w-full gap-2 overflow-x-auto scroll-smooth pb-2 [scrollbar-color:#22d3ee_#0f172a] [scrollbar-width:thin]">{TABS.map(([id, label]) => <button type="button" key={id} onClick={() => setActiveTab(id)} aria-pressed={activeTab === id} title={`فتح ${label}`} className={`shrink-0 whitespace-nowrap rounded-xl border px-4 py-2.5 text-sm font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${activeTab === id ? 'border-teal-300 bg-teal-500 text-slate-950 shadow-md' : 'border-slate-600 bg-slate-800 text-slate-100 hover:border-cyan-400 hover:bg-slate-700 hover:text-white'}`}>{label}</button>)}</div></nav>
    {cardsTabs.includes(activeTab) && <><section className="dawaa-panel"><div className="grid gap-3 md:grid-cols-4"><select value={branch} onChange={(e) => setBranch(e.target.value)} disabled={!canAllBranches} className="dawaa-input"><option value={ALL_FILTER}>كل الفروع</option>{BRANCHES.map((item) => <option key={item}>{item}</option>)}</select><select value={status} onChange={(e) => setStatus(e.target.value)} className="dawaa-input">{[ALL_FILTER, 'معلق', 'تم', 'لم يرد', 'مؤجل', 'متأخرة', 'يحتاج مدير'].map((item) => <option key={item}>{item}</option>)}</select><div className="relative md:col-span-2"><Search className="absolute right-3 top-3 h-4 w-4 text-slate-400" /><input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="بحث بالاسم أو الكود أو الهاتف" className="dawaa-input w-full pr-10" /></div></div>{refreshing && <div className="mt-2 text-xs font-bold text-teal-500">جاري تحديث البيانات والقائمة ما زالت متاحة...</div>}</section>{error && <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm font-bold text-amber-700">{error}</div>}<section className="grid gap-4 xl:grid-cols-2">{visibleRows.map((row) => <FollowupCard key={row.id} row={row} onResult={() => setResultRow(row)} onDetails={() => { setDetailsRow(row); setSelectedRow(row); }} onPostpone={() => void postpone(row)} onManager={() => void needsManager(row)} />)}</section>{!tabRows.length && <div className="dawaa-panel text-center text-sm font-bold text-slate-500">لا توجد متابعات مطابقة حاليًا</div>}{visibleCount < tabRows.length && <div className="text-center"><button onClick={() => setVisibleCount((count) => count + PAGE_SIZE)} className="btn-secondary">عرض المزيد ({Math.min(PAGE_SIZE, tabRows.length - visibleCount)})</button></div>}</>}
    {activeTab === 'add' && <section className="dawaa-panel"><h2 className="mb-4 text-lg font-black">إضافة متابعة جديدة</h2><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"><input className="dawaa-input" placeholder="اسم العميل" value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} /><input className="dawaa-input" placeholder="رقم الهاتف" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /><input className="dawaa-input" placeholder="الفرع" value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} /><select className="dawaa-input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>{['عاجل', 'مهم', 'متوسط', 'عادي'].map((item) => <option key={item}>{item}</option>)}</select><input className="dawaa-input" type="datetime-local" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} /><textarea className="dawaa-input md:col-span-2 xl:col-span-3" rows={3} placeholder="سبب المتابعة والمطلوب" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div><button onClick={() => void addFollowup()} className="dawaa-button-primary mt-4 inline-flex items-center gap-2"><Plus size={16} /> حفظ المتابعة</button></section>}
    {activeTab === 'evaluation' && <SimpleLink title="تقييم المحادثات" description="افتح نموذج تقييم المحادثة وسجل البنود والنقاط من صفحة التقييم المتخصصة." href="/reviews" />}
    {activeTab === 'scripts' && <section className="grid gap-3 md:grid-cols-2">{whatsappTemplates.map((template) => <article key={template.id} className="dawaa-panel"><h3 className="font-black">{template.name}</h3><p className="mt-1 text-xs text-slate-500">{template.description}</p><pre className="mt-3 whitespace-pre-wrap rounded-xl bg-slate-950 p-3 text-xs leading-6 text-slate-200">{template.template}</pre><button onClick={() => void navigator.clipboard.writeText(template.template).then(() => toast.success('تم نسخ القالب'))} className="btn-secondary mt-3"><Clipboard className="ml-1 inline h-4 w-4" /> نسخ</button></article>)}</section>}
    {activeTab === 'welcome' && <LazyState><CustomerWelcomeTasksPanel /></LazyState>}
    {activeTab === 'data-review' && <LazyState><CustomerDataReview /></LazyState>}
    {activeTab === 'crm' && <SimpleLink title="CRM والمتابعة الآمنة" description="فتح مركز إدارة علاقات العملاء والمتابعة الآمنة." href="/crm" />}
    {activeTab === 'cashback' && <SimpleLink title="نقاط العملاء والكاش باك" description="فتح صفحة نقاط العملاء والكاش باك." href="/customer-cashback" />}
    {activeTab === 'credit' && <SimpleLink title="كريدت خدمة العملاء" description="إدارة كريدت مسؤولي خدمة العملاء." href="/customer-service-credit" />}
    {activeTab === 'customer-requests' && <SimpleLink title="طلبات العملاء" description="فتح مركز طلبات الأصناف ومتابعة دورة توفيرها." href="/customer-requests" />}
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
/* Alternate legacy page retained temporarily for reference:

function priorityScore(row: FollowupRow) {
  let score = 0;
  if (row.needs_manager) score += 1000;
  if (isOverdue(row)) score += 700;
  if (segmentOf(row) === 'مهم جدًا') score += 500;
  if (segmentOf(row) === 'مهم') score += 300;
  if (customerStatusOf(row) === 'متوقف') score += 350;
  score += Number(avgMonthlyOf(row) || 0) / 100;
  return score;
}

function StatCard({ label, value, tone = 'slate' }: { label: string; value: string | number; tone?: 'slate' | 'cyan' | 'emerald' | 'amber' | 'rose' }) {
  const tones = {
    slate: 'border-slate-700 bg-slate-900/70 text-slate-100',
    cyan: 'border-cyan-500/30 bg-cyan-950/30 text-cyan-100',
    emerald: 'border-emerald-500/30 bg-emerald-950/30 text-emerald-100',
    amber: 'border-amber-500/30 bg-amber-950/30 text-amber-100',
    rose: 'border-rose-500/30 bg-rose-950/30 text-rose-100',
  };
  return <div className={`rounded-2xl border p-4 ${tones[tone]}`}><div className="text-xs opacity-70">{label}</div><div className="mt-2 text-2xl font-black">{value}</div></div>;
}

function FollowupCard({ row, selected, onSelect, onDone }: { row: FollowupRow; selected: boolean; onSelect: () => void; onDone: () => void }) {
  const phone = phoneOf(row);
  const validPhone = isValidEgyptPhone(phone, row.customer_code);
  const status = statusOf(row);
  return (
    <article className={`rounded-3xl border p-4 transition ${selected ? 'border-cyan-400 bg-cyan-950/30' : 'border-slate-700 bg-slate-900/70 hover:border-cyan-600/60'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-slate-600 px-2 py-1 text-xs font-bold text-slate-200">{status}</span>
            {row.needs_manager && <span className="rounded-full border border-rose-400/40 bg-rose-500/15 px-2 py-1 text-xs font-bold text-rose-100">يحتاج مدير</span>}
            {isOverdue(row) && <span className="rounded-full border border-amber-400/40 bg-amber-500/15 px-2 py-1 text-xs font-bold text-amber-100">متأخرة</span>}
          </div>
          <h3 className="mt-3 text-xl font-black text-white">{customerName(row)}</h3>
          <div className="mt-2 grid gap-1 text-sm text-slate-300 md:grid-cols-2">
            <span>كود: {text(row.customer_code)}</span>
            <span>هاتف: {validPhone ? phone : 'بدون رقم صحيح'}</span>
            <span>فرع: {text(row.branch)}</span>
            <span>مسؤول: {responsibleOf(row)}</span>
            <span>تصنيف: {segmentOf(row)}</span>
            <span>الحالة: {customerStatusOf(row)}</span>
            <span>آخر شراء: {formatDate(lastPurchaseOf(row))}</span>
            <span>متوسط شهري: {avgMonthlyOf(row) ? money(avgMonthlyOf(row)) : 'غير متاح'}</span>
          </div>
        </div>
      </div>
      <p className="mt-4 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-3 text-sm font-bold text-cyan-50">{row.followup_reason || row.suggested_action || recommendedAction(row)}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={onSelect} className="rounded-xl border border-slate-600 px-3 py-2 text-sm font-bold text-slate-100 hover:bg-slate-800"><Eye className="ml-1 inline h-4 w-4" /> عرض ملف العميل</button>
        {validPhone && <a href={generateWhatsAppLink(phone, scriptFor(row))} target="_blank" rel="noreferrer" className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-500"><MessageSquare className="ml-1 inline h-4 w-4" /> واتساب</a>}
        {validPhone && <a href={`tel:${phone}`} className="rounded-xl border border-slate-600 px-3 py-2 text-sm font-bold text-slate-100 hover:bg-slate-800"><PhoneCall className="ml-1 inline h-4 w-4" /> اتصال</a>}
        <button onClick={onDone} className="rounded-xl bg-cyan-600 px-3 py-2 text-sm font-bold text-white hover:bg-cyan-500"><CheckCircle2 className="ml-1 inline h-4 w-4" /> تم</button>
      </div>
    </article>
  );
}

export default function CustomerService() {
  const { user, canManage } = useAuth();
  const mountedRef = useRef(true);
  const [followups, setFollowups] = useState<FollowupRow[]>([]);
  const [selected, setSelected] = useState<FollowupRow | null>(null);
  const [branchFilter, setBranchFilter] = useState(ALL_FILTER);
  const [statusFilter, setStatusFilter] = useState(ALL_FILTER);
  const [responsibleFilter, setResponsibleFilter] = useState(ALL_FILTER);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeTab, setActiveTab] = useState<PageTab>('today');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(18);

  const canUseAllBranches = canSeeAllBranches(user?.role);
  const manager = Boolean(canManage || canUseAllBranches || user?.role === 'customer_service_manager' || user?.role === 'branch_manager');
  const userScopeLabel = scopeDescription(user?.role);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!canUseAllBranches && user?.branch && branchFilter !== normalizeBranchName(user.branch)) setBranchFilter(normalizeBranchName(user.branch));
  }, [branchFilter, canUseAllBranches, user?.branch]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [search]);

  const loadFollowups = useCallback(async (soft = false) => {
    if (!user) return;
    if (soft) setRefreshing(true);
    else if (!followups.length) setLoading(true);
    setError(null);
    try {
      const scopedBranch = effectiveBranchFilter(user, branchFilter, ALL_FILTER);
      const rows = await fetchCustomerServiceFollowups({ branch: scopedBranch, status: statusFilter, responsible: responsibleFilter, search: debouncedSearch, limit: 40 });
      const visibleRows = manager ? rows : rows.filter((row) => [row.assigned_to, row.responsible_name, row.assigned_doctor, responsibleOf(row)].filter(Boolean).includes(user?.name || ''));
      const sorted = [...visibleRows].sort((a, b) => priorityScore(b) - priorityScore(a));
      if (!mountedRef.current) return;
      setFollowups(sorted);
      setSelected((current) => (current && sorted.find((row) => row.id === current.id)) || sorted[0] || null);
      setVisibleCount(18);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : 'تعذر تحميل المتابعات');
    } finally {
      if (!mountedRef.current) return;
      setLoading(false);
      setRefreshing(false);
    }
  }, [branchFilter, debouncedSearch, followups.length, manager, responsibleFilter, statusFilter, user?.id, user?.name, user?.branch, user?.role]);

  useEffect(() => {
    loadFollowups(false);
  }, [loadFollowups]);

  const stats = useMemo(() => calculateFollowupStats(followups), [followups]);
  const recoveredCount = useMemo(() => followups.filter((row) => row.purchase_after_followup && ['متوقف', 'مهدد بالتوقف'].includes(customerStatusOf(row))).length, [followups]);
  const invalidPhoneCount = useMemo(() => followups.filter((row) => !isValidEgyptPhone(phoneOf(row), row.customer_code)).length, [followups]);
  const responsibleOptions = useMemo(() => [ALL_FILTER, ...new Set([...CUSTOMER_CARE_RESPONSIBLES.map((item) => item.name), ...followups.map(responsibleOf).filter((name) => name !== 'غير محدد')])], [followups]);

  const tabRows = useMemo(() => {
    if (activeTab === 'requests') return followups.filter((row) => row.request_type || row.request_details || row.assigned_doctor);
    if (activeTab === 'history') return followups.filter((row) => row.completed_at || statusOf(row).includes('تم'));
    return followups;
  }, [activeTab, followups]);
  const shownRows = tabRows.slice(0, visibleCount);

  const markDone = async (row: FollowupRow) => {
    try {
      const updated = await updateFollowupResult(row.id, { status: 'تم', followup_status: 'تم', completed_at: new Date().toISOString(), updated_by: user?.id || user?.name || null });
      setFollowups((items) => items.map((item) => item.id === updated.id ? updated : item));
      setSelected(updated);
      toast.success('تم حفظ نتيجة المتابعة');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر حفظ النتيجة');
    }
  };

  const copyScript = async (row: FollowupRow) => {
    await navigator.clipboard.writeText(scriptFor(row));
    toast.success('تم نسخ السكريبت');
  };

  const generateToday = async () => {
    setGenerating(true);
    try {
      const scopedBranch = effectiveBranchFilter(user, branchFilter, ALL_FILTER);
      const rows = await generateTodayFollowupsFromCustomerMetrics(scopedBranch, user?.name);
      toast.success(rows.length ? `تم إنشاء ${rows.length} متابعة` : 'لا توجد متابعات جديدة');
      await loadFollowups(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر إنشاء قائمة اليوم');
    } finally {
      setGenerating(false);
    }
  };

  if (loading && !followups.length) {
    return <div className="flex min-h-[60vh] items-center justify-center" dir="rtl"><div className="rounded-3xl border border-slate-700 bg-slate-900/80 p-8 text-center text-white"><Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-cyan-300" /><div className="text-lg font-black">جاري تحميل مركز خدمة العملاء...</div></div></div>;
  }

  return (
    <div className="space-y-5" dir="rtl">
      <section className="rounded-3xl border border-cyan-500/20 bg-slate-950/70 p-5 text-slate-100 shadow-xl">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <span className="rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-bold text-cyan-200">مركز خدمة العملاء</span>
            <h1 className="mt-3 text-2xl font-black">مركز خدمة العملاء والمتابعات</h1>
            <p className="mt-1 text-sm text-slate-400">نفس التصميم التفصيلي مع تحميل أخف وعرض تدريجي للكروت. نطاقك الحالي: {userScopeLabel}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => loadFollowups(true)} disabled={refreshing} className="rounded-2xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-bold hover:bg-slate-800 disabled:opacity-60"><RefreshCw className={`ml-2 inline h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> تحديث هادئ</button>
            <button onClick={generateToday} disabled={generating} className="rounded-2xl bg-cyan-600 px-4 py-2 text-sm font-bold text-white hover:bg-cyan-500 disabled:opacity-60"><Plus className="ml-2 inline h-4 w-4" /> {generating ? 'جاري الإنشاء...' : 'إنشاء قائمة اليوم'}</button>
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <StatCard label="المسند" value={stats.totalToday} tone="cyan" />
        <StatCard label="المكتمل" value={stats.completed} tone="emerald" />
        <StatCard label="لم يرد" value={stats.noAnswer} tone="amber" />
        <StatCard label="متأخر" value={stats.overdue} tone="rose" />
        <StatCard label="استرجاع شراء" value={recoveredCount} tone="emerald" />
        <StatCard label="أرقام تحتاج مراجعة" value={invalidPhoneCount} tone="amber" />
      </section>

      <section className="rounded-3xl border border-slate-700 bg-slate-950/70 p-4">
        <div className="grid gap-3 lg:grid-cols-5">
          <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} disabled={!canUseAllBranches} className="rounded-2xl border border-slate-700 bg-slate-900 p-3 text-slate-100"><option value={ALL_FILTER}>كل الفروع</option>{BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}</select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-2xl border border-slate-700 bg-slate-900 p-3 text-slate-100">{STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}</select>
          <select value={responsibleFilter} onChange={(e) => setResponsibleFilter(e.target.value)} className="rounded-2xl border border-slate-700 bg-slate-900 p-3 text-slate-100">{responsibleOptions.map((s) => <option key={s} value={s}>{s}</option>)}</select>
          <div className="relative lg:col-span-2"><Search className="absolute right-4 top-3.5 h-5 w-5 text-slate-500" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالاسم / الكود / الهاتف / المسؤول" className="w-full rounded-2xl border border-slate-700 bg-slate-900 py-3 pr-12 text-slate-100" /></div>
        </div>
      </section>

      {error && <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-100"><AlertTriangle className="ml-2 inline h-5 w-5" />{error}</div>}

      <section className="grid gap-5 xl:grid-cols-[1fr_420px]">
        <div className="rounded-3xl border border-slate-700 bg-slate-950/70 p-4">
          <div className="mb-4 flex flex-wrap gap-2">
            {PAGE_TABS.map((tab) => <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`rounded-2xl px-4 py-2 text-sm font-bold ${activeTab === tab.id ? 'bg-cyan-600 text-white' : 'bg-slate-900 text-slate-300 hover:bg-slate-800'}`}>{tab.label}</button>)}
          </div>
          <div className="mb-3 flex items-center justify-between text-sm text-slate-400"><span>يتم عرض {shownRows.length} من {tabRows.length} متابعة لتخفيف المتصفح</span>{refreshing && <span className="text-cyan-300">تحديث...</span>}</div>
          <div className="grid gap-4 md:grid-cols-2">
            {shownRows.map((row) => <FollowupCard key={row.id} row={row} selected={selected?.id === row.id} onSelect={() => setSelected(row)} onDone={() => markDone(row)} />)}
          </div>
          {!shownRows.length && <div className="rounded-2xl border border-dashed border-slate-700 p-10 text-center text-slate-400">لا توجد متابعات مطابقة حاليًا.</div>}
          {visibleCount < tabRows.length && <div className="mt-5 text-center"><button onClick={() => setVisibleCount((count) => count + 18)} className="rounded-2xl bg-slate-800 px-5 py-3 text-sm font-bold text-white hover:bg-slate-700">عرض المزيد</button></div>}
        </div>

        <aside className="rounded-3xl border border-cyan-500/20 bg-slate-950/80 p-4 text-slate-100 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-auto">
          <h2 className="text-xl font-black">تفاصيل المتابعة</h2>
          {!selected ? <p className="mt-4 text-sm text-slate-400">اختار عميل من القائمة لعرض تفاصيله.</p> : <div className="mt-4 space-y-4">
            <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4">
              <h3 className="text-2xl font-black">{customerName(selected)}</h3>
              <div className="mt-3 grid gap-2 text-sm text-slate-300">
                <div className="flex justify-between"><span>الكود</span><b>{text(selected.customer_code)}</b></div>
                <div className="flex justify-between"><span>الهاتف</span><b>{phoneOf(selected) || 'بدون رقم صحيح'}</b></div>
                <div className="flex justify-between"><span>الفرع</span><b>{text(selected.branch)}</b></div>
                <div className="flex justify-between"><span>الحالة</span><b>{customerStatusOf(selected)}</b></div>
                <div className="flex justify-between"><span>التصنيف</span><b>{segmentOf(selected)}</b></div>
                <div className="flex justify-between"><span>درجة الخطورة</span><b>{riskLevel(selected)}</b></div>
                <div className="flex justify-between"><span>آخر شراء</span><b>{formatDate(lastPurchaseOf(selected))}</b></div>
                <div className="flex justify-between"><span>الموعد</span><b>{formatDateTime(selected.followup_datetime || selected.followup_date || selected.created_at)}</b></div>
              </div>
            </div>
            <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4"><h4 className="mb-2 font-black">سكريبت مقترح</h4><p className="whitespace-pre-line text-sm leading-7 text-cyan-50">{scriptFor(selected)}</p></div>
            <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4"><h4 className="mb-2 font-black">ملاحظات قبل التواصل</h4><p className="text-sm text-slate-300">{selected.handling_notes || selected.service_notes || selected.whatsapp_notes || selected.customer_notes || selected.notes || 'لا توجد ملاحظات مسجلة.'}</p></div>
            <div className="flex flex-wrap gap-2">
              {isValidEgyptPhone(phoneOf(selected), selected.customer_code) && <a href={generateWhatsAppLink(phoneOf(selected), scriptFor(selected))} target="_blank" rel="noreferrer" className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500"><MessageSquare className="ml-1 inline h-4 w-4" /> واتساب</a>}
              <button onClick={() => copyScript(selected)} className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-bold hover:bg-slate-800"><Copy className="ml-1 inline h-4 w-4" /> نسخ سكريبت</button>
              <button onClick={() => markDone(selected)} className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-bold text-white hover:bg-cyan-500"><CheckCircle2 className="ml-1 inline h-4 w-4" /> تسجيل نتيجة</button>
            </div>
          </div>}
        </aside>
      </section>
    </div>
  );
*/
}
function Info({ label, value }: { label: string; value: string }) { return <div><span className="block text-[10px] font-bold text-slate-400">{label}</span><b>{value}</b></div>; }
function SimpleLink({ title, description, href }: { title: string; description: string; href: string }) { return <section className="dawaa-panel text-center"><h2 className="text-xl font-black">{title}</h2><p className="mt-2 text-sm text-slate-500">{description}</p><a href={href} className="dawaa-button-primary mt-4 inline-block">فتح الصفحة</a></section>; }
