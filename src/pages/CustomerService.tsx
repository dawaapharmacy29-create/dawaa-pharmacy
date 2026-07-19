import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Clipboard,
  Download,
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
import { supabase } from '@/lib/supabase';
import { ALL_FILTER } from '@/lib/api/customers';
import { searchCustomerMetrics,
  calculateFollowupStats,
  calculateTeamPerformance,
  createExceptionalFollowup,
  fetchCustomerServiceFollowups,
  fetchCustomerServiceFollowupById,
  generateTodayFollowupsFromCustomerMetrics,
  generateTodayFollowupsSmartReport,
  fetchCustomerServiceInsightPools,
  recommendedAction,
  riskLevel,
  updateFollowupResult,
  type FollowupRow,
  type CustomerServiceInsightPools,
} from '@/lib/api/customerServiceCommandCenter';
import { generateWhatsAppLink } from '@/lib/whatsapp';
import { isValidEgyptPhone } from '@/lib/customerAnalyticsService';
import { normalizeBranchName } from '@/lib/branch';
import { BRANCHES, CUSTOMER_SERVICE_BRANCH_OWNERS, CUSTOMER_SERVICE_DOCTORS, SHAMY_BRANCH_PHARMACISTS, SHOKRY_BRANCH_PHARMACISTS } from '@/lib/constants';
import { canSeeAllBranches, effectiveBranchFilter } from '@/lib/security/permissionScopes';
import { normalizeRole } from '@/lib/core/permissionSystem';
import { rowMatchesCurrentUserScope } from '@/lib/security/userDataScope';
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery';
import { mergeStaffChoices } from '@/lib/staffFallback';
import { CustomerFlagsBadges } from '@/components/CustomerFlagsBadges';
import { createNotification } from '@/lib/notificationService';
import QuickFollowupModal from '@/components/common/QuickFollowupModal';
import {
  customerMetricsKey,
  getCustomerServiceLiveMetrics,
  useCustomerServiceMetricsEnrichment,
} from '@/lib/customerServiceCustomerMetrics';
import {
  resolveSuggestedBranchFromInvoiceMetrics,
  saveCustomerBranchOverride,
} from '@/lib/customerBranchOverrides';
import { CustomerFlagChips, getCustomerCodeSafe, getCustomerFlagChips, resolveCustomerBranch } from '@/lib/customerDisplay';
import {
  fetchQuickReplyScripts,
  incrementQuickReplyUsage,
  renderQuickReplyTemplate,
  type QuickReplyScript,
} from '@/lib/quickReplyScripts';
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
  { branch: 'فرع الشامي', name: CUSTOMER_SERVICE_BRANCH_OWNERS['فرع الشامي'] },
  { branch: 'فرع شكري', name: CUSTOMER_SERVICE_BRANCH_OWNERS['فرع شكري'] },
];

function customerServiceBranchForUser(user?: { username?: string | null; name?: string | null; branch?: string | null } | null) {
  const username = String(user?.username || '').trim().toLowerCase();
  const name = String(user?.name || '').trim();
  if (username === 'cs.doha' || name.includes('ضحي') || name.includes('ضحى')) return 'فرع الشامي';
  if (username === 'cs.donia' || name.includes('دنيا')) return 'فرع شكري';
  return normalizeBranchName(user?.branch || '');
}

function customerKey(row: FollowupRow) {
  return String(getCustomerCodeSafe(row) || row.customer_phone || row.phone || row.customer_id || row.customer_name || row.name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function dedupeCustomerRows(rows: FollowupRow[]) {
  const map = new Map<string, FollowupRow>();
  for (const row of rows) {
    const key = customerKey(row);
    if (!key) continue;
    if (!map.has(key)) map.set(key, row);
  }
  return [...map.values()];
}

const EMPTY_INSIGHTS: CustomerServiceInsightPools = {
  important: [],
  reduced: [],
  stopped60: [],
  strong: [],
  source: 'not_loaded',
  warnings: [],
};
const TABS = [
  ['today', 'متابعات اليوم'],
  ['strong', 'متابعة قوية'],
  ['important-customers', 'أهم العملاء'],
  ['reduced-customers', 'قللوا التعامل'],
  ['stopped-customers', 'توقفوا أكثر من شهرين'],
  ['impact', 'أثر المتابعات'],
  ['owners-performance', 'أداء مسؤولي خدمة العملاء'],
  ['assigned', 'المتابعات المسندة'],
  ['requests', 'طلبات المتابعة'],
  ['finish', 'إنهاء متابعة'],
  ['notes', 'ملاحظات العميل'],
  ['alerts', 'تنبيهات العملاء'],
  ['history', 'سجل المتابعات'],
  ['hidden', 'المتابعات المخفية'],
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
  ['strong', 'متابعة قوية'],
  ['important-customers', 'أهم العملاء'],
  ['reduced-customers', 'قللوا التعامل'],
  ['stopped-customers', 'توقفوا أكثر من شهرين'],
  ['impact', 'أثر المتابعات'],
  ['owners-performance', 'أداء مسؤولي خدمة العملاء'],
  ['assigned', 'المتابعات المسندة'],
  ['requests', 'طلبات المتابعة'],
  ['finish', 'إنهاء متابعة'],
  ['history', 'سجل المتابعات'],
  ['hidden', 'المتابعات المخفية'],
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
type OperationsFilter = 'priority' | 'overdue' | 'manager' | 'noCode' | 'branchReview' | 'vip' | 'completed' | 'all';

const OPERATIONS_TABS: Array<[OperationsFilter, string]> = [
  ['priority', 'الأهم الآن'],
  ['overdue', 'متأخر'],
  ['manager', 'يحتاج مدير'],
  ['noCode', 'بدون كود'],
  ['branchReview', 'فرع غير مؤكد'],
  ['vip', 'VIP / مهم جدًا'],
  ['completed', 'مكتمل اليوم'],
  ['all', 'كل المتابعات'],
];

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

type AuditFilter =
  | 'today'
  | 'completed'
  | 'notStarted'
  | 'notStartedOverdue'
  | 'overdue'
  | 'noAnswer'
  | 'postponed'
  | 'needsManager'
  | 'invalidPhone'
  | 'recovered'
  | 'purchaseAfter'
  | 'contactedNoPurchase'
  | 'dataQuality';

const AUDIT_FILTER_LABELS: Record<AuditFilter, string> = {
  today: 'متابعات اليوم',
  completed: 'المكتمل',
  notStarted: 'لم يبدأ التواصل',
  notStartedOverdue: 'لم يبدأ التواصل ومتأخر',
  overdue: 'متأخر',
  noAnswer: 'لم يرد',
  postponed: 'مؤجل',
  needsManager: 'يحتاج مدير',
  invalidPhone: 'بدون رقم صحيح',
  recovered: 'عملاء تم استرجاعهم',
  purchaseAfter: 'قيمة الشراء بعد المتابعة',
  contactedNoPurchase: 'تواصل ولم يشترِ',
  dataQuality: 'مشاكل جودة البيانات',
};

const AUDIT_CSV_COLUMNS = [
  'customer_code',
  'customer_name',
  'phone',
  'mobile',
  'normalized_phone',
  'branch',
  'customer_category',
  'followup_date',
  'followup_status',
  'followup_result',
  'assigned_to',
  'assigned_to_name',
  'created_by',
  'created_at',
  'last_contact_at',
  'closed_at',
  'is_overdue',
  'overdue_days',
  'has_valid_phone',
  'first_invoice_date',
  'last_invoice_date',
  'days_since_last_purchase',
  'total_invoices',
  'total_sales',
  'average_invoice_value',
  'sales_before_followup',
  'sales_after_followup',
  'first_purchase_after_followup_date',
  'invoices_after_followup_count',
  'recovered_customer',
  'notes',
  'next_followup_date',
  'priority_label',
  'priority_score',
  'audit_reason',
  'data_quality_issues',
] as const;

type AuditCsvColumn = (typeof AUDIT_CSV_COLUMNS)[number];
type CustomerServiceAuditRow = Record<AuditCsvColumn, string | number | boolean | null>;

type AuditUiFilters = {
  search: string;
  branch: string;
  owner: string;
  status: string;
  priority: string;
  result: string;
  category: string;
  phone: string;
  recovered: string;
  from: string;
  to: string;
};

const AUDIT_STATUS_OPTIONS = [
  [ALL_FILTER, 'كل الحالات'],
  ['completed', 'مكتمل'],
  ['notStarted', 'لم يبدأ التواصل'],
  ['notStartedOverdue', 'لم يبدأ ومتأخر'],
  ['overdue', 'متأخر'],
  ['noAnswer', 'لم يرد'],
  ['postponed', 'مؤجل'],
  ['needsManager', 'يحتاج مدير'],
  ['recovered', 'تم استرجاعه'],
  ['contactedNoPurchase', 'تواصل ولم يشترِ'],
  ['open', 'مفتوح / قيد المتابعة'],
] as const;

const AUDIT_PRIORITY_OPTIONS = [
  [ALL_FILTER, 'كل الأولويات'],
  ['critical', 'حرجة'],
  ['high', 'عالية'],
  ['medium', 'متوسطة'],
  ['normal', 'عادية'],
] as const;

const AUDIT_PHONE_OPTIONS = [
  [ALL_FILTER, 'كل الأرقام'],
  ['valid', 'رقم صحيح فقط'],
  ['invalid', 'بدون رقم صحيح'],
] as const;

const AUDIT_RECOVERY_OPTIONS = [
  [ALL_FILTER, 'كل العملاء'],
  ['recovered', 'مسترجع فقط'],
  ['not_recovered', 'غير مسترجع'],
] as const;

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

function asRecord(row: FollowupRow): Record<string, unknown> {
  return row as unknown as Record<string, unknown>;
}

function valueFrom(row: FollowupRow, keys: string[]) {
  const record = asRecord(row);
  for (const key of keys) {
    const value = record[key];
    if (value !== null && value !== undefined && String(value).trim() !== '') return value;
  }
  return null;
}

function stringFrom(row: FollowupRow, keys: string[], fallback = '') {
  const value = valueFrom(row, keys);
  return value === null ? fallback : String(value).trim();
}

function numberFrom(row: FollowupRow, keys: string[], fallback = 0) {
  const value = valueFrom(row, keys);
  const n = Number(value ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}

function normalizePhoneForAudit(value?: string | null) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('20') && digits.length === 12) return `0${digits.slice(2)}`;
  if (digits.startsWith('0020') && digits.length === 14) return `0${digits.slice(4)}`;
  return digits;
}

function daysSince(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((today.getTime() - date.getTime()) / 86400000));
}

function overdueDays(row: FollowupRow) {
  if (!isOverdue(row)) return 0;
  return daysSince(row.followup_datetime || row.followup_date || row.date) || 0;
}

function followupDelayLabel(row: FollowupRow) {
  if (!isOverdue(row)) return 'غير متأخر';
  const raw = row.followup_datetime || row.followup_date || row.date || '';
  const time = new Date(raw).getTime();
  if (!Number.isFinite(time)) return 'متأخر';
  const minutes = Math.max(1, Math.floor((Date.now() - time) / 60000));
  if (minutes < 60) return `${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ساعة`;
  return `${Math.floor(hours / 24)} يوم`;
}

function salesAfterFollowup(row: FollowupRow) {
  return numberFrom(row, ['sales_after_followup', 'purchase_after_followup_amount', 'purchase_amount'], 0);
}

function salesBeforeFollowup(row: FollowupRow) {
  return numberFrom(row, ['sales_before_followup', 'previous_sales_before_followup'], 0);
}

function firstInvoiceDate(row: FollowupRow) {
  return stringFrom(row, ['first_invoice_date', 'first_purchase_date', 'first_purchase'], row.customer_metrics?.first_purchase || '');
}

function lastInvoiceDate(row: FollowupRow) {
  return stringFrom(row, ['last_invoice_date', 'last_purchase_date', 'last_purchase'], lastPurchaseOf(row) || '');
}

function firstPurchaseAfterFollowupDate(row: FollowupRow) {
  return stringFrom(row, ['first_purchase_after_followup_date', 'purchase_date'], '');
}

function invoicesAfterFollowupCount(row: FollowupRow) {
  const explicit = numberFrom(row, ['invoices_after_followup_count', 'purchase_after_followup_count'], NaN);
  if (Number.isFinite(explicit)) return explicit;
  return row.purchase_after_followup ? 1 : 0;
}

function isRecoveredCustomer(row: FollowupRow) {
  return Boolean(row.purchase_after_followup || salesAfterFollowup(row) > 0 || firstPurchaseAfterFollowupDate(row));
}

function isContactedNoPurchase(row: FollowupRow) {
  const contacted = Boolean(row.contacted_at || row.contact_result || row.followup_result || row.closed_at || row.completed_at) || /تم|contacted|completed/i.test(statusOf(row));
  return contacted && !isRecoveredCustomer(row);
}

function dataQualityIssues(row: FollowupRow) {
  const issues: string[] = [];
  if (!hasValidPhone(row)) issues.push('invalid_phone');
  if (!getCustomerCodeSafe(row)) issues.push('missing_customer_code');
  if (customerName(row) === 'عميل بدون اسم') issues.push('missing_customer_name');
  if (!normalizeBranchName(row.branch || '')) issues.push('missing_branch');
  if (!String(responsibleOf(row) || '').trim() || responsibleOf(row) === 'غير محدد') issues.push('missing_assigned_to');
  if (!(row.followup_datetime || row.followup_date || row.date)) issues.push('missing_followup_date');
  return issues;
}

function isDataQualityIssue(row: FollowupRow) {
  return dataQualityIssues(row).length > 0;
}

function auditStatusKey(row: FollowupRow) {
  if (isNotStartedOverdue(row)) return 'notStartedOverdue';
  if (isRecoveredCustomer(row)) return 'recovered';
  if (isCompleted(row)) return 'completed';
  if (row.needs_manager || /مدير/i.test(statusOf(row))) return 'needsManager';
  if (row.postponed_until || /مؤجل/i.test(statusOf(row))) return 'postponed';
  if (/لم يرد|no answer/i.test(statusOf(row))) return 'noAnswer';
  if (isOverdue(row)) return 'overdue';
  if (matchesMetricFilter(row, 'notStarted')) return 'notStarted';
  if (isContactedNoPurchase(row)) return 'contactedNoPurchase';
  return 'open';
}

function auditPriorityLabel(row: FollowupRow) {
  const score = auditPriorityScore(row);
  if (score >= 220) return 'حرجة';
  if (score >= 140) return 'عالية';
  if (score >= 80) return 'متوسطة';
  return 'عادية';
}

function auditPriorityKey(row: FollowupRow) {
  const label = auditPriorityLabel(row);
  if (label === 'حرجة') return 'critical';
  if (label === 'عالية') return 'high';
  if (label === 'متوسطة') return 'medium';
  return 'normal';
}

function auditDateValue(row: FollowupRow) {
  return String(row.followup_datetime || row.followup_date || row.date || '').slice(0, 10);
}

function auditReasons(row: FollowupRow) {
  const reasons: string[] = [];
  if (isNotStartedOverdue(row)) reasons.push(`لم يبدأ التواصل ومتأخر ${overdueDays(row)} يوم`);
  if (!hasValidPhone(row)) reasons.push('بدون رقم صحيح');
  if (!getCustomerCodeSafe(row)) reasons.push('بدون كود عميل');
  if (!normalizeBranchName(row.branch || '')) reasons.push('فرع غير محدد');
  if (customerName(row) === 'عميل بدون اسم') reasons.push('اسم العميل غير واضح');
  if (isOverdue(row) && !isNotStartedOverdue(row)) reasons.push(`متأخر ${overdueDays(row)} يوم`);
  if (isRecoveredCustomer(row)) reasons.push('اشترى بعد المتابعة');
  if (isContactedNoPurchase(row)) reasons.push('تم التواصل ولم يشترِ');
  if (row.needs_manager || /مدير/i.test(statusOf(row))) reasons.push('يحتاج تدخل مدير');
  if (row.postponed_until || /مؤجل/i.test(statusOf(row))) reasons.push('متابعة مؤجلة');
  if (/لم يرد|no answer/i.test(statusOf(row))) reasons.push('لم يرد');
  if (!row.contacted_at && !row.contact_result && !row.followup_result && !isCompleted(row)) reasons.push('لم يبدأ التواصل');
  return reasons.length ? reasons.join(' + ') : priorityReason(row);
}

function isNotStartedOverdue(row: FollowupRow) {
  return matchesMetricFilter(row, 'notStarted') && isOverdue(row);
}

function auditPriorityScore(row: FollowupRow) {
  let score = 0;
  if (isNotStartedOverdue(row)) score += 200;
  if (isOverdue(row)) score += 120 + overdueDays(row) * 3;
  if (row.needs_manager || /مدير/i.test(statusOf(row))) score += 90;
  if (!hasValidPhone(row)) score += 75;
  if (/لم يرد|no answer/i.test(statusOf(row))) score += 65;
  if (isContactedNoPurchase(row)) score += 35;
  score += Math.min(60, Math.round(totalSpent(row) / 3000));
  score += Math.min(25, Math.round(salesAfterFollowup(row) / 1000));
  return score;
}

function compareAuditRowsByPriority(a: FollowupRow, b: FollowupRow) {
  return auditPriorityScore(b) - auditPriorityScore(a) || totalSpent(b) - totalSpent(a) || salesAfterFollowup(b) - salesAfterFollowup(a) || customerName(a).localeCompare(customerName(b), 'ar');
}

function auditRowFromFollowup(row: FollowupRow): CustomerServiceAuditRow {
  const phone = phoneOf(row);
  const firstDate = firstInvoiceDate(row);
  const lastDate = lastInvoiceDate(row);
  const invoices = invoicesCount(row);
  const totalSales = totalSpent(row);
  return {
    customer_code: getCustomerCodeSafe(row),
    customer_name: customerName(row),
    phone,
    mobile: stringFrom(row, ['mobile', 'customer_mobile', 'whatsapp_phone', 'phone_alt'], ''),
    normalized_phone: normalizePhoneForAudit(phone),
    branch: normalizeBranchName(row.branch || '') || row.branch || '',
    customer_category: segmentOf(row),
    followup_date: row.followup_datetime || row.followup_date || row.date || '',
    followup_status: statusOf(row),
    followup_result: followupResultLabel(row),
    assigned_to: row.assigned_to || row.assigned_staff_id || row.assigned_doctor || '',
    assigned_to_name: responsibleOf(row),
    created_by: row.created_by_name || row.created_by || '',
    created_at: row.created_at || '',
    last_contact_at: lastContactAt(row) || '',
    closed_at: row.closed_at || row.completed_at || '',
    is_overdue: isOverdue(row),
    overdue_days: overdueDays(row),
    has_valid_phone: hasValidPhone(row),
    first_invoice_date: firstDate || '',
    last_invoice_date: lastDate || '',
    days_since_last_purchase: daysSince(lastDate) ?? '',
    total_invoices: invoices,
    total_sales: totalSales,
    average_invoice_value: invoices ? Math.round(totalSales / invoices) : numberFrom(row, ['average_invoice_value', 'avg_invoice'], 0),
    sales_before_followup: salesBeforeFollowup(row),
    sales_after_followup: salesAfterFollowup(row),
    first_purchase_after_followup_date: firstPurchaseAfterFollowupDate(row),
    invoices_after_followup_count: invoicesAfterFollowupCount(row),
    recovered_customer: isRecoveredCustomer(row),
    notes: [row.notes, row.followup_notes, row.customer_notes, row.handling_notes].filter(Boolean).join(' | '),
    next_followup_date: row.next_followup_date || row.postponed_until || '',
    priority_label: auditPriorityLabel(row),
    priority_score: auditPriorityScore(row),
    audit_reason: auditReasons(row),
    data_quality_issues: dataQualityIssues(row).join(' | '),
  };
}

function matchesAuditFilter(row: FollowupRow, filter: AuditFilter) {
  if (filter === 'today') return matchesMetricFilter(row, 'today');
  if (filter === 'completed') return isCompleted(row);
  if (filter === 'notStarted') return matchesMetricFilter(row, 'notStarted');
  if (filter === 'notStartedOverdue') return isNotStartedOverdue(row);
  if (filter === 'overdue') return isOverdue(row);
  if (filter === 'noAnswer') return /لم يرد|no answer/i.test(statusOf(row));
  if (filter === 'postponed') return Boolean(row.postponed_until) || /مؤجل/i.test(statusOf(row));
  if (filter === 'needsManager') return Boolean(row.needs_manager) || /مدير/i.test(statusOf(row));
  if (filter === 'invalidPhone') return !hasValidPhone(row);
  if (filter === 'recovered') return isRecoveredCustomer(row);
  if (filter === 'purchaseAfter') return salesAfterFollowup(row) > 0 || isRecoveredCustomer(row);
  if (filter === 'contactedNoPurchase') return isContactedNoPurchase(row);
  if (filter === 'dataQuality') return isDataQualityIssue(row);
  return true;
}


function matchesAuditUiFilters(row: FollowupRow, filters: AuditUiFilters) {
  const q = filters.search.trim().toLowerCase();
  if (q) {
    const digits = q.replace(/\D/g, '');
    const searchable = [customerName(row), getCustomerCodeSafe(row), phoneOf(row), normalizePhoneForAudit(phoneOf(row)), row.customer_id].join(' ').toLowerCase();
    if (!searchable.includes(q) && !(digits.length >= 3 && normalizePhoneForAudit(phoneOf(row)).includes(digits))) return false;
  }
  if (filters.branch !== ALL_FILTER && normalizeBranchName(row.branch || '') !== filters.branch) return false;
  if (filters.owner !== ALL_FILTER && responsibleOf(row) !== filters.owner) return false;
  if (filters.status !== ALL_FILTER && auditStatusKey(row) !== filters.status) return false;
  if (filters.priority !== ALL_FILTER && auditPriorityKey(row) !== filters.priority) return false;
  if (filters.result !== ALL_FILTER && followupResultLabel(row) !== filters.result) return false;
  if (filters.category !== ALL_FILTER && segmentOf(row) !== filters.category) return false;
  if (filters.phone === 'valid' && !hasValidPhone(row)) return false;
  if (filters.phone === 'invalid' && hasValidPhone(row)) return false;
  if (filters.recovered === 'recovered' && !isRecoveredCustomer(row)) return false;
  if (filters.recovered === 'not_recovered' && isRecoveredCustomer(row)) return false;
  const date = auditDateValue(row);
  if (filters.from && (!date || date < filters.from)) return false;
  if (filters.to && (!date || date > filters.to)) return false;
  return true;
}

function csvEscape(value: unknown) {
  const textValue = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(textValue)) return `"${textValue.replace(/"/g, '""')}"`;
  return textValue;
}

