import type { CustomerRequest } from '@/lib/api/customerRequests';
import { customerRequestIdentityIssues } from './request';

export const CUSTOMER_REQUEST_INCENTIVE_EVENTS = ['request_registered', 'request_achieved'] as const;
export type CustomerRequestIncentiveEvent = (typeof CUSTOMER_REQUEST_INCENTIVE_EVENTS)[number];
export type CustomerRequestDoctorTier = 'tier_1' | 'tier_2' | 'tier_3';

export const CUSTOMER_REQUEST_INCENTIVE_POLICY = {
  policyKey: 'customer_requests_doctor_points',
  version: '2026-08-24-v1',
  effectiveFrom: '2026-08-24T00:00:00+03:00',
  tiers: {
    tier_1: { sourceTierKey: 'senior_doctor', label: 'الفئة الأولى', request_registered: 2, request_achieved: 4 },
    tier_2: { sourceTierKey: 'mid_doctor', label: 'الفئة الثانية', request_registered: 1, request_achieved: 2 },
    tier_3: { sourceTierKey: 'assistant', label: 'الفئة الثالثة', request_registered: 0.5, request_achieved: 1 },
  },
} as const;

export interface CustomerRequestIncentiveAttribution {
  requestId: string;
  event: CustomerRequestIncentiveEvent;
  staffId: string | null;
  staffName: string | null;
  tier: CustomerRequestDoctorTier | null;
  eligible: boolean;
  blockedReasons: string[];
}

export interface CustomerRequestIncentiveCandidate extends CustomerRequestIncentiveAttribution {
  policyKey: string;
  policyVersion: string;
  points: number | null;
  settlementReady: boolean;
}

export function normalizeCustomerRequestDoctorTier(value?: string | null): CustomerRequestDoctorTier | null {
  const key = String(value || '').trim().toLowerCase();
  if (['tier_1', 'tier1', 'first', 'senior_doctor'].includes(key)) return 'tier_1';
  if (['tier_2', 'tier2', 'second', 'mid_doctor'].includes(key)) return 'tier_2';
  if (['tier_3', 'tier3', 'third', 'assistant'].includes(key)) return 'tier_3';
  return null;
}

export function customerRequestTierPoints(tier: CustomerRequestDoctorTier, event: CustomerRequestIncentiveEvent) {
  const row = CUSTOMER_REQUEST_INCENTIVE_POLICY.tiers[tier];
  const value = row[event];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function customerRequestIncentiveEligibility(request: CustomerRequest) {
  const identityIssues = customerRequestIdentityIssues(request);
  const blockedReasons: string[] = [];
  if (identityIssues.includes('missing_customer')) blockedReasons.push('customer_not_linked');
  if (identityIssues.includes('missing_customer_code')) blockedReasons.push('customer_code_missing');
  if (identityIssues.includes('missing_product')) blockedReasons.push('product_missing');
  if (identityIssues.includes('missing_product_code')) blockedReasons.push('product_not_linked');
  if (identityIssues.includes('missing_registrar')) blockedReasons.push('registrar_not_linked');
  if (request.sync_conflict) blockedReasons.push('sync_conflict');
  if (/مكرر|بالخطأ|duplicate/i.test(String(request.doctor_notes || request.source_notes || ''))) blockedReasons.push('duplicate_or_invalid_request');
  return { eligible: blockedReasons.length === 0, blockedReasons };
}

export function customerRequestRegistrarAttribution(
  request: CustomerRequest,
  event: CustomerRequestIncentiveEvent,
  tierKey?: string | null
): CustomerRequestIncentiveAttribution {
  const eligibility = customerRequestIncentiveEligibility(request);
  const tier = normalizeCustomerRequestDoctorTier(tierKey);
  const blockedReasons = [...eligibility.blockedReasons];
  if (!tier) blockedReasons.push('doctor_tier_missing');
  if (!request.doctor_id) blockedReasons.push('canonical_staff_id_missing');

  return {
    requestId: request.id,
    event,
    staffId: request.doctor_id || null,
    staffName: request.doctor_name?.trim() || request.created_by_name?.trim() || null,
    tier,
    eligible: eligibility.eligible && Boolean(tier) && Boolean(request.doctor_id),
    blockedReasons,
  };
}

export function customerRequestIncentiveCandidate(
  request: CustomerRequest,
  event: CustomerRequestIncentiveEvent,
  tierKey?: string | null
): CustomerRequestIncentiveCandidate {
  const attribution = customerRequestRegistrarAttribution(request, event, tierKey);
  const points = attribution.tier ? customerRequestTierPoints(attribution.tier, event) : null;
  const blockedReasons = [...attribution.blockedReasons];
  if (points === null) blockedReasons.push('event_points_unconfigured');
  return {
    ...attribution,
    eligible: attribution.eligible && points !== null,
    blockedReasons,
    policyKey: CUSTOMER_REQUEST_INCENTIVE_POLICY.policyKey,
    policyVersion: CUSTOMER_REQUEST_INCENTIVE_POLICY.version,
    points,
    settlementReady: attribution.eligible && points !== null,
  };
}
