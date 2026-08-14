import { supabase } from '@/lib/supabase';
import { normalizePhone } from '@/lib/customerSearch';
import type { CustomerRequest } from '@/lib/api/customerRequests';

export type QualityIssueType =
  | 'all'
  | 'customer_link'
  | 'customer_code'
  | 'phone'
  | 'branch'
  | 'product_link'
  | 'product_code'
  | 'sync_conflict';

export type QualityCenterRequest = CustomerRequest & {
  product_id?: string | null;
  product_code?: string | null;
};

export type QualityIssueKey = Exclude<QualityIssueType, 'all'>;
export type QualityPriorityBand = 'critical' | 'high' | 'medium' | 'low';
export type QualitySortMode = 'smart' | 'newest' | 'issues';

export type QualityCenterRow = {
  request: QualityCenterRequest;
  issues: QualityIssueKey[];
  priorityScore: number;
  priorityBand: QualityPriorityBand;
  priorityReasons: string[];
};

const CLOSED_STATUSES = new Set(['delivered', 'closed', 'cancelled']);
const ISSUE_WEIGHTS: Record<QualityIssueKey, number> = {
  customer_link: 26,
  customer_code: 12,
  phone: 8,
  branch: 10,
  product_link: 28,
  product_code: 14,
  sync_conflict: 22,
};

function safeDate(value: unknown) {
  const date = value ? new Date(String(value)) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function isUrgent(request: QualityCenterRequest) {
  const urgency = String(request.urgency || request.priority || '').trim().toLowerCase();
  return Boolean(request.is_urgent) || ['عاجل', 'urgent', 'high', 'critical'].includes(urgency);
}

function isUnassigned(request: QualityCenterRequest) {
  return !String(request.assigned_to || request.purchasing_assignee || request.source_assigned_employee || '').trim();
}

export function requestQualityIssueKeys(request: QualityCenterRequest): QualityIssueKey[] {
  const issues: QualityIssueKey[] = [];
  if (!request.customer_id) issues.push('customer_link');
  if (!String(request.customer_code || '').trim()) issues.push('customer_code');
  const phone = normalizePhone(request.customer_phone);
  if (!phone || phone.replace(/\D/g, '').length < 10) issues.push('phone');
  if (!String(request.branch || '').trim()) issues.push('branch');
  if (!request.product_id) issues.push('product_link');
  if (!String(request.product_code || '').trim()) issues.push('product_code');
  if (request.sync_conflict) issues.push('sync_conflict');
  return issues;
}

export function qualityIssueLabel(issue: QualityIssueKey) {
  const labels: Record<QualityIssueKey, string> = {
    customer_link: 'عميل غير مربوط',
    customer_code: 'كود عميل مفقود',
    phone: 'هاتف غير صالح',
    branch: 'فرع غير محدد',
    product_link: 'صنف غير مربوط',
    product_code: 'كود صنف مفقود',
    sync_conflict: 'تعارض مزامنة',
  };
  return labels[issue];
}

export function qualityPriorityLabel(band: QualityPriorityBand) {
  return ({ critical: 'حرج', high: 'عالي', medium: 'متوسط', low: 'منخفض' } as Record<QualityPriorityBand, string>)[band];
}

export function getRequestQualityPriority(request: QualityCenterRequest, issues = requestQualityIssueKeys(request)) {
  let score = issues.reduce((total, issue) => total + ISSUE_WEIGHTS[issue], 0);
  const reasons = issues
    .slice()
    .sort((a, b) => ISSUE_WEIGHTS[b] - ISSUE_WEIGHTS[a])
    .slice(0, 2)
    .map(qualityIssueLabel);

  const status = String(request.status || '').trim();
  const active = !CLOSED_STATUSES.has(status);
  if (active) score += 12;
  else score -= 24;

  if (isUrgent(request) && active) {
    score += 32;
    reasons.unshift('طلب عاجل');
  }

  const now = Date.now();
  const due = safeDate(request.due_date || request.needed_by_date || request.expected_arrival_date);
  if (active && due && due.getTime() < now) {
    const lateDays = Math.max(1, Math.floor((now - due.getTime()) / 86_400_000));
    score += Math.min(28, 14 + lateDays * 2);
    reasons.push(`متأخر ${lateDays.toLocaleString('ar-EG')} يوم`);
  }

  const created = safeDate(request.requested_at || request.created_at);
  if (active && created) {
    const ageDays = Math.max(0, Math.floor((now - created.getTime()) / 86_400_000));
    score += Math.min(16, Math.floor(ageDays / 2));
    if (ageDays >= 3) reasons.push(`مفتوح منذ ${ageDays.toLocaleString('ar-EG')} يوم`);
  }

  if (active && isUnassigned(request)) {
    score += 8;
    reasons.push('بدون مسئول');
  }

  const segment = String(request.customer_segment || '').toLowerCase();
  if (active && /vip|مهم|very important|important/.test(segment)) {
    score += 8;
    reasons.push('عميل مهم');
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const priorityBand: QualityPriorityBand = score >= 75 ? 'critical' : score >= 50 ? 'high' : score >= 28 ? 'medium' : 'low';
  return { priorityScore: score, priorityBand, priorityReasons: [...new Set(reasons)].slice(0, 4) };
}

export async function getCustomerRequestQualityCenter(options: {
  branch?: string;
  issue?: QualityIssueType;
  search?: string;
  limit?: number;
  sort?: QualitySortMode;
  priority?: QualityPriorityBand | 'all';
} = {}) {
  const limit = Math.min(Math.max(options.limit || 250, 20), 500);
  let query = supabase
    .from('customer_requests')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (options.branch && options.branch !== 'all') query = query.eq('branch', options.branch);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const search = String(options.search || '').trim().toLowerCase();
  const allRows: QualityCenterRow[] = ((data || []) as QualityCenterRequest[])
    .map((request) => {
      const issues = requestQualityIssueKeys(request);
      return { request, issues, ...getRequestQualityPriority(request, issues) };
    })
    .filter(({ issues }) => issues.length > 0);

  const counts = {
    all: allRows.length,
    customer_link: 0,
    customer_code: 0,
    phone: 0,
    branch: 0,
    product_link: 0,
    product_code: 0,
    sync_conflict: 0,
  } as Record<QualityIssueType, number>;

  const priorityCounts = { critical: 0, high: 0, medium: 0, low: 0 } as Record<QualityPriorityBand, number>;
  for (const row of allRows) {
    for (const issue of row.issues) counts[issue] += 1;
    priorityCounts[row.priorityBand] += 1;
  }

  const sort = options.sort || 'smart';
  const rows = allRows
    .filter(({ issues }) => options.issue && options.issue !== 'all' ? issues.includes(options.issue) : true)
    .filter(({ priorityBand }) => options.priority && options.priority !== 'all' ? priorityBand === options.priority : true)
    .filter(({ request }) => {
      if (!search) return true;
      return [request.customer_name, request.customer_code, request.customer_phone, request.medicine_name, request.product_code, request.branch]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
    })
    .sort((a, b) => {
      if (sort === 'issues') return b.issues.length - a.issues.length || b.priorityScore - a.priorityScore;
      if (sort === 'newest') return (safeDate(b.request.updated_at || b.request.created_at)?.getTime() || 0) - (safeDate(a.request.updated_at || a.request.created_at)?.getTime() || 0);
      return b.priorityScore - a.priorityScore
        || b.issues.length - a.issues.length
        || (safeDate(b.request.updated_at || b.request.created_at)?.getTime() || 0) - (safeDate(a.request.updated_at || a.request.created_at)?.getTime() || 0);
    });

  return { rows, counts, priorityCounts };
}
