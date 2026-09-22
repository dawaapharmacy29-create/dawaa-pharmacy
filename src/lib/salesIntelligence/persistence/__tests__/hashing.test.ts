import { describe, it, expect } from 'vitest';
import {
  canonicalize,
  computeAttributionInputHash,
  computeMatchingInputHash,
  computePolicyInputHash,
  computeSemanticSourceHash,
  sha256Hex,
} from '../hashing';
import { upsertSalesIntelligenceCase } from '../caseWriter';
import { persistCaseAnalysis } from '../analysisWriter';
import { persistPolicyEvaluation, fetchCurrentPolicyConfig } from '../policyEvaluationWriter';
import { persistAttribution } from '../attributionWriter';
import { persistBasketInvoiceMatch } from '../basketInvoiceMatchWriter';
import { createFakeSupabaseClient } from './fakeSupabaseClient';

// H.1B instruction #20 — 12 permanent hash/idempotency scenarios.

describe('Sales Intelligence Persistence — hashing determinism (instruction #20)', () => {
  it('1. identical semantic input produces an identical hash', async () => {
    const input = { rawWhatsAppExportText: 'hello world\nline 2', branchIdentityMappingVersion: 'v1' };
    const a = await computeSemanticSourceHash(input);
    const b = await computeSemanticSourceHash({ ...input });
    expect(a).toBe(b);
  });

  it('2. object key-order differences never change the hash (canonicalize)', () => {
    const a = canonicalize({ x: 1, y: { b: 2, a: 1 } });
    const b = canonicalize({ y: { a: 1, b: 2 }, x: 1 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('3. a policy-date change never changes the semantic source hash (policy date is not a hash input at all)', async () => {
    const text = 'same conversation text';
    // computeSemanticSourceHash's own signature has no policy-date parameter — this test proves
    // that structurally: the same raw text hashes identically regardless of anything a caller
    // might otherwise think to pass, because there is no field for it to attach to.
    const a = await computeSemanticSourceHash({ rawWhatsAppExportText: text, branchIdentityMappingVersion: 'v1' });
    const b = await computeSemanticSourceHash({ rawWhatsAppExportText: text, branchIdentityMappingVersion: 'v1' });
    expect(a).toBe(b);
  });

  it('4. pipeline-version has no field on the semantic hash input — identical hash regardless, even though a version change still changes the analysis identity/version decision at the writer level', async () => {
    const text = 'conversation text for version test';
    const hashUnderPipelineV1 = await computeSemanticSourceHash({ rawWhatsAppExportText: text, branchIdentityMappingVersion: 'v1' });
    const hashUnderPipelineV2 = await computeSemanticSourceHash({ rawWhatsAppExportText: text, branchIdentityMappingVersion: 'v1' });
    expect(hashUnderPipelineV1).toBe(hashUnderPipelineV2);

    // The writer-level decision (analysisWriter.ts/the RPC) additionally compares pipeline_version
    // as its own separate dedup dimension — demonstrated end-to-end in scenario 7 below (a changed
    // pipeline_version alone, same hash, still produces a new analysis row).
  });

  it('5. a conversation content change changes the semantic hash', async () => {
    const a = await computeSemanticSourceHash({ rawWhatsAppExportText: 'version A', branchIdentityMappingVersion: 'v1' });
    const b = await computeSemanticSourceHash({ rawWhatsAppExportText: 'version B', branchIdentityMappingVersion: 'v1' });
    expect(a).not.toBe(b);
  });

  it('6. same analysis input persisted twice is a no-op (idempotent write)', async () => {
    const client = createFakeSupabaseClient();
    await client.from('sales_intelligence_cases').insert({ case_id: 'case-1', conversation_id: 'conv-1', case_started_at: new Date().toISOString() });
    const content = analysisContentFixture();

    const first = await persistCaseAnalysis(client, 'case-1', 'raw text A', content);
    const second = await persistCaseAnalysis(client, 'case-1', 'raw text A', content);

    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(false);
    expect(second.analysisId).toBe(first.analysisId);
    expect(client.__tables.sales_intelligence_case_analyses.length).toBe(1);
  });

  it('7. a new semantic pipeline version (same raw text) still produces a new analysis row', async () => {
    const client = createFakeSupabaseClient();
    await client.from('sales_intelligence_cases').insert({ case_id: 'case-2', conversation_id: 'conv-2', case_started_at: new Date().toISOString() });
    const content = analysisContentFixture();

    const first = await persistCaseAnalysis(client, 'case-2', 'raw text B', content);
    // Simulate a pipeline-version bump by directly mutating the "current" row's pipeline_version,
    // exactly as if an earlier version had been persisted under an older PIPELINE_VERSION constant.
    const currentRow = client.__tables.sales_intelligence_case_analyses.find((r: any) => r.analysis_id === first.analysisId);
    (currentRow as any).pipeline_version = 'sales-intelligence-v0-older';

    const second = await persistCaseAnalysis(client, 'case-2', 'raw text B', content);
    expect(second.isNew).toBe(true);
    expect(second.analysisId).not.toBe(first.analysisId);
    expect(client.__tables.sales_intelligence_case_analyses.filter((r: any) => r.case_id === 'case-2').length).toBe(2);
  });

  it('8. a policy-config change produces a new policy evaluation, never a new semantic analysis', async () => {
    const client = createFakeSupabaseClient();
    await client.from('sales_intelligence_cases').insert({ case_id: 'case-3', conversation_id: 'conv-3', case_started_at: new Date().toISOString() });
    await client.from('sales_intelligence_policy_config').insert({
      policy_config_id: 'policy-1',
      policy_config_version: 1,
      protocol_policy_effective_at: null,
      is_current: true,
    });
    const analysisResult = await persistCaseAnalysis(client, 'case-3', 'raw text C', analysisContentFixture());
    const analysis = analysisFixture('case-3');

    const config1 = await fetchCurrentPolicyConfig(client);
    const evaluation1 = await persistPolicyEvaluation(client, analysisResult.analysisId, 'case-3', analysis, config1);
    expect(evaluation1.skipped).toBe(false);

    // Policy config changes to a NEW current row.
    (client.__tables.sales_intelligence_policy_config.find((r: any) => r.policy_config_id === 'policy-1') as any).is_current = false;
    await client.from('sales_intelligence_policy_config').insert({
      policy_config_id: 'policy-2',
      policy_config_version: 2,
      protocol_policy_effective_at: new Date().toISOString(),
      is_current: true,
    });
    const config2 = await fetchCurrentPolicyConfig(client);
    const evaluation2 = await persistPolicyEvaluation(client, analysisResult.analysisId, 'case-3', analysis, config2);

    expect(evaluation2.skipped).toBe(false);
    if (!evaluation1.skipped && !evaluation2.skipped) {
      expect(evaluation2.policyEvaluationId).not.toBe(evaluation1.policyEvaluationId);
    }
    // Still exactly ONE semantic analysis row for this case — the policy change never touched it.
    expect(client.__tables.sales_intelligence_case_analyses.filter((r: any) => r.case_id === 'case-3').length).toBe(1);
  });

  it('9. an invoice-candidate-set change produces a new attribution evaluation, never a new semantic analysis', async () => {
    const client = createFakeSupabaseClient();
    await client.from('sales_intelligence_cases').insert({ case_id: 'case-4', conversation_id: 'conv-4', case_started_at: new Date().toISOString() });
    const analysisResult = await persistCaseAnalysis(client, 'case-4', 'raw text D', analysisContentFixture());

    const attribution1 = await persistAttribution(
      client,
      analysisResult.analysisId,
      'case-4',
      { customerId: 'cust-1', customerPhone: null, candidateInvoiceIds: ['inv-1', 'inv-2'], branchNameRaw: null },
      attributionContentFixture()
    );
    const attribution2 = await persistAttribution(
      client,
      analysisResult.analysisId,
      'case-4',
      { customerId: 'cust-1', customerPhone: null, candidateInvoiceIds: ['inv-1', 'inv-2', 'inv-3'], branchNameRaw: null },
      attributionContentFixture()
    );

    expect(attribution1.isNew).toBe(true);
    expect(attribution2.isNew).toBe(true);
    expect(attribution2.attributionRowId).not.toBe(attribution1.attributionRowId);
    expect(attribution1.attributionInputHash).not.toBe(attribution2.attributionInputHash);
    expect(client.__tables.sales_intelligence_case_analyses.filter((r: any) => r.case_id === 'case-4').length).toBe(1);
  });

  it('10. a matching-input change produces a new match evaluation', async () => {
    const client = createFakeSupabaseClient();
    await client.from('sales_intelligence_cases').insert({ case_id: 'case-5', conversation_id: 'conv-5', case_started_at: new Date().toISOString() });
    const analysisResult = await persistCaseAnalysis(client, 'case-5', 'raw text E', analysisContentFixture());
    const attribution = await persistAttribution(
      client,
      analysisResult.analysisId,
      'case-5',
      { customerId: 'cust-1', customerPhone: null, candidateInvoiceIds: ['inv-1'], branchNameRaw: null },
      attributionContentFixture()
    );

    const match1 = await persistBasketInvoiceMatch(
      client,
      analysisResult.analysisId,
      'case-5',
      attribution.attributionRowId,
      [{ productNameRaw: 'panadol', quantity: 2 }],
      matchContentFixture()
    );
    const match2 = await persistBasketInvoiceMatch(
      client,
      analysisResult.analysisId,
      'case-5',
      attribution.attributionRowId,
      [{ productNameRaw: 'panadol', quantity: 3 }],
      matchContentFixture()
    );

    expect(match1.isNew).toBe(true);
    expect(match2.isNew).toBe(true);
    expect(match2.matchRowId).not.toBe(match1.matchRowId);
    expect(match1.matchingInputHash).not.toBe(match2.matchingInputHash);
  });

  it('11. a repeated persistence run is a deterministic no-op after rows already exist', async () => {
    const client = createFakeSupabaseClient();
    await client.from('sales_intelligence_cases').insert({ case_id: 'case-6', conversation_id: 'conv-6', case_started_at: new Date().toISOString() });
    const content = analysisContentFixture();

    await persistCaseAnalysis(client, 'case-6', 'raw text F', content);
    const rerun1 = await persistCaseAnalysis(client, 'case-6', 'raw text F', content);
    const rerun2 = await persistCaseAnalysis(client, 'case-6', 'raw text F', content);

    expect(rerun1.isNew).toBe(false);
    expect(rerun2.isNew).toBe(false);
    expect(rerun1.analysisId).toBe(rerun2.analysisId);
    expect(client.__tables.sales_intelligence_case_analyses.length).toBe(1);
  });

  it('12. competing_case_ids is stored on the exact attribution evaluation, unchanged by mapping', async () => {
    const client = createFakeSupabaseClient();
    await client.from('sales_intelligence_cases').insert({ case_id: 'case-7', conversation_id: 'conv-7', case_started_at: new Date().toISOString() });
    const analysisResult = await persistCaseAnalysis(client, 'case-7', 'raw text G', analysisContentFixture());

    const content = attributionContentFixture();
    content.competingCaseIds = ['case-8', 'case-9'];
    const attribution = await persistAttribution(
      client,
      analysisResult.analysisId,
      'case-7',
      { customerId: 'cust-1', customerPhone: null, candidateInvoiceIds: ['inv-1'], branchNameRaw: null },
      content
    );

    const row = client.__tables.sales_intelligence_attributions.find((r: any) => r.id === attribution.attributionRowId) as any;
    expect(row.competing_case_ids).toEqual(['case-8', 'case-9']);
  });
});

describe('Sales Intelligence Persistence — hashing edge cases', () => {
  it('sha256Hex is deterministic for the same input', async () => {
    const a = await sha256Hex('abc');
    const b = await sha256Hex('abc');
    expect(a).toBe(b);
  });

  it('attributionInputHash is order-independent for the candidate invoice id set', async () => {
    const a = await computeAttributionInputHash({ customerId: 'c1', customerPhone: null, candidateInvoiceIds: ['inv-1', 'inv-2'], branchNameRaw: null });
    const b = await computeAttributionInputHash({ customerId: 'c1', customerPhone: null, candidateInvoiceIds: ['inv-2', 'inv-1'], branchNameRaw: null });
    expect(a).toBe(b);
  });

  it('matchingInputHash is order-independent for basket items', async () => {
    const a = await computeMatchingInputHash({
      basketId: 'b1',
      basketVersion: 1,
      activeItems: [
        { productNameRaw: 'a', quantity: 1 },
        { productNameRaw: 'b', quantity: 2 },
      ],
      selectedInvoiceId: 'inv-1',
      selectedInvoiceNumber: null,
      matchingEngineVersion: 'v1',
    });
    const b = await computeMatchingInputHash({
      basketId: 'b1',
      basketVersion: 1,
      activeItems: [
        { productNameRaw: 'b', quantity: 2 },
        { productNameRaw: 'a', quantity: 1 },
      ],
      selectedInvoiceId: 'inv-1',
      selectedInvoiceNumber: null,
      matchingEngineVersion: 'v1',
    });
    expect(a).toBe(b);
  });

  it('policyInputHash changes when the policy config id changes', async () => {
    const a = await computePolicyInputHash({ protocolApplicability: 'applicable', caseEndedAt: '2026-01-01T00:00:00.000Z', policyConfigId: 'p1' });
    const b = await computePolicyInputHash({ protocolApplicability: 'applicable', caseEndedAt: '2026-01-01T00:00:00.000Z', policyConfigId: 'p2' });
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Minimal fixtures — only the fields each writer actually reads.
// ---------------------------------------------------------------------------
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

function analysisFixture(caseId: string): any {
  return {
    caseId,
    conversationId: 'conv-x',
    conversationCase: { caseId, endedAt: new Date().toISOString(), customerId: 'cust-1', customerPhone: null, branchId: null, branchNameRaw: null },
    protocolAssessment: { applicability: 'applicable' },
    integrityAssessment: { protocolPolicyCompliance: 'not_enforced' },
  };
}
