import { describe, it, expect } from 'vitest';
import { labelOr, caseTypeLabels, reviewReasonLabels } from '../labels';

describe('QA labels', () => {
  it('returns the mapped Arabic label for a known value', () => {
    expect(labelOr(caseTypeLabels, 'sales_opportunity')).toBe('فرصة بيعية');
  });

  it('falls back to a humanized string for an unmapped value instead of hiding it', () => {
    expect(labelOr(caseTypeLabels, 'some_future_case_type')).toBe('some future case type');
  });

  it('returns the fallback placeholder for null/undefined', () => {
    expect(labelOr(caseTypeLabels, null)).toBe('—');
    expect(labelOr(caseTypeLabels, undefined)).toBe('—');
  });

  it('never frames confirmation_protocol_incomplete/final_total_missing/staff_final_confirmation_missing as a violation', () => {
    expect(reviewReasonLabels.confirmation_protocol_incomplete).toMatch(/دلالة إجرائية فقط/);
    expect(reviewReasonLabels.final_total_missing).toMatch(/دلالة إجرائية فقط/);
    expect(reviewReasonLabels.staff_final_confirmation_missing).toMatch(/دلالة إجرائية فقط/);
  });
});
