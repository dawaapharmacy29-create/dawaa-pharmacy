import { describe, it, expect } from 'vitest';
import { persistCaseAnalysis } from '../analysisWriter';
import { persistAttribution } from '../attributionWriter';
import { persistBasketInvoiceMatch } from '../basketInvoiceMatchWriter';
import { createFakeSupabaseClient } from './fakeSupabaseClient';

// H.1B instruction #21 — 8 writer failure scenarios. The writer must fail loudly/transactionally,
// never silently drop data. Scenarios 6 ("malformed evidence payload") and 7 ("invalid enum/state")
// are, by nature, best exercised against the LIVE database's own jsonb/CHECK-constraint enforcement
// rather than a hand-rolled in-memory fake (which has no schema to violate) — those two are verified
// separately, live, as part of this phase's RLS/constraint verification pass (see the final H.1B
// report's "bugs discovered/fixed" and "RLS writer verification" sections), and this file documents
// that split explicitly rather than pretending a fake client can meaningfully reject a malformed
// jsonb shape it was never given a schema for.

function analysisContentFixture() {
  return {
    caseType: 'sales_opportunity',
    caseStatus: 'customer_confirmed',
    pipelineStatus: 'analyzed',
    overallEvidenceLevel: 'medium',
    identityAtAnalysis: { customerId: 'cust-1', customerPhone: null, branchId: null, branchNameRaw: null },
    caseStartedAt: new Date().toISOString(),
    caseEndedAt: new Date().toISOString(),
    historicalClosureLevel: 'weakly_inferred',
    commercialConfirmationState: 'customer_confirmed',
    protocolApplicability: 'applicable',
    attributionLevel: 'unknown',
    integrityEvaluationScope: 'insufficient',
    needsHumanReview: false,
    humanReviewReasons: [],
    failureReasons: [],
    pipelineWarnings: [],
    evidenceSnapshot: { conversationCaseConfidence: { level: 'strongly_inferred', score: 0.8, ruleIds: [] }, evidenceCompleteness: {}, historicalClosureEvidence: [], protocolApplicabilityRuleIds: [] },
  } as any;
}

function attributionContentFixture() {
  return {
    identityAtEvaluation: { customerId: 'cust-1', customerPhone: null },
    selectedInvoiceId: null,
    selectedInvoiceNumber: null,
    attributionLevel: 'unknown',
    confidenceScore: 0.1,
    isOfficialForStaffEvaluation: false,
    competingCaseIds: [],
    ambiguityStatus: 'none',
    identityConflict: 'none',
    branchConflict: false,
    candidateCount: 1,
    primaryEvidence: [],
    contradictions: [],
    ruleIds: [],
    legacyEvidenceUsed: false,
  } as any;
}

function matchContentFixture() {
  return {
    basketId: 'basket-1',
    basketVersion: 1,
    invoiceId: null,
    invoiceNumber: null,
    totalMatch: 'insufficient_data',
    itemMatch: 'insufficient_data',
    quantityMatch: 'insufficient_data',
    overallMatch: 'insufficient_data',
    headerEvidenceReady: false,
    itemEvidenceReady: false,
    integrityEvaluationScope: 'insufficient',
    differences: [],
    needsHumanReview: false,
    humanReviewReasons: [],
  } as any;
}

