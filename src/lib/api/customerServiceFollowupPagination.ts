import { normalizeBranchName } from '@/lib/branch';
import { supabase } from '@/lib/supabase';

export type FollowupPageFilters = {
  branch?: string | null;
  search?: string | null;
  status?: string | null;
  responsible?: string | null;
  includeHidden?: boolean;
  completed?: boolean | null;
  page?: number;
  pageSize?: number;
};

export type FollowupPage<T = Record<string, unknown>> = {
  rows: T[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
};

const DEFAULT_PAGE_SIZE = 250;
const MAX_PAGE_SIZE = 500;
const MAX_EXPORT_ROWS = 50_000;

function safePageSize(value?: number) {
  return Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(value || DEFAULT_PAGE_SIZE)));
}

function cleanSearch(value?: string | null) {
  return String(value || '').trim().replace(/[%_,]/g, ' ');
}

function isAll(value?: string | null) {
  return !value || value === 'all' || value === 'كل الفروع' || value === 'الكل';
}

export async function fetchCustomerServiceFollowupPage<T = Record<string, unknown>>(
  filters: FollowupPageFilters = {}
): Promise<FollowupPage<T>> {
  const page = Math.max(0, Math.floor(filters.page || 0));
  const pageSize = safePageSize(filters.pageSize);
  const from = page * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('daily_followups')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (!filters.includeHidden) query = query.eq('is_hidden', false);
  const branch = normalizeBranchName(filters.branch || '');
  if (!isAll(filters.branch) && branch) query = query.eq('branch', branch);

  if (filters.completed === true) query = query.not('completed_at', 'is', null);
  else if (filters.completed === false) {
    query = query
      .is('completed_at', null)
      .is('cancelled_at', null)
      .is('archived_at', null);
  }

  if (!isAll(filters.status)) {
    if (filters.status === 'يحتاج مدير') query = query.eq('needs_manager', true);
    else {
      const status = String(filters.status || '').replace(/[,]/g, '');
      query = query.or(
        `status.eq.${status},followup_status.eq.${status},contact_status.eq.${status},followup_result.eq.${status}`
      );
    }
  }

  if (!isAll(filters.responsible)) {
    const responsible = String(filters.responsible || '').replace(/[,]/g, '');
    query = query.or(
      `responsible_name.eq.${responsible},assigned_to.eq.${responsible},assigned_doctor.eq.${responsible}`
    );
  }

  const search = cleanSearch(filters.search);
  if (search) {
    const pattern = `%${search}%`;
    query = query.or(
      `customer_name.ilike.${pattern},name.ilike.${pattern},customer_code.ilike.${pattern},customer_phone.ilike.${pattern},phone.ilike.${pattern}`
    );
  }

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  const rows = (data || []) as T[];
  const total = Number(count || 0);
  return { rows, page, pageSize, total, hasMore: from + rows.length < total };
}

export async function fetchAllCustomerServiceFollowups<T = Record<string, unknown>>(
  filters: Omit<FollowupPageFilters, 'page'> = {},
  options: { maxRows?: number; onPage?: (page: FollowupPage<T>) => void } = {}
): Promise<T[]> {
  const pageSize = safePageSize(filters.pageSize || MAX_PAGE_SIZE);
  const maxRows = Math.max(1, Math.min(MAX_EXPORT_ROWS, options.maxRows || MAX_EXPORT_ROWS));
  const all: T[] = [];

  for (let page = 0; all.length < maxRows; page += 1) {
    const result = await fetchCustomerServiceFollowupPage<T>({ ...filters, page, pageSize });
    all.push(...result.rows.slice(0, maxRows - all.length));
    options.onPage?.(result);
    if (!result.hasMore || !result.rows.length) break;
  }

  return all;
}
