import { supabase } from '@/lib/supabase';
import type { CustomerRequest } from '@/lib/api/customerRequests';
import { customerRequestPrimaryAction, normalizeCustomerRequestStatus } from '../domain/status';
import { assertCustomerRequestTransition } from '../domain/transitions';
import { moveCustomerRequestToShortageSecure } from './moveCustomerRequestToShortageSecure';

export interface CustomerRequestCommandActor {
  id?: string | null;
  name?: string | null;
}

export type CustomerRequestSourcingOutcome = 'available' | 'needs_customer_confirmation' | 'not_available';
export type CustomerRequestContactOutcome = 'answered' | 'no_answer' | 'later';

async function runAtomicTransition(
  request: CustomerRequest,
  action: string,
  notes?: string | null,
  expectedArrivalDate?: string | null
) {
  const { data, error } = await supabase.rpc('advance_customer_request_v2', {
    p_request_id: request.id,
    p_action: action,
    p_notes: notes?.trim() || null,
    p_expected_arrival_date: expectedArrivalDate || null,
  });
  if (error) throw new Error(error.message);
  return data as CustomerRequest;
}

export async function startCustomerRequestSearch(request: CustomerRequest, _actor?: CustomerRequestCommandActor | null) {
  const status = normalizeCustomerRequestStatus(request.status);
  if (!['new', 'purchasing_review', 'not_available'].includes(status)) {
    throw new Error('لا يمكن بدء البحث من المرحلة الحالية');
  }
  if (status === 'new') {
    assertCustomerRequestTransition(status, 'purchasing_review');
    return runAtomicTransition(request, 'start_review');
  }
  if (status === 'purchasing_review') {
    assertCustomerRequestTransition(status, 'searching_suppliers');
    return runAtomicTransition(request, 'start_search');
  }
  throw new Error('الطلب غير متوفر يحتاج سببًا موثقًا لإعادة فتح البحث');
}

export async function reopenCustomerRequestSearch(
  request: CustomerRequest,
  reason: string,
  _actor?: CustomerRequestCommandActor | null
) {
  const normalizedReason = reason.trim();
  if (!normalizedReason) throw new Error('سجل سبب إعادة البحث أو البديل قبل المتابعة');
  if (normalizeCustomerRequestStatus(request.status) !== 'not_available') {
    throw new Error('إعادة فتح البحث متاحة للطلب غير المتوفر فقط');
  }
  assertCustomerRequestTransition(request.status, 'searching_suppliers');
  return runAtomicTransition(request, 'reopen_search', normalizedReason);
}

export async function recordCustomerRequestSourcing(
  request: CustomerRequest,
  input: {
    outcome: CustomerRequestSourcingOutcome;
    notes: string;
    expectedArrivalDate?: string | null;
    actor?: CustomerRequestCommandActor | null;
  }
) {
  const notes = input.notes.trim();
  if (!notes) throw new Error('سجل نتيجة البحث أو التوفير قبل الحفظ');
  assertCustomerRequestTransition(request.status, input.outcome);
  if (input.outcome === 'not_available') {
    return runAtomicTransition(request, 'sourcing_not_available', notes);
  }
  if (input.outcome === 'needs_customer_confirmation') {
    return runAtomicTransition(request, 'sourcing_needs_confirmation', notes);
  }
  return runAtomicTransition(request, 'sourcing_available', notes, input.expectedArrivalDate || null);
}

export async function confirmCustomerRequest(request: CustomerRequest, notes: string, _actor?: CustomerRequestCommandActor | null) {
  assertCustomerRequestTransition(request.status, 'customer_confirmed');
  return runAtomicTransition(request, 'confirm_customer', notes.trim() || null);
}

export async function contactCustomerForRequest(
  request: CustomerRequest,
  input: {
    outcome: CustomerRequestContactOutcome;
    notes?: string | null;
    followupAt?: string | null;
    actor?: CustomerRequestCommandActor | null;
  }
) {
  if (input.outcome === 'later' && !input.followupAt) throw new Error('حدد موعد المتابعة القادمة');
  if (input.outcome === 'answered') assertCustomerRequestTransition(request.status, 'customer_contacted');
  const { data, error } = await supabase.rpc('record_customer_request_contact_v2', {
    p_request_id: request.id,
    p_outcome: input.outcome,
    p_notes: input.notes?.trim() || null,
    p_followup_at: input.outcome === 'later' ? input.followupAt || null : null,
  });
  if (error) throw new Error(error.message);
  return data as CustomerRequest;
}

export async function deliverCustomerRequest(request: CustomerRequest, notes: string, _actor?: CustomerRequestCommandActor | null) {
  assertCustomerRequestTransition(request.status, 'delivered');
  return runAtomicTransition(request, 'deliver', notes.trim() || null);
}

export async function cancelCustomerRequest(request: CustomerRequest, reason: string, _actor?: CustomerRequestCommandActor | null) {
  const normalizedReason = reason.trim();
  if (!normalizedReason) throw new Error('سبب إلغاء الطلب مطلوب');
  assertCustomerRequestTransition(request.status, 'cancelled');
  return runAtomicTransition(request, 'cancel', normalizedReason);
}

export async function executeCustomerRequestPrimaryAction(
  request: CustomerRequest,
  input: { actor?: CustomerRequestCommandActor | null; notes?: string | null }
) {
  const action = customerRequestPrimaryAction(request.status);
  switch (action.action) {
    case 'start_search':
      return startCustomerRequestSearch(request, input.actor);
    case 'confirm_customer':
      return confirmCustomerRequest(request, input.notes || '', input.actor);
    case 'confirm_delivery':
      return deliverCustomerRequest(request, input.notes || '', input.actor);
    case 'record_sourcing':
    case 'contact_customer':
    case 'review_exception':
      throw new Error('هذا الإجراء يحتاج نتيجة تفصيلية قبل الحفظ');
    case 'none':
      return request;
  }
}

export async function sendCustomerRequestToShortages(request: CustomerRequest, _actor?: CustomerRequestCommandActor | null) {
  const updated = await moveCustomerRequestToShortageSecure(request);
  return { request: updated };
}