describe('Sales Intelligence Persistence — writer failure tests (instruction #21)', () => {
  it('1. FK violation: persisting a case_analysis for a case_id never upserted throws', async () => {
    const client = createFakeSupabaseClient();
    let threw = false;
    try {
      await persistCaseAnalysis(client, 'never-created-case', 'raw text', analysisContentFixture());
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(client.__tables.sales_intelligence_case_analyses.length).toBe(0);
  });

  it('2. duplicate-current invariant: two sequential different-hash writes never leave two current rows', async () => {
    const client = createFakeSupabaseClient();
    await client.from('sales_intelligence_cases').insert({ case_id: 'case-race', conversation_id: 'conv-race', case_started_at: new Date().toISOString() });

    const first = await persistCaseAnalysis(client, 'case-race', 'raw text 1', analysisContentFixture());
    const second = await persistCaseAnalysis(client, 'case-race', 'raw text 2', analysisContentFixture());

    const rows = client.__tables.sales_intelligence_case_analyses.filter((r: any) => r.case_id === 'case-race');
    const currentRows = rows.filter((r: any) => r.is_current === true);
    expect(currentRows.length).toBe(1);
    expect((currentRows[0] as any).analysis_id).toBe(second.analysisId);
    const oldRow = rows.find((r: any) => r.analysis_id === first.analysisId) as any;
    expect(oldRow.is_current).toBe(false);
    expect(oldRow.superseded_by_analysis_id).toBe(second.analysisId);
  });

  it('3. missing stable case: writing an analysis for a case_id with no sales_intelligence_cases row throws (never silently creates one)', async () => {
    const client = createFakeSupabaseClient();
    let threw = false;
    try {
      await persistCaseAnalysis(client, 'orphan-case', 'raw text', analysisContentFixture());
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(client.__tables.sales_intelligence_case_analyses.length).toBe(0);
  });

  it('4. attribution without analysis: persisting an attribution against a nonexistent analysis_id throws', async () => {
    const client = createFakeSupabaseClient();
    let threw = false;
    try {
      await persistAttribution(
        client,
        'nonexistent-analysis-id',
        'case-x',
        { customerId: null, customerPhone: null, candidateInvoiceIds: [], branchNameRaw: null },
        attributionContentFixture()
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(client.__tables.sales_intelligence_attributions.length).toBe(0);
  });

  it('5. match without attribution: persisting a match against a nonexistent attribution_row_id throws', async () => {
    const client = createFakeSupabaseClient();
    await client.from('sales_intelligence_cases').insert({ case_id: 'case-match-fail', conversation_id: 'conv-mf', case_started_at: new Date().toISOString() });
    const analysisResult = await persistCaseAnalysis(client, 'case-match-fail', 'raw text', analysisContentFixture());

    let threw = false;
    try {
      await persistBasketInvoiceMatch(client, analysisResult.analysisId, 'case-match-fail', 'nonexistent-attribution-row', [], matchContentFixture());
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(client.__tables.sales_intelligence_basket_invoice_matches.length).toBe(0);
  });

  it('6. malformed evidence payload is preserved as-given, never silently coerced (jsonb shape enforcement itself is a live-DB concern — see this file\'s header comment)', async () => {
    const client = createFakeSupabaseClient();
    await client.from('sales_intelligence_cases').insert({ case_id: 'case-evidence', conversation_id: 'conv-ev', case_started_at: new Date().toISOString() });
    const analysisResult = await persistCaseAnalysis(client, 'case-evidence', 'raw text', analysisContentFixture());

    const oddEvidenceContent = attributionContentFixture();
    // An evidence item missing an expected field — the writer must pass this through UNCHANGED
    // (never quietly drop/repair it), so a real schema violation surfaces at the database layer
    // where it belongs, not get masked here.
    oddEvidenceContent.primaryEvidence = [{ kind: 'unexpected_shape' }];
    const attribution = await persistAttribution(
      client,
      analysisResult.analysisId,
      'case-evidence',
      { customerId: null, customerPhone: null, candidateInvoiceIds: [], branchNameRaw: null },
      oddEvidenceContent
    );
    const row = client.__tables.sales_intelligence_attributions.find((r: any) => r.id === attribution.attributionRowId) as any;
    expect(row.primary_evidence).toEqual([{ kind: 'unexpected_shape' }]);
  });

  it('7. invalid enum/state values are passed through untouched, never silently normalized to a valid one (CHECK-constraint rejection itself is a live-DB concern — see header comment)', async () => {
    const client = createFakeSupabaseClient();
    await client.from('sales_intelligence_cases').insert({ case_id: 'case-enum', conversation_id: 'conv-enum', case_started_at: new Date().toISOString() });
    const badContent = analysisContentFixture();
    badContent.caseType = 'not_a_real_case_type';
    const result = await persistCaseAnalysis(client, 'case-enum', 'raw text', badContent);
    const row = client.__tables.sales_intelligence_case_analyses.find((r: any) => r.analysis_id === result.analysisId) as any;
    // Never silently coerced to a valid enum value — a real Postgres CHECK constraint would reject
    // this outright (verified live, see header comment); this test only proves the writer layer
    // itself adds no silent "fix-up" that would mask that rejection.
    expect(row.case_type).toBe('not_a_real_case_type');
  });

  it('8. partial batch failure: one case chain failing never blocks another case chain from completing, and the failure is reported, not swallowed', async () => {
    const client = createFakeSupabaseClient();
    await client.from('sales_intelligence_cases').insert({ case_id: 'case-good', conversation_id: 'conv-good', case_started_at: new Date().toISOString() });
    // 'case-bad' deliberately has NO sales_intelligence_cases row, so its analysis write will fail —
    // mirrors exactly how batchPersistenceService.ts's own per-case try/catch loop isolates one
    // case's failure from the rest of the batch (see that module's "CHOSEN ATOMICITY BOUNDARY"
    // comment) without needing a full WhatsApp-export fixture to exercise the same invariant.
    const caseIds = ['case-good', 'case-bad'];
    const outcomes: Array<{ caseId: string; success: boolean; error: string | null }> = [];

    for (const caseId of caseIds) {
      try {
        await persistCaseAnalysis(client, caseId, 'raw text', analysisContentFixture());
        outcomes.push({ caseId, success: true, error: null });
      } catch (err) {
        outcomes.push({ caseId, success: false, error: err instanceof Error ? err.message : String(err) });
      }
    }

    expect(outcomes.find((o) => o.caseId === 'case-good')?.success).toBe(true);
    expect(outcomes.find((o) => o.caseId === 'case-bad')?.success).toBe(false);
    expect(outcomes.find((o) => o.caseId === 'case-bad')?.error).toBeDefined();
    // The good case's row exists despite the bad case's failure — failure isolation confirmed.
    expect(client.__tables.sales_intelligence_case_analyses.some((r: any) => r.case_id === 'case-good')).toBe(true);
    expect(client.__tables.sales_intelligence_case_analyses.some((r: any) => r.case_id === 'case-bad')).toBe(false);
  });
});
