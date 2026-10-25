import { describe, expect, it } from 'vitest';
import {
  canonicalStaffRole,
  isCustomerServiceTeamLabel,
  staffCapabilities,
} from '../staffRoleCapabilities';

// Evaluation profiles and points_incentive applicability follow canonicalStaffRole. WhatsApp case
// analysis classifies «فريق دواء ألفا» as customer service through its own helper only.
describe('customer-service team label stays analysis-only', () => {
  it('canonicalStaffRole and capabilities for «فريق دواء ألفا» are unchanged (no incentive applicability)', () => {
    for (const label of ['فريق دواء ألفا', 'فريق دواء الفا', 'team dawaa alpha']) {
      expect(canonicalStaffRole(label)).toBe('other');
      expect(staffCapabilities(label)).toEqual([]);
    }
  });
  it('the analysis helper recognises the team and real customer-service roles', () => {
    expect(isCustomerServiceTeamLabel('فريق دواء ألفا')).toBe(true);
    expect(isCustomerServiceTeamLabel('خدمة العملاء')).toBe(true);
    expect(isCustomerServiceTeamLabel('صيدلاني')).toBe(false);
  });
});
