import { describe, expect, it } from 'vitest';
import {
  assertCustomerRequestTransition,
  customerRequestBranchIdentity,
  customerRequestCanTransition,
  customerRequestIncentiveCandidate,
  customerRequestIsClosedStatus,
  customerRequestOperationalStage,
  customerRequestPrimaryAction,
  customerRequestTierPoints,
  normalizeCustomerRequestDoctorTier,
  normalizeCustomerRequestStatus,
} from '../index';

describe('customer requests domain', () => {
  it('normalizes Base44 and app branch labels to one canonical branch', () => {
    expect(customerRequestBranchIdentity('فرع شكري').key).toBe('shokry');
    expect(customerRequestBranchIdentity('دواء شكري').key).toBe('shokry');
    expect(customerRequestBranchIdentity('فرع الشامي').key).toBe('elshamy');
    expect(customerRequestBranchIdentity('دواء الشامي').key).toBe('elshamy');
  });

  it('normalizes unknown workflow values safely', () => {
    expect(normalizeCustomerRequestStatus('available')).toBe('available');
    expect(normalizeCustomerRequestStatus('legacy_unknown')).toBe('new');
  });

  it('maps workflow states to one operational stage and primary action', () => {
    expect(customerRequestOperationalStage('available')).toBe('ready');
    expect(customerRequestPrimaryAction('available')).toEqual({ action: 'contact_customer', label: 'تواصل مع العميل' });
    expect(customerRequestOperationalStage('delivered')).toBe('completed');
  });

  it('allows only workflow-safe status transitions', () => {
    expect(customerRequestCanTransition('new', 'purchasing_review')).toBe(true);
    expect(customerRequestCanTransition('purchasing_review', 'searching_suppliers')).toBe(true);
    expect(customerRequestCanTransition('searching_suppliers', 'available')).toBe(true);
    expect(customerRequestCanTransition('available', 'customer_contacted')).toBe(true);
    expect(customerRequestCanTransition('customer_contacted', 'delivered')).toBe(true);
    expect(customerRequestCanTransition('new', 'delivered')).toBe(false);
    expect(customerRequestCanTransition('delivered', 'searching_suppliers')).toBe(false);
  });

  it('keeps not-available requests actionable for alternative review', () => {
    expect(customerRequestIsClosedStatus('not_available')).toBe(false);
    expect(customerRequestPrimaryAction('not_available')).toEqual({ action: 'review_exception', label: 'راجع البديل أو الإغلاق' });
    expect(customerRequestCanTransition('not_available', 'searching_suppliers')).toBe(true);
    expect(() => assertCustomerRequestTransition('not_available', 'searching_suppliers')).not.toThrow();
  });

  it('maps current staff incentive tier keys to the three doctor categories', () => {
    expect(normalizeCustomerRequestDoctorTier('senior_doctor')).toBe('tier_1');
    expect(normalizeCustomerRequestDoctorTier('mid_doctor')).toBe('tier_2');
    expect(normalizeCustomerRequestDoctorTier('assistant')).toBe('tier_3');
  });

  it('uses the approved registration and achievement points exactly', () => {
    expect(customerRequestTierPoints('tier_1', 'request_registered')).toBe(2);
    expect(customerRequestTierPoints('tier_2', 'request_registered')).toBe(1);
    expect(customerRequestTierPoints('tier_3', 'request_registered')).toBe(0.5);
    expect(customerRequestTierPoints('tier_1', 'request_achieved')).toBe(4);
    expect(customerRequestTierPoints('tier_2', 'request_achieved')).toBe(2);
    expect(customerRequestTierPoints('tier_3', 'request_achieved')).toBe(1);
  });

  it('fails closed when the doctor tier is missing', () => {
    const request = {
      id: 'request-1', customer_id: 'customer-1', customer_code: 'C100', customer_name: 'عميل اختبار',
      customer_phone: '01000000000', branch: 'فرع شكري', medicine_name: 'Product', product_code: 'P100',
      doctor_id: 'staff-1', doctor_name: 'د اختبار', status: 'new',
    } as any;
    const candidate = customerRequestIncentiveCandidate(request, 'request_registered', null);
    expect(candidate.points).toBeNull();
    expect(candidate.settlementReady).toBe(false);
    expect(candidate.blockedReasons).toContain('doctor_tier_missing');
  });

  it('creates the exact tier-one registration and achievement candidates', () => {
    const request = {
      id: 'request-2', customer_id: 'customer-2', customer_code: 'C200', customer_name: 'عميل اختبار',
      customer_phone: '01000000001', branch: 'فرع الشامي', medicine_name: 'Product', product_code: 'P200',
      doctor_id: 'staff-2', doctor_name: 'د اختبار 2', status: 'available',
    } as any;
    expect(customerRequestIncentiveCandidate(request, 'request_registered', 'senior_doctor').points).toBe(2);
    expect(customerRequestIncentiveCandidate(request, 'request_achieved', 'senior_doctor').points).toBe(4);
  });
});
