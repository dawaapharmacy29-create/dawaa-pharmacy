import { describe, expect, it } from 'vitest';
import {
  customerRequestBranchIdentity,
  customerRequestIncentiveCandidate,
  customerRequestOperationalStage,
  customerRequestPrimaryAction,
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

  it('fails closed when customer request incentive points are not configured', () => {
    const request = {
      id: 'request-1',
      customer_id: 'customer-1',
      customer_code: 'C100',
      customer_name: 'عميل اختبار',
      customer_phone: '01000000000',
      branch: 'فرع شكري',
      medicine_name: 'Product',
      product_code: 'P100',
      doctor_id: 'staff-1',
      doctor_name: 'د اختبار',
      status: 'new',
    } as any;

    const candidate = customerRequestIncentiveCandidate(request, 'request_registered', null);
    expect(candidate.points).toBeNull();
    expect(candidate.settlementReady).toBe(false);
    expect(candidate.blockedReasons).toContain('incentive_policy_missing');
  });

  it('settles only an eligible event with an explicit versioned policy value', () => {
    const request = {
      id: 'request-2',
      customer_id: 'customer-2',
      customer_code: 'C200',
      customer_name: 'عميل اختبار',
      customer_phone: '01000000001',
      branch: 'فرع الشامي',
      medicine_name: 'Product',
      product_code: 'P200',
      doctor_id: 'staff-2',
      doctor_name: 'د اختبار 2',
      status: 'new',
    } as any;

    const candidate = customerRequestIncentiveCandidate(request, 'request_registered', {
      policyKey: 'customer_requests',
      version: 'test-v1',
      effectiveFrom: null,
      pointsByEvent: { request_registered: 1 },
    });

    expect(candidate.points).toBe(1);
    expect(candidate.policyVersion).toBe('test-v1');
    expect(candidate.settlementReady).toBe(true);
  });
});
