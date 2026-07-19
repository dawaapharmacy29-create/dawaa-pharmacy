import { describe, expect, it } from 'vitest';
import {
  buildCustomerIdentity,
  getFollowupDataIssues,
  isFinalFollowupStatus,
  isOpenFollowupStatus,
  isValidEgyptianMobile,
  normalizeEgyptianPhone,
  resolveRequestedBy,
} from '@/lib/customerFollowupGuards';

describe('customer followup guards', () => {
  it('normalizes Egyptian phones', () => {
    expect(normalizeEgyptianPhone('+201007524265')).toBe('01007524265');
    expect(normalizeEgyptianPhone('00201007524265')).toBe('01007524265');
    expect(isValidEgyptianMobile('01')).toBe(false);
    expect(isValidEgyptianMobile('01007524265')).toBe(true);
  });

  it('builds stable prefixed identities', () => {
    expect(buildCustomerIdentity({ customerId: 'abc', customerCode: '12', phone: '01007524265' })).toBe('id:abc');
    expect(buildCustomerIdentity({ customerCode: '12', phone: '01007524265' })).toBe('code:12');
    expect(buildCustomerIdentity({ phone: '+201007524265' })).toBe('phone:01007524265');
  });

  it('classifies open and final states', () => {
    expect(isOpenFollowupStatus('open')).toBe(true);
    expect(isOpenFollowupStatus('مؤجل')).toBe(true);
    expect(isFinalFollowupStatus('completed')).toBe(true);
    expect(isFinalFollowupStatus('تم الشراء بعد المتابعة')).toBe(true);
  });

  it('extracts requester from internal notes', () => {
    expect(resolveRequestedBy({ followup_reason: 'طلب من: د معاذ | متابعة عميل مهم' })).toBe('د معاذ');
  });

  it('flags incomplete open followups', () => {
    const issues = getFollowupDataIssues({
      customerName: 'عميل اختبار',
      customerCode: '123',
      phone: '01',
      branch: 'فرع الشامي',
      requestedBy: 'غير محدد',
      reason: '0',
      status: 'open',
      nextFollowupDate: null,
    });
    expect(issues).toContain('رقم الهاتف غير صالح');
    expect(issues).toContain('مقدم الطلب غير محدد');
    expect(issues).toContain('سبب المتابعة غير واضح');
    expect(issues).toContain('متابعة مفتوحة بدون موعد قادم');
  });

  it('flags completed followups without an official result', () => {
    const issues = getFollowupDataIssues({
      customerId: 'abc',
      customerName: 'عميل اختبار',
      customerCode: '123',
      phone: '01007524265',
      branch: 'فرع الشامي',
      requestedBy: 'د معاذ',
      reason: 'متابعة احتياجات العميل',
      status: 'completed',
      result: '',
      completedAt: new Date().toISOString(),
    });
    expect(issues).toContain('متابعة مكتملة بدون نتيجة رسمية');
  });
});
