import { supabase } from '@/lib/supabase';
import type { CustomerRequest } from '@/lib/api/customerRequests';

export type CustomerRequestQuickFilter = 'all' | 'today' | 'recent' | 'attention' | 'overdue' | 'urgent' | 'unassigned' | 'unlinked' | 'backlog';

export interface CustomerRequestCommandSummary {
  total: number;
  today: number;
  open: number;
  urgent: number;
  overdue: number;
  searching: number;
  waiting_customer: number;
  ready: number;
  delivered: number;
  not_available: number;
  cancelled: number;
  from_dawaawael: number;
  unlinked_customer: number;
  no_branch: number;
  invalid_phone: number;
  unassigned: number;
  sync_conflicts: number;
  moved_to_shortage: number;
  fulfillment_rate: number;
  avg_fulfillment_hours: number;
}

export interface CustomerRequestPageOptions {
  page?: number;
  pageSize?: number;
  status?: string;
  branch?: string;
  urgency?: string;
  sourceSystem?: string;
  sourceChannel?: string;
  assignee?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  quickFilter?: CustomerRequestQuickFilter;
}

export interface CustomerRequestPageResult {
  rows: CustomerRequest[];
  count: number;
  page: number;
  pageSize: number;
  pages: number;
}

const CLOSED = ['closed', 'delivered', 'cancelled', 'not_available'];

function startOfTodayIso() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

function daysAgoIso(days: number) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

function safeSearch(value: string) {
  return value.trim().replace(/[,%()]/g, ' ');
}

export async function getCustomerRequestsCommandSummary(branch = 'all') {
  const { data, error } = await supabase.rpc('get_customer_requests_command_center_summary', {
    p_branch: branch === 'all' ? null : branch,
  });
  if (error) throw new Error(error.message);
  return (data || {}) as CustomerRequestCommandSummary;
}

export async function getCustomerRequestsPage(options: CustomerRequestPageOptions = {}): Promise<CustomerRequestPageResult> {
  const page = Math.max(1, options.page || 1);
  const pageSize = Math.min(100, Math.max(10, options.pageSize || 30));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let overdueIds: string[] | null = null;
  if ((options.quickFilter || 'all') === 'overdue') {
    const { data, error } = await supabase.rpc('get_customer_request_overdue_ids', {
      p_branch: options.branch && options.branch !== 'all' ? options.branch : null,
    });
    if (error) throw new Error(error.message);
    overdueIds = Array.isArray(data) ? (data as string[]) : [];
    if (overdueIds.length === 0) {
      return { rows: [], count: 0, page: 1, pageSize, pages: 1 };
    }
  }

  let query = supabase.from('customer_requests').select('*', { count: 'exact' }).order('is_urgent', { ascending: false }).order('updated_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false, nullsFirst: false });

  if (options.status && options.status !== 'all') query = query.eq('status', options.status);
  if (options.branch && options.branch !== 'all') query = query.eq('branch', options.branch);
  if (options.sourceSystem && options.sourceSystem !== 'all') {
    if (options.sourceSystem === 'manual') query = query.is('source_system', null);
    else query = query.eq('source_system', options.sourceSystem);
  }
  if (options.sourceChannel && options.sourceChannel !== 'all') {
    query = query.eq('source_request_channel', options.sourceChannel);
  }
  if (options.urgency && options.urgency !== 'all') {
    if (options.urgency === 'urgent') {
      query = query.or('is_urgent.eq.true,urgency.eq.urgent,urgency.eq.high,priority.eq.high');
    } else {
      query = query.eq('urgency', options.urgency);
    }
  }
  if (options.assignee && options.assignee !== 'all') {
    if (options.assignee === 'unassigned') {
      query = query.is('purchasing_assignee', null).is('source_assigned_employee', null);
    } else {
      const term = safeSearch(options.assignee);
      query = query.or(`purchasing_assignee.ilike.%${term}%,source_assigned_employee.ilike.%${term}%`);
    }
  }
  if (options.dateFrom) query = query.gte('requested_at', `${options.dateFrom}T00:00:00+02:00`);
  if (options.dateTo) query = query.lte('requested_at', `${options.dateTo}T23:59:59+02:00`);

  const quick = options.quickFilter || 'all';
  if (quick === 'today') query = query.gte('requested_at', startOfTodayIso());
  if (quick === 'recent') query = query.gte('requested_at', daysAgoIso(7));
  if (quick === 'urgent') query = query.or('is_urgent.eq.true,urgency.eq.urgent,urgency.eq.high,priority.eq.high');
  if (quick === 'unlinked') query = query.is('customer_id', null);
  if (quick === 'unassigned') query = query.is('purchasing_assignee', null).is('source_assigned_employee', null);
  if (quick === 'backlog') {
    query = query.not('status', 'in', `(${CLOSED.join(',')})`).lt('requested_at', daysAgoIso(7));
  }
  if (quick === 'attention') {
    query = query.not('status', 'in', `(${CLOSED.join(',')})`).gte('requested_at', daysAgoIso(7));
  }
  if (quick === 'overdue' && overdueIds) {
    query = query.in('id', overdueIds);
  }

  const search = safeSearch(options.search || '');
  if (search) {
    query = query.or([`customer_name.ilike.%${search}%`, `customer_code.ilike.%${search}%`, `customer_phone.ilike.%${search}%`, `medicine_name.ilike.%${search}%`, `product_code.ilike.%${search}%`, `doctor_name.ilike.%${search}%`, `supplier_hint.ilike.%${search}%`, `source_order_number.ilike.%${search}%`, `source_assigned_employee.ilike.%${search}%`].join(','));
  }

  const { data, error, count } = await query.range(from, to);
  if (error) throw new Error(error.message);

  const rows = (data || []) as CustomerRequest[];
  const customerIds = Array.from(new Set(rows.map((row) => row.customer_id).filter(Boolean))) as string[];
  const segmentById = new Map<string, string>();
  if (customerIds.length) {
    const { data: customers } = await supabase.from('customers').select('id,segment').in('id', customerIds);
    for (const customer of customers || []) {
      if (customer.id && customer.segment) segmentById.set(String(customer.id), String(customer.segment));
    }
  }

  const exactCount = count || 0;
  return {
    rows: rows.map((row) => ({
      ...row,
      customer_segment: row.customer_id ? segmentById.get(row.customer_id) || null : null,
    })),
    count: exactCount,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(exactCount / pageSize)),
  };
}

