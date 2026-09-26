// Phase I.B.1 — Product alias-candidate model.
//
// NEVER auto-learns aliases into resolver evidence. This module only PROPOSES candidates from
// observed text; a human must move a candidate to 'approved' before pharmacyProductResolverV2.ts
// may use it as alias-basis evidence (see that file's match-basis hierarchy). No DB table is
// created in this phase (I.B.1 scope is the alias-candidate MODEL, not its persistence — proposing
// a migration is out of scope without explicit approval, per the standing "no schema changes
// without instruction" rule) — this is a pure, in-memory aggregator today; a future phase can
// persist ProductAliasCandidate rows once the shape has been used long enough to trust.
export type ProductAliasCandidateStatus = 'proposed' | 'approved' | 'rejected';

export interface ProductAliasCandidate {
  /** The exact text observed in conversation (already lightly normalized — see aggregateAliasCandidates). */
  observedText: string;
  /** The catalog product this text is proposed to refer to. */
  proposedProductId: string;
  /** How many distinct evidence occurrences support this proposal. */
  occurrenceCount: number;
  /** Every case_id where this observedText->proposedProductId pairing was seen — full traceability, never summarized away. */
  evidenceCaseIds: string[];
  /** 0-1, computed as occurrenceCount weighed by how many DIFFERENT conversations support it (see aggregateAliasCandidates) — never hand-set. */
  confidence: number;
  status: ProductAliasCandidateStatus;
}

export interface AliasObservation {
  observedText: string;
  proposedProductId: string;
  caseId: string;
}

/**
 * Pure aggregation: groups raw observations into candidates. Confidence is deliberately simple and
 * conservative today (repetition across distinct cases, capped at 0.9 — never 1.0, since an
 * alias-candidate can never be "proven" the way an exact code match can) — see the I.B.1 report's
 * confidence-calibration section for why this stays a floor until real approval/rejection outcomes
 * exist to calibrate against.
 */
export function aggregateAliasCandidates(observations: AliasObservation[]): ProductAliasCandidate[] {
  const byKey = new Map<string, { observedText: string; proposedProductId: string; caseIds: Set<string> }>();
  for (const obs of observations) {
    const key = `${obs.observedText.trim().toLowerCase()}::${obs.proposedProductId}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = { observedText: obs.observedText.trim(), proposedProductId: obs.proposedProductId, caseIds: new Set() };
      byKey.set(key, entry);
    }
    entry.caseIds.add(obs.caseId);
  }
  return Array.from(byKey.values()).map((entry) => {
    const distinctCases = entry.caseIds.size;
    const confidence = Math.min(0.9, 0.3 + distinctCases * 0.15);
    return {
      observedText: entry.observedText,
      proposedProductId: entry.proposedProductId,
      occurrenceCount: distinctCases,
      evidenceCaseIds: Array.from(entry.caseIds),
      confidence,
      status: 'proposed' as const,
    };
  });
}

/** The only alias evidence a resolver may ever use — approved candidates, nothing else. */
export function approvedAliasMap(candidates: ProductAliasCandidate[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const candidate of candidates) {
    if (candidate.status === 'approved') map.set(candidate.observedText.trim().toLowerCase(), candidate.proposedProductId);
  }
  return map;
}
