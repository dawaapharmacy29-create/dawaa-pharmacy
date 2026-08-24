import { normalizeCustomerRequestStatus, type CanonicalCustomerRequestStatus } from './status';

const ALLOWED_TRANSITIONS: Record<CanonicalCustomerRequestStatus, readonly CanonicalCustomerRequestStatus[]> = {
  new: ['purchasing_review', 'cancelled'],
  purchasing_review: ['searching_suppliers', 'cancelled'],
  searching_suppliers: ['needs_customer_confirmation', 'available', 'not_available', 'cancelled'],
  needs_customer_confirmation: ['customer_confirmed', 'cancelled', 'not_available'],
  customer_confirmed: ['sourcing', 'available', 'not_available', 'cancelled'],
  sourcing: ['available', 'not_available', 'cancelled'],
  available: ['arrived', 'customer_contacted', 'cancelled'],
  arrived: ['customer_contacted', 'cancelled'],
  customer_contacted: ['delivered', 'cancelled'],
  delivered: ['closed'],
  closed: [],
  cancelled: [],
  not_available: ['searching_suppliers', 'cancelled'],
};

export function customerRequestAllowedTransitions(value?: string | null) {
  return ALLOWED_TRANSITIONS[normalizeCustomerRequestStatus(value)];
}

export function customerRequestCanTransition(from?: string | null, to?: string | null) {
  const fromStatus = normalizeCustomerRequestStatus(from);
  const toStatus = normalizeCustomerRequestStatus(to);
  if (fromStatus === toStatus) return true;
  return ALLOWED_TRANSITIONS[fromStatus].includes(toStatus);
}

export function assertCustomerRequestTransition(from?: string | null, to?: string | null) {
  if (customerRequestCanTransition(from, to)) return;
  throw new Error(`انتقال حالة طلب العميل غير مسموح: ${normalizeCustomerRequestStatus(from)} → ${normalizeCustomerRequestStatus(to)}`);
}