export function customerRequestAgeHours(request: CustomerRequest) {
  const raw = request.requested_at || request.created_at;
  if (!raw) return 0;
  const timestamp = new Date(raw).getTime();
  return Number.isFinite(timestamp) ? Math.max(0, (Date.now() - timestamp) / 3600000) : 0;
}

export function customerRequestStageAgeHours(request: CustomerRequest) {
  const raw = request.last_action_at || request.updated_at || request.requested_at || request.created_at;
  if (!raw) return 0;
  const timestamp = new Date(raw).getTime();
  return Number.isFinite(timestamp) ? Math.max(0, (Date.now() - timestamp) / 3600000) : 0;
}

export function customerRequestIsClosed(request: CustomerRequest) {
  return CLOSED.includes(String(request.status || 'new'));
}

export function customerRequestIsUrgent(request: CustomerRequest) {
  return Boolean(request.is_urgent || ['urgent', 'high', 'عاجل', 'مهم'].includes(String(request.urgency || '')) || request.priority === 'high');
}

export function customerRequestSlaHours(request: CustomerRequest) {
  const status = String(request.status || 'new').toLowerCase();
  const urgent = customerRequestIsUrgent(request);
  if (customerRequestIsClosed(request)) return 0;
  if (['new', 'purchasing_review'].includes(status)) return urgent ? 2 : 4;
  if (['searching_suppliers', 'sourcing'].includes(status)) return urgent ? 6 : 24;
  if (['needs_customer_confirmation', 'customer_confirmed'].includes(status)) return urgent ? 4 : 12;
  if (['available', 'arrived'].includes(status)) return urgent ? 1 : 2;
  if (status === 'customer_contacted') return urgent ? 12 : 24;
  return urgent ? 6 : 24;
}

export function customerRequestIsOverdue(request: CustomerRequest) {
  if (customerRequestIsClosed(request)) return false;
  return customerRequestStageAgeHours(request) > customerRequestSlaHours(request);
}

export function customerRequestQualityIssues(request: CustomerRequest) {
  const issues: string[] = [];
  const phone = String(request.customer_phone || '').replace(/\D/g, '');
  if (!request.customer_id) issues.push('عميل غير مربوط');
  if (!request.branch?.trim()) issues.push('بدون فرع');
  if (!phone || /^0+$/.test(phone) || phone.length < 8) issues.push('هاتف يحتاج مراجعة');
  if (!(request.purchasing_assignee || request.source_assigned_employee)?.trim()) issues.push('بدون مسئول');
  if (request.sync_conflict) issues.push('تعارض مزامنة');
  return issues;
}
