import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { ALL_FILTER, getCustomers, type CustomerMetric } from '@/lib/api/customers';
import { normalizeBranchName } from '@/lib/branch';
import { getBestCustomerPhone } from '@/lib/customerAnalyticsService';
import { calculateMonthlyIncentive } from '@/lib/performance/performanceRulesEngine';

export function clearCustomerServiceCommandCenterCache() {}

export type FollowupRow = {
  id: string;
  is_hidden?: boolean | null;
  hidden_at?: string | null;
  hidden_by?: string | null;
  hidden_reason?: string | null;
  date: string | null;
  customer_id: string | null;
  customer_name: string | null;
  phone: string | null;
  segment: string | null;
  status: string | null;
  total_spent: number | null;
  followup_type: string | null;
  followup_status: string | null;
  notes: string | null;
  branch: string | null;
  created_at: string | null;
  followup_date: string | null;
  name: string | null;
  classification: string | null;
  customer_status: string | null;
  followup_reason: string | null;
  priority: string | null;
  contact_status: string | null;
  contact_result: string | null;
  responsible_name: string | null;
  contacted_at: string | null;
  staff_id: string | null;
  customer_code: string | null;
  customer_phone: string | null;
  customer_flags?: Record<string, boolean> | null;
  customer_notes?: string | null;
  service_notes?: string | null;
  team_notes?: string | null;
  handling_notes?: string | null;
  whatsapp_notes?: string | null;
  address?: string | null;
  phone_alt?: string | null;
  whatsapp_phone?: string | null;
  assigned_to: string | null;
  assigned_staff_id: string | null;
  contact_method: string | null;
  followup_summary: string | null;
  followup_result: string | null;
  next_followup_date: string | null;
  request_type: string | null;
  request_details: string | null;
  request_status: string | null;
  purchase_after_followup: boolean | null;
  purchase_amount: number | null;
  purchase_invoice_no: string | null;
  purchase_date: string | null;
  linked_to_invoice_today?: boolean | null;
  points_value?: number | null;
  counts_toward_quota?: boolean | null;
  is_flagged?: boolean | null;
  flag_reason?: string | null;
  closed_at: string | null;
  closed_by: string | null;
  created_by: string | null;
  created_by_name: string | null;
  assigned_doctor: string | null;
  followup_notes: string | null;
  last_purchase_date: string | null;
  purchase_count_current_month: number | null;
  average_monthly_purchase_count: number | null;
  purchase_frequency_status: string | null;
  updated_at: string | null;
  category: string | null;
  suggested_action: string | null;
  quality_rating: number | null;
  internal_rating: number | null;
  customer_satisfaction: string | null;
  need_understood: boolean | null;
  cross_sell_offered: boolean | null;
  up_sell_offered: boolean | null;
  needs_next_followup: boolean | null;
  no_purchase_reason: string | null;
  doctor_internal_note: string | null;
  evaluated_by: string | null;
  evaluated_by_name: string | null;
  evaluated_at: string | null;
  response_status: string | null;
  needs_manager: boolean | null;
  completed_at: string | null;
  postponed_until: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  updated_by: string | null;
  followup_datetime: string | null;
  customer_metrics?: CustomerMetric | null;
};
export type FollowupFilters = {
  branch?: string;
  status?: string;
  responsible?: string;
  search?: string;
  limit?: number;
  strict?: boolean;
};
export type CustomerServiceSearchResult = CustomerMetric & {
  source: 'customer_metrics_summary' | 'customers';
  hasTodayFollowup: boolean;
  displayPhone: string | null;
  profile?: Record<string, unknown> | null;
};
export type CustomerServiceInsightPools = {
  important: FollowupRow[];
  reduced: FollowupRow[];
  stopped60: FollowupRow[];
  strong: FollowupRow[];
  cycleChurn: FollowupRow[];
  spendDecline: FollowupRow[];
  source: string;
  warnings: string[];
};

export type FollowupStats = {
  totalToday: number;
  completed: number;
  noAnswer: number;
  postponed: number;
  overdue: number;
  needsManager: number;
  purchaseAfterCount: number;
  purchaseAfterAmount: number;
};
export type FollowupPerformanceRow = {
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
  avgQualityRating: number | null;
  completionRate: number;
  recoveredCustomers: number;
  improvedFrequencyCount: number;
  avgCustomerSatisfaction: number | null;
  totalPoints: number;
  incentiveValueEstimate: number;
};
export type CreateExceptionalFollowupInput = {
  customer?: CustomerMetric | null;
  customerName: string;
  customerPhone?: string | null;
  customerCode?: string | null;
  branch?: string | null;
  priority?: string | null;
  requestType?: string | null;
  followupReason?: string | null;
  assignedDoctor?: string | null;
  followupDatetime?: string | null;
  requestDetails?: string | null;
  notes?: string | null;
  createdBy?: string | null;
  requestedByStaffId?: string | null;
  createdByName?: string | null;
  source?: string | null;
  contactStatus?: string | null;
};
export type FollowupResultPayload = {
  contact_method?: string | null;
  contacted_at?: string | null;
  contact_status?: string | null;
  contact_result?: string | null;
  followup_result?: string | null;
  followup_summary?: string | null;
  followup_notes?: string | null;
  purchase_after_followup?: boolean | null;
  purchase_amount?: number | null;
  purchase_invoice_no?: string | null;
  purchase_date?: string | null;
  next_followup_date?: string | null;
  quality_rating?: number | null;
  internal_rating?: number | null;
  customer_satisfaction?: string | null;
  need_understood?: boolean | null;
  cross_sell_offered?: boolean | null;
  up_sell_offered?: boolean | null;
  needs_next_followup?: boolean | null;
  no_purchase_reason?: string | null;
  doctor_internal_note?: string | null;
  evaluated_by?: string | null;
  evaluated_by_name?: string | null;
  evaluated_at?: string | null;
  needs_manager?: boolean | null;
  response_status?: string | null;
  completed_at?: string | null;
  postponed_until?: string | null;
  updated_by?: string | null;
  status?: string | null;
  followup_status?: string | null;
  cancelled_at?: string | null;
  cancelled_reason?: string | null;
  archived_at?: string | null;
  archive_reason?: string | null;
  is_hidden?: boolean | null;
  hidden_reason?: string | null;
  notes?: string | null;
  responsible_name?: string | null;
  request_type?: string | null;
  request_details?: string | null;
  request_status?: string | null;
};

