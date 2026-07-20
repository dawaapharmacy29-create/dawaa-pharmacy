import { describe, expect, it } from 'vitest';
import {
  buildCustomerIdentity,
  getCustomerActivityState,
  isFinalFollowupResult,
  isOpenFollowupResult,
  isValidEgyptianMobile,
  normalizeEgyptianPhone,
  resolveRequestedBy,
} from '@/lib/customerFollowupCore';
import { getFollowupDataIssues } from '@/lib/customerFollowupDataQuality';

describe('customer followup core', () => {
  it('prioritizes customer id in the canonical identity', () => {
    expect(
      buildCustomerIdentity({
        customerId: 'customer-1',
        customerCode: '100',
        phone: '01007524265',
        name: 'إسلام محمد',
      })
    ).toBe('id:customer-1');
  });

  it('uses code before phone when customer id is missing', () => {
    expect(buildCustomerIdentity({ customerCode: '8661', phone: '01007524265' })).toBe('code:8661');
  });

  it('normalizes Egyptian international mobile numbers', () => {
    expect(normalizeEgyptianPhone('+201007524265')).toBe('01007524265');
    expect(normalizeEgyptianPhone('00201007524265')).toBe('01007524265');
    expect(isValidEgyptianMobile('+201007524265')).toBe(true);
  });

  it('rejects incomplete mobile numbers', () => {
    expect(isValidEgyptianMobile('01')).toBe(false);
  });

  it('recognizes final and open followup results', () => {
    expect(isFinalFollowupResult('تم الرد والعميل راضي')).toBe(true);
    expect(isOpenFollowupResult('مؤجل')).toBe(true);
    expect(isOpenFollowupResult('not_started')).toBe(true);
  });

  it('classifies recent customers as active', () => {
    const state = getCustomerActivityState('2026-07-17', new Date('2026-07-20T12:00:00Z'));
    expect(state.key).toBe('active');
    expect(state.isAtRisk).toBe(false);
    expect(state.daysSinceLastPurchase).toBe(3);
  });

  it('marks customers without a purchase date as uncertain', () => {
    const state = getCustomerActivityState(null, new Date('2026-07-20T12:00:00Z'));
    expect(state.key).toBe('unknown');
    expect(state.isCertain).toBe(false);
  });

  it('resolves the requester from structured fields before text', () => {
    expect(
      resolveRequestedBy({
        created_by_name: 'د/ ضحى',
        request_details: 'طلب من: د معاذ',
      })
    ).toBe('د/ ضحى');
  });

  it('resolves the requester from legacy request text as a fallback', () => {
    expect(resolveRequestedBy({ request_details: 'طلب من: د معاذ | ملاحظة' })).toBe('د معاذ');
  });

  it('reports missing schedule and invalid phone in data quality diagnostics', () => {
    const issues = getFollowupDataIssues({
      customerId: 'id-1',
      customerCode: '8661',
      phone: '01',
      name: 'ش ++اسلام محمد',
      branch: 'فرع الشامي',
      requestedBy: 'د/ ضحى',
      reason: 'متابعة اهتمام',
      result: 'مؤجل',
      completed: false,
      customerLinked: true,
      salesLoaded: true,
    });
    expect(issues).toContain('رقم الهاتف غير صالح');
    expect(issues).toContain('متابعة مفتوحة بدون موعد قادم');
    expect(issues).toContain('اسم العميل يحتوي كودًا أو ملاحظات داخل الاسم');
  });
});
