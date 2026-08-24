import { supabase } from '@/lib/supabase';
import {
  recordCustomerRequestContactAttempt,
  updateCustomerRequestStatus,
  type CustomerRequest,
} from '@/lib/api/customerRequests';
import { customerRequestPrimaryAction, normalizeCustomerRequestStatus } from '../domain/status';
import { assertCustomerRequestTransition } from '../domain/transitions';
import { moveCustomerRequestToShortageSecure } from './moveCustomerRequestToShortageSecure';

export interface CustomerRequestCommandActor {
  id?: string | null;
  name?: string | null;
}

export type CustomerRequestSourcingOutcome = 'available' | 'needs_customer_confirmation' | 'not_available';
export type CustomerRequestContactOutcome = 'answered' | 'no_answer' | 'later';

function actorInput(actor?: CustomerRequestCommandActor | null) {
  return { user_id: actor?.id || null, user_name: actor?.name || null };
}

function cairoDateText(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('موعد المتابعة غير صحيح');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function persistExactNextAction(requestId: string, followupAt?: string | null) {
  const nextActionAt = followupAt || null;
  const dueDate = nextActionAt ? cairoDateText(nextActionAt) : null;
  const { data, error } = await supabase
    .from('customer_requests')
    .update({ next_action_at: nextActionAt, due_date: dueDate })
    .eq('id', requestId)
    .select('*')
    .single();
  if (error) throw new Error(`تم تسجيل نتيجة التواصل لكن تعذر تثبيت موعد المتابعة الدقيق: ${error.message}`);
  return data as CustomerRequest;
}

export async function startCustomerRequestSearch(request: CustomerRequest, actor?: CustomerRequestCommandActor | null) {
  const status = normalizeCustomerRequestStatus(request.status);
  if (!['new', 'purchasing_review', 'not_available'].includes(status)) {
    throw new Error('لا يمكن بدء البحث من المرحلة الحالية');
  }
  const next = status === 'new' ? 'purchasing_review' : 'searching_suppliers';
  assertCustomerRequestTransition(status, next);
  return updateCustomerRequestStatus(request, {
    status: next,
    notes: next === 'purchasing_review' ? 'تم استلام طلب العميل للمراجعة' : status === 'not_available' ? 'إعادة فتح البحث عن الصنف أو البديل' : 'بدأ البحث عن الصنف',
    purchasing_assignee: actor?.name || request.purchasing_assignee || null,
    ...actorInput(actor),
  });
}

export async function reopenCustomerRequestSearch(
  request: CustomerRequest,
  reason: string,
  actor?: CustomerRequestCommandActor | null
) {
  const normalizedReason = reason.trim();
  if (!normalizedReason) throw new Error('سجل سبب إعادة البحث أو البديل قبل المتابعة');
  if (normalizeCustomerRequestStatus(request.status) !== 'not_available') {
    throw new Error('إعادة فتح البحث متاحة للطلب غير المتوفر فقط');
  }
  assertCustomerRequestTransition(request.status, 'searching_suppliers');
  return updateCustomerRequestStatus(request, {
    status: 'searching_suppliers',
    notes: `إعادة فتح البحث: ${normalizedReason}`,
    purchasing_notes: normalizedReason,
    purchasing_assignee: actor?.name || request.purchasing_assignee || null,
    ...actorInput(actor),
  });
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
    return updateCustomerRequestStatus(request, {
      status: 'not_available',
      notes,
      purchasing_notes: notes,
      ...actorInput(input.actor),
    });
  }
  if (input.outcome === 'needs_customer_confirmation') {
    return updateCustomerRequestStatus(request, {
      status: 'needs_customer_confirmation',
      notes,
      purchasing_notes: notes,
      customer_confirmation_status: 'pending',
      ...actorInput(input.actor),
    });
  }
  return updateCustomerRequestStatus(request, {
    status: 'available',
    notes,
    purchasing_notes: notes,
    expected_arrival_date: input.expectedArrivalDate || null,
    ...actorInput(input.actor),
  });
}

export async function confirmCustomerRequest(request: CustomerRequest, notes: string, actor?: CustomerRequestCommandActor | null) {
  assertCustomerRequestTransition(request.status, 'customer_confirmed');
  return updateCustomerRequestStatus(request, {
    status: 'customer_confirmed',
    notes: notes.trim() || 'تم تأكيد احتياج العميل للطلب',
    customer_confirmation_status: 'confirmed',
    ...actorInput(actor),
  });
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
  const updated = await recordCustomerRequestContactAttempt(request, {
    outcome: input.outcome,
    notes: input.notes || null,
    followup_at: input.followupAt || null,
    ...actorInput(input.actor),
  });
  return persistExactNextAction(updated.id, input.outcome === 'later' ? input.followupAt : null);
}

export async function deliverCustomerRequest(request: CustomerRequest, notes: string, actor?: CustomerRequestCommandActor | null) {
  assertCustomerRequestTransition(request.status, 'delivered');
  return updateCustomerRequestStatus(request, {
    status: 'delivered',
    notes: notes.trim() || 'تم تسليم الصنف للعميل / إتمام البيع',
    contact_summary: notes.trim() || request.contact_summary || 'تم التسليم',
    ...actorInput(actor),
  });
}

export async function cancelCustomerRequest(request: CustomerRequest, reason: string, actor?: CustomerRequestCommandActor | null) {
  const normalizedReason = reason.trim();
  if (!normalizedReason) throw new Error('سبب إلغاء الطلب مطلوب');
  assertCustomerRequestTransition(request.status, 'cancelled');
  return updateCustomerRequestStatus(request, {
    status: 'cancelled',
    notes: normalizedReason,
    ...actorInput(actor),
  });
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
