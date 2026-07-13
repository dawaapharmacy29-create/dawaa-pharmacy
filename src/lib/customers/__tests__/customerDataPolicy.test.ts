import { describe, expect, it } from 'vitest';
import {
  calculateAverageMonthly,
  classifyCustomerAccount,
  classifyCustomerByAverageMonthly,
  normalizeCustomerCode,
  resolveCustomerBranch,
} from '../customerDataPolicy';

describe('customerDataPolicy', () => {
  it('applies the requested exclusive classification boundaries', () => {
    expect(classifyCustomerByAverageMonthly(8000)).toBe('مهم');
    expect(classifyCustomerByAverageMonthly(8000.01)).toBe('مهم جدًا');
    expect(classifyCustomerByAverageMonthly(4000)).toBe('متوسط');
    expect(classifyCustomerByAverageMonthly(4000.01)).toBe('مهم');
    expect(classifyCustomerByAverageMonthly(1500)).toBe('1500 أو أقل');
    expect(classifyCustomerByAverageMonthly(1500.01)).toBe('متوسط');
  });

  it('calculates average using active months only', () => {
    expect(calculateAverageMonthly(20000, 2)).toBe(10000);
    expect(calculateAverageMonthly(20000, 0)).toBe(0);
  });

  it('normalizes Arabic digits and Excel numeric suffixes', () => {
    expect(normalizeCustomerCode(' ١٢٣٤.0 ')).toBe('1234');
    expect(normalizeCustomerCode('code:7788')).toBe('7788');
    expect(normalizeCustomerCode('.')).toBe('');
  });

  it('separates pseudo and internal accounts from real customers', () => {
    expect(classifyCustomerAccount({ customerCode: '7', customerName: 'عميل الصيدلية' })).toBe(
      'pseudo_customer'
    );
    expect(classifyCustomerAccount({ customerCode: '90', customerName: 'حساب الجرد' })).toBe(
      'internal_account'
    );
    expect(classifyCustomerAccount({ customerCode: '101', customerName: 'محمد احمد' })).toBe(
      'real_customer'
    );
  });

  it('marks close branch distributions as multi-branch', () => {
    expect(resolveCustomerBranch({ 'فرع شكري': 8000, 'فرع الشامي': 2000 })).toMatchObject({
      currentBranch: 'فرع شكري',
      confidence: 'high',
      isMultiBranch: false,
    });
    expect(resolveCustomerBranch({ 'فرع شكري': 5500, 'فرع الشامي': 4500 })).toMatchObject({
      currentBranch: 'فرع شكري',
      confidence: 'low',
      isMultiBranch: true,
    });
  });
});
