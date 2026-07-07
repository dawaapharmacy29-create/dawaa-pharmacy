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
import { supabase } from '@/lib/supabase';
import { ALL_FILTER } from '@/lib/api/customers';
import { searchCustomerMetrics,
  calculateFollowupStats,
  calculateTeamPerformance,
  createExceptionalFollowup,
  fetchCustomerServiceFollowups,
  fetchCustomerServiceFollowupById,
  generateTodayFollowupsFromCustomerMetrics,
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
  return String(row.customer_code || row.customer_phone || row.phone || row.customer_id || row.customer_name || row.name || '')
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

function responsibleOf(row: FollowupRow) {
  const explicit = row.responsible_name || row.assigned_to || row.assigned_doctor;
  if (explicit) return text(explicit);
  return resolveCustomerServiceOwner(row.branch, null);
}

function branchServiceOwner(row: FollowupRow) {
  const normalized = normalizeBranchName(row.branch);
  if (normalized === 'فرع شكري' || normalized === 'شكري') {
    return CUSTOMER_SERVICE_BRANCH_OWNERS['فرع شكري'];
  }
  if (normalized === 'فرع الشامي' || normalized === 'الشامي') {
    return CUSTOMER_SERVICE_BRANCH_OWNERS['فرع الشامي'];
  }
  return resolveCustomerServiceOwner(row.branch, row.responsible_name || row.assigned_doctor);
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
    const branch = owner === CUSTOMER_SERVICE_BRANCH_OWNERS['فرع شكري'] ? 'فرع شكري' : 'فرع الشامي';
    map.set(owner, {
      responsible: owner,
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
  return Boolean(phone && isValidEgyptPhone(phone, row.customer_code));
}

function matchesSearch(row: FollowupRow, search: string) {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, '');
  const name = customerName(row).toLowerCase();
  const code = String(row.customer_code || '').toLowerCase();
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
  const code = String(row.customer_code || '').trim();
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
  const [activeTab, setActiveTabState] = useState<TabId>(TABS.some(([id]) => id === requestedTab) ? requestedTab! : 'today');
  const [rows, setRows] = useState<FollowupRow[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [branch, setBranch] = useState(
    dashboardBranch ? normalizeBranchName(dashboardBranch) : serviceCanAllBranches ? ALL_FILTER : serviceBranchOverride || ALL_FILTER
  );
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

  const enrichRowWithLiveMetrics = useCallback(async (row: FollowupRow): Promise<FollowupRow> => {
    const live = await getCustomerServiceLiveMetrics({
      customer_id: row.customer_id,
      customer_code: row.customer_code,
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
        customer_code: requested.customer_code || requestedCustomerFallback.customer_code,
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
        customer_code: row.customer_code,
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
        customer_code: row.customer_code,
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

  const displayTabRows = useMemo(
    () => filteredTabRows.slice(0, visibleCount).map(enrichRow),
    [enrichRow, filteredTabRows, visibleCount]
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
  const visibleRows = displayTabRows;
  const branchOwnerPerformance = useMemo(() => calculateBranchOwnerPerformance(rows), [rows]);
  const performance = useMemo(() => calculateTeamPerformance(rows), [rows]);
  const recoveredCount = useMemo(() => rows.filter((row) => row.purchase_after_followup).length, [rows]);
  const invalidPhoneCount = useMemo(() => rows.filter((row) => !hasValidPhone(row)).length, [rows]);
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
      target_route: `/customer-service?tab=today&followupId=${row.id}&openDetails=1&mode=edit&code=${encodeURIComponent(String(row.customer_code || ''))}&phone=${encodeURIComponent(phoneOf(row))}&name=${encodeURIComponent(customerName(row))}`,
      recipient_role: priority === 'urgent' ? 'customer_service_manager' : null,
      created_by: userId,
      created_by_name: userName,
    }).catch((notificationError) => console.warn('[customer-service] notification skipped', notificationError));
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
          customer_code: updated.customer_code || null,
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
        customer_code: row.customer_code,
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

          {cardsTabs.includes(activeTab) ? (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-300">
                <span>يتم عرض {visibleRows.length} من {filteredTabRows.length} متابعة لتخفيف المتصفح.</span>
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
                    <h3 className="text-2xl font-black text-white">{customerName(detailRow)}</h3>
                    <p className="mt-1 text-xs font-bold text-slate-400">{text(detailRow.customer_code || phoneOf(detailRow), 'بدون كود')}</p>
                  </div>
                  <span className={`rounded-full border px-3 py-1 text-xs font-black ${statusTone(detailRow)}`}>{statusOf(detailRow)}</span>
                </div>
                <div className="mt-4 grid gap-2 text-sm text-slate-300 sm:grid-cols-2 2xl:grid-cols-1">
                  <InfoRow label="الهاتف" value={phoneOf(detailRow) || 'بدون رقم صحيح'} />
                  <InfoRow label="الفرع" value={text(detailRow.branch)} />
                  <InfoRow label="الحالة" value={customerStatusOf(detailRow)} />
                  <InfoRow label="التصنيف" value={segmentOf(detailRow)} />
                  <InfoRow label="درجة الخطورة" value={riskLevel(detailRow)} />
                  <InfoRow label="آخر شراء" value={formatDate(lastPurchaseOf(detailRow))} />
                  <InfoRow label="متوسط شهري" value={money(avgMonthly(detailRow))} />
                  <InfoRow label="إجمالي مشتريات" value={money(totalSpent(detailRow))} />
                  <InfoRow label="المسؤول" value={responsibleOf(detailRow)} />
                </div>
                <CustomerFlagsBadges customerFlags={detailRow.customer_flags || {}} />
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
            onClose={() => setResultRow(null)}
            onSave={saveResult}
          />
        </LazyState>
      )}
      {detailsRow && (
        <LazyState>
          <CustomerQuickDetailsModal
            followupId={detailsRow.id}
            customerId={detailsRow.customer_id}
            customerCode={detailsRow.customer_code}
            customerPhone={phoneOf(detailsRow)}
            customerName={customerName(detailsRow)}
            branch={detailsRow.branch}
            fallbackMetric={modalFallbackFrom(detailsRow)}
            onEditFollowup={() => setResultRow(detailsRow)}
            onClose={() => setDetailsRow(null)}
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

function HistoryFollowupCard({ row, onSelect }: { row: FollowupRow; onSelect: () => void }) {
  return (
    <article
      onClick={onSelect}
      className="cursor-pointer rounded-3xl border border-emerald-500/25 bg-emerald-500/5 p-5 transition hover:border-emerald-400/40 hover:bg-emerald-500/10"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-black text-white">{customerName(row)}</h3>
          <div className="mt-2 flex flex-wrap gap-2 text-sm text-slate-300">
            <span>كود: {text(row.customer_code, 'بدون كود')}</span>
            <span>·</span>
            <span>{phoneOf(row) || 'بدون رقم'}</span>
            <span>·</span>
            <span>{text(row.branch)}</span>
          </div>
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
  const suggestedBranch = resolveSuggestedBranchFromInvoiceMetrics(row.customer_metrics);
  const hasBranchMismatch = Boolean(suggestedBranch && row.branch && suggestedBranch !== row.branch);
  return (
    <article
      onClick={onSelect}
      className={`cursor-pointer rounded-3xl border p-5 transition ${selected ? 'border-teal-400 bg-teal-500/15 shadow-lg shadow-teal-950/25' : 'border-slate-600/80 bg-[#0f172a]/90 hover:border-teal-500/40 hover:bg-slate-900/90'}`}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-xl font-black text-white">{customerName(row)}</h3>
          <div className="mt-2 flex flex-wrap gap-2 text-sm text-slate-300">
            <span className="rounded-lg bg-slate-800/80 px-2 py-1">كود: {text(row.customer_code, 'بدون كود')}</span>
            <span className={`rounded-lg px-2 py-1 ${validPhone ? 'bg-emerald-500/15 text-emerald-100' : 'bg-amber-500/15 text-amber-100'}`}>
              {validPhone ? phone : 'بدون رقم صحيح'}
            </span>
            <span className="rounded-lg bg-slate-800/80 px-2 py-1">{text(row.branch)}</span>
          </div>
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
