import { describe, expect, it } from 'vitest';
import {
  canonicalStaffRole,
  staffHasCapability,
} from '@/lib/staff/staffRoleCapabilities';

import { rulesForStaffRole } from '@/lib/evaluationRulesCatalog';

describe('staff role capabilities', () => {
  it('normalizes Arabic and English operating roles consistently', () => {
    expect(canonicalStaffRole('صيدلاني')).toBe('doctor');
    expect(canonicalStaffRole('pharmacist')).toBe('doctor');
    expect(canonicalStaffRole('مساعد صيدلي')).toBe('assistant');
    expect(canonicalStaffRole('assistant')).toBe('assistant');
    expect(canonicalStaffRole('inventory_assistant')).toBe('inventory_assistant');
    expect(canonicalStaffRole('مسؤولة النظافة')).toBe('cleaning');
    expect(canonicalStaffRole('cleaner')).toBe('cleaning');
    expect(canonicalStaffRole('customer_service_manager')).toBe('customer_service_manager');
    expect(canonicalStaffRole('مديرة الفروع')).toBe('branches_manager');
  });

  it('keeps sensitive operational capabilities scoped by role', () => {
    expect(staffHasCapability('صيدلاني', 'customer_conversation')).toBe(true);
    expect(staffHasCapability('مساعد صيدلي', 'customer_conversation')).toBe(false);
    expect(staffHasCapability('مسؤولة النظافة', 'cleaning')).toBe(true);
    expect(staffHasCapability('مسؤولة النظافة', 'sales_quality')).toBe(false);
    expect(staffHasCapability('توصيل', 'delivery')).toBe(true);
  });

  it('routes assistant and cleaning rules without leaking doctor-only scoped rules', () => {
    const assistantRules = rulesForStaffRole('مساعد صيدلي');
    const cleaningRules = rulesForStaffRole('مسؤولة النظافة');

    expect(assistantRules.some((rule) => rule.code.startsWith('ASSIST-V2-'))).toBe(true);
    expect(cleaningRules.some((rule) => rule.code.startsWith('CLEAN-V2-'))).toBe(true);

    expect(assistantRules.every((rule) => rule.role_scope === 'all' || rule.role_scopes?.includes('assistant'))).toBe(true);
    expect(cleaningRules.every((rule) => rule.role_scope === 'all' || rule.role_scopes?.includes('cleaning'))).toBe(true);
  });
});
