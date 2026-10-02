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
    expect(canonicalStaffRole('مساعد')).toBe('assistant');
    expect(canonicalStaffRole('shift_supervisor_morning')).toBe('shift_supervisor');
    expect(canonicalStaffRole('shift_supervisor_evening')).toBe('shift_supervisor');
    expect(canonicalStaffRole('مسئولة شيفت صباحي')).toBe('shift_supervisor');
    expect(canonicalStaffRole('مسئول شيفت مسائي')).toBe('shift_supervisor');
    expect(canonicalStaffRole('branch_manager_shamy')).toBe('branch_manager');
    expect(canonicalStaffRole('branch_manager_shokry')).toBe('branch_manager');
    expect(canonicalStaffRole('خدمة العملاء')).toBe('customer_service');
    expect(canonicalStaffRole('مندوب توصيل')).toBe('delivery');
    expect(canonicalStaffRole('فريق دواء ألفا')).toBe('customer_service');
    expect(canonicalStaffRole('مندوب')).toBe('other');
    expect(canonicalStaffRole('صيدلي أول')).toBe('doctor');
    expect(canonicalStaffRole('senior pharmacist')).toBe('doctor');
    expect(canonicalStaffRole('مساعد صيدلية')).toBe('assistant');
    expect(canonicalStaffRole('مندوب دليفري')).toBe('delivery');
    expect(canonicalStaffRole('كول سنتر')).toBe('customer_service');
    expect(canonicalStaffRole('مشرف شيفت')).toBe('shift_supervisor');
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
