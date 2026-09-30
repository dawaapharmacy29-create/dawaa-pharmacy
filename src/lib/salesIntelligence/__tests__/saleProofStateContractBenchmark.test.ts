import { describe, expect, it } from 'vitest';
import { runSaleProofStateContractBenchmark } from '../saleProofStateContractBenchmark';

describe('I.C.2 — Sale Proof State contract benchmark (synthetic mapping-rule check, NOT Ground Truth)', () => {
  it('is deterministic — running twice produces byte-identical JSON', () => {
    const a = runSaleProofStateContractBenchmark();
    const b = runSaleProofStateContractBenchmark();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('every scenario resolves to its expected state — no mismatches', () => {
    const report = runSaleProofStateContractBenchmark();
    expect(report.mismatches).toEqual([]);
  });

  it('the four required safety metrics are all zero, permanently', () => {
    const report = runSaleProofStateContractBenchmark();
    expect(report.falseProvenSale).toBe(0);
    expect(report.provenWithoutTrustedEvidence).toBe(0);
    expect(report.conversationOnlyProven).toBe(0);
    expect(report.statisticalOnlyProven).toBe(0);
    expect(report.allInvariantsHold).toBe(true);
  });

  it('contradiction scenarios are classified as contradicted, never silently downgraded to weakly_supported', () => {
    const report = runSaleProofStateContractBenchmark();
    expect(report.resultsByScenario.cross_customer_identity_conflict).toBe('contradicted');
    expect(report.resultsByScenario.trusted_plus_cross_customer_conflict).toBe('contradicted');
    expect(report.resultsByScenario.trusted_plus_branch_mismatch).toBe('contradicted');
    expect(report.resultsByScenario.competing_case_same_invoice).toBe('contradicted');
  });

  it('unknown scenarios (no invoice candidate) remain unknown, never promoted from conversation confidence alone', () => {
    const report = runSaleProofStateContractBenchmark();
    expect(report.resultsByScenario.no_candidates_conversation_complete).toBe('unknown');
  });

  it('reports plausible, non-empty state counts across the full scenario set', () => {
    const report = runSaleProofStateContractBenchmark();
    expect(report.scenarioCount).toBe(12);
    expect(report.stateCounts.proven).toBe(1);
    expect(report.stateCounts.contradicted).toBe(4);
    expect(report.stateCounts.unknown).toBe(1);
    expect(
      report.stateCounts.proven + report.stateCounts.strongly_supported + report.stateCounts.weakly_supported +
        report.stateCounts.unknown + report.stateCounts.contradicted
    ).toBe(report.scenarioCount);
  });
});
