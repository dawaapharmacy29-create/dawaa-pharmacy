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
import { searchCustomerMetrics,
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

const QUICK_FILTERS = [
  ['all', 'كل العملاء'],
  ['vip', 'VIP'],
  ['important', 'مهم'],
  ['stopped', 'متوقف'],
  ['overdue', 'متأخر'],
  ['not_contacted', 'لم يتم التواصل'],
  ['contacted', 'تم التواصل'],
  ['postponed', 'مؤجل'],
  ['needs_manager', 'يحتاج مدير'],
  ['no_phone', 'بدون رقم صحيح'],
  ['exceptional', 'متابعة استثنائية'],
] as const;

type QuickFilter = (typeof QUICK_FILTERS)[number][0];

type MetricFilter =
  | 'all'
  | 'today'
  | 'completed'
  | 'noAnswer'
  | 'postponed'
  | 'needsManager'
  | 'overdue'
  | 'invalidPhone'
  | 'recovered'
  | 'notStarted'
  | 'contactedNoPurchase';

const METRIC_FILTER_LABELS: Record<MetricFilter, string> = {
  all: 'عرض الكل',
  today: 'متابعات اليوم',
  completed: 'المكتمل',
  noAnswer: 'لم يرد',
  postponed: 'مؤجل',
  needsManager: 'يحتاج مدير',
  overdue: 'متأخر',
  invalidPhone: 'بدون رقم صحيح',
  recovered: 'تحول لبيع',
  notStarted: 'لم يبدأ التواصل',
  contactedNoPurchase: 'تم التواصل ولم يشترِ',
};

function matchesMetricFilter(row: FollowupRow, filter: MetricFilter) {
  if (filter === 'all') return true;
  const status = statusOf(row);
  if (filter === 'today') return !isCompleted(row);
  if (filter === 'completed') return isCompleted(row);
  if (filter === 'noAnswer') return /لم يرد|no answer/i.test(status);
  if (filter === 'postponed') return Boolean(row.postponed_until) || /مؤجل/i.test(status);
  if (filter === 'needsManager') return Boolean(row.needs_manager) || /مدير/i.test(status);
  if (filter === 'overdue') return isOverdue(row);
  if (filter === 'invalidPhone') return !phoneOf(row);
  if (filter === 'recovered') return Boolean(row.purchase_after_followup);
  if (filter === 'notStarted') return !row.contacted_at && !row.contact_result && !row.followup_result && !isCompleted(row);
  if (filter === 'contactedNoPurchase') {
    const contacted = Boolean(row.contacted_at || row.contact_result || row.followup_result) || /تم|contacted|completed/i.test(status);
    return contacted && !row.purchase_after_followup;
  }
  return true;
}

function reviewSummaryOf(row: FollowupRow) {
  const record = row as Record<string, unknown>;
  const rating = record.quality_rating || record.review_score || record.conversation_score || record.customer_satisfaction;
  return rating ? String(rating) : 'غير مسجل';
}

function priorityReason(row: FollowupRow) {
  if (row.needs_manager) return 'يحتاج مدير';
  if (isOverdue(row)) return 'متأخر';
  if (!phoneOf(row)) return 'بدون رقم صحيح';
  if (/عاجل|urgent|high/i.test(String(row.priority || ''))) return 'أولوية عاجلة';
  if (riskLevel(row) === 'عالي') return 'عميل مرتفع الخطورة';
  if (totalSpent(row) >= 8000) return 'مشتريات مرتفعة';
  if (avgMonthly(row) >= 1500) return 'متوسط شهري مهم';
  return 'متابعة دورية';
}

function lastContactAt(row: FollowupRow) {
  return row.contacted_at || row.updated_at || row.completed_at || row.created_at || row.followup_date || row.date || null;
}

function updatedByOf(row: FollowupRow) {
  const record = row as Record<string, unknown>;
  return text(record.updated_by_name || record.updated_by || record.created_by_name || record.created_by || responsibleOf(row), 'غير محدد');
}

function modalFallbackFrom(row: FollowupRow): Record<string, unknown> {
  return {
    id: row.customer_id || row.id,
    customer_id: row.customer_id || null,
    customer_code: row.customer_code || null,
    customer_name: customerName(row),
    customer_phone: phoneOf(row) || null,
    phone: phoneOf(row) || null,
    name: customerName(row),
    branch: row.branch || null,
    invoices_count: invoicesCount(row),
    total_spent: totalSpent(row),
    total_purchases: totalSpent(row),
    avg_monthly: avgMonthly(row),
    avg_invoice: invoicesCount(row) ? totalSpent(row) / invoicesCount(row) : Number(row.customer_metrics?.avg_invoice || 0),
    first_purchase: row.customer_metrics?.first_purchase || null,
    last_purchase: lastPurchaseOf(row),
    active_months: row.customer_metrics?.active_months || 0,
    segment: segmentOf(row),
    type: segmentOf(row),
    customer_status: customerStatusOf(row),
    status: customerStatusOf(row),
    retention_status: customerStatusOf(row),
  };
}


const ADDITIONAL_TOOLS: Array<{ id: string; label: string; href?: string }> = [
  { id: 'performance', label: 'تحليل خدمة العملاء' },
  { id: 'doctor', label: 'أداء الدكتور' },
  { id: 'team', label: 'أداء الفريق' },
  { id: 'decision', label: 'تحليل قرار العميل' },
  { id: 'improvements', label: 'اقتراحات التحسين' },
  { id: 'crm', label: 'CRM', href: '/crm' },
  { id: 'cashback', label: 'النقاط والكاش باك', href: '/customer-cashback' },
  { id: 'credit', label: 'كريدت خدمة العملاء', href: '/customer-service-credit' },
  { id: 'evaluation', label: 'تقييم المحادثات', href: '/reviews' },
  { id: 'quick-replies', label: 'اختصارات الردود السريعة', href: '/quick-replies' },
  { id: 'competition', label: 'مسابقة الدكاترة', href: '/doctor-competition' },
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
  result: string;
  nextDue: string;
  selectedCustomer?: ExceptionalCustomerSearchResult | null;
};

type ExceptionalCustomerSearchResult = {
  id?: string | number | null;
  customer_id?: string | number | null;
  code?: string | number | null;
  customer_code?: string | number | null;
  name?: string | null;
  customer_name?: string | null;
  client_name?: string | null;
  phone?: string | null;
  customer_phone?: string | null;
  mobile?: string | null;
  branch?: string | null;
  total_purchases?: number | null;
  monthly_avg?: number | null;
  last_purchase_date?: string | null;
  [key: string]: unknown;
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


function exceptionalCustomerName(customer: ExceptionalCustomerSearchResult | null | undefined) {
  return String(customer?.customer_name || customer?.name || customer?.client_name || '').trim();
}

function exceptionalCustomerPhone(customer: ExceptionalCustomerSearchResult | null | undefined) {
  return String(customer?.customer_phone || customer?.phone || customer?.mobile || '').trim();
}

function exceptionalCustomerCode(customer: ExceptionalCustomerSearchResult | null | undefined) {
  const value = customer?.customer_code || customer?.code || customer?.id || customer?.customer_id || '';
  return String(value).trim();
}

function exceptionalCustomerBranch(customer: ExceptionalCustomerSearchResult | null | undefined) {
  return String(customer?.branch || '').trim();
}

function matchesQuickFilter(row: FollowupRow, filter: QuickFilter) {
  if (filter === 'all') return true;
  const status = statusOf(row);
  const segment = segmentOf(row);
  const customerStatus = customerStatusOf(row);
  const priority = String(row.priority || '');
  if (filter === 'vip') return /vip|مهم جدا|مميز/i.test(`${segment} ${priority}`);
  if (filter === 'important') return /مهم|عاجل|high|urgent/i.test(priority);
  if (filter === 'stopped') return /متوقف|stop|inactive/i.test(customerStatus);
  if (filter === 'overdue') return isOverdue(row);
  if (filter === 'not_contacted') return /لم يرد|لم يتم|not contacted/i.test(status);
  if (filter === 'contacted') return /تم|completed|contacted/i.test(status) && !isCompleted(row);
  if (filter === 'postponed') return Boolean(row.postponed_until) || /مؤجل/i.test(status);
  if (filter === 'needs_manager') return Boolean(row.needs_manager) || /مدير/i.test(status);
  if (filter === 'no_phone') return !phoneOf(row);
  if (filter === 'exceptional') return /استثنائية|exceptional/i.test(`${row.request_type || ''} ${row.followup_type || ''} ${row.followup_reason || ''} ${row.notes || ''}`);
  return true;
}

function scriptFor(row: FollowupRow) {
  const reason = row.request_details || row.followup_reason || row.suggested_action || recommendedAction(row);
  const last = lastPurchaseOf(row) ? `\nآخر تعامل كان بتاريخ ${formatDate(lastPurchaseOf(row))}.` : '';
  return `أهلا بحضرتك، مع حضرتك خدمة عملاء صيدليات دواء.
بنطمن على حضرتك وبنتابع بخصوص ${reason}.${last}
نتشرف بخدمة حضرتك دائمًا.`;
}

function customer360Url(row: FollowupRow) {
  return `/customer-360?${new URLSearchParams({
    code: row.customer_code || '',
    id: row.customer_id || '',
    phone: phoneOf(row),
    name: customerName(row),
  }).toString()}`;
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


type ExceptionalCustomerSearchBoxProps = {
  branch?: string | null;
  onSelect: (customer: ExceptionalCustomerSearchResult) => void;
};

function ExceptionalCustomerSearchBox({ branch, onSelect }: ExceptionalCustomerSearchBoxProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ExceptionalCustomerSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<ExceptionalCustomerSearchResult | null>(null);

  const runSearch = async () => {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 2) {
      toast.error('اكتب اسم العميل أو الكود أو رقم الهاتف');
      return;
    }
    setLoading(true);
    try {
      const data = await searchCustomerMetrics(normalizedQuery, branch || undefined);
      const list = Array.isArray(data) ? (data as ExceptionalCustomerSearchResult[]) : [];
      setResults(list);
      if (list.length === 0) toast.info('لم يتم العثور على العميل، يمكن إضافته يدويًا');
    } catch (error) {
      console.error('[CustomerService] exceptional customer search failed', error);
      toast.error('تعذر البحث في قائمة العملاء');
    } finally {
      setLoading(false);
    }
  };

  const selectCustomer = (customer: ExceptionalCustomerSearchResult) => {
    setSelected(customer);
    onSelect(customer);
    toast.success('تم اختيار العميل من قاعدة البيانات');
  };

  const clearManual = () => {
    setSelected(null);
    setQuery('');
    setResults([]);
    toast.info('يمكنك إدخال عميل جديد يدويًا');
  };

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4 space-y-3">
      <div className="flex flex-col gap-2 lg:flex-row">
        <input
          className="input-dark flex-1"
          placeholder="ابحث في قاعدة بيانات العملاء بالاسم أو الكود أو رقم الهاتف"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void runSearch();
            }
          }}
        />
        <button type="button" className="btn-primary min-w-[120px]" onClick={() => void runSearch()} disabled={loading}>
          {loading ? 'جاري البحث...' : '🔎 بحث'}
        </button>
        <button type="button" className="btn-secondary min-w-[150px]" onClick={clearManual}>
          عميل جديد يدويًا
        </button>
      </div>

      {selected && (
        <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3 text-sm text-emerald-50">
          العميل المختار من قاعدة البيانات:
          <b className="mx-1">{exceptionalCustomerName(selected) || 'بدون اسم'}</b>
          <span className="text-emerald-100">
            · الكود: {exceptionalCustomerCode(selected) || 'بدون كود'}
            · الهاتف: {exceptionalCustomerPhone(selected) || 'بدون رقم'}
            · الفرع: {exceptionalCustomerBranch(selected) || 'غير محدد'}
          </span>
        </div>
      )}

      {results.length > 0 && (
        <div className="grid gap-2">
          {results.slice(0, 8).map((customer, index) => (
            <button
              key={String(customer.id || customer.customer_id || customer.customer_code || customer.code || index)}
              type="button"
              className="rounded-xl border border-slate-700 bg-slate-950/50 p-3 text-right text-sm text-slate-100 hover:border-cyan-400/60 hover:bg-cyan-500/10 transition"
              onClick={() => selectCustomer(customer)}
            >
              <div className="font-black">{exceptionalCustomerName(customer) || 'عميل بدون اسم'}</div>
              <div className="mt-1 text-xs text-slate-400">
                الكود: {exceptionalCustomerCode(customer) || 'بدون كود'} · الهاتف: {exceptionalCustomerPhone(customer) || 'بدون رقم'} · الفرع: {exceptionalCustomerBranch(customer) || 'غير محدد'}
              </div>
            </button>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-400">
        لو العميل موجود اختاره من نتائج البحث، ولو عميل جديد اكتب بياناته يدويًا بالأسفل.
      </p>
    </div>
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
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [metricFilter, setMetricFilter] = useState<MetricFilter>('all');
  const [assignedFilter, setAssignedFilter] = useState(ALL_FILTER);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [resultRow, setResultRow] = useState<FollowupRow | null>(null);
  const [detailsRow, setDetailsRow] = useState<FollowupRow | null>(null);
  const [selectedRow, setSelectedRow] = useState<FollowupRow | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerResults, setCustomerResults] = useState<ExceptionalCustomerSearchResult[]>([]);
  const [searchingCustomers, setSearchingCustomers] = useState(false);
  const [selectedAddCustomer, setSelectedAddCustomer] = useState<ExceptionalCustomerSearchResult | null>(null);

  const [doctorName, setDoctorName] = useState('');
  const [form, setForm] = useState<AddFollowupForm>({
    customerName: '',
    phone: '',
    branch: user?.branch || '',
    reason: '',
    priority: 'مهم',
    due: dateInputNow(),
    result: 'لم يتم التواصل بعد',
    nextDue: '',
    selectedCustomer: null,
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
  }, [activeTab, branch, status, debouncedSearch, quickFilter, assignedFilter, metricFilter]);

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
  const filteredTabRows = useMemo(
    () =>
      tabRows.filter((row) => {
        const responsible = responsibleOf(row);
        return (
          matchesQuickFilter(row, quickFilter) &&
          matchesMetricFilter(row, metricFilter) &&
          (assignedFilter === ALL_FILTER || responsible === assignedFilter)
        );
      }),
    [assignedFilter, metricFilter, quickFilter, tabRows]
  );
  const visibleRows = filteredTabRows.slice(0, visibleCount);
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
  const notStartedCount = useMemo(() => rows.filter((row) => matchesMetricFilter(row, 'notStarted')).length, [rows]);
  const contactedNoPurchaseCount = useMemo(() => rows.filter((row) => matchesMetricFilter(row, 'contactedNoPurchase')).length, [rows]);
  const funnel = useMemo(() => {
    const contacted = rows.filter((row) => !matchesMetricFilter(row, 'notStarted')).length;
    const later = rows.filter((row) => row.next_followup_date || row.postponed_until || /متابعة|لاحق|مؤجل/i.test(statusOf(row))).length;
    const closed = rows.filter((row) => row.closed_at || isCompleted(row)).length;
    return {
      total: rows.length,
      contacted,
      noAnswer: stats.noAnswer,
      later,
      recovered: recoveredCount,
      needsManager: stats.needsManager,
      closed,
      conversionRate: rows.length ? Math.round((recoveredCount / rows.length) * 100) : 0,
      recoveredAmount: stats.purchaseAfterAmount,
    };
  }, [recoveredCount, rows, stats.needsManager, stats.noAnswer, stats.purchaseAfterAmount]);
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

  const addQuickNote = async (row: FollowupRow) => {
    const note = window.prompt('اكتب ملاحظة المتابعة الجديدة');
    if (!note?.trim()) return;
    try {
      const updated = await updateFollowupResult(row.id, {
        followup_notes: [row.followup_notes, note.trim()].filter(Boolean).join('\n'),
        updated_by: userId || userName,
      });
      setRows((current) => current.map((item) => (item.id === row.id ? { ...item, ...updated } : item)));
      setSelectedRow((current) => (current?.id === row.id ? { ...current, ...updated } : current));
      toast.success('تم حفظ الملاحظة');
    } catch (noteError) {
      toast.error(noteError instanceof Error ? noteError.message : 'تعذر حفظ الملاحظة');
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

    const runCustomerSearch = async () => {
    const query = customerSearch.trim();
    if (query.length < 2) {
      toast.error('اكتب اسم العميل أو الكود أو رقم الهاتف');
      return;
    }
    setSearchingCustomers(true);
    try {
      const results = await searchCustomerMetrics(query, form.branch || undefined);
      setCustomerResults(Array.isArray(results) ? (results as ExceptionalCustomerSearchResult[]) : []);
      if (!Array.isArray(results) || results.length === 0) {
        toast.info('لم يتم العثور على العميل، يمكن إضافته يدويًا');
      }
    } catch (error) {
      console.error('[CustomerService] exceptional customer search failed', error);
      toast.error('تعذر البحث في قائمة العملاء');
    } finally {
      setSearchingCustomers(false);
    }
  };

  const selectCustomerForExceptionalFollowup = (customer: ExceptionalCustomerSearchResult) => {
    
    setForm((current) => ({
      ...current,
      customerName: exceptionalCustomerName(customer) || current.customerName,
      phone: exceptionalCustomerPhone(customer) || current.phone,
      branch: exceptionalCustomerBranch(customer) || current.branch,
    }));
    toast.success('تم اختيار العميل من قاعدة البيانات');
  };

  const clearSelectedAddCustomer = () => {
    setSelectedAddCustomer(null);
    setCustomerSearch('');
    setCustomerResults([]);
    toast.info('يمكنك إدخال عميل جديد يدويًا');
  };

const addFollowup = async () => {
    if (!form.customerName.trim()) return toast.error('اكتب اسم العميل');
    if (!form.reason.trim()) return toast.error('اكتب سبب المتابعة');
    try {
      const created = await createExceptionalFollowup({
        customer: (form.selectedCustomer as any) || undefined,
        customerName: form.customerName,
        customerPhone: form.phone,
        branch: form.branch,
        priority: form.priority,
        requestType: 'متابعة استثنائية',
        followupReason: form.reason,
        followupDatetime: form.due,
        requestDetails: form.reason,
        notes: [
          'متابعة استثنائية',
          form.reason ? `السبب: ${form.reason}` : '',
          form.result ? `النتيجة المبدئية: ${form.result}` : '',
        ].filter(Boolean).join('\n'),
        assignedDoctor: userName,
        createdBy: userId,
        createdByName: userName,
      });

      let finalRow = created;
      if (form.result && form.result !== 'لم يتم التواصل بعد') {
        const shouldComplete = ['تم التواصل', 'تم البيع', 'شكوى تم حلها', 'رقم غير صحيح'].includes(form.result);
        finalRow = await updateFollowupResult(created.id, {
          status: form.result,
          followup_status: form.result,
          contact_result: form.result,
          followup_result: form.result,
          followup_notes: form.reason,
          needs_manager: form.result === 'يحتاج مدير',
          purchase_after_followup: form.result === 'تم البيع',
          next_followup_date: form.nextDue || null,
          completed_at: shouldComplete ? new Date().toISOString() : null,
          updated_by: userId || userName,
        });
      }

      setRows((current) => [finalRow, ...current]);
      setSelectedRow(finalRow);
      createEventNotification(finalRow, 'customer_request', form.priority === 'عاجل' ? 'high' : 'normal', 'متابعة استثنائية جديدة');
      setForm({
        customerName: '',
        phone: '',
        branch: userBranch,
        reason: '',
        priority: 'مهم',
        due: dateInputNow(),
        result: 'لم يتم التواصل بعد',
        nextDue: '',
        selectedCustomer: null,
      });
      toast.success('تمت إضافة المتابعة الاستثنائية');
      setActiveTab('today');
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : 'تعذر إضافة المتابعة الاستثنائية');
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
      <section className="rounded-3xl border border-cyan-500/30 bg-gradient-to-l from-[#102640] via-slate-900 to-slate-950 p-4 text-slate-100 shadow-xl sm:p-5">
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
            <button onClick={() => setActiveTab('add')} className="btn-secondary flex items-center gap-2">
              <Plus size={16} /> إضافة متابعة استثنائية
            </button>
            <button onClick={generateToday} disabled={generating} className="btn-primary flex items-center gap-2">
              <Plus size={16} /> {generating ? 'جاري الإنشاء...' : 'إنشاء قائمة اليوم'}
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 2xl:grid-cols-10">
        <StatCard label="متابعات اليوم" value={stats.totalToday} tone="cyan" active={metricFilter === 'today'} onClick={() => setMetricFilter('today')} />
        <StatCard label="المكتمل" value={stats.completed} tone="emerald" active={metricFilter === 'completed'} onClick={() => setMetricFilter('completed')} />
        <StatCard label="لم يرد" value={stats.noAnswer} tone="amber" active={metricFilter === 'noAnswer'} onClick={() => setMetricFilter('noAnswer')} />
        <StatCard label="مؤجل" value={rows.filter((row) => Boolean(row.postponed_until) || statusOf(row).includes('مؤجل')).length} tone="cyan" active={metricFilter === 'postponed'} onClick={() => setMetricFilter('postponed')} />
        <StatCard label="يحتاج مدير" value={rows.filter((row) => row.needs_manager || statusOf(row).includes('مدير')).length} tone="rose" active={metricFilter === 'needsManager'} onClick={() => setMetricFilter('needsManager')} />
        <StatCard label="متأخر" value={stats.overdue} tone="rose" active={metricFilter === 'overdue'} onClick={() => setMetricFilter('overdue')} />
        <StatCard label="بدون رقم صحيح" value={invalidPhoneCount} tone="amber" active={metricFilter === 'invalidPhone'} onClick={() => setMetricFilter('invalidPhone')} />
        <StatCard label="تحول لبيع" value={recoveredCount} tone="emerald" active={metricFilter === 'recovered'} onClick={() => setMetricFilter('recovered')} />
        <StatCard label="لم يبدأ التواصل" value={notStartedCount} tone="cyan" active={metricFilter === 'notStarted'} onClick={() => setMetricFilter('notStarted')} />
        <StatCard label="تواصل ولم يشترِ" value={contactedNoPurchaseCount} tone="amber" active={metricFilter === 'contactedNoPurchase'} onClick={() => setMetricFilter('contactedNoPurchase')} />
      </section>

      {metricFilter !== 'all' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyan-400/30 bg-cyan-500/10 p-3 text-sm font-bold text-cyan-100">
          <span>يتم عرض: {METRIC_FILTER_LABELS[metricFilter]}</span>
          <button type="button" className="btn-secondary mr-3 px-3 py-1 text-xs" onClick={() => setMetricFilter('all')}>
            عرض الكل
          </button>
        </div>
      )}

      <section className="dawaa-panel">
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_2fr]">
          <label className="min-w-0 space-y-1">
            <span className="text-xs font-black text-slate-400">الفرع</span>
            <select value={branch} onChange={(e) => setBranch(e.target.value)} disabled={!canAllBranches} className="input-dark">
              <option value={ALL_FILTER}>كل الفروع</option>
              {BRANCHES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="min-w-0 space-y-1">
            <span className="text-xs font-black text-slate-400">حالة المتابعة</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="input-dark">
              {STATUS_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="min-w-0 space-y-1">
            <span className="text-xs font-black text-slate-400">المسؤول</span>
            <select value={assignedFilter} onChange={(e) => setAssignedFilter(e.target.value)} className="input-dark">
              <option value={ALL_FILTER}>كل المسؤولين</option>
              {doctorOptions.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <div className="min-w-0 rounded-2xl border border-slate-700 bg-slate-900/70 p-3 text-xs font-bold text-slate-300">
            <div className="text-slate-500">نطاق العرض</div>
            <div className="mt-1 truncate text-slate-200">{canAllBranches ? 'كل الفروع' : text(userBranch, 'فرع المستخدم')}</div>
          </div>
          <label className="min-w-0 space-y-1">
            <span className="text-xs font-black text-slate-400">بحث سريع</span>
            <div className="relative">
              <Search className="absolute right-4 top-3.5 h-5 w-5 text-slate-500" />
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="اسم / كود / هاتف / مسؤول"
                className="input-dark pr-12"
              />
            </div>
          </label>
        </div>
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {QUICK_FILTERS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setQuickFilter(id)}
              className={
                quickFilter === id
                  ? 'shrink-0 rounded-full border border-cyan-400 bg-cyan-500/15 px-3 py-1.5 text-xs font-black text-cyan-100'
                  : 'shrink-0 rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1.5 text-xs font-bold text-slate-300 hover:border-cyan-400/40'
              }
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {error && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-100">
          <AlertTriangle className="ml-2 inline h-5 w-5" /> {error}
        </div>
      )}

      <section className="grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
        <div className="dawaa-panel min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-xl font-black text-white">Overview / نظرة اليوم</h2>
              <p className="text-xs font-bold text-slate-400">Funnel خدمة العملاء من نفس بيانات المتابعات المحملة، بدون بيانات افتراضية.</p>
            </div>
            <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs font-black text-emerald-100">
              تحويل {funnel.conversionRate}%
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <MiniMetric label="المطلوب التواصل معهم" value={funnel.total} />
            <MiniMetric label="تم التواصل" value={funnel.contacted} />
            <MiniMetric label="يحتاج متابعة لاحقة" value={funnel.later} />
            <MiniMetric label="قيمة مبيعات المتابعة" value={money(funnel.recoveredAmount)} />
            <MiniMetric label="لم يرد" value={funnel.noAnswer} />
            <MiniMetric label="تحول إلى شراء" value={funnel.recovered} />
            <MiniMetric label="يحتاج مدير" value={funnel.needsManager} />
            <MiniMetric label="مغلق" value={funnel.closed} />
          </div>
        </div>

        <div className="dawaa-panel min-w-0">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-xl font-black text-white">أداء الدكاترة في خدمة العملاء</h2>
              <p className="text-xs font-bold text-slate-400">أعلى المسؤولين حسب الإنجاز والتحويل.</p>
            </div>
            <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => setActiveTab('performance')}>
              التقرير الكامل
            </button>
          </div>
          <div className="space-y-2">
            {performance.slice(0, 4).map((row, index) => (
              <div key={`${row.responsible}-${row.branch}`} className="rounded-2xl border border-slate-700 bg-slate-950/50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-black text-white">#{index + 1} {row.responsible}</div>
                    <div className="text-xs text-slate-400">{row.branch}</div>
                  </div>
                  <span className="rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2 py-1 text-xs font-black text-cyan-100">
                    إنجاز {row.completionRate}%
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-300">
                  <span>المسند: <b className="text-white">{row.assigned}</b></span>
                  <span>تحول: <b className="text-white">{row.purchaseAfterCount}</b></span>
                  <span>مبيعات: <b className="text-white">{money(row.purchaseAfterAmount)}</b></span>
                </div>
              </div>
            ))}
            {!performance.length && <EmptyState message="لا توجد بيانات كافية لحساب أداء الدكاترة حاليًا." />}
          </div>
        </div>
      </section>

      <section className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_400px]">
        <main className="dawaa-panel min-w-0">
          <div className="mb-4">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {PRIMARY_TABS.map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={activeTab === id ? 'btn-primary min-w-0 px-4 py-2 text-xs' : 'btn-secondary min-w-0 px-4 py-2 text-xs'}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <details className="mb-5 rounded-2xl border border-slate-700 bg-slate-950/35 p-4">
            <summary className="cursor-pointer text-sm font-black text-white">
              أدوات إضافية وتحليل المحادثات
              <span className="mr-2 text-xs font-bold text-slate-400">CRM، تقييم محادثة، قوالب واتساب، تقارير الفريق</span>
            </summary>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
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
                    onClick={() => setActiveTab(tool.id as TabId)}
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
          </details>

          {cardsTabs.includes(activeTab) ? (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-300">
                <span>يتم عرض {visibleRows.length} من {filteredTabRows.length} متابعة لتخفيف المتصفح.</span>
                {refreshing && <span className="text-cyan-300">تحديث...</span>}
              </div>
              <div className="grid gap-3 2xl:grid-cols-2">
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
              {visibleCount < filteredTabRows.length && (
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

        <aside className="dawaa-panel min-w-0 2xl:sticky 2xl:top-4 2xl:max-h-[calc(100vh-2rem)] 2xl:overflow-auto">
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
                <div className="mt-4 grid gap-2 text-sm text-slate-300 sm:grid-cols-2 2xl:grid-cols-1">
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
                <h4 className="mb-3 font-black text-white">قرار المتابعة السريع</h4>
                <div className="grid gap-2 text-sm text-slate-300">
                  <InfoRow label="سبب المتابعة" value={selectedRow.followup_reason || selectedRow.request_details || 'غير محدد'} />
                  <InfoRow label="الإجراء المقترح" value={selectedRow.suggested_action || recommendedAction(selectedRow)} />
                  <InfoRow label="حالة التواصل السابقة" value={selectedRow.contact_status || selectedRow.contact_result || statusOf(selectedRow)} />
                  <InfoRow
                    label="الخطوة القادمة"
                    value={
                      selectedRow.needs_manager
                        ? 'تصعيد للمدير'
                        : isOverdue(selectedRow)
                          ? 'تواصل عاجل اليوم'
                          : selectedRow.postponed_until
                            ? `متابعة مؤجلة: ${formatDateTime(selectedRow.postponed_until)}`
                            : 'تسجيل نتيجة التواصل'
                    }
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-slate-700 bg-slate-950/40 p-4">
                <h4 className="mb-2 font-black text-white">ملاحظات قبل التواصل</h4>
                <p className="text-sm leading-7 text-slate-300">
                  {selectedRow.handling_notes || selectedRow.service_notes || selectedRow.whatsapp_notes || selectedRow.customer_notes || selectedRow.notes || 'لا توجد ملاحظات مسجلة.'}
                </p>
              </div>

              <div className="grid gap-2 sm:grid-cols-3 2xl:grid-cols-2">
                <button className="btn-primary" onClick={() => setResultRow(selectedRow)}><CheckCircle2 className="ml-1 inline h-4 w-4" /> تسجيل نتيجة</button>
                <button className="btn-secondary" onClick={() => setDetailsRow(selectedRow)}><Eye className="ml-1 inline h-4 w-4" /> ملف العميل</button>
                <button className="btn-secondary" onClick={() => void copyScript(selectedRow)}><Clipboard className="ml-1 inline h-4 w-4" /> نسخ السكريبت</button>
                <a className="btn-secondary text-center" href={generateWhatsAppLink(phoneOf(selectedRow), scriptFor(selectedRow))} target="_blank" rel="noreferrer"><MessageSquare className="ml-1 inline h-4 w-4" /> واتساب</a>
                <a className="btn-secondary text-center" href={`tel:${phoneOf(selectedRow)}`}><PhoneCall className="ml-1 inline h-4 w-4" /> اتصال</a>
                <button className="btn-secondary" onClick={() => void postpone(selectedRow)}><CalendarClock className="ml-1 inline h-4 w-4" /> تأجيل</button>
                <button className="btn-secondary" onClick={() => void addQuickNote(selectedRow)}><Clipboard className="ml-1 inline h-4 w-4" /> إضافة ملاحظة</button>
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
            customerId={detailsRow.customer_id}
            customerCode={detailsRow.customer_code}
            customerPhone={phoneOf(detailsRow)}
            customerName={customerName(detailsRow)}
            branch={detailsRow.branch}
            fallbackMetric={modalFallbackFrom(detailsRow)}
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
      <div className="space-y-4">
        {selectedRow && (
          <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-4 text-sm text-cyan-50">
            <div className="font-black">العميل المختار من القائمة: {customerName(selectedRow)}</div>
            <div className="mt-1 text-xs text-cyan-100">
              الكود: {text(selectedRow.customer_code, 'بدون كود')} · الهاتف: {phoneOf(selectedRow) || 'بدون رقم'} · الفرع: {text(selectedRow.branch)}
            </div>
            <button
              type="button"
              className="btn-secondary mt-3"
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  customerName: customerName(selectedRow),
                  phone: phoneOf(selectedRow),
                  branch: selectedRow.branch || current.branch,
                  reason: selectedRow.followup_reason || selectedRow.request_details || current.reason,
                }))
              }
            >
              استخدام هذا العميل في المتابعة الاستثنائية
            </button>
          </div>
        )}

        <ExceptionalCustomerSearchBox
          branch={form.branch}
          onSelect={(customer) => {
            
            setForm((current) => ({
              ...current,
              selectedCustomer: customer,
              customerName: exceptionalCustomerName(customer) || current.customerName,
              phone: exceptionalCustomerPhone(customer) || current.phone,
              branch: exceptionalCustomerBranch(customer) || current.branch,
            }));
          }}
        />

        <div className="grid gap-3 lg:grid-cols-2">
          <input className="input-dark" placeholder="اسم العميل" value={form.customerName} onChange={(event) => setForm((current) => ({ ...current, customerName: event.target.value }))} />
          <input className="input-dark" placeholder="رقم الهاتف" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
          <select className="input-dark" value={form.branch} onChange={(event) => setForm((current) => ({ ...current, branch: event.target.value }))}>
            <option value="">اختر الفرع</option>
            {BRANCHES.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
          </select>
          <select className="input-dark" value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}>
            <option>عادي</option><option>مهم</option><option>عاجل</option>
          </select>
          <input className="input-dark" type="datetime-local" value={form.due} onChange={(event) => setForm((current) => ({ ...current, due: event.target.value }))} />
          <select className="input-dark" value={form.result} onChange={(event) => setForm((current) => ({ ...current, result: event.target.value }))}>
            <option>لم يتم التواصل بعد</option>
            <option>تم التواصل</option>
            <option>لم يرد</option>
            <option>طلب متابعة لاحقة</option>
            <option>تم البيع</option>
            <option>يحتاج مدير</option>
            <option>رقم غير صحيح</option>
            <option>شكوى تم حلها</option>
            <option>أخرى</option>
          </select>
          <input className="input-dark" type="datetime-local" value={form.nextDue} onChange={(event) => setForm((current) => ({ ...current, nextDue: event.target.value }))} />
          <textarea className="input-dark lg:col-span-2" rows={4} placeholder="سبب المتابعة وملاحظاتها" value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} />
          <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4 text-sm leading-7 text-cyan-50 lg:col-span-2">
            رسالة واتساب آمنة بدون اسم العميل:
            <br />
            أهلا بحضرتك، مع حضرتك خدمة عملاء صيدليات دواء. بنطمن على حضرتك وبنتشرف بخدمتك دائمًا.
          </div>
          <button className="btn-primary lg:col-span-2" onClick={onAdd}>حفظ متابعة استثنائية</button>
        </div>
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
  const score = priorityScore(row);
  return (
    <article
      onClick={onSelect}
      className={`cursor-pointer rounded-3xl border p-4 transition sm:p-5 ${selected ? 'border-cyan-400 bg-cyan-500/10 shadow-lg shadow-cyan-950/20' : 'border-slate-700 bg-slate-950/45 hover:border-cyan-500/40 hover:bg-slate-900/80'}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-black text-white">{customerName(row)}</h3>
          <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-400">
            <span>{text(row.customer_code, 'بدون كود')}</span>
            <span>·</span>
            <span>{phone || 'بدون رقم صحيح'}</span>
            <span>·</span>
            <span>{text(row.branch)}</span>
          </div>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <span className={`w-fit rounded-full border px-2.5 py-1 text-xs font-black ${priorityTone(row)}`}>{text(row.priority, 'مهم')}</span>
          <span className="w-fit rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-black text-cyan-100">
            أولوية {score} · {priorityReason(row)}
          </span>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${statusTone(row)}`}>{statusOf(row)}</span>
        <span className="rounded-full border border-slate-600 bg-slate-800/80 px-2.5 py-1 text-xs text-slate-200">{segmentOf(row)}</span>
        <span className="rounded-full border border-slate-600 bg-slate-800/80 px-2.5 py-1 text-xs text-slate-200">خطورة: {riskLevel(row)}</span>
        {/استثنائية|exceptional/i.test(`${row.request_type || ''} ${row.followup_type || ''} ${row.followup_reason || ''} ${row.notes || ''}`) && (
          <span className="rounded-full border border-fuchsia-400/40 bg-fuchsia-500/10 px-2.5 py-1 text-xs font-black text-fuchsia-100">متابعة استثنائية</span>
        )}
      </div>
      <div className="mt-4 grid gap-2 text-xs text-slate-300 sm:grid-cols-2">
        <InfoRow label="آخر شراء" value={formatDate(lastPurchaseOf(row))} />
        <InfoRow label="متوسط شهري" value={money(avgMonthly(row))} />
        <InfoRow label="إجمالي" value={money(totalSpent(row))} />
        <InfoRow label="المسؤول" value={responsibleOf(row)} />
        <InfoRow label="آخر نتيجة" value={statusOf(row)} />
        <InfoRow label="تم التواصل بواسطة" value={updatedByOf(row)} />
        <InfoRow label="وقت آخر تواصل" value={formatDateTime(lastContactAt(row))} />
        <InfoRow label="تقييم المحادثة" value={reviewSummaryOf(row)} />
        <InfoRow label="بيع بعد المتابعة" value={row.purchase_after_followup ? money((row as any).purchase_amount || 0) : 'لا'} />
        <InfoRow label="رقم الفاتورة" value={row.purchase_invoice_no || 'غير متاح'} />
      </div>
      <p className="mt-3 rounded-2xl border border-slate-700/70 bg-slate-900/60 p-3 text-sm leading-6 text-slate-300">
        {row.followup_reason || row.request_details || row.suggested_action || recommendedAction(row)}
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-7" onClick={(event) => event.stopPropagation()}>
        <button className="btn-primary px-3 py-2 text-xs" onClick={onResult}><CheckCircle2 className="ml-1 inline h-3.5 w-3.5" /> نتيجة</button>
        <button className="btn-secondary px-3 py-2 text-xs" onClick={onDetails}><Eye className="ml-1 inline h-3.5 w-3.5" /> التفاصيل</button>
        <a className="btn-secondary px-3 py-2 text-center text-xs" href={customer360Url(row)}><Eye className="ml-1 inline h-3.5 w-3.5" /> 360</a>
        <button className="btn-secondary px-3 py-2 text-xs" onClick={onCopy}><Clipboard className="ml-1 inline h-3.5 w-3.5" /> نسخ</button>
        <a className="btn-secondary px-3 py-2 text-center text-xs" href={generateWhatsAppLink(phone, scriptFor(row))} target="_blank" rel="noreferrer"><MessageSquare className="ml-1 inline h-3.5 w-3.5" /> واتساب</a>
        <a className="btn-secondary px-3 py-2 text-center text-xs" href={`tel:${phone}`}><PhoneCall className="ml-1 inline h-3.5 w-3.5" /> اتصال</a>
        <button className="btn-secondary px-3 py-2 text-xs" onClick={onPostpone}><CalendarClock className="ml-1 inline h-3.5 w-3.5" /> تأجيل</button>
        <button className="btn-secondary px-3 py-2 text-xs" onClick={onManager}><UserCheck className="ml-1 inline h-3.5 w-3.5" /> مدير</button>
      </div>
    </article>
  );
}

function StatCard({ label, value, tone, active = false, onClick }: { label: string; value: number | string; tone: 'cyan' | 'emerald' | 'amber' | 'rose'; active?: boolean; onClick?: () => void }) {
  const tones = {
    cyan: 'border-cyan-400/30 bg-cyan-500/10 text-cyan-100',
    emerald: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100',
    amber: 'border-amber-400/30 bg-amber-500/10 text-amber-100',
    rose: 'border-rose-400/30 bg-rose-500/10 text-rose-100',
  };
  const className = `rounded-2xl border p-4 text-right transition ${tones[tone]} ${onClick ? 'cursor-pointer hover:scale-[1.02] hover:border-white/50' : ''} ${active ? 'ring-2 ring-white/60 shadow-lg shadow-cyan-950/30' : ''}`;
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        <div className="text-xs font-bold opacity-80">{label}</div>
        <div className="mt-2 text-3xl font-black num">{value}</div>
        <div className="mt-1 text-[10px] font-bold opacity-70">اضغط لعرض العملاء</div>
      </button>
    );
  }
  return <div className={className}><div className="text-xs font-bold opacity-80">{label}</div><div className="mt-2 text-3xl font-black num">{value}</div></div>;
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-2"><span className="text-slate-400">{label}</span><b className="text-left text-slate-100">{value}</b></div>;
}

function MiniMetric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-950/45 p-3">
      <div className="text-[11px] font-black text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-black text-white num">{value}</div>
    </div>
  );
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
