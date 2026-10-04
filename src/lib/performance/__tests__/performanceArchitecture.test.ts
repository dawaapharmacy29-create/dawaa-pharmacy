import { describe, expect, it } from 'vitest';
import { evaluationProfileWeightsAreValid, evaluationProfileForRole } from '@/lib/evaluations/staffEvaluationProfilesV3';
import { canonicalStaffRole } from '@/lib/staff/staffRoleCapabilities';

describe('performance shadow architecture contracts', () => {
  it('keeps every role scorecard normalized to 100%', () => {
    expect(evaluationProfileWeightsAreValid()).toBe(true);
  });
  it('uses dedicated role scorecards for the requested operating groups', () => {
    expect(evaluationProfileForRole('pharmacist').role).toBe('doctor');
    expect(evaluationProfileForRole('مندوب توصيل').role).toBe('delivery');
    expect(evaluationProfileForRole('مساعد مخزون').role).toBe('inventory_assistant');
    expect(canonicalStaffRole('مدير فرع')).toBe('branch_manager');
  });
  it('does not silently route an unknown role into doctor or delivery', () => {
    expect(canonicalStaffRole('دور غير معروف')).toBe('other');
    expect(evaluationProfileForRole('دور غير معروف').role).toBe('other');
  });
});
