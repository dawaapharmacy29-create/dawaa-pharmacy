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

  it('has readable labels for the V8 case-review reasons surfaced in the management workspace', () => {
    expect(reviewReasonLabels.final_total_missing).toContain('إجمالي');
    expect(reviewReasonLabels.staff_final_confirmation_missing).toContain('تأكيد نهائي');
    expect(reviewReasonLabels.confirmation_protocol_incomplete).toContain('بروتوكول التأكيد');
    expect(reviewReasonLabels.customer_need_product_context_ambiguous).toContain('صنف ملتبس');
    expect(reviewReasonLabels['journey.review_required']).toContain('مسار البيع');
  });
});
