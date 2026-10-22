import { describe, expect, it } from 'vitest';
import { runSalesIntelligencePipeline } from '../salesIntelligencePipeline';
import { buildCanonicalComplaintActionRows } from '../persistence/canonicalComplaintProjector';

describe('canonical pipeline owns operational decisions', () => {
  it('computes unresolved complaint and request assessments before operational projection', () => {
    const raw = `[10/17/26, 10:00:00 AM] Customer: انا زعلان من مشكلة التوصيل
[10/17/26, 10:01:00 AM] You: حقك علينا هتابع بنفسي`;
    const result = runSalesIntelligencePipeline({
      conversationId: '11111111-1111-4111-8111-111111111111',
      rawWhatsAppExportText: raw,
      branchNameRawHint: 'فرع الشامي',
      resolveInvoiceCandidates: () => [],
    });
    expect(result.caseAnalyses.length).toBeGreaterThan(0);
    for (const analysis of result.caseAnalyses) {
      expect(analysis.complaintAssessment?.caseId).toBe(analysis.caseId);
      expect(analysis.customerRequestAssessment?.caseId).toBe(analysis.caseId);
      expect(analysis.salesOutcome.isSaleCountable).toBe(false);
      expect(analysis.salesOutcome.isRevenueCountable).toBe(false);
    }
    const actions = buildCanonicalComplaintActionRows(result.caseAnalyses, [{
      id: result.conversationId, raw_text: raw, customer_name: 'Synthetic customer', customer_code: '17',
    }]);
    expect(actions.rows).toHaveLength(1);
    expect(actions.rows[0]).toMatchObject({branch:'فرع الشامي',auto_eligible:false});
    expect(actions.rows[0].payload).toMatchObject({
      canonicalComplaintState:'recovery_attempted',reviewRequired:true,
    });
  });
});
