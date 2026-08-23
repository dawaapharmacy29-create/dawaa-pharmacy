import { supabase } from '@/lib/supabase';
import type { CustomerRequest } from '@/lib/api/customerRequests';
import {
  customerRequestAgeHours,
  customerRequestIsOverdue,
  customerRequestIsUrgent,
  customerRequestQualityIssues,
} from '../domain/request';
import { customerRequestBranchAliases, customerRequestSourceBranch } from '../domain/branch';
import { customerRequestIsClosedStatus } from '../domain/status';

export type CustomerRequestQuickFilter =
  | 'all'
  | 'today'
  | 'recent'
  | 'attention'
  | 'followup_due'
  | 'overdue'
  | 'urgent'
  | 'unassigned'
  | 'unlinked'
  | 'sync_review'
  | 'backlog';

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
  requestId?: string;
  customerId?: string;
  customerCode?: string;
  customerPhone?: string;
  productCode?: string;
  medicineName?: string;
  registrar?: string;
}

export interface CustomerRequestPageResult {
  rows: CustomerRequest[];
  count: number;
  page: number;
  pageSize: number;
  pages: number;
}

export interface CustomerRequestsRepository {
  getSummary(branch?: string): Promise<CustomerRequestCommandSummary>;
  getPage(options?: CustomerRequestPageOptions): Promise<CustomerRequestPageResult>;
}

const CLOSED = ['closed', 'delivered', 'cancelled', 'not_available'];
const CAIRO_TZ = 'Africa/Cairo';

function timeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

export function cairoDateBoundaryIso(dateText: string, end = false) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
  if (!match) throw new Error('صيغة التاريخ غير صحيحة');
  const desiredLocalAsUtc = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    end ? 23 : 0,
    end ? 59 : 0,
    end ? 59 : 0,
    end ? 999 : 0
  );
  let candidate = new Date(desiredLocalAsUtc);
  for (let index = 0; index < 2; index += 1) {
    candidate = new Date(desiredLocalAsUtc - timeZoneOffsetMs(candidate, CAIRO_TZ));
  }
  return candidate.toISOString();
}

function cairoTodayDateText() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CAIRO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function startOfTodayIso() {
  return cairoDateBoundaryIso(cairoTodayDateText());
}

