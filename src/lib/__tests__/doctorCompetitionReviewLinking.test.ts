import { describe, expect, it } from 'vitest';
import { normalizeDoctorName } from '@/lib/doctorCompetitionMetrics';

describe('doctor competition review identity normalization', () => {
  it('normalizes doctor prefixes consistently', () => {
    expect(normalizeDoctorName('د اسلام فاروق')).toBe(normalizeDoctorName('د/ اسلام فاروق'));
    expect(normalizeDoctorName('د. يوسف')).toBe(normalizeDoctorName('د/ يوسف'));
  });

  it('keeps different doctor names distinct', () => {
    expect(normalizeDoctorName('د/ يوسف')).not.toBe(normalizeDoctorName('يوسف عصام'));
  });
});
