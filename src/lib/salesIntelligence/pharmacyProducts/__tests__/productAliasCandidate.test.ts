import { describe, it, expect } from 'vitest';
import { aggregateAliasCandidates, approvedAliasMap, type ProductAliasCandidate } from '../productAliasCandidate';

describe('aggregateAliasCandidates', () => {
  it('groups observations by observedText+proposedProductId and counts distinct cases', () => {
    const candidates = aggregateAliasCandidates([
      { observedText: 'فليكس لايكس', proposedProductId: 'p-flexilax', caseId: 'case-1' },
      { observedText: 'فليكس لايكس', proposedProductId: 'p-flexilax', caseId: 'case-2' },
      { observedText: 'فليكس لايكس', proposedProductId: 'p-flexilax', caseId: 'case-1' }, // duplicate case, must not double-count
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].occurrenceCount).toBe(2);
    expect(candidates[0].evidenceCaseIds.sort()).toEqual(['case-1', 'case-2']);
    expect(candidates[0].status).toBe('proposed');
  });

  it('never assigns proven-level confidence to a proposed candidate', () => {
    const candidates = aggregateAliasCandidates(
      Array.from({ length: 20 }, (_, i) => ({ observedText: 'x', proposedProductId: 'p1', caseId: `case-${i}` }))
    );
    expect(candidates[0].confidence).toBeLessThanOrEqual(0.9);
  });

  it('keeps distinct observedText values as separate candidates', () => {
    const candidates = aggregateAliasCandidates([
      { observedText: 'فليكس لايكس', proposedProductId: 'p-flexilax', caseId: 'case-1' },
      { observedText: 'فليكسيلاكس', proposedProductId: 'p-flexilax', caseId: 'case-1' },
    ]);
    expect(candidates).toHaveLength(2);
  });
});

describe('approvedAliasMap', () => {
  it('only includes approved candidates, never proposed or rejected ones', () => {
    const candidates: ProductAliasCandidate[] = [
      { observedText: 'a', proposedProductId: 'p1', occurrenceCount: 5, evidenceCaseIds: [], confidence: 0.9, status: 'approved' },
      { observedText: 'b', proposedProductId: 'p2', occurrenceCount: 5, evidenceCaseIds: [], confidence: 0.9, status: 'proposed' },
      { observedText: 'c', proposedProductId: 'p3', occurrenceCount: 5, evidenceCaseIds: [], confidence: 0.9, status: 'rejected' },
    ];
    const map = approvedAliasMap(candidates);
    expect(map.get('a')).toBe('p1');
    expect(map.has('b')).toBe(false);
    expect(map.has('c')).toBe(false);
  });
});
