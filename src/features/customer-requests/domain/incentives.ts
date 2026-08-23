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

export interface CustomerRequestIncentivePolicy {
  policyKey: string;
  version: string;
  effectiveFrom: string | null;
  pointsByEvent: Partial<Record<CustomerRequestIncentiveEvent, number>>;
}

export interface CustomerRequestIncentiveCandidate extends CustomerRequestIncentiveAttribution {
  policyKey: string | null;
  policyVersion: string | null;
  points: number | null;
  settlementReady: boolean;
}

/**
 * Customer Requests owns event attribution and eligibility only.
 * Numeric point values must come from a versioned central policy and must never
 * be silently guessed in this feature. If a policy/event is missing, the
 * candidate stays non-settleable instead of awarding zero or an invented value.
 */
export function customerRequestIncentiveEligibility(request: CustomerRequest) {
  const identityIssues = customerRequestIdentityIssues(request);
  const blockedReasons: string[] = [];

  if (identityIssues.includes('missing_customer')) blockedReasons.push('customer_not_linked');
  if (identityIssues.includes('missing_customer_code')) blockedReasons.push('customer_code_missing');
  if (identityIssues.includes('missing_product')) blockedReasons.push('product_missing');
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

export function customerRequestIncentiveCandidate(
  request: CustomerRequest,
  event: CustomerRequestIncentiveEvent,
  policy?: CustomerRequestIncentivePolicy | null
): CustomerRequestIncentiveCandidate {
  const attribution = customerRequestRegistrarAttribution(request, event);
  const configuredPoints = policy?.pointsByEvent[event];
  const policyConfigured = typeof configuredPoints === 'number' && Number.isFinite(configuredPoints);
  const blockedReasons = [...attribution.blockedReasons];

  if (!policy) blockedReasons.push('incentive_policy_missing');
  else if (!policyConfigured) blockedReasons.push('event_points_unconfigured');

  return {
    ...attribution,
    eligible: attribution.eligible && policyConfigured,
    blockedReasons,
    policyKey: policy?.policyKey || null,
    policyVersion: policy?.version || null,
    points: policyConfigured ? configuredPoints : null,
    settlementReady: attribution.eligible && policyConfigured,
  };
}