function daysAgoIso(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
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

export async function getCustomerRequestsPage(
  options: CustomerRequestPageOptions = {}
): Promise<CustomerRequestPageResult> {
  const page = Math.max(1, options.page || 1);
  const pageSize = Math.min(100, Math.max(10, options.pageSize || 30));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const branchAliases = customerRequestBranchAliases(options.branch);

  let overdueIds: string[] | null = null;
  if ((options.quickFilter || 'all') === 'overdue') {
    const { data, error } = await supabase.rpc('get_customer_request_overdue_ids', {
      p_branch: customerRequestSourceBranch(options.branch),
    });
    if (error) throw new Error(error.message);
    overdueIds = Array.isArray(data) ? (data as string[]) : [];
    if (overdueIds.length === 0) return { rows: [], count: 0, page: 1, pageSize, pages: 1 };
  }

  let query = supabase.from('customer_requests').select('*', { count: 'exact' });
  if ((options.quickFilter || 'all') === 'followup_due') {
    query = query.order('due_date', { ascending: true, nullsFirst: false }).order('is_urgent', { ascending: false });
  } else {
    query = query.order('is_urgent', { ascending: false }).order('updated_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false, nullsFirst: false });
  }

  if (options.requestId) query = query.eq('id', options.requestId);
  if (options.customerId) query = query.eq('customer_id', options.customerId);
  if (options.customerCode) query = query.eq('customer_code', options.customerCode);
  if (options.customerPhone) query = query.eq('customer_phone', options.customerPhone);
  if (options.productCode) query = query.eq('product_code', options.productCode);
  if (options.medicineName && !options.productCode) query = query.ilike('medicine_name', options.medicineName);
  if (options.registrar) {
    const registrar = safeSearch(options.registrar);
    query = query.or(`doctor_name.ilike.${registrar},created_by_name.ilike.${registrar},source_assigned_employee.ilike.${registrar}`);
  }

  if (options.status && options.status !== 'all') query = query.eq('status', options.status);
  if (branchAliases.length === 1) query = query.eq('branch', branchAliases[0]);
  if (branchAliases.length > 1) query = query.in('branch', branchAliases);
  if (options.sourceSystem && options.sourceSystem !== 'all') {
    if (options.sourceSystem === 'manual') query = query.is('source_system', null);
    else query = query.eq('source_system', options.sourceSystem);
  }
  if (options.sourceChannel && options.sourceChannel !== 'all') query = query.eq('source_request_channel', options.sourceChannel);
  if (options.urgency && options.urgency !== 'all') {
    if (options.urgency === 'urgent') query = query.or('is_urgent.eq.true,urgency.eq.urgent,urgency.eq.high,priority.eq.high');
    else query = query.eq('urgency', options.urgency);
  }
  if (options.assignee && options.assignee !== 'all') {
    if (options.assignee === 'unassigned') query = query.is('purchasing_assignee', null).is('source_assigned_employee', null);
    else {
      const term = safeSearch(options.assignee);
      query = query.or(`purchasing_assignee.ilike.%${term}%,source_assigned_employee.ilike.%${term}%`);
    }
  }
  if (options.dateFrom) query = query.gte('requested_at', cairoDateBoundaryIso(options.dateFrom));
  if (options.dateTo) query = query.lte('requested_at', cairoDateBoundaryIso(options.dateTo, true));

  const quick = options.quickFilter || 'all';
  if (quick === 'today') query = query.gte('requested_at', startOfTodayIso());
  if (quick === 'recent') query = query.gte('requested_at', daysAgoIso(7));
  if (quick === 'followup_due') query = query.not('status', 'in', `(${CLOSED.join(',')})`).not('due_date', 'is', null).lte('due_date', new Date().toISOString());
  if (quick === 'urgent') query = query.or('is_urgent.eq.true,urgency.eq.urgent,urgency.eq.high,priority.eq.high');
  if (quick === 'unlinked') query = query.is('customer_id', null);
  if (quick === 'unassigned') query = query.is('purchasing_assignee', null).is('source_assigned_employee', null);
  if (quick === 'sync_review') query = query.eq('sync_conflict', true).eq('sync_conflict_reason', 'branch_unresolved_after_customer_match');
  if (quick === 'backlog') query = query.not('status', 'in', `(${CLOSED.join(',')})`).lt('requested_at', daysAgoIso(7));
  if (quick === 'attention') query = query.not('status', 'in', `(${CLOSED.join(',')})`).gte('requested_at', daysAgoIso(7));
  if (quick === 'overdue' && overdueIds) query = query.in('id', overdueIds);

  const search = safeSearch(options.search || '');
  if (search) {
    query = query.or([
      `customer_name.ilike.%${search}%`,
      `customer_code.ilike.%${search}%`,
      `customer_phone.ilike.%${search}%`,
      `medicine_name.ilike.%${search}%`,
      `product_code.ilike.%${search}%`,
      `doctor_name.ilike.%${search}%`,
      `supplier_hint.ilike.%${search}%`,
      `source_order_number.ilike.%${search}%`,
      `source_assigned_employee.ilike.%${search}%`,
    ].join(','));
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
    rows: rows.map((row) => ({ ...row, customer_segment: row.customer_id ? segmentById.get(row.customer_id) || null : null })),
    count: exactCount,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(exactCount / pageSize)),
  };
}

export function customerRequestIsClosed(request: CustomerRequest) {
  return customerRequestIsClosedStatus(request.status);
}

export { customerRequestAgeHours, customerRequestIsOverdue, customerRequestIsUrgent, customerRequestQualityIssues };

export const customerRequestsRepository: CustomerRequestsRepository = {
  getSummary: getCustomerRequestsCommandSummary,
  getPage: getCustomerRequestsPage,
};
