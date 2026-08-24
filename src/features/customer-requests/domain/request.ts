import type { CustomerRequest } from '@/lib/api/customerRequests';
import { customerRequestBranchIdentity } from './branch';
import { customerRequestIsClosedStatus, customerRequestOperationalStage, customerRequestPrimaryAction } from './status';

export type CustomerRequestIdentityIssue =
  | 'missing_customer'
  | 'missing_customer_code'
  | 'missing_product'
  | 'missing_product_code'
  | 'missing_branch'
  | 'missing_phone'
  | 'missing_registrar';

type RequestWithExactNextAction = CustomerRequest & { next_action_at?: string | null };

export function customerRequestTimestamp(request: CustomerRequest) {
  return request.requested_at || request.created_at || null;
}

export function customerRequestAgeHours(request: CustomerRequest) {
  const raw = customerRequestTimestamp(request);
  if (!raw) return 0;
  const timestamp = new Date(raw).getTime();
  return Number.isFinite(timestamp) ? Math.max(0, (Date.now() - timestamp) / 3_600_000) : 0;
}

export function customerRequestStageAgeHours(request: CustomerRequest) {
  const raw = request.last_action_at || request.updated_at || request.requested_at || request.created_at;
  if (!raw) return 0;
  const timestamp = new Date(raw).getTime();
  return Number.isFinite(timestamp) ? Math.max(0, (Date.now() - timestamp) / 3_600_000) : 0;
}

export function customerRequestIsUrgent(request: CustomerRequest) {
  const urgency = String(request.urgency || '').trim().toLowerCase();
  const priority = String(request.priority || '').trim().toLowerCase();
  return Boolean(request.is_urgent || ['urgent', 'high', 'عاجل', 'مهم'].includes(urgency) || priority === 'high');
}

export function customerRequestSlaHours(request: CustomerRequest) {
  const status = String(request.status || 'new').toLowerCase();
  const urgent = customerRequestIsUrgent(request);
  if (customerRequestIsClosedStatus(status)) return 0;
  if (['new', 'purchasing_review'].includes(status)) return urgent ? 2 : 4;
  if (['searching_suppliers', 'sourcing'].includes(status)) return urgent ? 6 : 24;
  if (['needs_customer_confirmation', 'customer_confirmed'].includes(status)) return urgent ? 4 : 12;
  if (['available', 'arrived'].includes(status)) return urgent ? 1 : 2;
  if (status === 'customer_contacted') return urgent ? 12 : 24;
  return urgent ? 6 : 24;
}

export function customerRequestIsOverdue(request: CustomerRequest) {
  if (customerRequestIsClosedStatus(request.status)) return false;
  return customerRequestStageAgeHours(request) > customerRequestSlaHours(request);
}

export function customerRequestNextActionAt(request: CustomerRequest) {
  return (request as RequestWithExactNextAction).next_action_at || request.due_date || request.needed_by_date || null;
}

export function customerRequestIdentityIssues(request: CustomerRequest): CustomerRequestIdentityIssue[] {
  const issues: CustomerRequestIdentityIssue[] = [];
  const phone = String(request.customer_phone || '').replace(/\D/g, '');
  const productCode = String((request as CustomerRequest & { product_code?: string | null }).product_code || '').trim();
  if (!request.customer_id) issues.push('missing_customer');
  if (!String(request.customer_code || '').trim()) issues.push('missing_customer_code');
  if (!String(request.medicine_name || '').trim()) issues.push('missing_product');
  if (!productCode) issues.push('missing_product_code');
  if (!customerRequestBranchIdentity(request.branch).key) issues.push('missing_branch');
  if (!phone || /^0+$/.test(phone) || phone.length < 8) issues.push('missing_phone');
  if (!(request.doctor_id || request.created_by || request.doctor_name || request.created_by_name || request.source_assigned_employee)) issues.push('missing_registrar');
  return issues;
}

export function customerRequestQualityIssues(request: CustomerRequest) {
  const labels: Partial<Record<CustomerRequestIdentityIssue, string>> = {
    missing_customer: 'عميل غير مربوط',
    missing_customer_code: 'كود العميل غير مكتمل',
    missing_product: 'الصنف غير محدد',
    missing_product_code: 'كود الصنف غير مربوط',
    missing_branch: 'بدون فرع',
    missing_phone: 'هاتف يحتاج مراجعة',
    missing_registrar: 'مسجل الطلب غير مربوط',
  };
  const result = customerRequestIdentityIssues(request).map((issue) => labels[issue] || issue);
  if (!(request.purchasing_assignee || request.source_assigned_employee)?.trim()) result.push('بدون مسئول');
  if (request.sync_conflict) result.push('تعارض مزامنة');
  return result;
}

export function customerRequestOperationalView(request: CustomerRequest) {
  const branch = customerRequestBranchIdentity(request.branch);
  const ageHours = customerRequestAgeHours(request);
  const slaHours = customerRequestSlaHours(request);
  return {
    id: request.id,
    customer: {
      id: request.customer_id,
      code: request.customer_code,
      name: request.customer_name,
      phone: request.customer_phone,
      segment: request.customer_segment || null,
    },
    product: {
      id: (request as CustomerRequest & { product_id?: string | null }).product_id || null,
      code: (request as CustomerRequest & { product_code?: string | null }).product_code || null,
      name: request.medicine_name,
      quantity: Number(request.quantity || 1),
    },
    branch,
    status: request.status || 'new',
    stage: customerRequestOperationalStage(request.status),
    primaryAction: customerRequestPrimaryAction(request.status),
    urgent: customerRequestIsUrgent(request),
    overdue: customerRequestIsOverdue(request),
    ageHours,
    slaHours,
    dueAt: customerRequestNextActionAt(request),
    owner: request.purchasing_assignee?.trim() || request.source_assigned_employee?.trim() || request.searching_by_name?.trim() || null,
    registrar: {
      id: request.doctor_id || request.created_by || null,
      name: request.doctor_name?.trim() || request.created_by_name?.trim() || request.source_assigned_employee?.trim() || null,
    },
    identityIssues: customerRequestIdentityIssues(request),
  };
}