type Row = Record<string, unknown>;
function requireSupabaseConfig() {
  if (!isSupabaseConfigured) throw new Error('Supabase is not configured.');
}
function toNumber(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function todayDay() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function isAll(value?: string | null) {
  return !value || value === ALL_FILTER || value === 'كل الفروع' || value === 'all';
}
function normalizeKey(value?: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}
function normalizeStatus(value?: string | null) {
  const raw = String(value || '').trim();
  if (!raw || raw === 'pending') return 'معلق';
  if (['done', 'completed', 'تم التواصل', 'تم'].includes(raw)) return 'تم';
  if (['no_answer', 'لم يرد'].includes(raw)) return 'لم يرد';
  if (['postponed', 'مؤجل'].includes(raw)) return 'مؤجل';
  if (['needs_manager', 'يحتاج مدير'].includes(raw)) return 'يحتاج مدير';
  return raw;
}
function isDone(row: FollowupRow) {
  return (
    Boolean(row.completed_at) ||
    ['تم', 'تم التواصل', 'تم الشراء بعد المتابعة'].includes(
      normalizeStatus(row.followup_status || row.status || row.contact_status)
    )
  );
}
function isNoAnswer(row: FollowupRow) {
  return normalizeStatus(row.followup_status || row.status || row.contact_status) === 'لم يرد';
}
function isPostponed(row: FollowupRow) {
  return (
    Boolean(row.postponed_until) ||
    normalizeStatus(row.followup_status || row.status || row.contact_status) === 'مؤجل'
  );
}
function isOverdue(row: FollowupRow) {
  if (isDone(row) || isPostponed(row)) return false;
  const due = row.followup_datetime || row.followup_date || row.date;
  return due ? new Date(due).getTime() < Date.now() : false;
}
function publicFollowupReason(value?: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const normalized = raw.replace(/[.。]+$/g, '').trim();
  if (/محاولة\s*استرجاع|استرجاع\s*العميل|سبب\s*التوقف|عرض\s*مناسب/i.test(normalized))
    return 'الاطمئنان على حضرتك ومعرفة لو كان فيه أي ملاحظة أو احتياج نقدر نساعد فيه';
  if (/متابعة\s*VIP|احتياجات\s*شهرية/i.test(normalized))
    return 'متابعة احتياجات حضرتك الشهرية والاطمئنان على رضاك عن الخدمة';
  if (/قبل\s*فقد\s*العميل|مهدد\s*بالتوقف/i.test(normalized))
    return 'الاطمئنان على سبب قلة التعامل ومساعدتك في أي طلب أو ملاحظة';
  if (/تحفيز\s*للشراء|متابعة\s*دورية/i.test(normalized))
    return 'متابعة احتياجات حضرتك والتأكد إن كل الأصناف المطلوبة متوفرة';
  if (/متابعة\s*عادية/i.test(normalized))
    return 'الاطمئنان على حضرتك ومتابعة أي احتياج من الصيدلية';
  return normalized;
}
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalizeFollowup(row: Row): FollowupRow {
  const safeFollowupReason = publicFollowupReason(row.followup_reason);
  const safeRequestDetails = publicFollowupReason(row.request_details);
  const safeSuggestedAction = publicFollowupReason(row.suggested_action);
  return {
    id: String(row.id || crypto.randomUUID()),
    date: (row.date as string) || null,
    customer_id: (row.customer_id as string) || null,
    customer_name: (row.customer_name as string) || (row.name as string) || null,
    phone: (row.phone as string) || (row.customer_phone as string) || null,
    segment: (row.segment as string) || (row.classification as string) || null,
    status: (row.status as string) || null,
    total_spent: toNumber(row.total_spent),
    followup_type: (row.followup_type as string) || null,
    followup_status: (row.followup_status as string) || null,
    notes: (row.notes as string) || null,
    branch: normalizeBranchName(row.branch as string),
    created_at: (row.created_at as string) || null,
    followup_date: (row.followup_date as string) || null,
    name: (row.name as string) || (row.customer_name as string) || null,
    classification: (row.classification as string) || (row.segment as string) || null,
    customer_status: (row.customer_status as string) || null,
    followup_reason: safeFollowupReason,
    priority: (row.priority as string) || null,
    contact_status: (row.contact_status as string) || null,
    contact_result: (row.contact_result as string) || null,
    responsible_name: (row.responsible_name as string) || null,
    contacted_at: (row.contacted_at as string) || null,
    staff_id: (row.staff_id as string) || null,
    customer_code: (row.customer_code as string) || null,
    customer_phone: (row.customer_phone as string) || (row.phone as string) || null,
    customer_flags: (row.customer_flags as Record<string, boolean>) || null,
    customer_notes: (row.customer_notes as string) || null,
    service_notes: (row.service_notes as string) || null,
    team_notes: (row.team_notes as string) || null,
    handling_notes: (row.handling_notes as string) || null,
    whatsapp_notes: (row.whatsapp_notes as string) || null,
    address: (row.address as string) || null,
    phone_alt: (row.phone_alt as string) || null,
    whatsapp_phone: (row.whatsapp_phone as string) || null,
    assigned_to: (row.assigned_to as string) || null,
    assigned_staff_id: (row.assigned_staff_id as string) || null,
    contact_method: (row.contact_method as string) || null,
    followup_summary: (row.followup_summary as string) || null,
    followup_result: (row.followup_result as string) || null,
    next_followup_date: (row.next_followup_date as string) || null,
    request_type: (row.request_type as string) || null,
    request_details: safeRequestDetails,
    request_status: (row.request_status as string) || null,
    purchase_after_followup: Boolean(row.purchase_after_followup),
    purchase_amount: toNumber(row.purchase_amount),
    purchase_invoice_no: (row.purchase_invoice_no as string) || null,
    purchase_date: (row.purchase_date as string) || null,
    closed_at: (row.closed_at as string) || null,
    closed_by: (row.closed_by as string) || null,
    created_by: (row.created_by as string) || null,
    created_by_name: (row.created_by_name as string) || null,
    assigned_doctor: (row.assigned_doctor as string) || null,
    followup_notes: (row.followup_notes as string) || null,
    last_purchase_date: (row.last_purchase_date as string) || null,
    purchase_count_current_month: toNumber(row.purchase_count_current_month),
    average_monthly_purchase_count: toNumber(row.average_monthly_purchase_count),
    purchase_frequency_status: (row.purchase_frequency_status as string) || null,
    updated_at: (row.updated_at as string) || null,
    category: (row.category as string) || null,
    suggested_action: safeSuggestedAction,
    quality_rating: row.quality_rating == null ? null : toNumber(row.quality_rating),
    internal_rating: row.internal_rating == null ? null : toNumber(row.internal_rating),
    customer_satisfaction: (row.customer_satisfaction as string) || null,
    need_understood: row.need_understood == null ? null : Boolean(row.need_understood),
    cross_sell_offered: Boolean(row.cross_sell_offered),
    up_sell_offered: Boolean(row.up_sell_offered),
    needs_next_followup: Boolean(row.needs_next_followup),
    no_purchase_reason: (row.no_purchase_reason as string) || null,
    doctor_internal_note: (row.doctor_internal_note as string) || null,
    evaluated_by: (row.evaluated_by as string) || null,
    evaluated_by_name: (row.evaluated_by_name as string) || null,
    evaluated_at: (row.evaluated_at as string) || null,
    response_status: (row.response_status as string) || null,
    needs_manager: Boolean(row.needs_manager),
    completed_at: (row.completed_at as string) || null,
    postponed_until: (row.postponed_until as string) || null,
    cancelled_at: (row.cancelled_at as string) || null,
    cancelled_by: (row.cancelled_by as string) || null,
    updated_by: (row.updated_by as string) || null,
    followup_datetime: (row.followup_datetime as string) || null,
  };
}

function indexMetric(map: Map<string, CustomerMetric>, metric: CustomerMetric | null | undefined) {
  if (!metric) return;
  [metric.customer_code, metric.customer_phone, metric.phone, metric.customer_name]
    .map(normalizeKey)
    .filter(Boolean)
    .forEach((key) => map.set(key, metric));
}

async function enrichFollowupRows(rows: FollowupRow[], filters: FollowupFilters) {
  if (!rows.length) return rows;
  try {
    const result = await getCustomers({
      branch: !isAll(filters.branch) ? filters.branch : ALL_FILTER,
      search: filters.search || '',
      limit: 250,
      offset: 0,
    });
    const byKey = new Map<string, CustomerMetric>();
    result.customers.filter(Boolean).forEach((metric) => indexMetric(byKey, metric));
    return rows.filter(Boolean).map((row) => {
      let metric: CustomerMetric | null = null;
      const keys = [row.customer_code, row.customer_phone, row.phone, row.name, row.customer_name]
        .map(normalizeKey)
        .filter(Boolean);
      for (const k of keys) {
        const m = byKey.get(k);
        if (m) {
          metric = m;
          break;
        }
      }
      if (!metric) return row;
      return {
        ...row,
        customer_metrics: metric,
        customer_id: row.customer_id || metric.customer_id || metric.id || null,
        customer_code: row.customer_code || metric.customer_code || null,
        customer_name: row.customer_name || metric.customer_name || row.name,
        name: row.name || metric.customer_name || row.customer_name,
        customer_phone: row.customer_phone || metric.customer_phone || metric.phone || null,
        phone: row.phone || metric.phone || metric.customer_phone || null,
        branch: row.branch || metric.branch || null,
        segment: row.segment || metric.segment || null,
        classification: row.classification || metric.segment || null,
        customer_status: row.customer_status || metric.customer_status || null,
        total_spent: row.total_spent || metric.total_spent || 0,
        last_purchase_date: row.last_purchase_date || metric.last_purchase || null,
        purchase_count_current_month: row.purchase_count_current_month || 0,
        average_monthly_purchase_count:
          row.average_monthly_purchase_count ||
          Math.round(
            Number(metric.invoices_count || 0) / Math.max(1, Number(metric.active_months || 1))
          ),
      };
    });
  } catch (error) {
    console.warn('customer metrics enrichment skipped', error);
    return rows;
  }
}
export async function searchCustomerMetrics(
  search: string,
  branch?: string
): Promise<CustomerServiceSearchResult[]> {
  const result = await getCustomers({
    search,
    branch: !isAll(branch) ? branch : ALL_FILTER,
    limit: 20,
    offset: 0,
  });
  return result.customers.filter(Boolean).map((metric) => ({
    ...metric,
    source: 'customer_metrics_summary',
    hasTodayFollowup: false,
    displayPhone: getBestCustomerPhone(
      {
        customer_code: metric.customer_code,
        customer_phone: metric.customer_phone,
        phone: metric.phone,
      } as FollowupRow,
      metric,
      null
    ),
    profile: null,
  }));
}
export async function fetchCustomerServiceFollowups(filters: FollowupFilters = {}) {
  requireSupabaseConfig();
  const load = async () => {
    let query = supabase
      .from('daily_followups')
      .select('*')
      .eq('is_hidden', false)
      .order('created_at', { ascending: false })
      .limit(filters.limit || 60);
    if (!isAll(filters.branch)) query = query.eq('branch', filters.branch as string);
    if (!isAll(filters.status) && filters.status !== 'متأخرة') {
      if (filters.status === 'يحتاج مدير') query = query.eq('needs_manager', true);
      else
        query = query.or(
          `status.eq.${filters.status},followup_status.eq.${filters.status},contact_status.eq.${filters.status}`
        );
    }
    if (!isAll(filters.responsible))
      query = query.or(
        `responsible_name.eq.${filters.responsible},assigned_to.eq.${filters.responsible},assigned_doctor.eq.${filters.responsible}`
      );
    if (filters.search?.trim()) {
      const text = `%${filters.search.trim().replace(/[%_]/g, '')}%`;
      query = query.or(
        `customer_name.ilike.${text},name.ilike.${text},customer_code.ilike.${text},customer_phone.ilike.${text},phone.ilike.${text}`
      );
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data || []).map((row) => normalizeFollowup(row as Row));
  };
  try {
    const rows = await withTimeout(load(), 8000, 'followups');
    const finalRows = filters.status === 'متأخرة' ? rows.filter(isOverdue) : rows;
    return await enrichFollowupRows(finalRows, filters);
  } catch (error) {
    console.warn('customer followups safe fallback returned empty list', error);
    if (filters.strict) throw error;
    return [] as FollowupRow[];
  }
}

export async function fetchCustomerServiceFollowupById(id: string) {
  requireSupabaseConfig();
  const normalizedId = String(id || '').trim();
  if (!normalizedId) return null;
  try {
    const { data, error } = await supabase.from('daily_followups').select('*').eq('id', normalizedId).eq('is_hidden', false).single();
    if (error) throw new Error(error.message);
    const row = normalizeFollowup((data || {}) as Row);
    const enriched = await enrichFollowupRows([row], {});
    return enriched[0] || row;
  } catch (error) {
    console.warn('customer followup by id failed', error);
    return null;
  }
}
export async function fetchFollowupPerformanceSummary(branch?: string) {
  try {
    let query = supabase
      .from('followup_performance_summary')
      .select('*')
      .eq('followup_date', todayDay())
      .limit(60);
    if (!isAll(branch)) query = query.eq('branch', branch as string);
    const { data, error } = await query;
    if (error) return null;
    return (data || []) as Row[];
  } catch {
    return null;
  }
}
export function calculateFollowupStats(rows: FollowupRow[]): FollowupStats {
  return rows.reduce(
    (acc, row) => {
      acc.totalToday += 1;
      if (isDone(row)) acc.completed += 1;
      if (isNoAnswer(row)) acc.noAnswer += 1;
      if (isPostponed(row)) acc.postponed += 1;
      if (isOverdue(row)) acc.overdue += 1;
      if (row.needs_manager || normalizeStatus(row.followup_status || row.status) === 'يحتاج مدير')
        acc.needsManager += 1;
      if (row.purchase_after_followup) {
        acc.purchaseAfterCount += 1;
        acc.purchaseAfterAmount += toNumber(row.purchase_amount);
      }
      return acc;
    },
    {
      totalToday: 0,
      completed: 0,
      noAnswer: 0,
      postponed: 0,
      overdue: 0,
      needsManager: 0,
      purchaseAfterCount: 0,
      purchaseAfterAmount: 0,
    }
  );
}
export function calculateTeamPerformance(rows: FollowupRow[]): FollowupPerformanceRow[] {
  const map = new Map<string, FollowupPerformanceRow>();
  for (const row of rows) {
    const responsible =
      row.responsible_name || row.assigned_to || row.assigned_doctor || 'غير محدد';
    const key = `${responsible}__${row.branch || ''}`;
    const item = map.get(key) || {
      responsible,
      branch: row.branch || 'غير محدد',
      assigned: 0,
      completed: 0,
      overdue: 0,
      noAnswer: 0,
      postponed: 0,
      needsManager: 0,
      purchaseAfterCount: 0,
      purchaseAfterAmount: 0,
      avgQualityRating: null,
      completionRate: 0,
      recoveredCustomers: 0,
      improvedFrequencyCount: 0,
      avgCustomerSatisfaction: null,
      totalPoints: 0,
      incentiveValueEstimate: 0,
    };
    item.assigned += 1;
    if (isDone(row)) item.completed += 1;
    if (isOverdue(row)) item.overdue += 1;
    if (isNoAnswer(row)) item.noAnswer += 1;
    if (isPostponed(row)) item.postponed += 1;
    if (row.needs_manager) item.needsManager += 1;
    if (row.purchase_after_followup) {
      item.purchaseAfterCount += 1;
      item.purchaseAfterAmount += toNumber(row.purchase_amount);
    }
    map.set(key, item);
  }
  return [...map.values()].map((item) => {
    const totalPoints = item.completed * 5 + item.purchaseAfterCount * 10 - item.noAnswer * 2;
    return {
      ...item,
      completionRate: item.assigned ? Math.round((item.completed / item.assigned) * 100) : 0,
      totalPoints,
      incentiveValueEstimate: calculateMonthlyIncentive({
        approvedExceptionalRewardPoints: Math.max(0, totalPoints),
        approvedDeductionPoints: Math.max(0, -totalPoints),
      }).monthlyIncentiveValue,
    };
  });
}
export async function createExceptionalFollowup(input: CreateExceptionalFollowupInput) {
  const publicReason =
    publicFollowupReason(input.followupReason || input.requestType) ||
    'الاطمئنان على العميل ومتابعة احتياجه';
  const { data, error } = await supabase.rpc('dawaa_create_exceptional_followup_v2', {
    p_customer_id: input.customer?.customer_id || input.customer?.id || null,
    p_customer_code: input.customer?.customer_code || input.customerCode || null,
    p_customer_name: input.customerName || input.customer?.customer_name || null,
    p_customer_phone: input.customerPhone || input.customer?.customer_phone || null,
    p_branch: normalizeBranchName(input.branch || input.customer?.branch || ''), p_priority: input.priority || 'مهم',
    p_reason: publicReason, p_followup_datetime: input.followupDatetime || new Date().toISOString(),
    p_assigned_doctor: input.assignedDoctor || null, p_request_details: publicFollowupReason(input.requestDetails || input.notes) || null,
    p_notes: input.notes || null, p_created_by: null, p_created_by_name: null,
  });
  if (error) throw new Error(error.message);
  return normalizeFollowup(data as Row);
}
export async function updateFollowupResult(id: string, payload: FollowupResultPayload) {
  if (payload.cancelled_at || payload.status === 'ملغي') {
    const { data, error } = await supabase.rpc('dawaa_cancel_customer_followup_v1', { p_followup_id:id, p_reason:payload.cancelled_reason || payload.followup_notes || 'إلغاء المتابعة', p_actor_id:null, p_actor_name:null });
    if (error) throw new Error(error.message); return normalizeFollowup(data as Row);
  }
  if (payload.is_hidden || payload.archived_at || payload.status === 'archived') {
    const { data, error } = await supabase.rpc('dawaa_archive_customer_followup_v1', { p_followup_id:id, p_reason:payload.archive_reason || payload.hidden_reason || payload.followup_notes || 'أرشفة المتابعة', p_actor:null });
    if (error) throw new Error(error.message); return normalizeFollowup(data as Row);
  }
  if (payload.postponed_until || payload.status === 'مؤجل') {
    const { data, error } = await supabase.rpc('dawaa_postpone_customer_followup_v1', { p_followup_id:id, p_postponed_until:payload.postponed_until || payload.next_followup_date, p_actor:null });
    if (error) throw new Error(error.message); return normalizeFollowup(data as Row);
  }
  const result=String(payload.followup_result || payload.contact_result || '').trim();
  const { data,error }=await supabase.rpc('dawaa_save_customer_followup_result_v1',{
    p_followup_id:id,p_status:payload.status || payload.followup_status || 'تم',p_contact_status:payload.contact_status || null,
    p_contact_result:result,p_summary:payload.followup_summary || result,p_notes:payload.followup_notes || payload.notes || null,
    p_contact_method:payload.contact_method || null,p_next_followup_date:payload.next_followup_date || null,p_responsible_name:payload.responsible_name || null,
    p_request_type:payload.request_type || null,p_request_details:payload.request_details || null,p_request_status:payload.request_status || null,
    p_purchase_amount:payload.purchase_after_followup ? Number(payload.purchase_amount || 0) : null,p_quality_rating:payload.quality_rating ?? null,
    p_internal_rating:payload.internal_rating ?? null,p_customer_satisfaction:payload.customer_satisfaction || null,p_purchase_invoice_no:payload.purchase_invoice_no || null,
  });
  if(error)throw new Error(error.message);return normalizeFollowup(data as Row);
}

function daysSince(value?: string | null) {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.floor((Date.now() - time) / 86400000);
}

function followupKeyFromCustomer(customer: CustomerMetric) {
  return normalizeKey(customer.customer_code || customer.customer_phone || customer.phone || customer.id || customer.customer_name);
}

function followupKeyFromRow(row: FollowupRow) {
  return normalizeKey(row.customer_code || row.customer_phone || row.phone || row.customer_id || row.customer_name || row.name);
}

function metricToFollowupRow(customer: CustomerMetric, reason: string, priority = 'مهم'): FollowupRow {
  const now = new Date().toISOString();
  return normalizeFollowup({
    id: `insight-${customer.id || customer.customer_code || customer.customer_phone || crypto.randomUUID()}`,
    date: todayDay(),
    customer_id: customer.customer_id || customer.id || null,
    customer_code: customer.customer_code || null,
    customer_name: customer.customer_name || customer.name || null,
    name: customer.customer_name || customer.name || null,
    customer_phone: customer.customer_phone || customer.phone || null,
    phone: customer.phone || customer.customer_phone || null,
    branch: customer.branch || null,
    segment: customer.segment || customer.type || null,
    customer_status: customer.customer_status || customer.status || null,
    total_spent: customer.total_spent || customer.total_purchases || 0,
    last_purchase_date: customer.last_purchase || null,
    priority,
    followup_reason: reason,
    suggested_action: recommendedAction(customer),
    request_type: reason,
    status: 'معلق',
    followup_status: 'معلق',
    followup_date: now,
    followup_datetime: now,
    customer_metrics: customer,
  });
}

export async function fetchCustomerServiceInsightPools(branch?: string): Promise<CustomerServiceInsightPools> {
  const warnings: string[] = [];
  const scopedBranch = !isAll(branch) ? branch : ALL_FILTER;
  const fetchPool = async (options: Parameters<typeof getCustomers>[0], label: string) => {
    try {
      const result = await withTimeout(getCustomers({ ...options, branch: scopedBranch, limit: 80, offset: 0 }), 9000, label);
      return result.customers;
    } catch (error) {
      warnings.push(error instanceof Error ? `${label}: ${error.message}` : `${label}: تعذر التحميل`);
      return [] as CustomerMetric[];
    }
  };

  const [vipCustomers, atRiskCustomers, stoppedCustomers] = await Promise.all([
    fetchPool({ type: 'مهم جدًا' }, 'أهم العملاء'),
    fetchPool({ status: 'مهدد بالتوقف' }, 'عملاء قللوا التعامل'),
    fetchPool({ status: 'متوقف' }, 'عملاء متوقفون'),
  ]);

  const important = vipCustomers
    .filter(Boolean)
    .sort((a, b) => toNumber(b.total_spent || b.total_purchases) - toNumber(a.total_spent || a.total_purchases))
    .slice(0, 40)
    .map((customer) => metricToFollowupRow(customer, 'عميل مهم حاليًا يحتاج متابعة ذكية', customer.segment === 'مهم جدًا' ? 'عاجل' : 'مهم'));

  const reduced = atRiskCustomers
    .filter(Boolean)
    .filter((customer) => (customer.avg_monthly || 0) >= 500 || (customer.total_spent || 0) >= 1500)
    .slice(0, 40)
    .map((customer) => metricToFollowupRow(customer, 'قلل التعامل ويحتاج استرجاع قبل التوقف', 'مهم'));

  const stopped60 = stoppedCustomers
    .filter(Boolean)
    .filter((customer) => {
      const days = daysSince(customer.last_purchase);
      // من غير حد أقصى، القائمة كانت بتتلخبط بعملاء توقفوا من سنين (أو حتى من غير تاريخ شراء
      // موثوق أصلًا) وده بيغرق العملاء اللي توقفوا حديثًا واحتمال ردهم أعلى بكتير.
      // بنركّز على نافذة آخر 60-180 يوم (شهرين لحد 6 شهور) اللي فعلاً يستاهلوا متابعة يومية.
      return days != null && days >= 60 && days <= 180;
    })
    .sort((a, b) => (daysSince(a.last_purchase) ?? 0) - (daysSince(b.last_purchase) ?? 0))
    .slice(0, 40)
    .map((customer) => {
      const days = daysSince(customer.last_purchase);
      return metricToFollowupRow(
        customer,
        days ? `متوقف منذ ${days} يوم ويحتاج متابعة استرجاع` : 'متوقف أكثر من شهرين ويحتاج متابعة استرجاع',
        'عاجل'
      );
    });

  return { important, reduced, stopped60, strong: await fetchTopActive3mPool(scopedBranch, warnings), cycleChurn: await fetchCycleChurnRiskPool(scopedBranch, warnings), spendDecline: await fetchSpendDeclinePool(scopedBranch, warnings), source: 'dawaa_customer_metrics_app_view', warnings };
}

async function fetchSpendDeclinePool(branch: string, warnings: string[]): Promise<FollowupRow[]> {
  if (isAll(branch)) return [];
  try {
    const { data, error } = await supabase.rpc('get_customer_spend_decline_alerts', { p_branch: branch });
    if (error) throw error;
    const rows = ((data as Row[]) || []).filter(Boolean);
    return rows.slice(0, 30).map((row) => {
      const declinePct = Number(row.decline_pct || 0);
      const priorAvg = Number(row.prior_avg_monthly_spend || 0);
      const recoveryScore = Number(row.recovery_score || 0);
      const lifetimeInvoices = Number(row.lifetime_invoices || 0);
      return normalizeFollowup({
        id: `spend-decline-${row.customer_code}`,
        date: todayDay(),
        customer_code: row.customer_code,
        customer_name: row.customer_name,
        name: row.customer_name,
        customer_phone: row.customer_phone || '',
        phone: row.customer_phone || '',
        branch,
        total_spent: row.recent_30d_spend || 0,
        priority: declinePct >= 70 ? 'عاجل' : 'مهم',
        followup_reason: `كان بيصرف حوالي ${priorAvg} ج.م شهريًا وقل بنسبة ${declinePct}% آخر 30 يوم (عميل من ${lifetimeInvoices} فاتورة تاريخيًا، درجة قابلية الاسترجاع ${recoveryScore}/100) — يحتاج متابعة قبل ما يتوقف تمامًا`,
        request_type: 'انخفاض ملحوظ في المسحوبات',
        status: 'معلق',
        followup_status: 'معلق',
        followup_date: new Date().toISOString(),
        followup_datetime: new Date().toISOString(),
      });
    });
  } catch (error) {
    warnings.push(error instanceof Error ? `انخفاض المسحوبات: ${error.message}` : 'انخفاض المسحوبات: تعذر التحميل');
    return [];
  }
}

async function fetchTopActive3mPool(branch: string, warnings: string[]): Promise<FollowupRow[]> {
  if (isAll(branch)) return [];
  try {
    const { data, error } = await supabase.rpc('get_daily_smart_followup_candidates', { p_branch: branch });
    if (error) throw error;
    const rows = ((data as { top_active_customers?: Row[] } | null)?.top_active_customers || []).filter(Boolean);
    return rows.slice(0, 20).map((row) => {
      const phone = String(row.customer_phone || '');
      return normalizeFollowup({
        id: `top-active-${row.customer_code}`,
        date: todayDay(),
        customer_code: row.customer_code,
        customer_name: row.customer_name,
        name: row.customer_name,
        customer_phone: phone.startsWith('code:') ? '' : phone,
        phone: phone.startsWith('code:') ? '' : phone,
        branch,
        total_spent: row.total_spent || 0,
        priority: 'مهم',
        followup_reason: `من أهم العملاء آخر 3 شهور (${row.invoices || 0} فاتورة) — يستاهل متابعة اهتمام`,
        request_type: 'أهم العملاء آخر 3 شهور',
        status: 'معلق',
        followup_status: 'معلق',
        followup_date: new Date().toISOString(),
        followup_datetime: new Date().toISOString(),
      });
    });
  } catch (error) {
    warnings.push(error instanceof Error ? `أهم العملاء آخر 3 شهور: ${error.message}` : 'أهم العملاء آخر 3 شهور: تعذر التحميل');
    return [];
  }
}

async function fetchCycleChurnRiskPool(branch: string, warnings: string[]): Promise<FollowupRow[]> {
  if (isAll(branch)) return [];
  try {
    const { data, error } = await supabase.rpc('get_daily_smart_followup_candidates', { p_branch: branch });
    if (error) throw error;
    const rows = ((data as { cycle_churn_risk?: Row[] } | null)?.cycle_churn_risk || []).filter(Boolean);
    return rows.slice(0, 30).map((row) => {
      const phone = String(row.customer_phone || '');
      return normalizeFollowup({
        id: `cycle-churn-${row.customer_code}`,
        date: todayDay(),
        customer_code: row.customer_code,
        customer_name: row.customer_name,
        name: row.customer_name,
        customer_phone: phone.startsWith('code:') ? '' : phone,
        phone: phone.startsWith('code:') ? '' : phone,
        branch,
        priority: 'مهم',
        followup_reason: 'اشترى في الدورة اللي فاتت بشهرين وماشتراش في الدورة الأخيرة — يحتاج متابعة قبل ما يتوقف تمامًا',
        request_type: 'مهددون بالتوقف (مقارنة دورتين)',
        status: 'معلق',
        followup_status: 'معلق',
        followup_date: new Date().toISOString(),
        followup_datetime: new Date().toISOString(),
      });
    });
  } catch (error) {
    warnings.push(error instanceof Error ? `عملاء مهددون بالتوقف (دورتين): ${error.message}` : 'عملاء مهددون بالتوقف (دورتين): تعذر التحميل');
    return [];
  }
}

async function fetchOpenFollowupKeys(branch?: string) {
  try {
    let query = supabase
      .from('daily_followups')
      .select('customer_code,customer_phone,phone,customer_id,customer_name,name,status,followup_status,completed_at,closed_at,next_followup_date,followup_date,date')
      .limit(1000);
    if (!isAll(branch)) query = query.eq('branch', branch as string);
    const { data, error } = await query;
    if (error) return new Set<string>();
    const keys = new Set<string>();
    for (const raw of (data || []) as Row[]) {
      const row = normalizeFollowup(raw);
      if (!isDone(row)) keys.add(followupKeyFromRow(row));
      const date = String(row.date || row.followup_date || row.next_followup_date || '').slice(0, 10);
      if (date === todayDay()) keys.add(followupKeyFromRow(row));
    }
    return keys;
  } catch {
    return new Set<string>();
  }
}

export type GenerateTodayFollowupsSmartReport = {
  createdRows: FollowupRow[];
  created_count: number;
  skipped_duplicates_count: number;
  skipped_open_followups_count: number;
  skipped_invalid_phone_count: number;
  failed_count: number;
  candidate_count: number;
};

function smartCandidatePhone(row: FollowupRow) {
  return getBestCustomerPhone(row.customer_metrics as CustomerMetric | null) || row.customer_phone || row.phone || '';
}

export async function generateTodayFollowupsSmartReport(
  branch?: string,
  createdByName?: string | null
): Promise<GenerateTodayFollowupsSmartReport> {
  const branches = isAll(branch) ? ['فرع الشامي', 'فرع شكري'] : [normalizeBranchName(branch || '')].filter(Boolean);
  const report: GenerateTodayFollowupsSmartReport = {
    createdRows: [],
    created_count: 0,
    skipped_duplicates_count: 0,
    skipped_open_followups_count: 0,
    skipped_invalid_phone_count: 0,
    failed_count: 0,
    candidate_count: 0,
  };

  for (const branchName of branches) {
    const existingKeys = await fetchOpenFollowupKeys(branchName);
    const pools = await fetchCustomerServiceInsightPools(branchName);
    const candidates = [...pools.spendDecline, ...pools.strong, ...pools.cycleChurn, ...pools.stopped60, ...pools.reduced, ...pools.important].filter(Boolean);
    report.candidate_count += candidates.length;
    const unique = new Map<string, FollowupRow>();

    for (const row of candidates) {
      const key = followupKeyFromRow(row);
      const phone = smartCandidatePhone(row).replace(/\D/g, '');
      if (!key || phone.length < 10) {
        report.skipped_invalid_phone_count += 1;
        continue;
      }
      if (existingKeys.has(key)) {
        report.skipped_open_followups_count += 1;
        continue;
      }
      if (unique.has(key)) {
        report.skipped_duplicates_count += 1;
        continue;
      }
      unique.set(key, row);
      if (unique.size >= 20) break;
    }

    for (const row of unique.values()) {
      try {
        const created = await createExceptionalFollowup({
          customer: row.customer_metrics as CustomerMetric | null,
          customerName: row.customer_name || row.name || 'عميل',
          customerPhone: smartCandidatePhone(row),
          customerCode: row.customer_code,
          branch: branchName,
          priority: row.priority || 'مهم',
          requestType: 'متابعة يومية ذكية',
          followupReason: row.followup_reason || recommendedAction(row),
          followupDatetime: new Date().toISOString(),
          requestDetails: row.followup_reason || recommendedAction(row),
          createdByName,
          source: 'smart_daily_customer_service_queue_v6',
        });
        report.createdRows.push(created);
        report.created_count += 1;
        existingKeys.add(followupKeyFromRow(created));
      } catch (error) {
        report.failed_count += 1;
        console.warn('smart daily followup insert skipped', error);
      }
    }
  }

  return report;
}

export async function generateTodayFollowupsFromCustomerMetrics(
  branch?: string,
  createdByName?: string | null
) {
  const report = await generateTodayFollowupsSmartReport(branch, createdByName);
  return report.createdRows;
}

export function riskLevel(row: FollowupRow | CustomerMetric) {
  const status = 'customer_status' in row ? row.customer_status : null;
  const segment = 'segment' in row ? row.segment : null;
  if (status === 'متوقف' || segment === 'مهم جدًا') return 'عالي';
  if (status === 'مهدد بالتوقف' || segment === 'مهم') return 'متوسط';
  return 'منخفض';
}
export function recommendedAction(row: FollowupRow | CustomerMetric) {
  const status = 'customer_status' in row ? row.customer_status : null;
  const segment = 'segment' in row ? row.segment : null;
  if (status === 'متوقف') return 'الاطمئنان على سبب توقف التعامل ومعرفة أي ملاحظة أو احتياج';
  if (status === 'مهدد بالتوقف') return 'متابعة سبب قلة التعامل قبل أن يتوقف العميل';
  if (segment === 'مهم جدًا') return 'متابعة احتياجات العميل الشهرية لأنه من العملاء المميزين';
  if (segment === 'مهم') return 'متابعة دورية للتأكد من توافر احتياجات العميل';
  return 'الاطمئنان على العميل ومتابعة أي احتياج من الصيدلية';
}
