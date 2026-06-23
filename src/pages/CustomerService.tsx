import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  BarChart3,
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
  ShieldAlert,
  Sparkles,
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
const STATUS_OPTIONS = [ALL_FILTER, 'معلق', 'تم', 'لم يرد', 'مؤجل', 'متأخرة', 'يحتاج مدير', 'تم الشراء بعد المتابعة'];
const CUSTOMER_CARE_RESPONSIBLES = [
  { branch: 'فرع الشامي', name: 'د ضحى' },
  { branch: 'فرع شكري', name: 'د دنيا' },
];
const TABS = [
  ['today', 'متابعات اليوم'],
  ['assigned', 'المتابعات المسندة'],
  ['requests', 'طلبات المتابعة'],
  ['finish', 'إنهاء متابعة'],
  ['notes', 'ملاحظات العميل'],
  ['alerts', 'تنبيهات العملاء'],
  ['history', 'سجل المتابعات'],
  ['welcome', 'الرسائل الترحيبية'],
  ['data-review', 'مراجعة البيانات'],
  ['scripts', 'قوالب واتساب'],
  ['add', 'إضافة متابعة'],
  ['performance', 'تحليل خدمة العملاء'],
  ['doctor', 'أداء الدكتور'],
  ['team', 'أداء الفريق'],
  ['decision', 'تحليل قرار العميل'],
  ['improvements', 'اقتراحات التحسين'],
  ['crm', 'CRM والمتابعة الآمنة'],
  ['cashback', 'نقاط العملاء والكاش باك'],
  ['credit', 'كريدت خدمة العملاء'],
  ['customer-requests', 'طلبات العملاء'],
  ['evaluation', 'تقييم محادثة'],
] as const;

type TabId = (typeof TABS)[number][0];

const PRIMARY_TABS: Array<[TabId, string]> = [
  ['today', 'متابعات اليوم'],
  ['assigned', 'المتابعات المسندة'],
  ['requests', 'طلبات المتابعة'],
  ['finish', 'إنهاء متابعة'],
  ['history', 'سجل المتابعات'],
  ['add', 'إضافة متابعة'],
];

const ADDITIONAL_TOOLS: Array<{ id: TabId; label: string; href?: string }> = [
  { id: 'performance', label: 'تحليل خدمة العملاء' },
  { id: 'doctor', label: 'أداء الدكتور' },
  { id: 'team', label: 'أداء الفريق' },
  { id: 'decision', label: 'تحليل قرار العميل' },
  { id: 'improvements', label: 'اقتراحات التحسين' },
  { id: 'crm', label: 'CRM', href: '/crm' },
  { id: 'cashback', label: 'النقاط والكاش باك', href: '/customer-cashback' },
  { id: 'credit', label: 'كريدت خدمة العملاء', href: '/customer-service-credit' },
  { id: 'evaluation', label: 'تقييم المحادثات', href: '/reviews' },
  { id: 'scripts', label: 'قوالب واتساب' },
  { id: 'welcome', label: 'الرسائل الترحيبية' },
  { id: 'notes', label: 'ملاحظات العميل' },
  { id: 'alerts', label: 'تنبيهات العملاء' },
  { id: 'data-review', label: 'مراجعة البيانات', href: '/customer-data-review' },
  { id: 'customer-requests', label: 'طلبات العملاء', href: '/customer-requests' },
];

type AddFollowupForm = {
  customerName: string;
  phone: string;
  branch: string;
  reason: string;
  priority: string;
  due: string;
};

function text(value: unknown, fallback = 'غير محدد') {
  return String(value ?? '').trim() || fallback;
}

function dateInputNow() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function formatDate(value?: string | null) {
  if (!value) return 'غير محدد';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleDateString('ar-EG');
}

function formatDateTime(value?: string | null) {
  if (!value) return 'غير محدد';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
}

function money(value: unknown) {
  const n = Number(value ?? 0);
  return `${Number.isFinite(n) ? n.toLocaleString('ar-EG', { maximumFractionDigits: 0 }) : '0'} ج`;
}

function phoneOf(row: FollowupRow) {
  return String(row.customer_phone || row.phone || row.whatsapp_phone || row.phone_alt || '').trim();
}

function customerName(row: FollowupRow) {
  return text(row.customer_name || row.name, 'عميل بدون اسم');
}

function segmentOf(row: FollowupRow) {
  return text(row.customer_metrics?.segment || row.segment || row.classification, 'غير مصنف');
}

function customerStatusOf(row: FollowupRow) {
  return text(row.customer_metrics?.customer_status || row.customer_status, 'غير محدد');
}

