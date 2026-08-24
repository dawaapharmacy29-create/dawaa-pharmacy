import { supabase } from '@/lib/supabase';
import { createCustomerRequest, type CustomerRequest } from '@/lib/api/customerRequests';
import { linkCustomerRequestProduct, type CatalogProduct } from '@/lib/api/productsCatalog';
import type { CustomerSearchResult } from '@/lib/customerSearch';
import { customerRequestBranchAliases, customerRequestSourceBranch } from '../domain/branch';

export interface CanonicalCustomerRequestCreateInput {
  customer: CustomerSearchResult;
  product: CatalogProduct;
  doctor: { id: string; name: string };
  branch?: string | null;
  quantity?: number;
  urgency?: string;
  requestType?: string;
  channel?: string | null;
  neededBy?: string | null;
  expectedFulfillmentDays?: number | null;
  notes?: string | null;
  supplierHint?: string | null;
  imageUrl?: string | null;
  imagePath?: string | null;
  createdBy?: { id?: string | null; name?: string | null };
}

export interface CanonicalCustomerRequestIncentivePreview {
  tierKey: string | null;
  registrationPoints: number | null;
  achievementPoints: number | null;
  policyVersion: string | null;
  pointsEligible: boolean;
  blockedReason: string | null;
}

export interface CanonicalCustomerRequestCreateResult {
  request: CustomerRequest;
  duplicateRequest: CustomerRequest | null;
  incentive: CanonicalCustomerRequestIncentivePreview;
}

const OPEN_STATUSES = [
  'new',
  'purchasing_review',
  'searching_suppliers',
  'needs_customer_confirmation',
  'customer_confirmed',
  'sourcing',
  'available',
  'arrived',
  'customer_contacted',
];

function required(value: unknown, label: string) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label} مطلوب`);
  return text;
}

function numeric(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function resolveDoctorIncentivePreview(doctorId: string): Promise<CanonicalCustomerRequestIncentivePreview> {
  const { data, error } = await supabase.rpc('get_customer_request_doctor_incentive_preview', {
    p_staff_id: doctorId,
  });
  if (error) throw new Error(error.message);

  const row = (data || {}) as Record<string, unknown>;
  return {
    tierKey: row.tier_key ? String(row.tier_key) : null,
    registrationPoints: numeric(row.registration_points),
    achievementPoints: numeric(row.achievement_points),
    policyVersion: row.policy_version ? String(row.policy_version) : null,
    pointsEligible: Boolean(row.points_eligible),
    blockedReason: row.blocked_reason ? String(row.blocked_reason) : null,
  };
}

export async function getCanonicalCustomerRequestDoctorIncentivePreview(doctorId: string) {
  return resolveDoctorIncentivePreview(required(doctorId, 'الدكتور'));
}

export async function findOpenDuplicateCustomerRequest(input: {
  customerId: string;
  productCode: string;
  branch?: string | null;
  windowHours?: number;
}) {
  const since = new Date(Date.now() - Math.max(1, input.windowHours || 24) * 3_600_000).toISOString();
  let query = supabase
    .from('customer_requests')
    .select('*')
    .eq('customer_id', input.customerId)
    .eq('product_code', input.productCode)
    .in('status', OPEN_STATUSES)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1);

  const aliases = customerRequestBranchAliases(input.branch);
  if (aliases.length === 1) query = query.eq('branch', aliases[0]);
  if (aliases.length > 1) query = query.in('branch', aliases);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data || [])[0] || null) as CustomerRequest | null;
}

/**
 * Canonical creation boundary for new Customer Requests.
 * A new request must start from real customer/product/staff identities.
 * Product linkage is completed immediately after the legacy-compatible insert;
 * the database incentive trigger then retries registration settlement idempotently.
 */
export async function createCanonicalCustomerRequest(
  input: CanonicalCustomerRequestCreateInput
): Promise<CanonicalCustomerRequestCreateResult> {
  const customerId = required(input.customer.id, 'ربط العميل');
  const customerCode = required(input.customer.code, 'كود العميل');
  const productId = required(input.product.id, 'ربط الصنف');
  const productCode = required(input.product.code, 'كود الصنف');
  const productName = required(input.product.name, 'اسم الصنف');
  const doctorId = required(input.doctor.id, 'ربط الدكتور');
  const doctorName = required(input.doctor.name, 'اسم الدكتور');
  const branch = required(customerRequestSourceBranch(input.branch || input.customer.branch), 'الفرع');
  const quantity = Number(input.quantity || 1);
  if (!Number.isFinite(quantity) || quantity < 1) throw new Error('الكمية غير صحيحة');

  const incentive = await resolveDoctorIncentivePreview(doctorId);
  if (incentive.blockedReason === 'doctor_not_linked_to_staff') {
    throw new Error('الدكتور المختار غير مربوط بحساب موظف معتمد');
  }

  const duplicateRequest = await findOpenDuplicateCustomerRequest({
    customerId,
    productCode,
    branch,
    windowHours: 24,
  });
  if (duplicateRequest) return { request: duplicateRequest, duplicateRequest, incentive };

  const created = await createCustomerRequest({
    customer_id: customerId,
    customer_code: customerCode,
    customer_name: input.customer.name,
    customer_phone: input.customer.phone || null,
    branch,
    medicine_name: productName,
    medicine_image_url: input.imageUrl || null,
    item_image_url: input.imageUrl || null,
    item_image_path: input.imagePath || null,
    quantity,
    urgency: input.urgency || 'normal',
    request_type: input.requestType || 'missing_medicine',
    source_request_channel: input.channel || null,
    needed_by_date: input.neededBy || null,
    expected_fulfillment_days: input.expectedFulfillmentDays ?? null,
    doctor_id: doctorId,
    doctor_name: doctorName,
    doctor_notes: input.notes || null,
    supplier_hint: input.supplierHint || null,
    created_by: input.createdBy?.id || doctorId,
    created_by_name: input.createdBy?.name || doctorName,
  });

  await linkCustomerRequestProduct(created.id, productId);

  const { data, error } = await supabase
    .from('customer_requests')
    .select('*')
    .eq('id', created.id)
    .single();
  if (error) throw new Error(error.message);

  return { request: data as CustomerRequest, duplicateRequest: null, incentive };
}
