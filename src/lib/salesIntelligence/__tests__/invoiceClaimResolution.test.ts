import { describe, expect, it } from 'vitest';
import { resolveExclusiveInvoiceClaims } from '@/lib/salesIntelligence/invoiceClaimResolution';

function analysis(input: { caseId: string; invoiceId: string; direct?: boolean; time?: any; score?: number; total?: any }) {
  const candidate: any = {
    caseId: input.caseId, invoiceId: input.invoiceId, invoiceNumber: input.invoiceId,
    customerIdMatch: true, phoneMatch: true, identityConflict: 'none', branchMatch: 'exact_canonical',
    timeDistanceMinutes: 0, timeMatchStrength: input.time ?? 'strong', staffMatch: 'unknown',
    announcedTotalMatch: input.total ?? 'not_available', basketValueMatch: 'not_available',
    productMatch: 'unavailable', quantityMatch: 'unavailable', legacyEvidenceMatch: false,
    directOrderLink: false, directInvoiceLink: input.direct ?? false, evidence: [], ruleIds: [],
    confidenceAssessment: { level: input.direct ? 'proven' : 'strongly_inferred', score: input.score ?? 0.6, ruleIds: [], evidence: [] },
    disqualifiers: [],
  };
  return { caseId: input.caseId, attribution: { selectedInvoiceId: input.invoiceId, selectedCandidate: candidate } } as any;
}

describe('Exclusive invoice claim resolution', () => {
  it('prioritizes a unique trusted link', () => {
    const result = resolveExclusiveInvoiceClaims([
      analysis({ caseId: 'trusted', invoiceId: 'inv-1', direct: true, time: 'moderate' }),
      analysis({ caseId: 'near', invoiceId: 'inv-1', time: 'very_strong', score: 0.9 }),
    ]);
    expect(result.resolvedWinners[0].winnerCaseId).toBe('trusted');
    expect(result.deniedInvoiceIdsByCase.get('near')?.has('inv-1')).toBe(true);
  });

  it('prefers independent transaction corroboration before time proximity', () => {
    const result = resolveExclusiveInvoiceClaims([
      analysis({ caseId: 'total', invoiceId: 'inv-1', time: 'moderate', total: 'exact', score: 0.7 }),
      analysis({ caseId: 'near', invoiceId: 'inv-1', time: 'very_strong', score: 0.75 }),
    ]);
    expect(result.resolvedWinners[0].winnerCaseId).toBe('total');
  });

  it('uses a stronger time band when corroboration is equal', () => {
    const result = resolveExclusiveInvoiceClaims([
      analysis({ caseId: 'older', invoiceId: 'inv-1', time: 'moderate', score: 0.6 }),
      analysis({ caseId: 'during', invoiceId: 'inv-1', time: 'very_strong', score: 0.55 }),
    ]);
    expect(result.resolvedWinners[0].winnerCaseId).toBe('during');
  });

  it('keeps a near score tie unresolved', () => {
    const result = resolveExclusiveInvoiceClaims([
      analysis({ caseId: 'a', invoiceId: 'inv-1', time: 'strong', score: 0.60 }),
      analysis({ caseId: 'b', invoiceId: 'inv-1', time: 'strong', score: 0.63 }),
    ]);
    expect(result.resolvedWinners).toHaveLength(0);
    expect(result.unresolvedCompetingSelections).toHaveLength(2);
  });

  it('uses score only when the difference clears the ambiguity margin', () => {
    const result = resolveExclusiveInvoiceClaims([
      analysis({ caseId: 'a', invoiceId: 'inv-1', time: 'strong', score: 0.60 }),
      analysis({ caseId: 'b', invoiceId: 'inv-1', time: 'strong', score: 0.70 }),
    ]);
    expect(result.resolvedWinners[0].winnerCaseId).toBe('b');
  });
});