function lastPurchaseOf(row: FollowupRow) {
  return row.customer_metrics?.last_purchase || row.last_purchase_date || null;
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

function responsibleOf(row: FollowupRow) {
  if (row.responsible_name || row.assigned_to || row.assigned_doctor) {
    return text(row.responsible_name || row.assigned_to || row.assigned_doctor);
  }
  const branch = normalizeBranchName(row.branch);
  return CUSTOMER_CARE_RESPONSIBLES.find((item) => normalizeBranchName(item.branch) === branch)?.name || 'غير محدد';
}

function statusOf(row: FollowupRow) {
  if (row.completed_at) return row.followup_status || 'تم';
  if (row.postponed_until) return 'مؤجل';
  if (row.needs_manager) return 'يحتاج مدير';
  return text(row.followup_status || row.status || row.contact_status, 'معلق');
}

function isCompleted(row: FollowupRow) {
  return Boolean(row.completed_at) || /تم|completed|done/i.test(statusOf(row));
}

function isOverdue(row: FollowupRow) {
  if (isCompleted(row) || row.postponed_until) return false;
  const due = row.followup_datetime || row.followup_date || row.date;
  return Boolean(due && new Date(due).getTime() < Date.now());
}

function statusTone(row: FollowupRow) {
  const status = statusOf(row);
  if (status.includes('تم')) return 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200';
  if (status.includes('لم يرد')) return 'border-amber-400/30 bg-amber-500/10 text-amber-200';
  if (status.includes('مدير')) return 'border-red-400/30 bg-red-500/10 text-red-200';
  if (status.includes('مؤجل')) return 'border-blue-400/30 bg-blue-500/10 text-blue-200';
  return 'border-slate-500/30 bg-slate-700/30 text-slate-200';
}

function priorityTone(row: FollowupRow) {
  const priority = String(row.priority || '').trim();
  if (/عاجل|urgent|high/i.test(priority)) return 'border-red-400/40 bg-red-500/10 text-red-200';
  if (/مهم/i.test(priority)) return 'border-cyan-400/40 bg-cyan-500/10 text-cyan-100';
  return 'border-slate-500/30 bg-slate-800/70 text-slate-300';
}

function priorityScore(row: FollowupRow) {
  let score = 0;
  if (isOverdue(row)) score += 70;
  if (row.needs_manager) score += 65;
  if (/عاجل/i.test(String(row.priority || ''))) score += 45;
  if (/مهم/i.test(String(row.priority || ''))) score += 25;
  if (riskLevel(row) === 'عالي') score += 20;
  if (totalSpent(row) >= 8000) score += 15;
  return score;
}

function scriptFor(row: FollowupRow) {
  const name = customerName(row);
  const reason = row.request_details || row.followup_reason || row.suggested_action || recommendedAction(row);
  const last = lastPurchaseOf(row) ? `\nآخر تعامل كان بتاريخ ${formatDate(lastPurchaseOf(row))}.` : '';
  return `السلام عليكم ${name}\nمع حضرتك صيدليات دواء.\nكنا بنتابع مع حضرتك بخصوص ${reason}.${last}\nهل في أي حاجة نقدر نساعد حضرتك فيها؟`;
}

function customerFrom(row: FollowupRow): Customer {
  return {
    id: row.customer_id || row.id,
    customer_code: row.customer_code,
    name: customerName(row),
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
  } as unknown as Customer;
}

function asDailyFollowup(row: FollowupRow) {
  return row as unknown as DailyFollowup;
}

function LazyState({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="dawaa-panel flex min-h-56 items-center justify-center gap-2 text-sm font-bold text-slate-300">
          <Loader2 className="h-5 w-5 animate-spin" /> جاري تحميل القسم...
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

export default function CustomerService() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get('tab') as TabId | null;
  const dashboardBranch = params.get('branch')?.trim() || '';
  const requestedFollowupId = params.get('followupId') || params.get('requestId') || params.get('taskId') || '';
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
  const [form, setForm] = useState<AddFollowupForm>({
    customerName: '',
    phone: '',
    branch: user?.branch || '',
    reason: '',
    priority: 'مهم',
    due: dateInputNow(),
  });
  const mountedRef = useRef(true);
  const firstLoadRef = useRef(true);
  const userId = user?.id || '';
  const userName = user?.name || '';
  const userRole = user?.role || '';
  const userBranch = user?.branch || '';
  const canAllBranches = canSeeAllBranches(userRole);

  const setActiveTab = useCallback(
    (tab: TabId) => {
      setActiveTabState(tab);
      const next = new URLSearchParams(params);
      next.set('tab', tab);
      setParams(next, { replace: true });
    },
    [params, setParams]
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchInput.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!canAllBranches && userBranch) setBranch(normalizeBranchName(userBranch));
  }, [canAllBranches, userBranch]);

  useEffect(() => {
    if (requestedTab && TABS.some(([id]) => id === requestedTab)) setActiveTabState(requestedTab);
  }, [requestedTab]);

  useEffect(() => {
    if (!requestedFollowupId || !rows.length) return;
    const requested = rows.find((row) => row.id === requestedFollowupId);
    if (requested) {
      setSelectedRow(requested);
      setDetailsRow(requested);
    }
  }, [requestedFollowupId, rows]);

  const load = useCallback(
    async (soft = false) => {
      if (soft || !firstLoadRef.current) setRefreshing(true);
      else setInitialLoading(true);
      setError(null);
      try {
        const scopedUser = { role: userRole, branch: userBranch };
        const scopedBranch = effectiveBranchFilter(scopedUser, branch, ALL_FILTER);
        const data = await fetchCustomerServiceFollowups({
          branch: scopedBranch,
          status,
          search: debouncedSearch,
          limit: FETCH_LIMIT,
        });
        if (!mountedRef.current) return;
        const sorted = [...data].sort((a, b) => priorityScore(b) - priorityScore(a));
        setRows(sorted);
        setSelectedRow((current) => (current && sorted.some((row) => row.id === current.id) ? current : sorted[0] || null));
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
    },
    [branch, debouncedSearch, status, userBranch, userRole]
  );

  useEffect(() => {
    void load(!firstLoadRef.current);
  }, [load]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [activeTab, branch, status, debouncedSearch]);

  const stats = useMemo(() => calculateFollowupStats(rows), [rows]);
  const assignedRows = useMemo(
    () =>
      rows.filter((row) =>
        [row.responsible_name, row.assigned_to, row.assigned_doctor, responsibleOf(row)].some((name) =>
          String(name || '').includes(userName)
        )
      ),
    [rows, userName]
  );
  const tabRows = useMemo(() => {
    if (activeTab === 'assigned') return assignedRows;
    if (activeTab === 'requests' || activeTab === 'customer-requests') {
      return rows.filter((row) => Boolean(row.request_type || row.request_details || row.request_status));
    }
    if (activeTab === 'finish') return rows.filter((row) => !isCompleted(row));
    if (activeTab === 'notes') return rows.filter((row) => row.notes || row.customer_notes || row.handling_notes || row.whatsapp_notes);
    if (activeTab === 'alerts') {
      return rows.filter((row) => row.needs_manager || isOverdue(row) || riskLevel(row) !== 'منخفض' || Object.values(row.customer_flags || {}).some(Boolean));
    }
    if (activeTab === 'history') return rows;
    return rows.filter((row) => !isCompleted(row));
  }, [activeTab, assignedRows, rows]);
  const visibleRows = tabRows.slice(0, visibleCount);
  const staff = useMemo(
    () =>
      [
        ...new Map(
          rows.map((row) => {
            const name = responsibleOf(row);
            return [name, { id: row.assigned_staff_id || name, name, role: 'خدمة عملاء', branch: row.branch || 'غير محدد' }];
          })
        ).values(),
      ],
    [rows]
  );
  const doctorOptions = useMemo(() => staff.map((item) => item.name).filter((name) => name !== 'غير محدد'), [staff]);
  const performance = useMemo(() => calculateTeamPerformance(rows), [rows]);
  const recoveredCount = useMemo(() => rows.filter((row) => row.purchase_after_followup).length, [rows]);
  const invalidPhoneCount = useMemo(() => rows.filter((row) => !phoneOf(row)).length, [rows]);
  const selectedCustomer = selectedRow ? customerFrom(selectedRow) : null;

  const createEventNotification = (row: FollowupRow, type: string, priority: 'normal' | 'high' | 'urgent', title: string) => {
    void createNotification({
      title,
      message: `${customerName(row)} — ${text(row.followup_reason || row.request_details, 'متابعة عميل')}`,
      type,
      priority,
      branch: row.branch,
      target_type: 'customer_followup',
      target_id: row.id,
      target_route: `/customer-service?tab=today&followupId=${row.id}`,
      recipient_role: priority === 'urgent' ? 'customer_service_manager' : null,
      created_by: userId,
      created_by_name: userName,
    }).catch((notificationError) => console.warn('[customer-service] notification skipped', notificationError));
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
    setRows((current) => current.map((row) => (row.id === updated.id ? updated : row)));
    setSelectedRow(updated);
    setResultRow(null);
    if (needsManager) {
      createEventNotification(
        updated,
        result.result.includes('شكوى') ? 'manager_alert' : 'customer_followup',
        result.result.includes('شكوى') ? 'urgent' : 'high',
        result.result.includes('شكوى') ? 'شكوى عميل تحتاج تدخلًا عاجلًا' : 'متابعة عميل تحتاج مدير'
      );
    }
  };

  const postpone = async (row: FollowupRow) => {
    const next = new Date();
    next.setDate(next.getDate() + 1);
    try {
      const updated = await updateFollowupResult(row.id, {
        status: 'مؤجل',
        followup_status: 'مؤجل',
        postponed_until: next.toISOString(),
        next_followup_date: next.toISOString(),
        updated_by: userId || userName,
      });
      setRows((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setSelectedRow(updated);
      toast.success('تم تأجيل المتابعة للغد');
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : 'تعذر التأجيل');
    }
  };

  const escalateToManager = async (row: FollowupRow) => {
    try {
      const updated = await updateFollowupResult(row.id, {
        status: 'يحتاج مدير',
        followup_status: 'يحتاج مدير',
        needs_manager: true,
        updated_by: userId || userName,
      });
      setRows((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setSelectedRow(updated);
      createEventNotification(updated, 'customer_followup', 'high', 'متابعة عميل تحتاج مدير');
      toast.success('تم إرسال المتابعة للمدير');
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : 'تعذر التصعيد');
    }
  };

  const generateToday = async () => {
    setGenerating(true);
    try {
      const scopedBranch = effectiveBranchFilter({ role: userRole, branch: userBranch }, branch, ALL_FILTER);
      const created = await generateTodayFollowupsFromCustomerMetrics(scopedBranch, userName);
      toast.success(created.length ? `تم إنشاء ${created.length} متابعة` : 'لا توجد متابعات جديدة');
      await load(true);
    } catch (generateError) {
      toast.error(generateError instanceof Error ? generateError.message : 'تعذر إنشاء قائمة اليوم');
    } finally {
      setGenerating(false);
    }
  };

  const addFollowup = async () => {
    if (!form.customerName.trim()) return toast.error('اكتب اسم العميل');
    try {
      const created = await createExceptionalFollowup({
        customerName: form.customerName,
        customerPhone: form.phone,
        branch: form.branch,
        priority: form.priority,
        requestType: 'متابعة استثنائية',
        followupReason: form.reason,
        followupDatetime: form.due,
        createdBy: userId,
        createdByName: userName,
      });
      setRows((current) => [created, ...current]);
      setSelectedRow(created);
      createEventNotification(created, 'customer_request', form.priority === 'عاجل' ? 'high' : 'normal', 'طلب متابعة جديد');
      setForm({ customerName: '', phone: '', branch: userBranch, reason: '', priority: 'مهم', due: dateInputNow() });
      toast.success('تمت إضافة المتابعة');
      setActiveTab('today');
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : 'تعذر إضافة المتابعة');
    }
  };

  const copyScript = async (row: FollowupRow) => {
    await navigator.clipboard.writeText(scriptFor(row));
    toast.success('تم نسخ السكريبت');
  };

  if (initialLoading && !rows.length) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center" dir="rtl">
        <div className="dawaa-panel text-center">
          <RefreshCw className="mx-auto mb-4 h-8 w-8 animate-spin text-teal-500" />
          <div className="font-black">جاري تحميل مركز خدمة العملاء...</div>
        </div>
      </div>
    );
  }

  const cardsTabs: TabId[] = ['today', 'assigned', 'requests', 'finish', 'notes', 'alerts', 'history', 'customer-requests'];

  return (
    <div className="customer-service-v3 w-full max-w-full space-y-5 overflow-hidden" dir="rtl">
      <section className="rounded-3xl border border-cyan-500/30 bg-gradient-to-l from-[#102640] via-slate-900 to-slate-950 p-5 text-slate-100 shadow-xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <span className="inline-flex rounded-full border border-cyan-400/30 bg-cyan-500/15 px-3 py-1 text-xs font-black text-cyan-100">
              Customer Service Command Center
            </span>
            <h1 className="mt-3 text-2xl font-black text-white">مركز خدمة العملاء والمتابعات</h1>
            <p className="mt-1 text-sm font-semibold text-slate-200">
              نسخة V3 تجمع تفاصيل النسخة القديمة مع تحميل تدريجي، تابات خفيفة، وإجراءات مباشرة على كل عميل.
            </p>
            {dashboardBranch && <p className="mt-2 text-xs font-bold text-cyan-200">عرض مرتبط من لوحة القيادة · الفرع: {dashboardBranch}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => void load(true)} disabled={refreshing} className="btn-secondary flex items-center gap-2">
              <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> تحديث هادئ
            </button>
            <button onClick={generateToday} disabled={generating} className="btn-primary flex items-center gap-2">
              <Plus size={16} /> {generating ? 'جاري الإنشاء...' : 'إنشاء قائمة اليوم'}
            </button>
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

      <section className="dawaa-panel">
        <div className="grid gap-3 lg:grid-cols-5">
          <select value={branch} onChange={(e) => setBranch(e.target.value)} disabled={!canAllBranches} className="input-dark">
            <option value={ALL_FILTER}>كل الفروع</option>
            {BRANCHES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="input-dark">
            {STATUS_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-3 text-xs font-bold text-slate-300">
            نطاق العرض: {canAllBranches ? 'كل الفروع' : text(userBranch, 'فرع المستخدم')}
          </div>
          <div className="relative lg:col-span-2">
            <Search className="absolute right-4 top-3.5 h-5 w-5 text-slate-500" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="بحث بالاسم / الكود / الهاتف / المسؤول"
              className="input-dark pr-12"
            />
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-100">
          <AlertTriangle className="ml-2 inline h-5 w-5" /> {error}
        </div>
      )}

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_430px]">
        <main className="dawaa-panel min-w-0">
          <div className="mb-4 overflow-x-auto pb-2">
            <div className="flex min-w-max gap-2">
              {PRIMARY_TABS.map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={activeTab === id ? 'btn-primary whitespace-nowrap px-4 py-2 text-xs' : 'btn-secondary whitespace-nowrap px-4 py-2 text-xs'}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-5 rounded-2xl border border-slate-700 bg-slate-950/35 p-4">
            <h2 className="mb-3 text-sm font-black text-white">أدوات إضافية</h2>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {ADDITIONAL_TOOLS.map((tool) =>
                tool.href ? (
                  <a
                    key={tool.id}
                    href={tool.href}
                    className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-center text-xs font-bold text-slate-200 transition hover:border-cyan-400/50 hover:text-cyan-200"
                  >
                    {tool.label}
                  </a>
                ) : (
                  <button
                    key={tool.id}
                    type="button"
                    onClick={() => setActiveTab(tool.id)}
                    className={
                      activeTab === tool.id
                        ? 'rounded-xl border border-cyan-400 bg-cyan-500/15 px-3 py-2 text-xs font-bold text-cyan-100'
                        : 'rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-200 transition hover:border-cyan-400/50 hover:text-cyan-200'
                    }
                  >
                    {tool.label}
                  </button>
                )
              )}
            </div>
          </div>

          {cardsTabs.includes(activeTab) ? (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-300">
                <span>يتم عرض {visibleRows.length} من {tabRows.length} متابعة لتخفيف المتصفح.</span>
                {refreshing && <span className="text-cyan-300">تحديث...</span>}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {visibleRows.map((row) => (
                  <FollowupCard
                    key={row.id}
                    row={row}
                    selected={selectedRow?.id === row.id}
                    onSelect={() => setSelectedRow(row)}
                    onDetails={() => setDetailsRow(row)}
                    onResult={() => setResultRow(row)}
                    onCopy={() => void copyScript(row)}
                    onPostpone={() => void postpone(row)}
                    onManager={() => void escalateToManager(row)}
                  />
                ))}
              </div>
              {!visibleRows.length && <EmptyState />}
              {visibleCount < tabRows.length && (
                <div className="mt-5 text-center">
                  <button onClick={() => setVisibleCount((count) => count + PAGE_SIZE)} className="btn-secondary">
                    عرض المزيد
                  </button>
                </div>
              )}
            </>
          ) : (
            <LazyState>
              <TabPanel
                tab={activeTab}
                rows={rows}
                staff={staff}
                selectedRow={selectedRow}
                doctorName={doctorName}
                setDoctorName={setDoctorName}
                doctorOptions={doctorOptions}
                form={form}
                setForm={setForm}
                onAdd={addFollowup}
                performance={performance}
              />
            </LazyState>
          )}
        </main>

        <aside className="dawaa-panel min-w-0 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-auto">
          <h2 className="text-xl font-black text-white">ملف المتابعة السريع</h2>
          {!selectedRow ? (
            <p className="mt-4 text-sm text-slate-400">اختار عميل من القائمة لعرض التفاصيل والسكريبت والإجراءات.</p>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="rounded-2xl border border-slate-700 bg-slate-950/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-2xl font-black text-white">{customerName(selectedRow)}</h3>
                    <p className="mt-1 text-xs font-bold text-slate-400">{text(selectedRow.customer_code || phoneOf(selectedRow), 'بدون كود')}</p>
                  </div>
                  <span className={`rounded-full border px-3 py-1 text-xs font-black ${statusTone(selectedRow)}`}>{statusOf(selectedRow)}</span>
                </div>
                <div className="mt-4 grid gap-2 text-sm text-slate-300">
                  <InfoRow label="الهاتف" value={phoneOf(selectedRow) || 'بدون رقم صحيح'} />
                  <InfoRow label="الفرع" value={text(selectedRow.branch)} />
                  <InfoRow label="الحالة" value={customerStatusOf(selectedRow)} />
                  <InfoRow label="التصنيف" value={segmentOf(selectedRow)} />
                  <InfoRow label="درجة الخطورة" value={riskLevel(selectedRow)} />
                  <InfoRow label="آخر شراء" value={formatDate(lastPurchaseOf(selectedRow))} />
                  <InfoRow label="متوسط شهري" value={money(avgMonthly(selectedRow))} />
                  <InfoRow label="إجمالي مشتريات" value={money(totalSpent(selectedRow))} />
                  <InfoRow label="المسؤول" value={responsibleOf(selectedRow)} />
                </div>
                <CustomerFlagsBadges customerFlags={selectedRow.customer_flags || {}} />
              </div>

              <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4">
                <h4 className="mb-2 font-black text-cyan-100">سكريبت مقترح</h4>
                <p className="whitespace-pre-line text-sm leading-7 text-cyan-50">{scriptFor(selectedRow)}</p>
              </div>

              <div className="rounded-2xl border border-slate-700 bg-slate-950/40 p-4">
                <h4 className="mb-2 font-black text-white">ملاحظات قبل التواصل</h4>
                <p className="text-sm leading-7 text-slate-300">
                  {selectedRow.handling_notes || selectedRow.service_notes || selectedRow.whatsapp_notes || selectedRow.customer_notes || selectedRow.notes || 'لا توجد ملاحظات مسجلة.'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button className="btn-primary" onClick={() => setResultRow(selectedRow)}><CheckCircle2 className="ml-1 inline h-4 w-4" /> تسجيل نتيجة</button>
                <button className="btn-secondary" onClick={() => setDetailsRow(selectedRow)}><Eye className="ml-1 inline h-4 w-4" /> ملف العميل</button>
                <button className="btn-secondary" onClick={() => void copyScript(selectedRow)}><Clipboard className="ml-1 inline h-4 w-4" /> نسخ السكريبت</button>
                <a className="btn-secondary text-center" href={generateWhatsAppLink(phoneOf(selectedRow), scriptFor(selectedRow))} target="_blank" rel="noreferrer"><MessageSquare className="ml-1 inline h-4 w-4" /> واتساب</a>
                <button className="btn-secondary" onClick={() => void postpone(selectedRow)}><CalendarClock className="ml-1 inline h-4 w-4" /> تأجيل</button>
                <button className="btn-secondary" onClick={() => void escalateToManager(selectedRow)}><ShieldAlert className="ml-1 inline h-4 w-4" /> يحتاج مدير</button>
              </div>
            </div>
          )}
        </aside>
      </section>

      {resultRow && (
        <LazyState>
          <FollowupResultModal followup={asDailyFollowup(resultRow)} onClose={() => setResultRow(null)} onSave={saveResult} />
        </LazyState>
      )}
      {detailsRow && (
        <LazyState>
          <CustomerQuickDetailsModal
            customerCode={detailsRow.customer_code}
            customerPhone={phoneOf(detailsRow)}
            customerName={customerName(detailsRow)}
            branch={detailsRow.branch}
            onClose={() => setDetailsRow(null)}
          />
        </LazyState>
      )}
    </div>
  );
}

function TabPanel({
  tab,
  rows,
  staff,
  selectedRow,
  doctorName,
  setDoctorName,
  doctorOptions,
  form,
  setForm,
  onAdd,
  performance,
}: {
  tab: TabId;
  rows: FollowupRow[];
  staff: Array<{ id: string; name: string; role: string; branch: string | null }>;
  selectedRow: FollowupRow | null;
  doctorName: string;
  setDoctorName: (value: string) => void;
  doctorOptions: string[];
  form: AddFollowupForm;
  setForm: (value: AddFollowupForm | ((current: AddFollowupForm) => AddFollowupForm)) => void;
  onAdd: () => void;
  performance: ReturnType<typeof calculateTeamPerformance>;
}) {
  if (tab === 'welcome') return <CustomerWelcomeTasksPanel />;
  if (tab === 'data-review') return <CustomerDataReview />;
  if (tab === 'team') return <TeamPerformanceAnalytics followups={rows.map(asDailyFollowup)} staff={staff as any} />;
  if (tab === 'doctor') {
    return (
      <div className="space-y-4">
        <select value={doctorName} onChange={(event) => setDoctorName(event.target.value)} className="input-dark max-w-md">
          <option value="">اختر المسؤول / الدكتور</option>
          {doctorOptions.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        {doctorName ? <DoctorPerformanceAnalysis followups={rows.map(asDailyFollowup)} doctorName={doctorName} /> : <EmptyState message="اختر اسم المسؤول لعرض التحليل." />}
      </div>
    );
  }
  if (tab === 'decision') {
    return selectedRow ? <CustomerDecisionAnalysis customer={customerFrom(selectedRow)} followups={rows.map(asDailyFollowup)} /> : <EmptyState message="اختار عميل من القائمة أولًا." />;
  }
  if (tab === 'improvements') return <ContinuousImprovement followups={rows.map(asDailyFollowup)} />;
  if (tab === 'performance') {
    return (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {performance.slice(0, 12).map((row) => (
          <div key={`${row.responsible}-${row.branch}`} className="rounded-2xl border border-slate-700 bg-slate-950/50 p-4">
            <div className="text-lg font-black text-white">{row.responsible}</div>
            <div className="text-xs text-slate-400">{row.branch}</div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-300">
              <InfoRow label="المسند" value={row.assigned} />
              <InfoRow label="المكتمل" value={row.completed} />
              <InfoRow label="النسبة" value={`${row.completionRate}%`} />
              <InfoRow label="شراء بعد المتابعة" value={money(row.purchaseAfterAmount)} />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (tab === 'scripts') {
    return (
      <div className="grid gap-4 lg:grid-cols-3">
        <ScriptCard title="استرجاع عميل متوقف" body="السلام عليكم، مع حضرتك صيدليات دواء. لاحظنا إن حضرتك بقالك فترة ما تعاملتش معانا، وحابين نطمئن هل في أي احتياج نقدر نجهزه لحضرتك؟" />
        <ScriptCard title="عميل VIP" body="السلام عليكم، حضرتك من العملاء المميزين عندنا. بنراجع احتياجات حضرتك الشهرية ونقدر نجهز الطلب أو نوفر بدائل مناسبة." />
        <ScriptCard title="طلب ناقص" body="السلام عليكم، بخصوص الصنف المطلوب، هنراجع توفره ونتابع مع حضرتك فور وصوله أو توفر بديل مناسب." />
      </div>
    );
  }
  if (tab === 'add') {
    return (
      <div className="grid gap-3 lg:grid-cols-2">
        <input className="input-dark" placeholder="اسم العميل" value={form.customerName} onChange={(event) => setForm((current) => ({ ...current, customerName: event.target.value }))} />
        <input className="input-dark" placeholder="رقم الهاتف" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
        <select className="input-dark" value={form.branch} onChange={(event) => setForm((current) => ({ ...current, branch: event.target.value }))}>
          <option value="">اختر الفرع</option>
          {BRANCHES.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
        </select>
        <select className="input-dark" value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}>
          <option>مهم</option><option>عاجل</option><option>متوسط</option><option>عادي</option>
        </select>
        <input className="input-dark" type="datetime-local" value={form.due} onChange={(event) => setForm((current) => ({ ...current, due: event.target.value }))} />
        <textarea className="input-dark lg:col-span-2" rows={4} placeholder="سبب المتابعة" value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} />
        <button className="btn-primary lg:col-span-2" onClick={onAdd}>إضافة متابعة</button>
      </div>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <NavigationCard title="CRM والمتابعة الآمنة" href="/crm" description="فتح صفحة CRM المتقدمة ومتابعة العملاء بأمان." />
      <NavigationCard title="نقاط العملاء والكاش باك" href="/customer-cashback" description="متابعة رصيد العملاء ونقاط الولاء." />
      <NavigationCard title="كريدت خدمة العملاء" href="/customer-service-credit" description="متابعة كريدت وخدمة العملاء." />
      <NavigationCard title="طلبات العملاء" href="/customer-requests" description="طلبات العملاء والمتابعات القادمة." />
      <NavigationCard title="تقييم محادثة" href="/reviews" description="تسجيل أو مراجعة تقييم محادثة وبيع." />
    </div>
  );
}

function FollowupCard({ row, selected, onSelect, onDetails, onResult, onCopy, onPostpone, onManager }: {
  row: FollowupRow;
  selected: boolean;
  onSelect: () => void;
  onDetails: () => void;
  onResult: () => void;
  onCopy: () => void;
  onPostpone: () => void;
  onManager: () => void;
}) {
  const phone = phoneOf(row);
  return (
    <article
      onClick={onSelect}
      className={`cursor-pointer rounded-3xl border p-4 transition ${selected ? 'border-cyan-400 bg-cyan-500/10 shadow-lg shadow-cyan-950/20' : 'border-slate-700 bg-slate-950/45 hover:border-cyan-500/40 hover:bg-slate-900/80'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-black text-white">{customerName(row)}</h3>
          <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-400">
            <span>{text(row.customer_code || phone, 'بدون كود')}</span>
            <span>·</span>
            <span>{text(row.branch)}</span>
          </div>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${priorityTone(row)}`}>{text(row.priority, 'مهم')}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${statusTone(row)}`}>{statusOf(row)}</span>
        <span className="rounded-full border border-slate-600 bg-slate-800/80 px-2.5 py-1 text-xs text-slate-200">{segmentOf(row)}</span>
        <span className="rounded-full border border-slate-600 bg-slate-800/80 px-2.5 py-1 text-xs text-slate-200">خطورة: {riskLevel(row)}</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-300">
        <InfoRow label="آخر شراء" value={formatDate(lastPurchaseOf(row))} />
        <InfoRow label="متوسط شهري" value={money(avgMonthly(row))} />
        <InfoRow label="إجمالي" value={money(totalSpent(row))} />
        <InfoRow label="المسؤول" value={responsibleOf(row)} />
      </div>
      <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-300">
        {row.followup_reason || row.request_details || row.suggested_action || recommendedAction(row)}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2 xl:grid-cols-3" onClick={(event) => event.stopPropagation()}>
        <button className="btn-primary px-3 py-2 text-xs" onClick={onResult}><CheckCircle2 className="ml-1 inline h-3.5 w-3.5" /> نتيجة</button>
        <button className="btn-secondary px-3 py-2 text-xs" onClick={onDetails}><Eye className="ml-1 inline h-3.5 w-3.5" /> التفاصيل</button>
        <button className="btn-secondary px-3 py-2 text-xs" onClick={onCopy}><Clipboard className="ml-1 inline h-3.5 w-3.5" /> نسخ</button>
        <a className="btn-secondary px-3 py-2 text-center text-xs" href={generateWhatsAppLink(phone, scriptFor(row))} target="_blank" rel="noreferrer"><MessageSquare className="ml-1 inline h-3.5 w-3.5" /> واتساب</a>
        <button className="btn-secondary px-3 py-2 text-xs" onClick={onPostpone}><CalendarClock className="ml-1 inline h-3.5 w-3.5" /> تأجيل</button>
        <button className="btn-secondary px-3 py-2 text-xs" onClick={onManager}><UserCheck className="ml-1 inline h-3.5 w-3.5" /> مدير</button>
      </div>
    </article>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number | string; tone: 'cyan' | 'emerald' | 'amber' | 'rose' }) {
  const tones = {
    cyan: 'border-cyan-400/30 bg-cyan-500/10 text-cyan-100',
    emerald: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100',
    amber: 'border-amber-400/30 bg-amber-500/10 text-amber-100',
    rose: 'border-rose-400/30 bg-rose-500/10 text-rose-100',
  };
  return <div className={`rounded-2xl border p-4 ${tones[tone]}`}><div className="text-xs font-bold opacity-80">{label}</div><div className="mt-2 text-3xl font-black num">{value}</div></div>;
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-2"><span className="text-slate-400">{label}</span><b className="text-left text-slate-100">{value}</b></div>;
}

function EmptyState({ message = 'لا توجد بيانات مطابقة حاليًا.' }: { message?: string }) {
  return <div className="rounded-2xl border border-dashed border-slate-700 p-10 text-center text-slate-400">{message}</div>;
}

function ScriptCard({ title, body }: { title: string; body: string }) {
  const copy = async () => {
    await navigator.clipboard.writeText(body);
    toast.success('تم نسخ السكريبت');
  };
  return <div className="rounded-2xl border border-slate-700 bg-slate-950/50 p-4"><h3 className="font-black text-white">{title}</h3><p className="mt-3 whitespace-pre-line text-sm leading-7 text-slate-300">{body}</p><button className="btn-secondary mt-4 w-full" onClick={copy}><Clipboard className="ml-1 inline h-4 w-4" /> نسخ</button></div>;
}

function NavigationCard({ title, description, href }: { title: string; description: string; href: string }) {
  return <a href={href} className="rounded-2xl border border-slate-700 bg-slate-950/50 p-4 transition hover:border-cyan-400/50 hover:bg-cyan-500/10"><div className="flex items-center gap-2 text-white"><Sparkles className="h-4 w-4 text-cyan-300" /><b>{title}</b></div><p className="mt-2 text-sm leading-6 text-slate-300">{description}</p></a>;
}
