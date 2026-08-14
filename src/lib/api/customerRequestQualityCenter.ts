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

export async function getCustomerRequestQualityCenter(options: {
  branch?: string;
  issue?: QualityIssueType;
  search?: string;
  limit?: number;
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
  const allRows = ((data || []) as QualityCenterRequest[])
    .map((request) => ({ request, issues: requestQualityIssueKeys(request) }))
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

  for (const row of allRows) {
    for (const issue of row.issues) counts[issue] += 1;
  }

  const rows = allRows
    .filter(({ issues }) => options.issue && options.issue !== 'all' ? issues.includes(options.issue) : true)
    .filter(({ request }) => {
      if (!search) return true;
      return [request.customer_name, request.customer_code, request.customer_phone, request.medicine_name, request.product_code, request.branch]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
    });

  return { rows, counts };
}
