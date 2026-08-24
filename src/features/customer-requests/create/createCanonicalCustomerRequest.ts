import { supabase } from '@/lib/supabase';
import type { CustomerRequest } from '@/lib/api/customerRequests';
import type { CatalogProduct } from '@/lib/api/productsCatalog';
import type { CustomerSearchResult } from '@/lib/customerSearch';
import { customerRequestSourceBranch } from '../domain/branch';

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

export interface CanonicalCustomerRequestRegistrationCredit {
  settled: boolean;
  points: number | null;
  tierKey: string | null;
  policyVersion: string | null;
  eventId: string | null;
}

export interface CanonicalCustomerRequestCreateResult {
  request: CustomerRequest;
  duplicateRequest: CustomerRequest | null;
  incentive: CanonicalCustomerRequestIncentivePreview;
  registrationCredit: CanonicalCustomerRequestRegistrationCredit;
}

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

/**
 * Atomic canonical creation boundary.
 * Customer/product/staff identity, authorization, duplicate detection, request insert
 * and initial audit event are all validated inside one database transaction.
 */
export async function createCanonicalCustomerRequest(
  input: CanonicalCustomerRequestCreateInput
): Promise<CanonicalCustomerRequestCreateResult> {
  const customerId = required(input.customer.id, 'ربط العميل');
  required(input.customer.code, 'كود العميل');
  const productId = required(input.product.id, 'ربط الصنف');
  required(input.product.code, 'كود الصنف');
  required(input.product.name, 'اسم الصنف');
  const doctorId = required(input.doctor.id, 'ربط الدكتور');
  required(input.doctor.name, 'اسم الدكتور');
  const branch = required(customerRequestSourceBranch(input.branch || input.customer.branch), 'الفرع');
  const quantity = Number(input.quantity || 1);
  if (!Number.isFinite(quantity) || quantity < 1) throw new Error('الكمية غير صحيحة');

  const incentive = await resolveDoctorIncentivePreview(doctorId);
  if (incentive.blockedReason === 'doctor_not_linked_to_staff') {
    throw new Error('الدكتور المختار غير مربوط بموظف معتمد');
  }

  const { data, error } = await supabase.rpc('create_customer_request_canonical_v2', {
    p_customer_id: customerId,
    p_product_id: productId,
    p_doctor_id: doctorId,
    p_branch: branch,
    p_quantity: quantity,
    p_urgency: input.urgency || 'normal',
    p_request_type: input.requestType || 'missing_medicine',
    p_channel: input.channel || null,
    p_needed_by_date: input.neededBy || null,
    p_expected_fulfillment_days: input.expectedFulfillmentDays ?? null,
    p_supplier_hint: input.supplierHint || null,
    p_notes: input.notes || null,
    p_image_url: input.imageUrl || null,
    p_image_path: input.imagePath || null,
  });
  if (error) throw new Error(error.message);

  const result = (data || {}) as Record<string, unknown>;
  const request = result.request as CustomerRequest | undefined;
  if (!request?.id) throw new Error('تمت العملية بدون إرجاع الطلب المسجل');
  const duplicate = Boolean(result.duplicate);

  const creditRow = (result.registration_credit || {}) as Record<string, unknown>;
  const registrationCredit: CanonicalCustomerRequestRegistrationCredit = {
    settled: Boolean(creditRow.settled),
    points: numeric(creditRow.points),
    tierKey: creditRow.tier_key ? String(creditRow.tier_key) : null,
    policyVersion: creditRow.policy_version ? String(creditRow.policy_version) : null,
    eventId: creditRow.event_id ? String(creditRow.event_id) : null,
  };

  return {
    request,
    duplicateRequest: duplicate ? request : null,
    incentive,
    registrationCredit,
  };
}
