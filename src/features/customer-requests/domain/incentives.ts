import type { CustomerRequest } from '@/lib/api/customerRequests';
import { customerRequestIdentityIssues } from './request';

export const CUSTOMER_REQUEST_INCENTIVE_EVENTS = [
  'request_registered',
  'request_sourcing_started',
  'request_fulfilled',
  'customer_contacted',
  'request_delivered',
] as const;

export type CustomerRequestIncentiveEvent = (typeof CUSTOMER_REQUEST_INCENTIVE_EVENTS)[number];

export interface CustomerRequestIncentiveAttribution {
  requestId: string;
  event: CustomerRequestIncentiveEvent;
  staffId: string | null;
  staffName: string | null;
  eligible: boolean;
  blockedReasons: string[];
}

/**
 * This module intentionally does not assign point values.
 * Point values belong to the central incentive rules engine so changing a rule
 * never requires changing the customer-requests workflow.
 */
export function customerRequestIncentiveEligibility(request: CustomerRequest) {
  const identityIssues = customerRequestIdentityIssues(request);
  const blockedReasons: string[] = [];

  if (identityIssues.includes('missing_customer')) blockedReasons.push('customer_not_linked');
  if (identityIssues.includes('missing_product_code')) blockedReasons.push('product_not_linked');
  if (identityIssues.includes('missing_registrar')) blockedReasons.push('registrar_not_linked');
  if (request.sync_conflict) blockedReasons.push('sync_conflict');
  if (String(request.status || '') === 'cancelled' && /مكرر|بالخطأ|duplicate/i.test(String(request.doctor_notes || request.source_notes || ''))) {
    blockedReasons.push('duplicate_or_invalid_request');
  }

  return {
    eligible: blockedReasons.length === 0,
    blockedReasons,
  };
}

export function customerRequestRegistrarAttribution(
  request: CustomerRequest,
  event: CustomerRequestIncentiveEvent = 'request_registered'
): CustomerRequestIncentiveAttribution {
  const eligibility = customerRequestIncentiveEligibility(request);
  return {
    requestId: request.id,
    event,
    staffId: request.doctor_id || request.created_by || null,
    staffName: request.doctor_name?.trim() || request.created_by_name?.trim() || request.source_assigned_employee?.trim() || null,
    eligible: eligibility.eligible,
    blockedReasons: eligibility.blockedReasons,
  };
}
