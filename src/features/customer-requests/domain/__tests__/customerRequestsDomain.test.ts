import { describe, expect, it } from 'vitest';
import {
  customerRequestBranchIdentity,
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
});
