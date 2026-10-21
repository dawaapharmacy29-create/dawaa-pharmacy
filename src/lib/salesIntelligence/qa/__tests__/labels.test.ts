import { describe, it, expect } from 'vitest';
import { labelOr, caseTypeLabels, reviewReasonLabels } from '../labels';

describe('QA labels', () => {
  it('returns the mapped Arabic label for a known value', () => {
    expect(labelOr(caseTypeLabels, 'sales_opportunity')).toBe('فرصة بيعية');
  });

  it('never shows an unmapped internal value in English; it reads as needing review', () => {
    expect(labelOr(caseTypeLabels, 'some_future_case_type')).toBe('قيمة غير مترجمة — يحتاج مراجعة');
    expect(labelOr(caseTypeLabels, 'قيمة عربية')).toBe('قيمة عربية');
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

  it('every review reason the engines emit for the Ibrahim review reads in Arabic', () => {
    const codes = ['source_branch_not_transaction_branch','service_case_does_not_inherit_source_branch','introduced_staff_unresolved',
      'explicit_branch_staff_unresolved','staff_home_branch_differs_from_operation','noncommercial_followup_not_attributable',
      'case_segmentation_uncertain','product_identity_unresolved','final_summary_missing','announced_total_missing',
      'customer_confirmation_uncertain','basket_not_detected','quantity_unknown','staff_identity_unresolved',
      'independent_multiple_requests_require_review','branch_conflict','noncommercial_nursing_service_requires_review'];
    for (const code of codes) {
      expect(reviewReasonLabels[code], code).toBeTruthy();
      expect(reviewReasonLabels[code], code).not.toMatch(/[A-Za-z]/);
    }
  });
});