function downloadAuditCsv(rows: CustomerServiceAuditRow[], filename: string) {
  const csv = [
    AUDIT_CSV_COLUMNS.join(','),
    ...rows.map((row) => AUDIT_CSV_COLUMNS.map((column) => csvEscape(row[column])).join(',')),
  ].join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function safePercent(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
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
    customer_code: getCustomerCodeSafe(row) || null,
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

function resolveCustomerServiceOwner(branch?: string | null, responsibleName?: string | null) {
  const normalized = normalizeBranchName(branch);
  if (normalized === 'فرع شكري' || normalized === 'شكري') {
    return CUSTOMER_SERVICE_BRANCH_OWNERS['فرع شكري'];
  }
  if (normalized === 'فرع الشامي' || normalized === 'الشامي') {
    return CUSTOMER_SERVICE_BRANCH_OWNERS['فرع الشامي'];
  }
  const explicit = String(responsibleName || '').trim();
  return explicit || 'غير محدد';
}

function canonicalCustomerServiceOwner(value?: string | null) {
  const raw = String(value || '').trim();
  if (!raw) return 'غير محدد';
  const compact = raw
    .replace(/[\/\.]/g, '')
    .replace(/دكتور|الدكتورة|دكتورة|dr|doctor/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/ضح[ىي]/.test(compact)) return 'د/ ضحى';
  if (/دنيا/.test(compact)) return 'د/ دنيا';
  return raw;
}

function responsibleOf(row: FollowupRow) {
  const record = asRecord(row);
  const explicit = row.responsible_name || record.assigned_to_name || row.assigned_to || row.assigned_doctor;
  if (explicit) return canonicalCustomerServiceOwner(text(explicit));
  return canonicalCustomerServiceOwner(resolveCustomerServiceOwner(row.branch, null));
}

function branchServiceOwner(row: FollowupRow) {
  const normalized = normalizeBranchName(row.branch);
  if (normalized === 'فرع شكري' || normalized === 'شكري') {
    return canonicalCustomerServiceOwner(CUSTOMER_SERVICE_BRANCH_OWNERS['فرع شكري']);
  }
  if (normalized === 'فرع الشامي' || normalized === 'الشامي') {
    return canonicalCustomerServiceOwner(CUSTOMER_SERVICE_BRANCH_OWNERS['فرع الشامي']);
  }
  return canonicalCustomerServiceOwner(resolveCustomerServiceOwner(row.branch, row.responsible_name || row.assigned_doctor));
}

function statusOf(row: FollowupRow) {
  if (row.completed_at) return row.followup_status || 'تم';
  if (row.postponed_until) return 'مؤجل';
  if (row.needs_manager) return 'يحتاج مدير';
  return text(row.followup_status || row.status || row.contact_status, 'معلق');
}

function isCompleted(row: FollowupRow) {
  return isHistoryCompleted(row);
}

function isHistoryCompleted(row: FollowupRow) {
  if (row.purchase_after_followup) return true;
  if (row.closed_at || row.completed_at) return true;

  const combined = [
    row.status,
    row.followup_status,
    row.contact_status,
    row.contact_result,
    row.followup_result,
  ]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');

  const openPattern =
    /pending|معلق|لم يرد|no_answer|no answer|مؤجل|delayed|needs_manager|مدير|overdue|متأخر|open|لم يتم/i;
  const donePattern =
    /تم|completed|done|closed|success|purchased|converted|تم الشراء|تم الاسترجاع|تم التواصل|contacted/i;

  if (openPattern.test(combined) && !donePattern.test(combined)) return false;
  return donePattern.test(combined);
}

function followupResultLabel(row: FollowupRow) {
  return text(
    row.followup_result || row.contact_result || row.followup_status || row.status || row.contact_status,
    'غير محدد'
  );
}

function followupHistoryDate(row: FollowupRow) {
  return row.completed_at || row.contacted_at || row.followup_datetime || row.followup_date || row.updated_at || row.created_at;
}

type BranchOwnerPerformance = {
  responsible: string;
  branch: string;
  assigned: number;
  completed: number;
  overdue: number;
  noAnswer: number;
  postponed: number;
  needsManager: number;
  purchaseAfterCount: number;
  purchaseAfterAmount: number;
  recoveredCustomers: number;
  avgQualityRating: number | null;
  completionRate: number;
  incentiveValueEstimate: number;
};

function calculateBranchOwnerPerformance(rows: FollowupRow[]): BranchOwnerPerformance[] {
  const owners = CUSTOMER_SERVICE_DOCTORS;
  const map = new Map<string, BranchOwnerPerformance>();

  for (const owner of owners) {
    const canonicalOwner = canonicalCustomerServiceOwner(owner);
    const branch = canonicalOwner === canonicalCustomerServiceOwner(CUSTOMER_SERVICE_BRANCH_OWNERS['فرع شكري']) ? 'فرع شكري' : 'فرع الشامي';
    map.set(canonicalOwner, {
      responsible: canonicalOwner,
      branch,
      assigned: 0,
      completed: 0,
      overdue: 0,
      noAnswer: 0,
      postponed: 0,
      needsManager: 0,
      purchaseAfterCount: 0,
      purchaseAfterAmount: 0,
      recoveredCustomers: 0,
      avgQualityRating: null,
      completionRate: 0,
      incentiveValueEstimate: 0,
    });
  }

  for (const row of rows) {
    const owner = branchServiceOwner(row);
    if (!map.has(owner)) continue;
    const item = map.get(owner)!;
    item.assigned += 1;
    if (isHistoryCompleted(row)) item.completed += 1;
    if (isOverdue(row)) item.overdue += 1;
    if (/لم يرد|no answer/i.test(statusOf(row))) item.noAnswer += 1;
    if (Boolean(row.postponed_until) || /مؤجل/i.test(statusOf(row))) item.postponed += 1;
    if (row.needs_manager || /مدير/i.test(statusOf(row))) item.needsManager += 1;
    if (row.purchase_after_followup) {
      item.purchaseAfterCount += 1;
      item.purchaseAfterAmount += Number(row.purchase_amount || 0);
      item.recoveredCustomers += 1;
    }
  }

  return [...map.values()].map((item) => {
    const totalPoints = item.completed * 5 + item.purchaseAfterCount * 10 - item.noAnswer * 2;
    return {
      ...item,
      completionRate: item.assigned ? Math.round((item.completed / item.assigned) * 100) : 0,
      incentiveValueEstimate: Math.max(0, totalPoints * 10),
    };
  });
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

function hasValidPhone(row: FollowupRow) {
  const phone = phoneOf(row);
  return Boolean(phone && isValidEgyptPhone(phone, getCustomerCodeSafe(row)));
}

function matchesSearch(row: FollowupRow, search: string) {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, '');
  const name = customerName(row).toLowerCase();
  const code = getCustomerCodeSafe(row).toLowerCase();
  const phone = phoneOf(row);
  return (
    name.includes(q) ||
    code.includes(q) ||
    (digits.length >= 3 && phone.replace(/\D/g, '').includes(digits)) ||
    phone.includes(q)
  );
}

function currentMonthPurchases(row: FollowupRow) {
  return Number(row.purchase_count_current_month || row.customer_metrics?.invoices_count || 0);
}

function averagePurchaseCount(row: FollowupRow) {
  const fromRow = Number(row.average_monthly_purchase_count || 0);
  if (fromRow > 0) return fromRow;
  const activeMonths = Number(row.customer_metrics?.active_months || 0);
  const invoices = invoicesCount(row);
  if (activeMonths > 0 && invoices > 0) return Math.round(invoices / activeMonths);
  return 0;
}

function preContactNote(row: FollowupRow) {
  return (
    row.handling_notes ||
    row.service_notes ||
    row.whatsapp_notes ||
    row.customer_notes ||
    row.notes ||
    null
  );
}

function scriptFor(row: FollowupRow) {
  const reason = row.request_details || row.followup_reason || row.suggested_action || recommendedAction(row);
  if (!hasValidPhone(row)) {
    return 'العميل بدون رقم صحيح — راجع بيانات التواصل أو استخدم الاتصال الهاتفي من سجل الفرع قبل إرسال واتساب.';
  }
  if (row.needs_manager || isOverdue(row)) {
    return `أهلا بحضرتك، مع حضرتك صيدليات دواء.\nبنطمن على حضرتك بخصوص ${reason}.\nلو في أي ملاحظة أو احتياج، نتشرف بخدمة حضرتك فورًا.`;
  }
  if (/متوقف|stop/i.test(customerStatusOf(row))) {
    return `أهلا بحضرتك، مع حضرتك صيدليات دواء.\nبنطمن على حضرتك ونتأكد إن كل احتياجاتك متوفرة.\n${reason}\nنتشرف بخدمة حضرتك دائمًا.`;
  }
  if (/مهم جدا|vip/i.test(segmentOf(row))) {
    return `أهلا بحضرتك، مع حضرتك صيدليات دواء.\nحضرتك من عملائنا المميزين، وبنطمن على احتياجاتك الشهرية.\n${reason}\nتحت أمر حضرتك في أي وقت.`;
  }
  if (/شكوى|complaint/i.test(`${reason} ${row.followup_notes || ''}`)) {
    return `أهلا بحضرتك، مع حضرتك صيدليات دواء.\nبنعتذر عن أي إزعاج سابق، وبنتابع مع حضرتك لحل ${reason}.\nنتشرف بخدمة حضرتك.`;
  }
  const last = lastPurchaseOf(row) ? `\nآخر تعامل كان بتاريخ ${formatDate(lastPurchaseOf(row))}.` : '';
  return `أهلا بحضرتك، مع حضرتك صيدليات دواء.\nبنطمن على حضرتك وبنتابع بخصوص ${reason}.${last}\nنتشرف بخدمة حضرتك دائمًا.`;
}

function waMessageFor(row: FollowupRow) {
  const reason = row.request_details || row.followup_reason || recommendedAction(row);
  return `أهلا بحضرتك، مع حضرتك صيدليات دواء.\nبنطمن على حضرتك بخصوص ${reason}.\nنتشرف بخدمة حضرتك دائمًا.`;
}

function customer360Url(row: FollowupRow) {
  const params = new URLSearchParams();
  const code = getCustomerCodeSafe(row);
  const id = String(row.customer_id || '').trim();
  const phone = phoneOf(row);
  const name = customerName(row);
  if (code) params.set('code', code);
  if (id) params.set('id', id);
  if (phone) params.set('phone', phone);
  if (name && name !== 'عميل بدون اسم') params.set('name', name);
  return `/customer-360?${params.toString()}`;
}

function customerFrom(row: FollowupRow): Customer {
  const resolvedBranch = resolveCustomerBranch(row);
  return {
    id: row.customer_id || row.id,
    customer_code: getCustomerCodeSafe(row),
    name: customerName(row),
    phone: phoneOf(row),
    branch: resolvedBranch.branch,
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
  const requestedOpenDetails = params.get('openDetails') === '1' || Boolean(requestedFollowupId);
  const requestedMode = params.get('mode') || '';
  const requestedCustomerFallback = useMemo(
    () => ({
      customer_code: params.get('code') || null,
      customer_phone: params.get('phone') || null,
      customer_name: params.get('name') || null,
      customer_id: params.get('customerId') || null,
    }),
    [params]
  );
  const quickFollowupRequested =
    params.get('quickFollowup') === '1' || params.get('action') === 'quick-followup';
  const userId = user?.id || '';
  const userName = user?.name || '';
  const userRole = user?.role || '';
  const userBranch = user?.branch || '';
  const serviceBranchOverride = customerServiceBranchForUser(user);
  const canAllBranches = canSeeAllBranches(userRole);
  const serviceCanAllBranches = canAllBranches && !['cs.doha', 'cs.donia'].includes(String(user?.username || '').toLowerCase());
  const canHideFollowups = ['general_manager', 'executive_manager', 'branches_manager', 'customer_service_manager'].includes(normalizeRole(userRole));
  const [activeTab, setActiveTabState] = useState<TabId>(TABS.some(([id]) => id === requestedTab) ? requestedTab! : 'today');
  const [rows, setRows] = useState<FollowupRow[]>([]);
  const [hiddenRows, setHiddenRows] = useState<FollowupRow[]>([]);
  const [hiddenLoading, setHiddenLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [branch, setBranch] = useState(
    dashboardBranch ? normalizeBranchName(dashboardBranch) : serviceCanAllBranches ? ALL_FILTER : serviceBranchOverride || ALL_FILTER
  );
  const [status, setStatus] = useState(ALL_FILTER);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [operationsFilter, setOperationsFilter] = useState<OperationsFilter>('priority');
  const [metricFilter, setMetricFilter] = useState<MetricFilter>('all');
  const [auditFilter, setAuditFilter] = useState<AuditFilter>('today');
  const [auditSearch, setAuditSearch] = useState('');
  const [auditBranchFilter, setAuditBranchFilter] = useState(ALL_FILTER);
  const [auditOwnerFilter, setAuditOwnerFilter] = useState(ALL_FILTER);
  const [auditStatusFilter, setAuditStatusFilter] = useState(ALL_FILTER);
  const [auditPriorityFilter, setAuditPriorityFilter] = useState(ALL_FILTER);
  const [auditResultFilter, setAuditResultFilter] = useState(ALL_FILTER);
  const [auditCategoryFilter, setAuditCategoryFilter] = useState(ALL_FILTER);
  const [auditPhoneFilter, setAuditPhoneFilter] = useState(ALL_FILTER);
  const [auditRecoveredFilter, setAuditRecoveredFilter] = useState(ALL_FILTER);
  const [auditFromDate, setAuditFromDate] = useState('');
  const [auditToDate, setAuditToDate] = useState('');
  const [auditRowsLimit, setAuditRowsLimit] = useState(120);
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
  const [quickFollowupOpen, setQuickFollowupOpen] = useState(false);
  const [quickReplies, setQuickReplies] = useState<QuickReplyScript[]>([]);
  const [quickReplyRow, setQuickReplyRow] = useState<FollowupRow | null>(null);
  const [useCustomerNameInReply, setUseCustomerNameInReply] = useState(false);
  const [insights, setInsights] = useState<CustomerServiceInsightPools>(EMPTY_INSIGHTS);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);

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

  const setActiveTab = useCallback(
    (tab: TabId) => {
      setActiveTabState(tab);
      const next = new URLSearchParams(params);
      next.set('tab', tab);
      setParams(next, { replace: true });
    },
    [params, setParams]
  );

  const applyMetricFilter = useCallback(
    (filter: MetricFilter) => {
      setMetricFilter(filter);
      setQuickFilter('all');
      setAssignedFilter(ALL_FILTER);
      setStatus(ALL_FILTER);
      if (filter === 'completed' || filter === 'recovered' || filter === 'contactedNoPurchase') {
        setActiveTab('history');
      } else if (filter === 'today') {
        setActiveTab('today');
      } else {
        setActiveTab('today');
      }
    },
    [setActiveTab]
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
    if (!serviceCanAllBranches) setBranch(serviceBranchOverride || normalizeBranchName(userBranch));
  }, [serviceCanAllBranches, serviceBranchOverride, userBranch]);

  useEffect(() => {
    if (requestedTab && TABS.some(([id]) => id === requestedTab)) setActiveTabState(requestedTab);
  }, [requestedTab]);

  useEffect(() => {
    if (!quickFollowupRequested) return;
    setQuickFollowupOpen(true);
    setActiveTabState('requests');
  }, [quickFollowupRequested]);

  useEffect(() => {
    let active = true;
    void fetchQuickReplyScripts().then((scripts) => {
      if (active) setQuickReplies(scripts);
    });
    return () => {
      active = false;
    };
  }, []);

  const closeQuickFollowup = useCallback(() => {
    setQuickFollowupOpen(false);
    const next = new URLSearchParams(params);
    next.delete('quickFollowup');
    next.delete('action');
    setParams(next, { replace: true });
  }, [params, setParams]);

  const clearModalQueryParams = useCallback(() => {
    const next = new URLSearchParams(params);
    ['followupId', 'requestId', 'taskId', 'openDetails', 'mode', 'customerId', 'code', 'phone', 'name', 'customer', 'followup', 'modal'].forEach((key) => {
      next.delete(key);
    });
    setParams(next, { replace: true });
  }, [params, setParams]);

  const closeCustomerDetails = useCallback(() => {
    setDetailsRow(null);
    clearModalQueryParams();
  }, [clearModalQueryParams]);

  const enrichRowWithLiveMetrics = useCallback(async (row: FollowupRow): Promise<FollowupRow> => {
    const live = await getCustomerServiceLiveMetrics({
      customer_id: row.customer_id,
      customer_code: getCustomerCodeSafe(row),
      customer_phone: phoneOf(row),
      customer_name: customerName(row),
      branch: row.branch,
    });
    if (!live) return row;
    const fallbackTotal = totalSpent(row);
    const fallbackInvoices = invoicesCount(row);
    const nextTotal = live.total_spent > 0 ? live.total_spent : fallbackTotal;
    const nextInvoices = live.invoices_count > 0 ? live.invoices_count : fallbackInvoices;
    return {
      ...row,
      total_spent: nextTotal,
      last_purchase_date: live.last_purchase || row.last_purchase_date,
      purchase_count_current_month: live.current_month_count || row.purchase_count_current_month,
      average_monthly_purchase_count: live.average_monthly_purchase_count || averagePurchaseCount(row),
      customer_status: live.customer_status || row.customer_status,
      segment: live.segment || row.segment,
      branch: live.branch_last_purchase || live.branch || row.branch,
      customer_metrics: {
        ...(row.customer_metrics || { id: row.customer_id || row.id }),
        total_spent: nextTotal,
        invoices_count: nextInvoices,
        last_purchase: live.last_purchase || row.customer_metrics?.last_purchase || row.last_purchase_date || null,
        first_purchase: live.first_purchase || row.customer_metrics?.first_purchase || null,
        avg_invoice: live.avg_invoice || (nextInvoices ? nextTotal / nextInvoices : 0),
        avg_monthly: live.avg_monthly || avgMonthly(row),
        customer_status: live.customer_status || row.customer_metrics?.customer_status,
        segment: live.segment || row.customer_metrics?.segment,
        branch_most_frequent: live.branch_most_frequent,
        branch_highest_value: live.branch_highest_value,
        branch_last_purchase: live.branch_last_purchase,
        invoices_matched_count: live.invoices_matched_count,
        matched_by: live.matched_by,
        source: live.source,
      } as unknown as FollowupRow['customer_metrics'],
    };
  }, []);

  useEffect(() => {
    if (!requestedFollowupId) return;
    let cancelled = false;
    const run = async () => {
      const requested = rows.find((row) => row.id === requestedFollowupId) || (await fetchCustomerServiceFollowupById(requestedFollowupId));
      if (!requested || cancelled) return;
      const enriched = await enrichRowWithLiveMetrics({
        ...requested,
        customer_code: getCustomerCodeSafe(requested) || requestedCustomerFallback.customer_code,
        customer_phone: requested.customer_phone || requested.phone || requestedCustomerFallback.customer_phone,
        phone: requested.phone || requested.customer_phone || requestedCustomerFallback.customer_phone,
        customer_name: requested.customer_name || requested.name || requestedCustomerFallback.customer_name,
        name: requested.name || requested.customer_name || requestedCustomerFallback.customer_name,
        customer_id: requested.customer_id || requestedCustomerFallback.customer_id,
      });
      if (cancelled) return;
      setRows((current) => (current.some((row) => row.id === enriched.id) ? current.map((row) => (row.id === enriched.id ? enriched : row)) : [enriched, ...current]));
      setSelectedRow(enriched);
      if (requestedOpenDetails) setDetailsRow(enriched);
      if (requestedMode === 'edit') setResultRow(enriched);
      if (import.meta.env.DEV) {
        console.debug('[CustomerService] requested followup opened', {
          followupId: requestedFollowupId,
          customer_code: enriched.customer_code,
          customer_phone: enriched.customer_phone || enriched.phone,
          customer_name: enriched.customer_name || enriched.name,
          matched_by: (enriched.customer_metrics as Record<string, unknown> | null)?.matched_by,
          invoices_matched_count: (enriched.customer_metrics as Record<string, unknown> | null)?.invoices_matched_count,
          source: (enriched.customer_metrics as Record<string, unknown> | null)?.source,
        });
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [enrichRowWithLiveMetrics, requestedCustomerFallback, requestedFollowupId, requestedMode, requestedOpenDetails, rows]);

  const load = useCallback(
    async (soft = false) => {
      if (soft || !firstLoadRef.current) setRefreshing(true);
      else setInitialLoading(true);
      setError(null);
      try {
        const scopedUser = { role: userRole, branch: serviceBranchOverride || userBranch };
        const scopedBranch = serviceCanAllBranches ? effectiveBranchFilter(scopedUser, branch, ALL_FILTER) : serviceBranchOverride || userBranch;
        const data = await fetchCustomerServiceFollowups({
          branch: scopedBranch,
          status,
          search: debouncedSearch,
          limit: FETCH_LIMIT,
        });
        if (!mountedRef.current) return;
        const scopedData = data.filter((row) => rowMatchesCurrentUserScope(user, row as unknown as Record<string, unknown>));
        const sorted = [...scopedData].sort((a, b) => priorityScore(b) - priorityScore(a));
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
    [branch, debouncedSearch, serviceBranchOverride, serviceCanAllBranches, status, user, userBranch, userRole]
  );

  useEffect(() => {
    void load(!firstLoadRef.current);
  }, [load]);

  const loadHiddenFollowups = useCallback(async () => {
    if (!canHideFollowups) return;
    setHiddenLoading(true);
    try {
      let query = supabase
        .from('daily_followups')
        .select('*')
        .eq('is_hidden', true)
        .order('hidden_at', { ascending: false })
        .limit(250);
      if (!serviceCanAllBranches) query = query.eq('branch', serviceBranchOverride || userBranch);
      else if (branch !== ALL_FILTER) query = query.eq('branch', branch);
      const { data, error } = await query;
      if (error) throw error;
      setHiddenRows(((data || []) as FollowupRow[]).filter((row) => rowMatchesCurrentUserScope(user, row as unknown as Record<string, unknown>)));
    } catch (hiddenError) {
      toast.error(`تعذر تحميل المتابعات المخفية: ${hiddenError instanceof Error ? hiddenError.message : 'خطأ غير متوقع'}`);
    } finally {
      setHiddenLoading(false);
    }
  }, [branch, canHideFollowups, serviceBranchOverride, serviceCanAllBranches, user, userBranch]);

  useEffect(() => {
    if (activeTab === 'hidden') void loadHiddenFollowups();
  }, [activeTab, loadHiddenFollowups]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setInsightsLoading(true);
      setInsightsError(null);
      try {
        const scopedBranch = serviceCanAllBranches ? effectiveBranchFilter({ role: userRole, branch: serviceBranchOverride || userBranch }, branch, ALL_FILTER) : serviceBranchOverride || userBranch;
        const data = await fetchCustomerServiceInsightPools(scopedBranch);
        if (!cancelled) setInsights(data);
      } catch (error) {
        if (!cancelled) setInsightsError(error instanceof Error ? error.message : 'تعذر تحميل القوائم التحليلية');
      } finally {
        if (!cancelled) setInsightsLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [branch, serviceBranchOverride, serviceCanAllBranches, userBranch, userRole]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [activeTab, branch, status, debouncedSearch, quickFilter, assignedFilter, metricFilter, auditFilter]);

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
    if (activeTab === 'strong') return dedupeCustomerRows(rows.filter((row) => /متابعة قوية|متابعة استثنائية|عاجل/i.test(String(row.request_type || row.followup_reason || row.priority || ''))));
    if (activeTab === 'important-customers') return dedupeCustomerRows([...insights.important]);
    if (activeTab === 'reduced-customers') return dedupeCustomerRows([...insights.reduced]);
    if (activeTab === 'stopped-customers') return dedupeCustomerRows([...insights.stopped60]);
    if (activeTab === 'assigned') return assignedRows;
    if (activeTab === 'requests' || activeTab === 'customer-requests') {
      return rows.filter((row) => Boolean(row.request_type || row.request_details || row.request_status));
    }
    if (activeTab === 'finish') return rows.filter((row) => !isCompleted(row));
    if (activeTab === 'notes') return rows.filter((row) => row.notes || row.customer_notes || row.handling_notes || row.whatsapp_notes);
    if (activeTab === 'alerts') {
      return rows.filter((row) => row.needs_manager || isOverdue(row) || riskLevel(row) !== 'منخفض' || Object.values(row.customer_flags || {}).some(Boolean));
    }
    if (activeTab === 'history') return rows.filter(isHistoryCompleted);
    return rows.filter((row) => !isCompleted(row));
  }, [activeTab, assignedRows, insights.important, insights.reduced, insights.stopped60, rows]);
  const filteredTabRows = useMemo(
    () =>
      tabRows.filter((row) => {
        const responsible = responsibleOf(row);
        return (
          matchesSearch(row, debouncedSearch) &&
          matchesQuickFilter(row, quickFilter) &&
          matchesMetricFilter(row, metricFilter) &&
          (assignedFilter === ALL_FILTER || responsible === assignedFilter)
        );
      }),
    [assignedFilter, debouncedSearch, metricFilter, quickFilter, tabRows]
  );

  const enrichmentTargets = useMemo(
    () =>
      filteredTabRows.slice(0, visibleCount).map((row) => ({
        customer_id: row.customer_id,
        customer_code: getCustomerCodeSafe(row),
        customer_phone: phoneOf(row),
        customer_name: customerName(row),
        branch: row.branch,
      })),
    [filteredTabRows, visibleCount]
  );
  const liveMetricsByKey = useCustomerServiceMetricsEnrichment(enrichmentTargets);

  const enrichRow = useCallback(
    (row: FollowupRow): FollowupRow => {
      const key = customerMetricsKey({
        customer_id: row.customer_id,
        customer_code: getCustomerCodeSafe(row),
        customer_phone: phoneOf(row),
        customer_name: customerName(row),
      });
      const live = liveMetricsByKey.get(key);
      if (!live) return row;

      // لا نسمح للـ live enrichment يمسح الأرقام القديمة لو لقى الفواتير والتاريخ
      // لكن لم يقدر يقرأ عمود قيمة الفاتورة بسبب اختلاف اسم العمود في sales_invoices.
      const fallbackTotal = totalSpent(row);
      const fallbackInvoices = invoicesCount(row);
      const fallbackAvgMonthly = avgMonthly(row);
      const fallbackAvgInvoice = Number(row.customer_metrics?.avg_invoice || 0);

      const nextTotal = live.total_spent > 0 ? live.total_spent : fallbackTotal;
      const nextInvoices = live.invoices_count > 0 ? live.invoices_count : fallbackInvoices;
      const nextAvgInvoice =
        live.avg_invoice > 0
          ? live.avg_invoice
          : fallbackAvgInvoice > 0
            ? fallbackAvgInvoice
            : nextInvoices > 0
              ? nextTotal / nextInvoices
              : 0;
      const nextAvgMonthly = live.avg_monthly > 0 ? live.avg_monthly : fallbackAvgMonthly;
      const nextCurrentMonthCount =
        live.current_month_count > 0 ? live.current_month_count : Number(row.purchase_count_current_month || 0);
      const nextAverageMonthlyPurchaseCount =
        live.average_monthly_purchase_count > 0
          ? live.average_monthly_purchase_count
          : averagePurchaseCount(row);

      return {
        ...row,
        total_spent: nextTotal,
        last_purchase_date: live.last_purchase || row.last_purchase_date,
        purchase_count_current_month: nextCurrentMonthCount,
        average_monthly_purchase_count: nextAverageMonthlyPurchaseCount,
        customer_status: live.customer_status || row.customer_status,
        segment: live.segment || row.segment,
        branch: live.branch_last_purchase || live.branch || row.branch,
        customer_metrics: {
          ...(row.customer_metrics || { id: row.customer_id || row.id }),
          total_spent: nextTotal,
          invoices_count: nextInvoices,
          last_purchase: live.last_purchase || row.customer_metrics?.last_purchase || row.last_purchase_date || null,
          first_purchase: live.first_purchase || row.customer_metrics?.first_purchase || null,
          avg_invoice: nextAvgInvoice,
          avg_monthly: nextAvgMonthly,
          customer_status: live.customer_status || row.customer_metrics?.customer_status,
          segment: live.segment || row.customer_metrics?.segment,
          branch_most_frequent: live.branch_most_frequent,
          branch_highest_value: live.branch_highest_value,
          branch_last_purchase: live.branch_last_purchase,
          invoices_matched_count: live.invoices_matched_count,
          matched_by: live.matched_by,
          source: live.source,
        } as unknown as FollowupRow['customer_metrics'],
      };
    },
    [liveMetricsByKey]
  );

  const selectedDisplayRow = useMemo(() => {
    if (!selectedRow) return null;
    return enrichRow(selectedRow);
  }, [enrichRow, selectedRow]);
  const detailRow = selectedDisplayRow || selectedRow;
  const { data: staffRows } = useSupabaseQuery<{ id: string; name: string; role: string; branch: string | null; active?: boolean | null }>({
    table: 'staff',
    select: 'id,name,role,branch,active',
    filters: [{ column: 'active', operator: 'eq', value: true }],
    orderBy: { column: 'name', ascending: true },
    limit: 200,
  });
  const staff = useMemo(() => {
    const fromDb = mergeStaffChoices(staffRows || []).map((item) => ({
      id: item.id,
      name: item.display_name || item.name,
      role: item.role,
      branch: item.branch,
    }));
    const fromFollowups = [
      ...new Map(
        rows.map((row) => {
          const name = responsibleOf(row);
          return [name, { id: row.assigned_staff_id || name, name, role: 'خدمة عملاء', branch: row.branch || 'غير محدد' }];
        })
      ).values(),
    ];
    const merged = new Map<string, { id: string; name: string; role: string; branch: string | null }>();
    for (const item of [...fromDb, ...fromFollowups]) {
      if (item.name && item.name !== 'غير محدد') merged.set(item.name, item);
    }
    return [...merged.values()];
  }, [rows, staffRows]);
  const doctorOptions = useMemo(
    () =>
      [
        ...new Set([
          ...staff.map((item) => item.name),
          ...CUSTOMER_SERVICE_DOCTORS,
          ...SHOKRY_BRANCH_PHARMACISTS,
          ...SHAMY_BRANCH_PHARMACISTS,
        ].filter(Boolean)),
      ].sort((a, b) => a.localeCompare(b, 'ar')),
    [staff]
  );
  const operationRows = useMemo(() => {
    const source = [...filteredTabRows];
    const byPriority = source.sort(compareAuditRowsByPriority);
    if (operationsFilter === 'all') return byPriority;
    if (operationsFilter === 'overdue') return byPriority.filter(isOverdue);
    if (operationsFilter === 'manager') return byPriority.filter((row) => row.needs_manager || /مدير/i.test(statusOf(row)));
    if (operationsFilter === 'noCode') return byPriority.filter((row) => !getCustomerCodeSafe(row));
    if (operationsFilter === 'branchReview') return byPriority.filter((row) => resolveCustomerBranch(row).needsReview);
    if (operationsFilter === 'vip') return byPriority.filter((row) => /vip|مهم جدًا|مميز/i.test(`${segmentOf(row)} ${String(row.priority || '')} ${getCustomerFlagChips(row).join(' ')}`));
    if (operationsFilter === 'completed') return byPriority.filter(isHistoryCompleted);
    return byPriority;
  }, [filteredTabRows, operationsFilter]);
  const operationsCounts = useMemo(() => {
    const noCode = rows.filter((row) => !getCustomerCodeSafe(row)).length;
    const branchUncertain = rows.filter((row) => resolveCustomerBranch(row).needsReview).length;
    const urgent = rows.filter((row) => priorityScore(row) >= 100 || /عاجل|urgent/i.test(String(row.priority || ''))).length;
    const vip = rows.filter((row) => /vip|مهم جدًا|مميز/i.test(`${segmentOf(row)} ${String(row.priority || '')} ${getCustomerFlagChips(row).join(' ')}`)).length;
    return {
      open: rows.filter((row) => !isCompleted(row)).length,
      overdue: rows.filter(isOverdue).length,
      urgent,
      needsManager: rows.filter((row) => row.needs_manager || /مدير/i.test(statusOf(row))).length,
      completedToday: rows.filter(isHistoryCompleted).length,
      smartSuggestions: insights.important.length + insights.reduced.length + insights.stopped60.length,
      purchaseAfterAmount: stats.purchaseAfterAmount,
      noCode,
      branchUncertain,
      vip,
    };
  }, [insights.important.length, insights.reduced.length, insights.stopped60.length, rows, stats.purchaseAfterAmount]);
  const operationalVisibleRows = useMemo(
    () => operationRows.slice(0, visibleCount).map(enrichRow),
    [enrichRow, operationRows, visibleCount]
  );
  const visibleRows = operationalVisibleRows;
  const branchOwnerPerformance = useMemo(() => calculateBranchOwnerPerformance(rows), [rows]);
  const performance = useMemo(() => calculateTeamPerformance(rows), [rows]);
  const recoveredCount = useMemo(() => rows.filter((row) => row.purchase_after_followup).length, [rows]);
  const invalidPhoneCount = useMemo(() => rows.filter((row) => !hasValidPhone(row)).length, [rows]);
  const notStartedCount = useMemo(() => rows.filter((row) => matchesMetricFilter(row, 'notStarted')).length, [rows]);
  const contactedNoPurchaseCount = useMemo(() => rows.filter((row) => matchesMetricFilter(row, 'contactedNoPurchase')).length, [rows]);
  const auditBaseSourceRows = useMemo(() => dedupeCustomerRows(rows), [rows]);
  const auditUiFilters = useMemo<AuditUiFilters>(() => ({
    search: auditSearch,
    branch: auditBranchFilter,
    owner: auditOwnerFilter,
    status: auditStatusFilter,
    priority: auditPriorityFilter,
    result: auditResultFilter,
    category: auditCategoryFilter,
    phone: auditPhoneFilter,
    recovered: auditRecoveredFilter,
    from: auditFromDate,
    to: auditToDate,
  }), [auditBranchFilter, auditCategoryFilter, auditFromDate, auditOwnerFilter, auditPhoneFilter, auditPriorityFilter, auditRecoveredFilter, auditResultFilter, auditSearch, auditStatusFilter, auditToDate]);
  const auditUiFiltersActive = useMemo(() => Boolean(
    auditSearch.trim() || auditBranchFilter !== ALL_FILTER || auditOwnerFilter !== ALL_FILTER || auditStatusFilter !== ALL_FILTER || auditPriorityFilter !== ALL_FILTER || auditResultFilter !== ALL_FILTER || auditCategoryFilter !== ALL_FILTER || auditPhoneFilter !== ALL_FILTER || auditRecoveredFilter !== ALL_FILTER || auditFromDate || auditToDate
  ), [auditBranchFilter, auditCategoryFilter, auditFromDate, auditOwnerFilter, auditPhoneFilter, auditPriorityFilter, auditRecoveredFilter, auditResultFilter, auditSearch, auditStatusFilter, auditToDate]);
  const auditScopedSourceRows = useMemo(() => auditBaseSourceRows.filter((row) => matchesAuditUiFilters(row, auditUiFilters)), [auditBaseSourceRows, auditUiFilters]);
  const auditRows = useMemo(() => auditBaseSourceRows.map(auditRowFromFollowup), [auditBaseSourceRows]);
  const auditFilteredSourceRows = useMemo(() => auditScopedSourceRows.filter((row) => matchesAuditFilter(row, auditFilter)).sort(compareAuditRowsByPriority), [auditFilter, auditScopedSourceRows]);
  const auditFilteredRows = useMemo(() => auditFilteredSourceRows.map(auditRowFromFollowup), [auditFilteredSourceRows]);
  const auditVisibleSourceRows = useMemo(() => auditFilteredSourceRows.slice(0, auditRowsLimit), [auditFilteredSourceRows, auditRowsLimit]);
  const auditVisibleRows = useMemo(() => auditVisibleSourceRows.map(auditRowFromFollowup), [auditVisibleSourceRows]);
  const auditBranchOptions = useMemo(() => [ALL_FILTER, ...new Set(auditBaseSourceRows.map((row) => normalizeBranchName(row.branch || '')).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar')), [auditBaseSourceRows]);
  const auditOwnerOptions = useMemo(() => [ALL_FILTER, ...new Set(auditBaseSourceRows.map((row) => responsibleOf(row)).filter((value) => value && value !== 'غير محدد'))].sort((a, b) => a.localeCompare(b, 'ar')), [auditBaseSourceRows]);
  const auditResultOptions = useMemo(() => [ALL_FILTER, ...new Set(auditBaseSourceRows.map((row) => followupResultLabel(row)).filter((value) => value && value !== 'غير محدد'))].sort((a, b) => a.localeCompare(b, 'ar')), [auditBaseSourceRows]);
  const auditCategoryOptions = useMemo(() => [ALL_FILTER, ...new Set(auditBaseSourceRows.map((row) => segmentOf(row)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar')), [auditBaseSourceRows]);
  const resetAuditUiFilters = useCallback(() => {
    setAuditSearch('');
    setAuditBranchFilter(ALL_FILTER);
    setAuditOwnerFilter(ALL_FILTER);
    setAuditStatusFilter(ALL_FILTER);
    setAuditPriorityFilter(ALL_FILTER);
    setAuditResultFilter(ALL_FILTER);
    setAuditCategoryFilter(ALL_FILTER);
    setAuditPhoneFilter(ALL_FILTER);
    setAuditRecoveredFilter(ALL_FILTER);
    setAuditFromDate('');
    setAuditToDate('');
    setAuditRowsLimit(120);
  }, []);
  useEffect(() => { setAuditRowsLimit(120); }, [auditFilter, auditUiFilters]);
  const auditCounts = useMemo(() => {
    const uniqueRows = auditScopedSourceRows;
    return {
      today: uniqueRows.filter((row) => matchesAuditFilter(row, 'today')).length,
      completed: uniqueRows.filter((row) => matchesAuditFilter(row, 'completed')).length,
      notStarted: uniqueRows.filter((row) => matchesAuditFilter(row, 'notStarted')).length,
      notStartedOverdue: uniqueRows.filter((row) => matchesAuditFilter(row, 'notStartedOverdue')).length,
      overdue: uniqueRows.filter((row) => matchesAuditFilter(row, 'overdue')).length,
      noAnswer: uniqueRows.filter((row) => matchesAuditFilter(row, 'noAnswer')).length,
      postponed: uniqueRows.filter((row) => matchesAuditFilter(row, 'postponed')).length,
      needsManager: uniqueRows.filter((row) => matchesAuditFilter(row, 'needsManager')).length,
      invalidPhone: uniqueRows.filter((row) => matchesAuditFilter(row, 'invalidPhone')).length,
      recovered: uniqueRows.filter((row) => matchesAuditFilter(row, 'recovered')).length,
      purchaseAfter: uniqueRows.reduce((sum, row) => sum + salesAfterFollowup(row), 0),
      contactedNoPurchase: uniqueRows.filter((row) => matchesAuditFilter(row, 'contactedNoPurchase')).length,
      dataQuality: uniqueRows.filter((row) => matchesAuditFilter(row, 'dataQuality')).length,
    };
  }, [auditScopedSourceRows]);
  const auditAnalysis = useMemo(() => {
    const uniqueRows = auditScopedSourceRows;
    const total = uniqueRows.length;
    const byOwner = new Map<string, { name: string; branch: string; recovered: number; amount: number; total: number }>();
    const byBranch = new Map<string, { branch: string; recovered: number; amount: number; total: number }>();
    for (const row of uniqueRows) {
      const owner = responsibleOf(row);
      const branchName = normalizeBranchName(row.branch || '') || 'غير محدد';
      const ownerItem = byOwner.get(owner) || { name: owner, branch: branchName, recovered: 0, amount: 0, total: 0 };
      ownerItem.total += 1;
      if (isRecoveredCustomer(row)) ownerItem.recovered += 1;
      ownerItem.amount += salesAfterFollowup(row);
      byOwner.set(owner, ownerItem);
      const branchItem = byBranch.get(branchName) || { branch: branchName, recovered: 0, amount: 0, total: 0 };
      branchItem.total += 1;
      if (isRecoveredCustomer(row)) branchItem.recovered += 1;
      branchItem.amount += salesAfterFollowup(row);
      byBranch.set(branchName, branchItem);
    }
    const bestOwner = [...byOwner.values()].sort((a, b) => b.recovered - a.recovered || b.amount - a.amount || b.total - a.total)[0];
    const bestBranch = [...byBranch.values()].sort((a, b) => safePercent(b.recovered, b.total) - safePercent(a.recovered, a.total) || b.amount - a.amount)[0];
    const completionRate = safePercent(auditCounts.completed, total);
    const overdueRate = safePercent(auditCounts.overdue, total);
    const noAnswerRate = safePercent(auditCounts.noAnswer, total);
    const recoveryRate = safePercent(auditCounts.recovered, total);
    const notStartedRate = safePercent(auditCounts.notStarted, total);
    const notStartedOverdueRate = safePercent(auditCounts.notStartedOverdue, total);
    const invalidPhoneRate = safePercent(auditCounts.invalidPhone, total);
    const warnings: string[] = [];
    if (overdueRate >= 30) warnings.push(`المتأخر ${overdueRate}% من المتابعات`);
    if (notStartedRate >= 30) warnings.push(`لم يبدأ التواصل ${notStartedRate}% من المتابعات`);
    if (notStartedOverdueRate > 0) warnings.push(`${auditCounts.notStartedOverdue} عميل متأخر ولم يبدأ التواصل`);
    if (invalidPhoneRate >= 10) warnings.push(`أرقام غير صالحة ${invalidPhoneRate}%`);
    return {
      completionRate,
      overdueRate,
      noAnswerRate,
      recoveryRate,
      notStartedRate,
      notStartedOverdueRate,
      invalidPhoneRate,
      purchaseAfterAmount: auditCounts.purchaseAfter,
      bestOwner: bestOwner ? `${bestOwner.name} · ${bestOwner.recovered} عميل · ${money(bestOwner.amount)}` : 'غير متاح',
      bestBranch: bestBranch ? `${bestBranch.branch} · ${safePercent(bestBranch.recovered, bestBranch.total)}% استرجاع · ${money(bestBranch.amount)}` : 'غير متاح',
      dataQualityIssues: `${auditCounts.dataQuality} مشكلة · بدون رقم صحيح ${auditCounts.invalidPhone}`,
      warnings,
    };
  }, [auditCounts, auditScopedSourceRows]);
  const exportAuditDisplayed = useCallback(() => {
    downloadAuditCsv(auditFilteredRows, `customer-service-audit-${AUDIT_FILTER_LABELS[auditFilter]}-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success('تم تصدير المعروض CSV');
  }, [auditFilter, auditFilteredRows]);
  const exportAuditFull = useCallback(() => {
    downloadAuditCsv(auditRows, `customer-service-audit-full-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success('تم تصدير التحليل الكامل CSV');
  }, [auditRows]);
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
      target_route: `/customer-service?tab=today&followupId=${row.id}&openDetails=1&mode=edit&code=${encodeURIComponent(getCustomerCodeSafe(row))}&phone=${encodeURIComponent(phoneOf(row))}&name=${encodeURIComponent(customerName(row))}`,
      recipient_role: priority === 'urgent' ? 'customer_service_manager' : null,
      created_by: userId,
      created_by_name: userName,
    }).catch((notificationError) => console.warn('[customer-service] notification skipped', notificationError));
  };

  const hideFollowup = async (row: FollowupRow) => {
    if (!canHideFollowups) return toast.error('إخفاء المتابعة متاح للمدير المسؤول فقط.');
    const reason = window.prompt('اكتب سبب إخفاء المتابعة. ستظل محفوظة في السجل ولن تُحذف:');
    if (reason == null) return;
    if (!reason.trim()) return toast.error('سبب الإخفاء مطلوب.');
    const { error } = await supabase
      .from('daily_followups')
      .update({
        is_hidden: true,
        hidden_at: new Date().toISOString(),
        hidden_by: userId || userName || 'manager',
        hidden_reason: reason.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    if (error) return toast.error(`تعذر إخفاء المتابعة: ${error.message}`);
    setRows((current) => current.filter((item) => item.id !== row.id));
    setSelectedRow((current) => (current?.id === row.id ? null : current));
    setDetailsRow((current) => (current?.id === row.id ? null : current));
    setResultRow((current) => (current?.id === row.id ? null : current));
    toast.success('تم إخفاء المتابعة مع الاحتفاظ بها في السجل.');
  };

  const restoreFollowup = async (row: FollowupRow) => {
    if (!canHideFollowups) return toast.error('استعادة المتابعة متاحة للمدير المسؤول فقط.');
    const { error } = await supabase
      .from('daily_followups')
      .update({ is_hidden: false, hidden_at: null, hidden_by: null, hidden_reason: null, updated_at: new Date().toISOString() })
      .eq('id', row.id);
    if (error) return toast.error(`تعذر استعادة المتابعة: ${error.message}`);
    setHiddenRows((current) => current.filter((item) => item.id !== row.id));
    toast.success('تمت استعادة المتابعة إلى قوائم العمل.');
    void load(true);
  };

  const saveResult = async (result: FollowupResultData) => {
    if (!resultRow) return;
    const before = resultRow as unknown as Record<string, unknown>;
    const needsManager = result.result === 'يحتاج متابعة مدير' || result.result === 'تم الرد ويوجد شكوى';
    const purchase = result.result === 'تم الشراء بعد المتابعة';
    const updated = await updateFollowupResult(resultRow.id, {
      followup_status: result.result,
      status: result.result,
      contact_result: result.result,
      followup_result: result.result,
      followup_notes: result.notes,
      quality_rating: result.qualityRating,
      internal_rating: result.internalRating,
      customer_satisfaction: result.customerSatisfaction || (result.customerSatisfied ? 'راضي' : null),
      need_understood: result.needUnderstood,
      cross_sell_offered: result.crossSellOffered,
      up_sell_offered: result.upSellOffered,
      needs_next_followup: result.needsNextFollowup,
      no_purchase_reason: result.noPurchaseReason || null,
      doctor_internal_note: result.doctorInternalNote || null,
      evaluated_by: userId || userName || null,
      evaluated_by_name: userName || null,
      evaluated_at: new Date().toISOString(),
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
    const changedFields: Record<string, { old: unknown; next: unknown }> = {};
    const after = updated as unknown as Record<string, unknown>;
    [
      'status',
      'followup_status',
      'contact_result',
      'followup_result',
      'followup_notes',
      'next_followup_date',
      'internal_rating',
      'customer_satisfaction',
      'need_understood',
      'cross_sell_offered',
      'up_sell_offered',
      'needs_next_followup',
      'no_purchase_reason',
      'doctor_internal_note',
    ].forEach((key) => {
      if (String(before[key] ?? '') !== String(after[key] ?? '')) {
        changedFields[key] = { old: before[key] ?? null, next: after[key] ?? null };
      }
    });
    supabase
      .rpc('insert_customer_followup_edit_log', {
        p_payload: {
          followup_id: updated.id,
          customer_code: getCustomerCodeSafe(updated) || null,
          customer_phone: phoneOf(updated) || null,
          customer_name: customerName(updated),
          old_status: String(before.status || before.followup_status || ''),
          new_status: String(after.status || after.followup_status || ''),
          old_result: String(before.followup_result || before.contact_result || ''),
          new_result: result.result,
          old_notes: String(before.followup_notes || before.notes || ''),
          new_notes: result.notes || '',
          changed_fields: changedFields,
          edited_by: userId || null,
          edited_by_name: userName || null,
        },
      })
      .then(({ error: logError }) => {
        if (logError) console.warn('[customer-service] followup edit log skipped', logError);
      });
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

  const approveBranchCorrection = async (row: FollowupRow) => {
    const suggested = resolveSuggestedBranchFromInvoiceMetrics(row.customer_metrics);
    if (!suggested) {
      toast.error('لا يوجد فرع مقترح من الفواتير لهذا العميل');
      return;
    }
    const reason = window.prompt('سبب تعديل فرع العميل', 'تصحيح حسب تحليل فواتير العميل');
    if (reason === null) return;
    try {
      await saveCustomerBranchOverride({
        customer_code: getCustomerCodeSafe(row),
        customer_id: row.customer_id,
        customer_phone: phoneOf(row),
        customer_name: customerName(row),
        old_branch: row.branch,
        new_branch: suggested,
        suggested_branch: suggested,
        reason,
        created_by: userId || userName,
        created_by_name: userName,
      });
      setRows((current) => current.map((item) => (item.id === row.id ? { ...item, branch: suggested } : item)));
      setSelectedRow((current) => (current?.id === row.id ? { ...current, branch: suggested } : current));
      toast.success('تم اعتماد تصحيح فرع العميل كـ override آمن');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر حفظ تصحيح الفرع');
    }
  };

  const renderReplyForRow = (script: QuickReplyScript, row: FollowupRow) =>
    renderQuickReplyTemplate(script.message_body, {
      customer_name: customerName(row),
      doctor_name: userName || responsibleOf(row),
      branch: row.branch,
      last_purchase: formatDate(lastPurchaseOf(row)),
      use_customer_name: useCustomerNameInReply,
    });

  const useQuickReply = async (script: QuickReplyScript, row: FollowupRow, openWhatsapp = false) => {
    const message = renderReplyForRow(script, row);
    try {
      await navigator.clipboard.writeText(message);
      await incrementQuickReplyUsage(script.id);
      setQuickReplies((current) =>
        current.map((item) => (item.id === script.id ? { ...item, usage_count: item.usage_count + 1 } : item))
      );
      if (openWhatsapp && hasValidPhone(row)) {
        window.open(generateWhatsAppLink(phoneOf(row), message), '_blank', 'noopener,noreferrer');
      }
      toast.success(openWhatsapp ? 'تم نسخ الرد وفتح واتساب' : 'تم نسخ الرد السريع');
    } catch {
      toast.error('تعذر نسخ الرد السريع');
    }
  };

  const convertToStrongFollowup = (row: FollowupRow) => {
    setSelectedRow(row);
    setForm((current) => ({
      ...current,
      customerName: customerName(row),
      phone: phoneOf(row),
      branch: row.branch || branch,
      priority: 'عاجل',
      due: dateInputNow(),
      result: 'لم يتم التواصل بعد',
      nextDue: '',
      reason: [
        'متابعة قوية',
        row.followup_reason || recommendedAction(row),
        lastContactAt(row) ? `آخر متابعة/تحديث: ${formatDateTime(lastContactAt(row))}` : '',
      ].filter(Boolean).join('\n'),
      selectedCustomer: (row.customer_metrics as any) || null,
    }));
    setActiveTab('add');
    toast.success('تم تجهيز العميل كمتابعة قوية. راجع السبب وحدد موعد المتابعة ثم احفظ.');
  };

  const generateToday = async () => {
    setGenerating(true);
    try {
      const scopedBranch = serviceCanAllBranches ? effectiveBranchFilter({ role: userRole, branch: serviceBranchOverride || userBranch }, branch, ALL_FILTER) : serviceBranchOverride || userBranch;
      const report = await generateTodayFollowupsSmartReport(scopedBranch, userName);
      const created = report.createdRows || [];
      const uniqueCreated = dedupeCustomerRows(created);
      const summary = [
        `تم إنشاء ${report.created_count} متابعة`,
        `تكرار: ${report.skipped_duplicates_count}`,
        `متابعة مفتوحة/اليوم: ${report.skipped_open_followups_count}`,
        `رقم غير صالح: ${report.skipped_invalid_phone_count}`,
        `فشل حفظ: ${report.failed_count}`,
      ].join(' · ');
      if (report.created_count > 0) toast.success(summary);
      else toast.info(`لا توجد متابعات جديدة · ${summary}`);
      if (uniqueCreated.length !== created.length) toast.info(`تم تنظيف ${created.length - uniqueCreated.length} تكرار من نتيجة الإنشاء قبل العرض`);
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
      setActiveTab('requests');
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : 'تعذر إضافة المتابعة الاستثنائية');
    }
  };

  const copyScript = async (row: FollowupRow) => {
    await navigator.clipboard.writeText(waMessageFor(row));
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

  const cardsTabs: TabId[] = ['today', 'strong', 'important-customers', 'reduced-customers', 'stopped-customers', 'assigned', 'requests', 'finish', 'notes', 'alerts', 'history', 'customer-requests'];

  return (
    <div className="customer-service-v3 w-full max-w-full space-y-5 overflow-hidden" dir="rtl">
      <section className="rounded-3xl border border-teal-500/35 bg-gradient-to-l from-[#0f2744] via-[#111827] to-[#0b1220] p-5 text-slate-100 shadow-xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <span className="inline-flex rounded-full border border-cyan-400/30 bg-cyan-500/15 px-3 py-1 text-xs font-black text-cyan-100">
              Customer Service Command Center
            </span>
            <h1 className="mt-3 text-3xl font-black text-white">متابعة العملاء</h1>
            <p className="mt-1 text-sm font-semibold text-slate-200">
              ابدأ من أهم عميل وسجل نتيجة كل متابعة بسرعة، مع ترتيب تلقائي حسب الخطورة والأولوية.
            </p>
            {dashboardBranch && <p className="mt-2 text-xs font-bold text-cyan-200">عرض مرتبط من لوحة القيادة · الفرع: {dashboardBranch}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setQuickFollowupOpen(true)} className="btn-primary flex items-center gap-2">
              <Plus size={16} /> إنشاء متابعة
            </button>
            <button onClick={() => void load(true)} disabled={refreshing} className="btn-secondary flex items-center gap-2">
              <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> تحديث ذكي
            </button>
            <button onClick={exportAuditDisplayed} className="btn-secondary flex items-center gap-2">
              <Download size={16} /> تصدير CSV
            </button>
            <button onClick={() => setActiveTab('scripts')} className="btn-secondary flex items-center gap-2">
              <MessageSquare size={16} /> قوالب الردود
            </button>
            <a href="/customer-data-review" className="btn-secondary flex items-center gap-2">
              <ShieldAlert size={16} /> مراجعة البيانات
            </a>
            <button onClick={generateToday} disabled={generating} className="btn-secondary flex items-center gap-2">
              <Sparkles size={16} /> {generating ? 'جاري الإنشاء...' : 'مقترحات ذكية'}
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-9">
        <StatCard label="مفتوح الآن" value={operationsCounts.open} tone="cyan" active={operationsFilter === 'all'} onClick={() => setOperationsFilter('all')} />
        <StatCard label="متأخر" value={operationsCounts.overdue} tone="rose" active={operationsFilter === 'overdue'} onClick={() => setOperationsFilter('overdue')} />
        <StatCard label="عاجل" value={operationsCounts.urgent} tone="rose" active={operationsFilter === 'priority'} onClick={() => setOperationsFilter('priority')} />
        <StatCard label="يحتاج مدير" value={operationsCounts.needsManager} tone="rose" active={operationsFilter === 'manager'} onClick={() => setOperationsFilter('manager')} />
        <StatCard label="بدون كود" value={operationsCounts.noCode} tone="amber" active={operationsFilter === 'noCode'} onClick={() => setOperationsFilter('noCode')} />
        <StatCard label="فرع غير مؤكد" value={operationsCounts.branchUncertain} tone="amber" active={operationsFilter === 'branchReview'} onClick={() => setOperationsFilter('branchReview')} />
        <StatCard label="مكتمل اليوم" value={operationsCounts.completedToday} tone="emerald" active={operationsFilter === 'completed'} onClick={() => setOperationsFilter('completed')} />
        <StatCard label="مقترحات ذكية" value={operationsCounts.smartSuggestions} tone="cyan" onClick={() => setActiveTab('important-customers')} />
        <StatCard label="مبيعات بعد المتابعة" value={money(operationsCounts.purchaseAfterAmount)} tone="emerald" active={metricFilter === 'recovered'} onClick={() => applyMetricFilter('recovered')} />
      </section>

      <section className="rounded-3xl border border-cyan-400/30 bg-slate-950/45 p-4 shadow-xl">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <span className="inline-flex rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1 text-xs font-black text-cyan-100">
              Customer Service Operations V6
            </span>
            <h2 className="mt-2 text-xl font-black text-white">تدقيق وتشغيل خدمة العملاء V6</h2>
            <p className="mt-1 text-xs font-semibold text-slate-400">
              التحليل مبني على نفس بيانات المتابعات المحملة من fetchCustomerServiceFollowups، بدون بيانات وهمية أو localStorage.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" onClick={exportAuditDisplayed}>
              تصدير المعروض CSV
            </button>
            <button type="button" className="btn-primary" onClick={exportAuditFull}>
              تصدير التحليل الكامل CSV
            </button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-6">
          {([
            ['today', auditCounts.today, 'cyan'],
            ['completed', auditCounts.completed, 'emerald'],
            ['notStarted', auditCounts.notStarted, 'cyan'],
            ['notStartedOverdue', auditCounts.notStartedOverdue, 'rose'],
            ['overdue', auditCounts.overdue, 'rose'],
            ['noAnswer', auditCounts.noAnswer, 'amber'],
            ['postponed', auditCounts.postponed, 'cyan'],
            ['needsManager', auditCounts.needsManager, 'rose'],
            ['invalidPhone', auditCounts.invalidPhone, 'amber'],
            ['recovered', auditCounts.recovered, 'emerald'],
            ['purchaseAfter', money(auditCounts.purchaseAfter), 'emerald'],
            ['contactedNoPurchase', auditCounts.contactedNoPurchase, 'amber'],
            ['dataQuality', auditCounts.dataQuality, 'rose'],
          ] as Array<[AuditFilter, string | number, 'cyan' | 'emerald' | 'amber' | 'rose']>).map(([id, value, tone]) => (
            <StatCard
              key={id}
              label={AUDIT_FILTER_LABELS[id]}
              value={value}
              tone={tone}
              active={auditFilter === id}
              onClick={() => setAuditFilter(id)}
            />
          ))}
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MiniMetric label="نسبة الإنجاز" value={`${auditAnalysis.completionRate}%`} />
          <MiniMetric label="نسبة المتأخر" value={`${auditAnalysis.overdueRate}%`} />
          <MiniMetric label="نسبة عدم الرد" value={`${auditAnalysis.noAnswerRate}%`} />
          <MiniMetric label="معدل الاسترجاع" value={`${auditAnalysis.recoveryRate}%`} />
          <MiniMetric label="قيمة الشراء بعد المتابعة" value={money(auditAnalysis.purchaseAfterAmount)} />
          <MiniMetric label="أفضل مسؤول خدمة عملاء" value={auditAnalysis.bestOwner} />
          <MiniMetric label="أفضل فرع حسب الاسترجاع" value={auditAnalysis.bestBranch} />
          <MiniMetric label="مشاكل جودة البيانات" value={auditAnalysis.dataQualityIssues} />
        </div>

        {auditAnalysis.warnings.length > 0 && (
          <div className="mt-4 rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-sm font-bold text-red-50">
            <div className="mb-2 flex items-center gap-2 text-base font-black">
              <AlertTriangle className="h-5 w-5" /> تنبيه تشغيلي عاجل
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {auditAnalysis.warnings.map((warning) => (
                <button
                  key={warning}
                  type="button"
                  className="rounded-xl border border-red-300/30 bg-slate-950/30 px-3 py-2 text-right hover:bg-red-500/15"
                  onClick={() => setAuditFilter(warning.includes('لم يبدأ') ? 'notStartedOverdue' : warning.includes('أرقام') ? 'invalidPhone' : 'overdue')}
                >
                  {warning}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-900/55 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-black text-white">فلاتر تشغيل خدمة العملاء</div>
              <div className="text-xs font-semibold text-slate-400">كل الكروت والجدول والتصدير تعتمد على نفس الفلاتر الحالية.</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {auditUiFiltersActive && <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-xs font-black text-amber-100">الأرقام متأثرة بالفلاتر الحالية</span>}
              <button type="button" className="btn-secondary text-xs" onClick={resetAuditUiFilters}>إعادة ضبط الفلاتر</button>
              <button type="button" className="btn-secondary text-xs" onClick={() => setAuditFilter('today')}>مسح كارت التصنيف</button>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <input className="input-dark" placeholder="بحث بالاسم / الكود / الرقم" value={auditSearch} onChange={(event) => setAuditSearch(event.target.value)} />
            <select className="input-dark" value={auditBranchFilter} onChange={(event) => setAuditBranchFilter(event.target.value)}>
              {auditBranchOptions.map((item) => <option key={item} value={item}>{item === ALL_FILTER ? 'كل الفروع' : item}</option>)}
            </select>
            <select className="input-dark" value={auditOwnerFilter} onChange={(event) => setAuditOwnerFilter(event.target.value)}>
              {auditOwnerOptions.map((item) => <option key={item} value={item}>{item === ALL_FILTER ? 'كل مسؤولي خدمة العملاء' : item}</option>)}
            </select>
            <select className="input-dark" value={auditStatusFilter} onChange={(event) => setAuditStatusFilter(event.target.value)}>
              {AUDIT_STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select className="input-dark" value={auditPriorityFilter} onChange={(event) => setAuditPriorityFilter(event.target.value)}>
              {AUDIT_PRIORITY_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select className="input-dark" value={auditResultFilter} onChange={(event) => setAuditResultFilter(event.target.value)}>
              {auditResultOptions.map((item) => <option key={item} value={item}>{item === ALL_FILTER ? 'كل نتائج المتابعة' : item}</option>)}
            </select>
            <select className="input-dark" value={auditCategoryFilter} onChange={(event) => setAuditCategoryFilter(event.target.value)}>
              {auditCategoryOptions.map((item) => <option key={item} value={item}>{item === ALL_FILTER ? 'كل تصنيفات العملاء' : item}</option>)}
            </select>
            <select className="input-dark" value={auditPhoneFilter} onChange={(event) => setAuditPhoneFilter(event.target.value)}>
              {AUDIT_PHONE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select className="input-dark" value={auditRecoveredFilter} onChange={(event) => setAuditRecoveredFilter(event.target.value)}>
              {AUDIT_RECOVERY_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <input className="input-dark" type="date" value={auditFromDate} onChange={(event) => setAuditFromDate(event.target.value)} aria-label="تاريخ المتابعة من" />
            <input className="input-dark" type="date" value={auditToDate} onChange={(event) => setAuditToDate(event.target.value)} aria-label="تاريخ المتابعة إلى" />
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-700 bg-slate-950/40">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3 text-sm font-bold text-slate-200">
            <span>تفاصيل: {AUDIT_FILTER_LABELS[auditFilter]} · يعرض {auditVisibleRows.length} من {auditFilteredRows.length} متابعة</span>
            <span className="text-xs text-slate-400">مرتب تلقائيًا حسب الأولوية التشغيلية. {auditUiFiltersActive ? 'الأرقام متأثرة بالفلاتر الحالية.' : 'لا توجد فلاتر إضافية مطبقة.'}</span>
          </div>
          <div className="max-h-[420px] overflow-auto">
            <table className="min-w-[1100px] w-full text-right text-xs">
              <thead className="sticky top-0 bg-slate-900 text-slate-300">
                <tr>
                  <th className="px-3 py-2">العميل</th>
                  <th className="px-3 py-2">الكود</th>
                  <th className="px-3 py-2">الهاتف</th>
                  <th className="px-3 py-2">الفرع</th>
                  <th className="px-3 py-2">الحالة/النتيجة</th>
                  <th className="px-3 py-2">المسؤول</th>
                  <th className="px-3 py-2">آخر شراء</th>
                  <th className="px-3 py-2">مبيعات بعد المتابعة</th>
                  <th className="px-3 py-2">المتابعة القادمة</th>
                  <th className="px-3 py-2">الأولوية</th>
                  <th className="px-3 py-2">درجة الأولوية</th>
                  <th className="px-3 py-2">مشاكل البيانات</th>
                  <th className="px-3 py-2">سبب التصنيف</th>
                </tr>
              </thead>
              <tbody>
                {auditVisibleRows.map((row, index) => (
                  <tr key={`${row.customer_code || 'no-code'}-${row.normalized_phone}-${index}`} className="border-t border-slate-800 text-slate-200">
                    <td className="px-3 py-2 font-bold text-white">{row.customer_name}</td>
                    <td className="px-3 py-2">{row.customer_code || 'بدون كود'}</td>
                    <td className="px-3 py-2">{row.phone || row.mobile || '—'}</td>
                    <td className="px-3 py-2">{row.branch || '—'}</td>
                    <td className="px-3 py-2">{row.followup_status} · {row.followup_result}</td>
                    <td className="px-3 py-2">{row.assigned_to_name || row.assigned_to || '—'}</td>
                    <td className="px-3 py-2">{row.last_invoice_date || '—'}</td>
                    <td className="px-3 py-2 font-black text-emerald-200">{money(row.sales_after_followup)}</td>
                    <td className="px-3 py-2">{row.next_followup_date || '—'}</td>
                    <td className="px-3 py-2 font-black text-amber-100">{row.priority_label}</td>
                    <td className="px-3 py-2 font-black text-amber-200">{row.priority_score}</td>
                    <td className="px-3 py-2 text-rose-100">{row.data_quality_issues || '—'}</td>
                    <td className="px-3 py-2 text-cyan-100">{row.audit_reason}</td>
                  </tr>
                ))}
                {auditFilteredRows.length === 0 && (
                  <tr>
                    <td colSpan={13} className="px-3 py-8 text-center font-bold text-slate-400">
                      لا توجد عملاء داخل هذا التصنيف حاليًا.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {auditFilteredRows.length > auditVisibleRows.length && (
            <div className="border-t border-slate-800 p-3 text-center">
              <button type="button" className="btn-secondary" onClick={() => setAuditRowsLimit((value) => value + 120)}>
                عرض المزيد · متبقي {auditFilteredRows.length - auditVisibleRows.length}
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 2xl:grid-cols-10">
        <StatCard label="متابعات اليوم" value={stats.totalToday} tone="cyan" active={metricFilter === 'today'} onClick={() => applyMetricFilter('today')} />
        <StatCard label="المكتمل" value={stats.completed} tone="emerald" active={metricFilter === 'completed'} onClick={() => applyMetricFilter('completed')} />
        <StatCard label="لم يرد" value={stats.noAnswer} tone="amber" active={metricFilter === 'noAnswer'} onClick={() => applyMetricFilter('noAnswer')} />
        <StatCard label="مؤجل" value={rows.filter((row) => Boolean(row.postponed_until) || statusOf(row).includes('مؤجل')).length} tone="cyan" active={metricFilter === 'postponed'} onClick={() => applyMetricFilter('postponed')} />
        <StatCard label="يحتاج مدير" value={rows.filter((row) => row.needs_manager || statusOf(row).includes('مدير')).length} tone="rose" active={metricFilter === 'needsManager'} onClick={() => applyMetricFilter('needsManager')} />
        <StatCard label="متأخر" value={stats.overdue} tone="rose" active={metricFilter === 'overdue'} onClick={() => applyMetricFilter('overdue')} />
        <StatCard label="بدون رقم صحيح" value={invalidPhoneCount} tone="amber" active={metricFilter === 'invalidPhone'} onClick={() => applyMetricFilter('invalidPhone')} />
        <StatCard label="قيمة الشراء بعد المتابعة" value={money(stats.purchaseAfterAmount)} tone="emerald" active={metricFilter === 'recovered'} onClick={() => applyMetricFilter('recovered')} />
        <StatCard label="عملاء تم استرجاعهم" value={recoveredCount} tone="emerald" active={metricFilter === 'recovered'} onClick={() => applyMetricFilter('recovered')} />
        <StatCard label="لم يبدأ التواصل" value={notStartedCount} tone="cyan" active={metricFilter === 'notStarted'} onClick={() => applyMetricFilter('notStarted')} />
        <StatCard label="تواصل ولم يشترِ" value={contactedNoPurchaseCount} tone="amber" active={metricFilter === 'contactedNoPurchase'} onClick={() => applyMetricFilter('contactedNoPurchase')} />
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
            <select value={branch} onChange={(e) => setBranch(e.target.value)} disabled={!serviceCanAllBranches} className="input-dark">
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
            <div className="mt-1 truncate text-slate-200">{serviceCanAllBranches ? 'كل الفروع' : text(serviceBranchOverride || userBranch, 'فرع المستخدم')}</div>
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
          {OPERATIONS_TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setOperationsFilter(id)}
              className={
                operationsFilter === id
                  ? 'shrink-0 rounded-full border border-emerald-300 bg-emerald-500/15 px-3 py-1.5 text-xs font-black text-emerald-100'
                  : 'shrink-0 rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1.5 text-xs font-bold text-slate-300 hover:border-emerald-300/40'
              }
            >
              {label}
            </button>
          ))}
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

      {(insightsLoading || insightsError || insights.warnings.length > 0) && (
        <div className="rounded-2xl border border-cyan-500/25 bg-cyan-500/10 p-4 text-sm font-bold text-cyan-50">
          {insightsLoading ? 'جاري تحميل القوائم التحليلية للعملاء...' : insightsError || insights.warnings.join(' · ')}
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
            {branchOwnerPerformance.map((row) => (
              <div key={`${row.responsible}-${row.branch}`} className="rounded-2xl border border-slate-700 bg-slate-950/50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-black text-white">{row.responsible}</div>
                    <div className="text-xs text-slate-400">مسؤولة خدمة العملاء · {row.branch}</div>
                  </div>
                  <span className="rounded-full border border-teal-400/30 bg-teal-500/10 px-2 py-1 text-xs font-black text-teal-100">
                    إنجاز {row.completionRate}%
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-300 sm:grid-cols-4">
                  <span>المسند: <b className="text-white">{row.assigned}</b></span>
                  <span>المكتمل: <b className="text-white">{row.completed}</b></span>
                  <span>مسترجع: <b className="text-white">{row.recoveredCustomers}</b></span>
                  <span>مبيعات: <b className="text-white">{money(row.purchaseAfterAmount)}</b></span>
                </div>
              </div>
            ))}
            {!branchOwnerPerformance.length && <EmptyState message="لا توجد بيانات كافية لحساب أداء مسؤولات الفروع." />}
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

          {activeTab === 'hidden' ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-black text-white">المتابعات المخفية</h3>
                  <p className="text-xs text-slate-400">سجل آمن لا يحذف البيانات، مع سبب الإخفاء والمنفذ وإمكانية الاستعادة.</p>
                </div>
                <button className="btn-secondary" onClick={() => void loadHiddenFollowups()} disabled={hiddenLoading}>
                  <RefreshCw className={`ml-1 inline h-4 w-4 ${hiddenLoading ? 'animate-spin' : ''}`} /> تحديث
                </button>
              </div>
              {!canHideFollowups ? (
                <EmptyState message="هذه الصفحة متاحة للمدير المسؤول فقط." />
              ) : hiddenRows.length ? (
                <div className="grid gap-3 xl:grid-cols-2">
                  {hiddenRows.map((row) => (
                    <article key={row.id} className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <h4 className="font-black text-white">{customerName(row)}</h4>
                          <p className="mt-1 text-xs text-slate-400">{getCustomerCodeSafe(row) || 'بدون كود'} · {row.branch || 'بدون فرع'}</p>
                        </div>
                        <span className="rounded-full border border-amber-400/30 px-2 py-1 text-xs font-black text-amber-100">مخفية</span>
                      </div>
                      <div className="mt-3 grid gap-2 text-sm text-slate-300">
                        <InfoRow label="سبب الإخفاء" value={row.hidden_reason || 'غير مسجل'} />
                        <InfoRow label="تم بواسطة" value={row.hidden_by || 'غير محدد'} />
                        <InfoRow label="وقت الإخفاء" value={formatDateTime(row.hidden_at)} />
                        <InfoRow label="سبب المتابعة الأصلي" value={row.followup_reason || row.request_details || 'غير محدد'} />
                      </div>
                      <button className="btn-primary mt-4 w-full" onClick={() => void restoreFollowup(row)}>استعادة المتابعة</button>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState message={hiddenLoading ? 'جاري تحميل المتابعات المخفية...' : 'لا توجد متابعات مخفية في النطاق الحالي.'} />
              )}
            </div>
          ) : cardsTabs.includes(activeTab) ? (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-300">
                <span>يتم عرض {visibleRows.length} من {operationRows.length} متابعة مرتبة حسب الأولوية والتشغيل.</span>
                {refreshing && <span className="text-cyan-300">تحديث...</span>}
              </div>
              <div className="grid gap-3 2xl:grid-cols-2">
                {visibleRows.map((row) =>
                  activeTab === 'history' ? (
                    <HistoryFollowupCard key={row.id} row={row} onSelect={() => setSelectedRow(row)} />
                  ) : (
                    <FollowupCard
                      key={row.id}
                      row={row}
                      selected={selectedRow?.id === row.id}
                      onSelect={() => setSelectedRow(row)}
                      onDetails={() => setDetailsRow(enrichRow(row))}
                      onResult={() => setResultRow(row)}
                      onCopy={() => void copyScript(row)}
                      onPostpone={() => void postpone(row)}
                      onManager={() => void escalateToManager(row)}
                      onQuickReply={() => setQuickReplyRow(row)}
                      onStrongFollowup={() => convertToStrongFollowup(row)}
                      onApproveBranch={() => void approveBranchCorrection(row)}
                    />
                  )
                )}
              </div>
              {!visibleRows.length && (
                <EmptyState
                  message="لا توجد متابعات مطابقة للفلاتر الحالية. امسح الفلاتر أو أنشئ متابعة جديدة أو افتح قاعدة العملاء."
                  onReset={() => {
                    setSearchInput('');
                    setQuickFilter('all');
                    setOperationsFilter('priority');
                    setMetricFilter('all');
                    setAssignedFilter(ALL_FILTER);
                    setStatus(ALL_FILTER);
                  }}
                  onCreate={() => setQuickFollowupOpen(true)}
                  onCustomers={() => { window.location.href = '/customers'; }}
                />
              )}
              {visibleCount < operationRows.length && (
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
                    <h3 className="text-2xl font-black text-white">{customerName(detailRow)}</h3>
                    <p className="mt-1 text-xs font-bold text-slate-400">{getCustomerCodeSafe(detailRow) || phoneOf(detailRow) || 'بدون كود'}</p>
                  </div>
                  <span className={`rounded-full border px-3 py-1 text-xs font-black ${statusTone(detailRow)}`}>{statusOf(detailRow)}</span>
                </div>
                <div className="mt-4 grid gap-2 text-sm text-slate-300 sm:grid-cols-2 2xl:grid-cols-1">
                  <InfoRow label="الهاتف" value={phoneOf(detailRow) || 'بدون رقم صحيح'} />
                  <InfoRow label="الفرع" value={resolveCustomerBranch(detailRow).branch} />
                  <InfoRow label="الحالة" value={customerStatusOf(detailRow)} />
                  <InfoRow label="التصنيف" value={segmentOf(detailRow)} />
                  <InfoRow label="درجة الخطورة" value={riskLevel(detailRow)} />
                  <InfoRow label="آخر شراء" value={formatDate(lastPurchaseOf(detailRow))} />
                  <InfoRow label="متوسط شهري" value={money(avgMonthly(detailRow))} />
                  <InfoRow label="إجمالي مشتريات" value={money(totalSpent(detailRow))} />
                  <InfoRow label="المسؤول" value={responsibleOf(detailRow)} />
                </div>
                <CustomerFlagsBadges customerFlags={detailRow.customer_flags || {}} />
                <CustomerFlagChips row={detailRow} className="mt-3" />
                {resolveSuggestedBranchFromInvoiceMetrics(detailRow.customer_metrics) &&
                  detailRow.branch !== resolveSuggestedBranchFromInvoiceMetrics(detailRow.customer_metrics) && (
                    <div className="mt-3 rounded-2xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm leading-6 text-amber-50">
                      الفرع المسجل: {text(detailRow.branch)} — المقترح من الفواتير:{' '}
                      {resolveSuggestedBranchFromInvoiceMetrics(detailRow.customer_metrics)}
                      <button type="button" className="btn-secondary mt-2 w-full text-xs" onClick={() => void approveBranchCorrection(detailRow)}>
                        اعتماد التصحيح
                      </button>
                    </div>
                  )}
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

              {(detailRow.internal_rating || detailRow.no_purchase_reason || detailRow.cross_sell_offered || detailRow.up_sell_offered) && (
                <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4">
                  <h4 className="mb-3 font-black text-cyan-100">آخر تقييم داخلي</h4>
                  <div className="grid gap-2 text-sm text-slate-200">
                    <InfoRow label="جودة التواصل" value={detailRow.internal_rating ? `${detailRow.internal_rating}/5` : 'غير محدد'} />
                    <InfoRow label="رضا العميل" value={detailRow.customer_satisfaction || 'غير محدد'} />
                    <InfoRow label="فهم الاحتياج" value={detailRow.need_understood == null ? 'غير محدد' : detailRow.need_understood ? 'نعم' : 'لا'} />
                    <InfoRow label="Cross Sell / Up Sell" value={`${detailRow.cross_sell_offered ? 'نعم' : 'لا'} / ${detailRow.up_sell_offered ? 'نعم' : 'لا'}`} />
                    <InfoRow label="سبب عدم الشراء" value={detailRow.no_purchase_reason || 'غير محدد'} />
                  </div>
                  {detailRow.doctor_internal_note && (
                    <p className="mt-3 rounded-xl bg-slate-950/40 p-3 text-sm leading-7 text-slate-200">
                      {detailRow.doctor_internal_note}
                    </p>
                  )}
                </div>
              )}

              <div className="rounded-2xl border border-slate-700 bg-slate-950/40 p-4">
                <h4 className="mb-2 font-black text-white">ملاحظات قبل التواصل</h4>
                <p className="text-sm leading-7 text-slate-300">
                  {selectedRow.handling_notes || selectedRow.service_notes || selectedRow.whatsapp_notes || selectedRow.customer_notes || selectedRow.notes || 'لا توجد ملاحظات مسجلة.'}
                </p>
              </div>

              <div className="grid gap-2 sm:grid-cols-3 2xl:grid-cols-2">
                <button className="btn-primary" onClick={() => setResultRow(selectedRow)}><CheckCircle2 className="ml-1 inline h-4 w-4" /> تسجيل نتيجة</button>
                <button className="btn-secondary" onClick={() => setDetailsRow(detailRow)}><Eye className="ml-1 inline h-4 w-4" /> ملف العميل</button>
                <button className="btn-secondary" onClick={() => void copyScript(selectedRow)}><Clipboard className="ml-1 inline h-4 w-4" /> نسخ السكريبت</button>
                <button className="btn-secondary" onClick={() => setQuickReplyRow(detailRow)}><MessageSquare className="ml-1 inline h-4 w-4" /> اختيار رد سريع</button>
                <a
                  className={`btn-secondary text-center ${hasValidPhone(selectedRow) ? '' : 'pointer-events-none opacity-40'}`}
                  href={hasValidPhone(selectedRow) ? generateWhatsAppLink(phoneOf(selectedRow), waMessageFor(selectedRow)) : undefined}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MessageSquare className="ml-1 inline h-4 w-4" /> واتساب
                </a>
                <a className="btn-secondary text-center" href={hasValidPhone(selectedRow) ? `tel:${phoneOf(selectedRow)}` : undefined}>
                  <PhoneCall className="ml-1 inline h-4 w-4" /> اتصال
                </a>
                <a className="btn-primary text-center" href={customer360Url(selectedRow)}>
                  <Eye className="ml-1 inline h-4 w-4" /> ملف 360
                </a>
                <button className="btn-secondary" onClick={() => void postpone(selectedRow)}><CalendarClock className="ml-1 inline h-4 w-4" /> تأجيل</button>
                <button className="btn-secondary" onClick={() => void addQuickNote(selectedRow)}><Clipboard className="ml-1 inline h-4 w-4" /> إضافة ملاحظة</button>
                <button className="btn-secondary" onClick={() => void escalateToManager(selectedRow)}><ShieldAlert className="ml-1 inline h-4 w-4" /> يحتاج مدير</button>
                {canHideFollowups && (
                  <button className="btn-secondary border-amber-500/40 text-amber-100" onClick={() => void hideFollowup(selectedRow)}>
                    <Eye className="ml-1 inline h-4 w-4" /> إخفاء المتابعة
                  </button>
                )}
              </div>
            </div>
          )}
        </aside>
      </section>

      {resultRow && (
        <LazyState>
          <FollowupResultModal
            followup={asDailyFollowup(resultRow)}
            mode={requestedMode === 'edit' ? 'edit' : 'create'}
            onClose={() => {
              setResultRow(null);
              clearModalQueryParams();
            }}
            onSave={saveResult}
          />
        </LazyState>
      )}
      {detailsRow && (
        <LazyState>
          <CustomerQuickDetailsModal
            followupId={detailsRow.id}
            customerId={detailsRow.customer_id}
            customerCode={getCustomerCodeSafe(detailsRow)}
            customerPhone={phoneOf(detailsRow)}
            customerName={customerName(detailsRow)}
            branch={detailsRow.branch}
            fallbackMetric={modalFallbackFrom(detailsRow)}
            onEditFollowup={() => setResultRow(detailsRow)}
            onClose={closeCustomerDetails}
          />
        </LazyState>
      )}
      {quickReplyRow && (
        <QuickReplyPickerModal
          row={quickReplyRow}
          scripts={quickReplies}
          useCustomerName={useCustomerNameInReply}
          onUseCustomerNameChange={setUseCustomerNameInReply}
          renderMessage={(script) => renderReplyForRow(script, quickReplyRow)}
          onCopy={(script) => void useQuickReply(script, quickReplyRow)}
          onWhatsapp={(script) => void useQuickReply(script, quickReplyRow, true)}
          onClose={() => setQuickReplyRow(null)}
        />
      )}
      <QuickFollowupModal
        open={quickFollowupOpen}
        onClose={closeQuickFollowup}
        onCreated={() => {
          void load(true);
          setActiveTab('requests');
        }}
      />
    </div>
  );
}

function QuickReplyPickerModal({
  row,
  scripts,
  useCustomerName,
  onUseCustomerNameChange,
  renderMessage,
  onCopy,
  onWhatsapp,
  onClose,
}: {
  row: FollowupRow;
  scripts: QuickReplyScript[];
  useCustomerName: boolean;
  onUseCustomerNameChange: (value: boolean) => void;
  renderMessage: (script: QuickReplyScript) => string;
  onCopy: (script: QuickReplyScript) => void;
  onWhatsapp: (script: QuickReplyScript) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = scripts
    .filter((script) => script.active !== false)
    .filter((script) =>
      !q ||
      [script.shortcut, script.title, script.category, script.script_type, script.message_body, ...(script.tags || [])]
        .join(' ')
        .toLowerCase()
        .includes(q)
    );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" dir="rtl">
      <div className="max-h-[88vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-white">اختيار رد سريع</h2>
            <p className="mt-1 text-sm text-slate-400">{customerName(row)} · {phoneOf(row) || 'بدون رقم'}</p>
          </div>
          <button className="btn-secondary px-3 py-2 text-sm" onClick={onClose}>إغلاق</button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
          <input
            className="input-dark"
            placeholder="ابحث بالاختصار مثل /برد أو العنوان أو النوع"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <label className="flex items-center gap-2 rounded-2xl border border-slate-700 px-4 py-2 text-sm text-slate-200">
            <input type="checkbox" checked={useCustomerName} onChange={(event) => onUseCustomerNameChange(event.target.checked)} />
            استخدام اسم العميل
          </label>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {filtered.map((script) => {
            const message = renderMessage(script);
            return (
              <article key={script.id} className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-black text-white">{script.shortcut} · {script.title}</h3>
                    <p className="mt-1 text-xs text-slate-400">{script.category} · {script.script_type} · استخدام {script.usage_count || 0}</p>
                  </div>
                </div>
                <p className="mt-3 whitespace-pre-line rounded-xl bg-slate-950/70 p-3 text-sm leading-7 text-slate-200">{message}</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <button className="btn-secondary text-xs" onClick={() => onCopy(script)}>
                    <Clipboard className="ml-1 inline h-3.5 w-3.5" /> نسخ الرد
                  </button>
                  <button className="btn-primary text-xs" onClick={() => onWhatsapp(script)} disabled={!hasValidPhone(row)}>
                    <MessageSquare className="ml-1 inline h-3.5 w-3.5" /> استخدام في واتساب
                  </button>
                </div>
              </article>
            );
          })}
        </div>
        {!filtered.length && <EmptyState message="لا توجد ردود سريعة مطابقة." />}
      </div>
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
  if (tab === 'impact') {
    const completed = rows.filter((row) => isHistoryCompleted(row));
    const recovered = completed.filter((row) => row.purchase_after_followup);
    const amount = recovered.reduce((sum, row) => sum + Number(row.purchase_amount || 0), 0);
    const avgDays = recovered.length
      ? Math.round(
          recovered.reduce((sum, row) => {
            const start = new Date(row.created_at || row.followup_date || row.date || '').getTime();
            const end = new Date(row.purchase_date || row.completed_at || row.updated_at || '').getTime();
            return sum + (Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, (end - start) / 86400000) : 0);
          }, 0) / recovered.length
        )
      : 0;
    return (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MiniMetric label="إجمالي المتابعات" value={rows.length} />
        <MiniMetric label="اشتروا بعد المتابعة" value={recovered.length} />
        <MiniMetric label="معدل التحويل" value={rows.length ? `${Math.round((recovered.length / rows.length) * 100)}%` : '0%'} />
        <MiniMetric label="قيمة المبيعات بعد المتابعة" value={money(amount)} />
        <MiniMetric label="متوسط أيام التحويل" value={avgDays ? `${avgDays} يوم` : 'غير متاح'} />
      </div>
    );
  }
  if (tab === 'owners-performance') {
    return <TeamPerformanceAnalytics followups={rows.map(asDailyFollowup)} staff={staff as any} />;
  }
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
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <ScriptCard title="متابعة عادية" body="أهلا بحضرتك، مع حضرتك صيدليات دواء. بنطمن على حضرتك ونتأكد إن احتياجاتك متوفرة. نتشرف بخدمة حضرتك دائمًا." />
        <ScriptCard title="عميل متوقف" body="أهلا بحضرتك، مع حضرتك صيدليات دواء. بنطمن على حضرتك ونتأكد إن كل احتياجاتك متوفرة. لو في أي ملاحظة أو طلب، نجهزه لحضرتك فورًا." />
        <ScriptCard title="عميل مهم جدًا" body="أهلا بحضرتك، مع حضرتك صيدليات دواء. حضرتك من عملائنا المميزين، وبنطمن على احتياجاتك الشهرية. تحت أمر حضرتك في أي وقت." />
        <ScriptCard title="بدون رقم صحيح" body="راجع بيانات التواصل من ملف العميل أو سجل الفرع قبل الإرسال. لا ترسل واتساب لرقم غير مؤكد." />
        <ScriptCard title="يحتاج تدخل سريع" body="أهلا بحضرتك، مع حضرتك صيدليات دواء. بنتابع مع حضرتك بخصوص طلبكم، وهنراجع التفاصيل فورًا ونرد عليكم في أقرب وقت." />
        <ScriptCard title="اعتذار عن مشكلة" body="أهلا بحضرتك، مع حضرتك صيدليات دواء. بنعتذر عن أي إزعاج سابق، وبنتابع مع حضرتك لحل الملاحظة وضمان رضاك." />
        <ScriptCard title="عرض مناسب بدون ضغط" body="أهلا بحضرتك، مع حضرتك صيدليات دواء. لو حضرتك محتاج أي أصناف، نقدر نجهزها أو نوفر بديل مناسب بدون أي التزام." />
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
              الكود: {getCustomerCodeSafe(selectedRow) || 'بدون كود'} · الهاتف: {phoneOf(selectedRow) || 'بدون رقم'} · الفرع: {resolveCustomerBranch(selectedRow).branch}
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

function HistoryFollowupCard({ row, onSelect }: { row: FollowupRow; onSelect: () => void }) {
  const resolvedBranch = resolveCustomerBranch(row);
  return (
    <article
      onClick={onSelect}
      className="cursor-pointer rounded-3xl border border-emerald-500/25 bg-emerald-500/5 p-5 transition hover:border-emerald-400/40 hover:bg-emerald-500/10"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-black text-white">{customerName(row)}</h3>
          <div className="mt-2 flex flex-wrap gap-2 text-sm text-slate-300">
            <span>كود: {getCustomerCodeSafe(row) || 'بدون كود'}</span>
            <span>·</span>
            <span>{phoneOf(row) || 'بدون رقم'}</span>
            <span>·</span>
            <span>{resolvedBranch.branch}</span>
          </div>
          <CustomerFlagChips row={row} className="mt-2" />
        </div>
        <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs font-black text-emerald-100">
          {followupResultLabel(row)}
        </span>
      </div>
      <div className="mt-4 grid gap-2 text-sm text-slate-200 sm:grid-cols-2">
        <InfoRow label="مسؤول خدمة العملاء" value={branchServiceOwner(row)} />
        <InfoRow label="تاريخ المتابعة" value={formatDateTime(followupHistoryDate(row))} />
        <InfoRow label="شراء بعد المتابعة" value={row.purchase_after_followup ? 'نعم' : 'لا'} />
        <InfoRow label="قيمة الشراء" value={row.purchase_after_followup ? money(row.purchase_amount) : '—'} />
      </div>
      {(row.followup_notes || row.notes) && (
        <p className="mt-3 rounded-2xl border border-slate-700/70 bg-slate-900/70 p-3 text-sm leading-6 text-slate-300">
          {row.followup_notes || row.notes}
        </p>
      )}
      <div className="mt-4">
        <a className="btn-primary inline-flex px-4 py-2 text-xs" href={customer360Url(row)} onClick={(event) => event.stopPropagation()}>
          <Eye className="ml-1 inline h-3.5 w-3.5" /> عرض ملف العميل 360
        </a>
      </div>
    </article>
  );
}

function FollowupCard({ row, selected, onSelect, onDetails, onResult, onCopy, onPostpone, onManager, onQuickReply, onStrongFollowup, onApproveBranch }: {
  row: FollowupRow;
  selected: boolean;
  onSelect: () => void;
  onDetails: () => void;
  onResult: () => void;
  onCopy: () => void;
  onPostpone: () => void;
  onManager: () => void;
  onQuickReply?: () => void;
  onStrongFollowup?: () => void;
  onApproveBranch?: () => void;
}) {
  const phone = phoneOf(row);
  const validPhone = hasValidPhone(row);
  const waLink = validPhone ? generateWhatsAppLink(phone, waMessageFor(row)) : '';
  const score = priorityScore(row);
  const note = preContactNote(row);
  const code = getCustomerCodeSafe(row);
  const resolvedBranch = resolveCustomerBranch(row);
  const suggestedBranch = resolveSuggestedBranchFromInvoiceMetrics(row.customer_metrics);
  const hasBranchMismatch = Boolean(suggestedBranch && row.branch && suggestedBranch !== row.branch);
  return (
    <article
      onClick={onSelect}
      className={`cursor-pointer rounded-3xl border p-5 transition ${selected ? 'border-teal-400 bg-teal-500/15 shadow-lg shadow-teal-950/25' : 'border-slate-600/80 bg-[#0f172a]/90 hover:border-teal-500/40 hover:bg-slate-900/90'}`}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-xl font-black text-white" title={customerName(row)}>{customerName(row)}</h3>
          <div className="mt-2 flex flex-wrap gap-2 text-sm text-slate-300">
            <span className="rounded-lg bg-slate-800/80 px-2 py-1">كود: {code || 'بدون كود'}</span>
            <span className={`rounded-lg px-2 py-1 ${validPhone ? 'bg-emerald-500/15 text-emerald-100' : 'bg-amber-500/15 text-amber-100'}`}>
              {validPhone ? phone : 'بدون رقم صحيح'}
            </span>
            <span className="rounded-lg bg-slate-800/80 px-2 py-1">{resolvedBranch.branch}</span>
            {resolvedBranch.needsReview ? (
              <span className="rounded-lg border border-amber-300/40 bg-amber-500/10 px-2 py-1 text-amber-200">
                فرع غير مؤكد
              </span>
            ) : null}
          </div>
          <CustomerFlagChips row={row} className="mt-2" />
        </div>
        <div className="flex flex-col items-start gap-2 lg:items-end">
          <span className={`w-fit rounded-full border px-3 py-1 text-xs font-black ${priorityTone(row)}`}>{text(row.priority, 'مهم')}</span>
          <span className="w-fit rounded-full border border-teal-400/30 bg-teal-500/10 px-3 py-1 text-[11px] font-black text-teal-100">
            {priorityReason(row)}
          </span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <span className={`rounded-full border px-3 py-1 text-xs font-black ${statusTone(row)}`}>{statusOf(row)}</span>
        <span className="rounded-full border border-slate-500/50 bg-slate-800/80 px-3 py-1 text-xs font-bold text-slate-100">{segmentOf(row)}</span>
        <span className="rounded-full border border-slate-500/50 bg-slate-800/80 px-3 py-1 text-xs text-slate-200">حالة: {customerStatusOf(row)}</span>
        <span className="rounded-full border border-slate-500/50 bg-slate-800/80 px-3 py-1 text-xs text-slate-200">خطورة: {riskLevel(row)}</span>
        <span className={`rounded-full border px-3 py-1 text-xs text-slate-200 ${isOverdue(row) ? 'border-red-400/35 bg-red-500/10 text-red-100' : 'border-slate-500/50 bg-slate-800/80'}`}>
          التأخير: {followupDelayLabel(row)}
        </span>
        <span className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-100">
          المسؤول: {responsibleOf(row)}
        </span>
      </div>

      <div className="mt-4 grid gap-2 text-sm text-slate-200 sm:grid-cols-2 lg:grid-cols-3">
        <InfoRow label="آخر شراء" value={formatDate(lastPurchaseOf(row))} />
        <InfoRow label="متوسط شهري" value={money(avgMonthly(row))} />
        <InfoRow label="شراء الشهر الحالي" value={String(currentMonthPurchases(row))} />
        <InfoRow label="متوسط مرات الشراء" value={String(averagePurchaseCount(row))} />
        <InfoRow label="إجمالي المشتريات" value={money(totalSpent(row))} />
        <InfoRow label="مسؤول خدمة العملاء" value={branchServiceOwner(row)} />
        <InfoRow label="المتابعة القادمة" value={formatDateTime(row.next_followup_date || row.postponed_until || row.followup_datetime)} />
      </div>

      {note && (
        <p className="mt-3 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-3 text-sm leading-6 text-amber-50">
          <b className="text-amber-200">ملاحظة قبل التواصل:</b> {note}
        </p>
      )}

      <p className="mt-3 rounded-2xl border border-teal-500/20 bg-teal-500/10 p-3 text-sm leading-7 text-teal-50">
        <b className="text-teal-200">سكريبت مقترح:</b> {scriptFor(row)}
      </p>

      {hasBranchMismatch && (
        <div className="mt-3 rounded-2xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm leading-6 text-amber-50">
          <b className="text-amber-200">مراجعة الفرع:</b> الفرع المسجل: {text(row.branch)} — المقترح من الفواتير: {suggestedBranch}
          {onApproveBranch && (
            <button type="button" className="btn-secondary mt-2 w-full text-xs" onClick={onApproveBranch}>
              اعتماد التصحيح
            </button>
          )}
        </div>
      )}

      {(row.internal_rating || row.no_purchase_reason || row.cross_sell_offered || row.up_sell_offered) && (
        <div className="mt-3 grid gap-2 text-xs text-slate-200 sm:grid-cols-3">
          <InfoRow label="تقييم داخلي" value={row.internal_rating ? `${row.internal_rating}/5` : 'غير محدد'} />
          <InfoRow label="Cross / Up" value={`${row.cross_sell_offered ? 'Cross' : '—'} / ${row.up_sell_offered ? 'Up' : '—'}`} />
          <InfoRow label="سبب عدم الشراء" value={row.no_purchase_reason || 'غير محدد'} />
        </div>
      )}

      <p className="mt-3 rounded-2xl border border-slate-700/70 bg-slate-900/70 p-3 text-sm leading-6 text-slate-300">
        {row.followup_reason || row.request_details || row.suggested_action || recommendedAction(row)}
      </p>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5" onClick={(event) => event.stopPropagation()}>
        <a className="btn-primary px-3 py-2 text-center text-xs" href={customer360Url(row)}><Eye className="ml-1 inline h-3.5 w-3.5" /> ملف 360</a>
        <a className={`btn-secondary px-3 py-2 text-center text-xs ${validPhone ? '' : 'pointer-events-none opacity-40'}`} href={validPhone ? `tel:${phone}` : undefined}><PhoneCall className="ml-1 inline h-3.5 w-3.5" /> اتصال</a>
        {validPhone && waLink ? (
          <a className="btn-secondary px-3 py-2 text-center text-xs" href={waLink} target="_blank" rel="noreferrer"><MessageSquare className="ml-1 inline h-3.5 w-3.5" /> واتساب</a>
        ) : (
          <button type="button" className="btn-secondary px-3 py-2 text-xs opacity-40" disabled title="رقم غير صحيح"><MessageSquare className="ml-1 inline h-3.5 w-3.5" /> واتساب</button>
        )}
        <button className="btn-secondary px-3 py-2 text-xs" onClick={onCopy}><Clipboard className="ml-1 inline h-3.5 w-3.5" /> نسخ رسالة</button>
        <button className="btn-secondary px-3 py-2 text-xs" onClick={onQuickReply}><MessageSquare className="ml-1 inline h-3.5 w-3.5" /> اختيار رد سريع</button>
        <button className="btn-primary px-3 py-2 text-xs" onClick={onResult}><CheckCircle2 className="ml-1 inline h-3.5 w-3.5" /> تم</button>
        <button className="btn-secondary px-3 py-2 text-xs" onClick={onResult}><AlertTriangle className="ml-1 inline h-3.5 w-3.5" /> لم يرد</button>
        <button className="btn-secondary px-3 py-2 text-xs" onClick={onPostpone}><CalendarClock className="ml-1 inline h-3.5 w-3.5" /> تأجيل</button>
        <button className="btn-secondary px-3 py-2 text-xs" onClick={onManager}><UserCheck className="ml-1 inline h-3.5 w-3.5" /> يحتاج مدير</button>
        {onStrongFollowup && <button className="btn-primary px-3 py-2 text-xs" onClick={onStrongFollowup}><Sparkles className="ml-1 inline h-3.5 w-3.5" /> متابعة قوية</button>}
        <button className="btn-secondary px-3 py-2 text-xs" onClick={onDetails}><Eye className="ml-1 inline h-3.5 w-3.5" /> تفاصيل</button>
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

function EmptyState({
  message = 'لا توجد بيانات مطابقة حاليًا.',
  onReset,
  onCreate,
  onCustomers,
}: {
  message?: string;
  onReset?: () => void;
  onCreate?: () => void;
  onCustomers?: () => void;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/35 p-10 text-center text-slate-300">
      <div className="text-base font-black text-white">{message}</div>
      {(onReset || onCreate || onCustomers) && (
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {onReset && <button type="button" className="btn-secondary" onClick={onReset}>إزالة الفلاتر</button>}
          {onCreate && <button type="button" className="btn-primary" onClick={onCreate}>إنشاء متابعة</button>}
          {onCustomers && <button type="button" className="btn-secondary" onClick={onCustomers}>فتح قاعدة العملاء</button>}
        </div>
      )}
    </div>
  );
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
