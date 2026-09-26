import type { SalesIntelligenceCaseAnalysis, SaleAttributionCandidate } from './types';

const SCORE_MARGIN = 0.05;

export interface InvoiceClaimResolution {
  deniedInvoiceIdsByCase: Map<string, Set<string>>;
  unresolvedCompetingSelections: Array<{ caseId: string; invoiceId: string }>;
  resolvedWinners: Array<{ invoiceId: string; winnerCaseId: string; loserCaseIds: string[] }>;
}

interface Claim {
  caseId: string;
  invoiceId: string;
  candidate: SaleAttributionCandidate;
}

function corroborationCount(candidate: SaleAttributionCandidate): number {
  let count = 0;
  if (candidate.announcedTotalMatch === 'exact' || candidate.announcedTotalMatch === 'near_match') count += 1;
  if (candidate.basketValueMatch === 'exact' || candidate.basketValueMatch === 'near_match') count += 1;
  if (candidate.productMatch === 'available_match') count += 1;
  if (candidate.quantityMatch === 'available_match') count += 1;
  if (candidate.staffMatch === 'same') count += 1;
  return count;
}

function timeRank(candidate: SaleAttributionCandidate): number {
  switch (candidate.timeMatchStrength) {
    case 'very_strong': return 5;
    case 'strong': return 4;
    case 'moderate': return 3;
    case 'weak': return 2;
    case 'very_weak': return 1;
    default: return 0;
  }
}

function compareClaimStrength(a: Claim, b: Claim): number {
  const directDiff = Number(a.candidate.directInvoiceLink) - Number(b.candidate.directInvoiceLink);
  if (directDiff !== 0) return directDiff;
  const corroborationDiff = corroborationCount(a.candidate) - corroborationCount(b.candidate);
  if (corroborationDiff !== 0) return corroborationDiff;
  const timeDiff = timeRank(a.candidate) - timeRank(b.candidate);
  if (timeDiff !== 0) return timeDiff;
  const scoreDiff = a.candidate.confidenceAssessment.score - b.candidate.confidenceAssessment.score;
  if (Math.abs(scoreDiff) > SCORE_MARGIN) return scoreDiff;
  return 0;
}

function addDenied(map: Map<string, Set<string>>, caseId: string, invoiceId: string): void {
  const bucket = map.get(caseId) ?? new Set<string>();
  bucket.add(invoiceId);
  map.set(caseId, bucket);
}

export function resolveExclusiveInvoiceClaims(analyses: SalesIntelligenceCaseAnalysis[]): InvoiceClaimResolution {
  const claimsByInvoice = new Map<string, Claim[]>();
  for (const analysis of analyses) {
    const invoiceId = analysis.attribution.selectedInvoiceId;
    const candidate = analysis.attribution.selectedCandidate;
    if (!invoiceId || !candidate) continue;
    const bucket = claimsByInvoice.get(invoiceId) ?? [];
    bucket.push({ caseId: analysis.caseId, invoiceId, candidate });
    claimsByInvoice.set(invoiceId, bucket);
  }

  const deniedInvoiceIdsByCase = new Map<string, Set<string>>();
  const unresolvedCompetingSelections: Array<{ caseId: string; invoiceId: string }> = [];
  const resolvedWinners: Array<{ invoiceId: string; winnerCaseId: string; loserCaseIds: string[] }> = [];

  for (const [invoiceId, claims] of claimsByInvoice.entries()) {
    if (claims.length <= 1) continue;
    const sorted = [...claims].sort((a, b) => {
      const strength = compareClaimStrength(b, a);
      return strength !== 0 ? strength : a.caseId.localeCompare(b.caseId);
    });
    const top = sorted[0];
    const second = sorted[1];
    if (compareClaimStrength(top, second) <= 0) {
      for (const claim of claims) unresolvedCompetingSelections.push({ caseId: claim.caseId, invoiceId });
      continue;
    }
    const losers = claims.filter((claim) => claim.caseId !== top.caseId);
    for (const loser of losers) addDenied(deniedInvoiceIdsByCase, loser.caseId, invoiceId);
    resolvedWinners.push({ invoiceId, winnerCaseId: top.caseId, loserCaseIds: losers.map((x) => x.caseId).sort() });
  }

  return { deniedInvoiceIdsByCase, unresolvedCompetingSelections, resolvedWinners };
}

export function mergeDeniedInvoiceMaps(target: Map<string, Set<string>>, incoming: Map<string, Set<string>>): number {
  let added = 0;
  for (const [caseId, invoiceIds] of incoming.entries()) {
    const bucket = target.get(caseId) ?? new Set<string>();
    for (const invoiceId of invoiceIds) {
      if (!bucket.has(invoiceId)) { bucket.add(invoiceId); added += 1; }
    }
    target.set(caseId, bucket);
  }
  return added;
}
