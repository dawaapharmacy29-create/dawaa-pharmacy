import { describe, expect, it } from 'vitest';
import {
  evaluationProfileForRole,
  evaluationProfileWeightsAreValid,
} from '@/lib/evaluations/staffEvaluationProfilesV3';

describe('staffEvaluationProfilesV3', () => {
  it('keeps every role profile at exactly 100 percent', () => {
    expect(evaluationProfileWeightsAreValid()).toBe(true);
  });

  it('routes cleaner to cleaning-specific evaluation', () => {
    const profile = evaluationProfileForRole('مسؤولة النظافة');
    expect(profile.role).toBe('cleaning');
    expect(profile.sections.some((section) => section.key === 'daily_stars')).toBe(true);
    expect(profile.sections.some((section) => section.key === 'dispensing')).toBe(false);
  });

  it('routes pharmacy assistant away from doctor dispensing/conversation model', () => {
    const profile = evaluationProfileForRole('مساعد صيدلي');
    expect(profile.role).toBe('assistant');
    expect(profile.sections.some((section) => section.key === 'orders_accuracy')).toBe(true);
    expect(profile.sections.some((section) => section.key === 'dispensing')).toBe(false);
    expect(profile.sections.some((section) => section.key === 'conversations')).toBe(false);
  });

  it('gives customer service its own followup and data quality weights', () => {
    const profile = evaluationProfileForRole('مسؤولة خدمة العملاء');
    expect(profile.role).toBe('customer_service');
    expect(profile.sections.find((section) => section.key === 'followups')?.weight).toBe(30);
    expect(profile.sections.find((section) => section.key === 'data_quality')?.weight).toBe(20);
  });

  it('returns fresh section state for every caller', () => {
    const first = evaluationProfileForRole('صيدلاني');
    first.sections[0].score = 5;
    const second = evaluationProfileForRole('صيدلاني');
    expect(second.sections[0].score).toBe(0);
  });
});
