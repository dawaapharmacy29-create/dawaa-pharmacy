import { describe, expect, it } from 'vitest';
import { resolveCustomerDisplayIdentity } from '../customerDisplayIdentity';

describe('customerDisplayIdentity', () => {
  it('splits an attached Dawaa customer code from the WhatsApp display name', () => {
    expect(resolveCustomerDisplayIdentity({ sourceName: 'محمد الكموني17777' })).toMatchObject({
      name: 'محمد الكموني',
      code: '17777',
      codeSource: 'name_suffix',
    });
  });

  it('supports spaced, dashed, parenthesized and hash-separated codes', () => {
    for (const value of ['محمد الكموني 17777', 'محمد الكموني - 17777', 'محمد الكموني (17777)', 'محمد الكموني #17777']) {
      const result = resolveCustomerDisplayIdentity({ sourceName: value });
      expect(result.name).toBe('محمد الكموني');
      expect(result.code).toBe('17777');
    }
  });

  it('normalizes Arabic digits in a code suffix', () => {
    expect(resolveCustomerDisplayIdentity({ sourceName: 'محمد الكموني١٧٧٧٧' }).code).toBe('17777');
  });

  it('never mistakes a phone-like suffix for a customer code', () => {
    const result = resolveCustomerDisplayIdentity({ sourceName: 'محمد 01012345678' });
    expect(result.name).toBe('محمد 01012345678');
    expect(result.code).toBeNull();
  });

  it('prefers an explicit source code over a name suffix', () => {
    expect(resolveCustomerDisplayIdentity({ sourceName: 'محمد17777', sourceCode: '555' }).code).toBe('555');
  });

  it('uses fallback identity only when source metadata is missing', () => {
    expect(resolveCustomerDisplayIdentity({
      sourceName: null,
      sourceCode: null,
      sourcePhone: null,
      fallbackName: 'أحمد علي4455',
      fallbackPhone: '01000000000',
    })).toMatchObject({ name: 'أحمد علي', code: '4455', phone: '01000000000' });
  });
});
