import { describe, expect, it } from 'vitest';
import { mapCaseAnalysisRowContent } from '../mappers';
import type { SalesIntelligenceCaseAnalysis } from '../../types';

describe('Sales Intelligence persistence — canonical outcome audit trail', () => {
  it('persists the engine canonicalSalesOutcome verbatim inside evidenceSnapshot', () => {
    const canonicalSalesOutcome = {
      caseId: 'source-1:interaction:0',
      outcome: 'sale_proven',
      saleProofState: 'proven',
      isSaleCountable: true,
      isRevenueCountable: true,
      isOrderConfirmed: true,
      needsHumanReview: false,
      reasonCodes: ['outcome.sale_proven.trusted_invoice'],
    };

    const analysis = {
      conversationCase: {
        caseId: 'source-1:interaction:0',
        caseType: 'sales_opportunity',
        status: 'customer_confirmed',
        customerId: 'customer-1',
        customerPhone: '01000000000',
        branchId: null,
        branchNameRaw: 'فرع شكري',
        startedAt: '2026-09-29T08:00:00.000Z',
        endedAt: '2026-09-29T08:10:00.000Z',
        confidence: { level: 'proven', score: 1, ruleIds: ['case.test'], evidence: [] },
      },
      status: 'analyzed',
      evidenceCompleteness: { overallEvidenceLevel: 'high' },
      historicalClosure: {
        closureLevel: 'strongly_inferred',
        confidence: { evidence: [] },
        ruleIds: ['closure.test'],
      },
      commercialConfirmation: { currentState: 'commercial_confirmation_complete' },
      protocolAssessment: { applicability: 'applicable' },
      attribution: { attributionLevel: 'proven' },
      basketInvoiceMatch: { integrityEvaluationScope: 'header_only' },
      needsHumanReview: false,
      humanReviewReasons: [],
      failureReasons: [],
      pipelineWarnings: [],
      salesOutcome: canonicalSalesOutcome,
    } as unknown as SalesIntelligenceCaseAnalysis;

    const row = mapCaseAnalysisRowContent(analysis);
    expect(row.evidenceSnapshot.canonicalSalesOutcome).toEqual(canonicalSalesOutcome);
  });
});
