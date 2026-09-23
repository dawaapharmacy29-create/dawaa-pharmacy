// Sales Intelligence Phase H.1B — customer-grouped batch persistence service.
//
// THE critical N+1 fix (instruction #12): never case -> fetch invoices -> case -> fetch invoices.
// Instead: segment every conversation first (cheap, pure, no I/O), group the resulting cases by
// canonical customer, fetch candidate invoices ONCE per customer/time-window group, run every case
// in that group against the shared candidate pool, resolve competing-case relationships across the
// WHOLE batch before persisting anything, and only then write. `dryRun: true` performs every step
// up to and including row-mapping/version-decisions but executes zero INSERT/UPDATE/DELETE/RPC
// mutation (instruction #14) — the same code path is used for both modes so a dry-run plan can
// never drift from what a real run would actually do.
import { normalizeEgyptianCustomerPhone, isValidEgyptianCustomerMobile } from '../../customers/customerIdentity';
import type { InvoiceLike } from '../../invoices/invoiceCore';
import {
  CANDIDATE_RETRIEVAL_MAX_ROWS,
  CANDIDATE_RETRIEVAL_TIME_WINDOW,
  fetchInvoiceCandidates,
  type InvoiceCandidateQuery,
} from '../invoiceCandidateRetrieval';
import { deriveCasesOnly, runSalesIntelligencePipeline, type SalesIntelligencePipelineInput } from '../salesIntelligencePipeline';
import type { ConversationCase, SalesIntelligenceCaseAnalysis } from '../types';
import { upsertSalesIntelligenceCase, type CaseUpsertResult } from './caseWriter';
import { persistCaseAnalysis, type PersistCaseAnalysisResult } from './analysisWriter';
import { fetchCurrentPolicyConfig, persistPolicyEvaluation, type PersistPolicyEvaluationResult } from './policyEvaluationWriter';
import { persistAttribution, type PersistAttributionResult } from './attributionWriter';
import { persistBasketInvoiceMatch, type PersistBasketInvoiceMatchResult } from './basketInvoiceMatchWriter';
import { computeAttributionInputHash, computeMatchingInputHash, computePolicyInputHash, computeSemanticSourceHash } from './hashing';
import {
  invoiceRowLookupId,
  mapAttributionRowContent,
  mapBasketInvoiceMatchRowContent,
  mapCaseAnalysisRowContent,
  mapCaseRowContent,
  mapPolicyEvaluationRowContent,
} from './mappers';
import { BRANCH_IDENTITY_MAPPING_VERSION, ENGINE_VERSIONS } from './versions';

// ---------------------------------------------------------------------------
// Input contract
// ---------------------------------------------------------------------------

export interface BatchConversationInput {
  /** whatsapp_review_sources.id — the real uuid FK target for sales_intelligence_cases.conversation_id. */
  conversationId: string;
  rawWhatsAppExportText: string;
  /** Trusted whatsapp_review_sources.conversation_started_at, when the caller loaded it. */
  trustedConversationStartedAt?: string | null;
  sourceCaseIdV22?: string | null;
  customerIdHint?: string | null;
  customerPhoneHint?: string | null;
  branchIdHint?: string | null;
  branchNameRawHint?: string | null;
  knownStaffIds?: string[];
  legacyMatchedInvoiceId?: string | null;
  legacyMatchedInvoiceNumber?: string | null;
  trustedInvoiceId?: string | null;
  trustedInvoiceNumber?: string | null;
  invoiceCancelledOrReturned?: boolean;
  invoiceStatusHint?: 'cancelled' | 'returned' | null;
  sessionSplitGapMinutes?: number;
  protocolPolicyEffectiveAt?: string | null;
}

export interface RunBatchPersistenceInput {
  conversations: BatchConversationInput[];
  /** true (instruction #14): zero mutation, structured plan only. false: actually writes, per-case, reporting every outcome. */
  dryRun: boolean;
}

// ---------------------------------------------------------------------------
// Plan/result contracts (instruction #14 — machine-testable, not console-only logging)
// ---------------------------------------------------------------------------

export interface PlanCaseEntry {
  caseId: string;
  conversationId: string;
  customerGroupKey: string | null;
}

export interface PlanAnalysisEntry {
  caseId: string;
  semanticSourceHash: string;
  currentAnalysisId: string | null;
  currentAnalysisVersion: number | null;
  nextAnalysisVersion: number;
}

export interface PlanPolicyEvaluationEntry {
  caseId: string;
  analysisId: string | null;
  policyInputHash: string | null;
  currentPolicyEvaluationId: string | null;
}

export interface PlanAttributionEntry {
  caseId: string;
  analysisId: string | null;
  attributionInputHash: string;
  currentAttributionRowId: string | null;
  competingCaseIds: string[];
}

export interface PlanMatchEntry {
  caseId: string;
  analysisId: string | null;
  matchingInputHash: string;
  currentMatchRowId: string | null;
}

export interface PlanConflict {
  caseId: string;
  kind: string;
  detail: string;
}

export interface PlanWarning {
  caseId: string | null;
  kind: string;
  detail: string;
}

export interface PersistencePlan {
  casesToInsert: PlanCaseEntry[];
  casesToUpdateCanonicalIdentity: PlanCaseEntry[];
  casesUnchanged: PlanCaseEntry[];
  analysesToInsert: PlanAnalysisEntry[];
  analysesNoOp: PlanAnalysisEntry[];
  analysesToSupersede: PlanAnalysisEntry[];
  policyEvaluationsToInsert: PlanPolicyEvaluationEntry[];
  policyEvaluationsNoOp: PlanPolicyEvaluationEntry[];
  policyEvaluationsSkippedNoConfig: PlanPolicyEvaluationEntry[];
  attributionsToInsert: PlanAttributionEntry[];
  attributionsNoOp: PlanAttributionEntry[];
  matchesToInsert: PlanMatchEntry[];
  matchesNoOp: PlanMatchEntry[];
  conflicts: PlanConflict[];
  warnings: PlanWarning[];
}

export interface CasePersistenceOutcome {
  caseId: string;
  success: boolean;
  error: string | null;
  caseUpsert: CaseUpsertResult | null;
  analysis: PersistCaseAnalysisResult | null;
  policyEvaluation: PersistPolicyEvaluationResult | null;
  attribution: PersistAttributionResult | null;
  match: PersistBasketInvoiceMatchResult | null;
}

export interface PerformanceMetrics {
  conversations: number;
  cases: number;
  customerGroups: number;
  candidateInvoiceFetches: number;
  previousTheoreticalFetchCount: number;
  candidateInvoicesEvaluated: number;
  purePipelineComputeMs: number;
  persistencePlanningMs: number;
}

export interface RunBatchPersistenceResult {
  dryRun: boolean;
  plan: PersistencePlan;
  /** Only populated when dryRun === false — the actual per-case write outcomes. */
  caseOutcomes: CasePersistenceOutcome[] | null;
  caseAnalyses: SalesIntelligenceCaseAnalysis[];
  performance: PerformanceMetrics;
}

// ---------------------------------------------------------------------------
// Customer grouping (instruction #12, steps 3-6)
// ---------------------------------------------------------------------------

interface CustomerGroup {
  key: string;
  customerId: string | null;
  customerPhoneNormalized: string | null;
  cases: Array<{ conversationCase: ConversationCase; conversation: BatchConversationInput }>;
}

function canonicalCustomerKey(conversationCase: ConversationCase): { key: string | null; customerId: string | null; phone: string | null } {
  if (conversationCase.customerId) return { key: `id:${conversationCase.customerId}`, customerId: conversationCase.customerId, phone: null };
  const normalized = conversationCase.customerPhone ? normalizeEgyptianCustomerPhone(conversationCase.customerPhone) : '';
  if (isValidEgyptianCustomerMobile(normalized)) return { key: `phone:${normalized}`, customerId: null, phone: normalized };
  return { key: null, customerId: null, phone: null };
}

function groupCasesByCustomer(
  segmented: Array<{ conversationCase: ConversationCase; conversation: BatchConversationInput }>
): CustomerGroup[] {
  const groups = new Map<string, CustomerGroup>();
  let ungroupedCounter = 0;

  for (const entry of segmented) {
    const { key, customerId, phone } = canonicalCustomerKey(entry.conversationCase);
    // A case with no resolvable identity gets its own singleton group (caseId-keyed) — it cannot
    // share a fetch with anything else, which is an inherent property of having no identity to
    // group by, never a bug in the grouping logic itself.
    const effectiveKey = key ?? `case:${entry.conversationCase.caseId}:${ungroupedCounter++}`;
    let group = groups.get(effectiveKey);
    if (!group) {
      group = { key: effectiveKey, customerId, customerPhoneNormalized: phone, cases: [] };
      groups.set(effectiveKey, group);
    }
    group.cases.push(entry);
  }

  return Array.from(groups.values());
}

function groupTimeWindow(group: CustomerGroup): { windowStartIso: string; windowEndIso: string } {
  let minStart = Infinity;
  let maxEnd = -Infinity;
  for (const { conversationCase } of group.cases) {
    const startMs = new Date(conversationCase.startedAt).getTime();
    const endMsRaw = conversationCase.endedAt ? new Date(conversationCase.endedAt).getTime() : NaN;
    const endMs = Number.isFinite(endMsRaw) ? Math.max(endMsRaw, startMs) : startMs;
    minStart = Math.min(minStart, startMs);
    maxEnd = Math.max(maxEnd, endMs);
  }
  const windowStart = new Date(minStart - CANDIDATE_RETRIEVAL_TIME_WINDOW.beforeCaseStartHours * 3600_000);
  const windowEnd = new Date(maxEnd + CANDIDATE_RETRIEVAL_TIME_WINDOW.afterCaseEndHours * 3600_000);
  return { windowStartIso: windowStart.toISOString(), windowEndIso: windowEnd.toISOString() };
}

async function fetchCandidatesForGroup(supabaseClient: any, group: CustomerGroup): Promise<InvoiceLike[]> {
  if (!group.customerId && !group.customerPhoneNormalized) return [];
  const { windowStartIso, windowEndIso } = groupTimeWindow(group);
  const query: InvoiceCandidateQuery = {
    caseId: group.key,
    customerId: group.customerId,
    customerPhoneNormalized: group.customerPhoneNormalized,
    branchNameRaw: null,
    windowStartIso,
    windowEndIso,
    limit: CANDIDATE_RETRIEVAL_MAX_ROWS,
  };
  return fetchInvoiceCandidates(supabaseClient, query);
}

// ---------------------------------------------------------------------------
// Read-only decision planning (used by dry-run, and to decide what to report even in a real run) —
// mirrors each RPC's own no-op comparison via a plain SELECT, never a write. A dry-run's decision
// can, in principle, differ from what the real RPC decides under a genuine concurrent race — that
// is an inherent, documented property of "plan" semantics (instruction #14/#16), never a
// correctness issue for the RPCs themselves, which remain the sole source of truth at write time.
// ---------------------------------------------------------------------------

async function planCase(supabaseClient: any, caseId: string): Promise<{ exists: boolean; identityChanged: boolean; existingRow: Record<string, unknown> | null }> {
  const { data, error } = await supabaseClient
    .from('sales_intelligence_cases')
    .select('case_id, conversation_id, source_case_id_v22, customer_id, customer_phone, branch_id, branch_name_raw')
    .eq('case_id', caseId)
    .maybeSingle();
  if (error) throw error;
  return { exists: Boolean(data), identityChanged: !data, existingRow: data ?? null };
}

async function planAnalysis(
  supabaseClient: any,
  caseId: string,
  semanticSourceHash: string
): Promise<PlanAnalysisEntry & { isNoOp: boolean }> {
  const { data, error } = await supabaseClient
    .from('sales_intelligence_case_analyses')
    .select(
      'analysis_id, analysis_version, semantic_source_hash, pipeline_version, engine_version_case_segmentation, engine_version_historical_closure, engine_version_commercial_confirmation, engine_version_protocol_applicability'
    )
    .eq('case_id', caseId)
    .eq('is_current', true)
    .maybeSingle();
  if (error) throw error;

  const isNoOp =
    Boolean(data) &&
    data.semantic_source_hash === semanticSourceHash &&
    data.engine_version_case_segmentation === ENGINE_VERSIONS.caseSegmentation &&
    data.engine_version_historical_closure === ENGINE_VERSIONS.historicalClosure &&
    data.engine_version_commercial_confirmation === ENGINE_VERSIONS.commercialConfirmation &&
    data.engine_version_protocol_applicability === ENGINE_VERSIONS.protocolApplicability;

  return {
    caseId,
    semanticSourceHash,
    currentAnalysisId: data?.analysis_id ?? null,
    currentAnalysisVersion: data?.analysis_version ?? null,
    nextAnalysisVersion: isNoOp ? data.analysis_version : (data?.analysis_version ?? 0) + 1,
    isNoOp,
  };
}

// ---------------------------------------------------------------------------
// Top-level entry point
// ---------------------------------------------------------------------------

export async function runBatchPersistence(supabaseClient: any, input: RunBatchPersistenceInput): Promise<RunBatchPersistenceResult> {
  const pureComputeStart = Date.now();

  // Step 1: segment every conversation (cheap, pure, no I/O) — needed to group by customer BEFORE
  // any invoice fetch (instruction #12 steps 1-4).
  const segmented: Array<{ conversationCase: ConversationCase; conversation: BatchConversationInput }> = [];
  let previousTheoreticalFetchCount = 0;
  for (const conversation of input.conversations) {
    const result = deriveCasesOnly({
      conversationId: conversation.conversationId,
      rawWhatsAppExportText: conversation.rawWhatsAppExportText,
      trustedConversationStartedAt: conversation.trustedConversationStartedAt ?? null,
      sourceCaseIdV22: conversation.sourceCaseIdV22,
      customerIdHint: conversation.customerIdHint,
      customerPhoneHint: conversation.customerPhoneHint,
      branchIdHint: conversation.branchIdHint,
      branchNameRawHint: conversation.branchNameRawHint,
      sessionSplitGapMinutes: conversation.sessionSplitGapMinutes,
    });
    for (const conversationCase of result.cases) {
      segmented.push({ conversationCase, conversation });
      // The naive "case -> fetch invoices" approach this batch service replaces would have issued
      // exactly one candidate-invoice fetch per CASE — this counter is that theoretical baseline,
      // reported alongside the real per-GROUP fetch count below to quantify the N+1 reduction
      // (instruction #24).
      previousTheoreticalFetchCount += 1;
    }
  }

  // Step 2: group by canonical customer, one bounded time window + one candidate fetch per group
  // (instruction #12 steps 4-6).
  const groups = groupCasesByCustomer(segmented);
  const candidatesByGroupKey = new Map<string, InvoiceLike[]>();
  for (const group of groups) {
    candidatesByGroupKey.set(group.key, await fetchCandidatesForGroup(supabaseClient, group));
  }
  const candidateInvoiceFetches = groups.length;
  const candidateInvoicesEvaluated = Array.from(candidatesByGroupKey.values()).reduce((sum, rows) => sum + rows.length, 0);

  // Step 3: PASS 1 — run the pure pipeline per conversation against its group's shared candidate
  // pool with no competing-selection input, to learn each case's own selectedInvoiceId.
  const pass1ByConversation = new Map<string, SalesIntelligenceCaseAnalysis[]>();
  const groupKeyByCaseId = new Map<string, string>();
  for (const group of groups) {
    for (const { conversationCase } of group.cases) groupKeyByCaseId.set(conversationCase.caseId, group.key);
  }
  const conversationToGroupCandidates = (conversation: BatchConversationInput, caseId: string): InvoiceLike[] => {
    const groupKey = groupKeyByCaseId.get(caseId);
    return groupKey ? (candidatesByGroupKey.get(groupKey) ?? []) : [];
  };

  for (const conversation of input.conversations) {
    const pipelineInput: SalesIntelligencePipelineInput = {
      conversationId: conversation.conversationId,
      rawWhatsAppExportText: conversation.rawWhatsAppExportText,
      trustedConversationStartedAt: conversation.trustedConversationStartedAt ?? null,
      sourceCaseIdV22: conversation.sourceCaseIdV22,
      customerIdHint: conversation.customerIdHint,
      customerPhoneHint: conversation.customerPhoneHint,
      branchIdHint: conversation.branchIdHint,
      branchNameRawHint: conversation.branchNameRawHint,
      knownStaffIds: conversation.knownStaffIds,
      legacyMatchedInvoiceId: conversation.legacyMatchedInvoiceId,
      legacyMatchedInvoiceNumber: conversation.legacyMatchedInvoiceNumber,
      trustedInvoiceId: conversation.trustedInvoiceId,
      trustedInvoiceNumber: conversation.trustedInvoiceNumber,
      invoiceCancelledOrReturned: conversation.invoiceCancelledOrReturned,
      invoiceStatusHint: conversation.invoiceStatusHint,
      sessionSplitGapMinutes: conversation.sessionSplitGapMinutes,
      protocolPolicyEffectiveAt: conversation.protocolPolicyEffectiveAt,
      competingSelections: [],
      resolveInvoiceCandidates: (context) => conversationToGroupCandidates(conversation, context.caseId),
    };
    const result = runSalesIntelligencePipeline(pipelineInput);
    pass1ByConversation.set(conversation.conversationId, result.caseAnalyses);
  }

  // Step 4: resolve competing-case relationships across the FULL batch BEFORE persistence
  // (instruction #12 steps 8-9 — never persist pass-1 attribution and later "fix" it silently).
  const competingSelections: Array<{ caseId: string; invoiceId: string }> = [];
  for (const analyses of pass1ByConversation.values()) {
    for (const analysis of analyses) {
      if (analysis.attribution.selectedInvoiceId) {
        competingSelections.push({ caseId: analysis.caseId, invoiceId: analysis.attribution.selectedInvoiceId });
      }
    }
  }

  // Step 5: PASS 2 — final run, with the full batch's competing selections visible to every case.
  const caseAnalyses: SalesIntelligenceCaseAnalysis[] = [];
  for (const conversation of input.conversations) {
    const pipelineInput: SalesIntelligencePipelineInput = {
      conversationId: conversation.conversationId,
      rawWhatsAppExportText: conversation.rawWhatsAppExportText,
      trustedConversationStartedAt: conversation.trustedConversationStartedAt ?? null,
      sourceCaseIdV22: conversation.sourceCaseIdV22,
      customerIdHint: conversation.customerIdHint,
      customerPhoneHint: conversation.customerPhoneHint,
      branchIdHint: conversation.branchIdHint,
      branchNameRawHint: conversation.branchNameRawHint,
      knownStaffIds: conversation.knownStaffIds,
      legacyMatchedInvoiceId: conversation.legacyMatchedInvoiceId,
      legacyMatchedInvoiceNumber: conversation.legacyMatchedInvoiceNumber,
      trustedInvoiceId: conversation.trustedInvoiceId,
      trustedInvoiceNumber: conversation.trustedInvoiceNumber,
      invoiceCancelledOrReturned: conversation.invoiceCancelledOrReturned,
      invoiceStatusHint: conversation.invoiceStatusHint,
      sessionSplitGapMinutes: conversation.sessionSplitGapMinutes,
      protocolPolicyEffectiveAt: conversation.protocolPolicyEffectiveAt,
      competingSelections,
      resolveInvoiceCandidates: (context) => conversationToGroupCandidates(conversation, context.caseId),
    };
    const result = runSalesIntelligencePipeline(pipelineInput);
    caseAnalyses.push(...result.caseAnalyses);
  }

  const purePipelineComputeMs = Date.now() - pureComputeStart;

  // Step 6: build the plan (dry-run) and/or actually persist (real run) — same per-case logic
  // either way, branching only at the final "would write" vs. "does write" point.
  const planningStart = Date.now();
  const plan: PersistencePlan = {
    casesToInsert: [],
    casesToUpdateCanonicalIdentity: [],
    casesUnchanged: [],
    analysesToInsert: [],
    analysesNoOp: [],
    analysesToSupersede: [],
    policyEvaluationsToInsert: [],
    policyEvaluationsNoOp: [],
    policyEvaluationsSkippedNoConfig: [],
    attributionsToInsert: [],
    attributionsNoOp: [],
    matchesToInsert: [],
    matchesNoOp: [],
    conflicts: [],
    warnings: [],
  };
  const caseOutcomes: CasePersistenceOutcome[] = [];

  const currentPolicyConfig = await fetchCurrentPolicyConfig(supabaseClient);
  if (!currentPolicyConfig) {
    plan.warnings.push({
      caseId: null,
      kind: 'no_current_policy_config',
      detail: 'No current sales_intelligence_policy_config row exists — every case will skip policy-evaluation persistence (see policyEvaluationWriter.ts).',
    });
  }

  for (const analysis of caseAnalyses) {
    const conversationCase = analysis.conversationCase;
    const groupKey = groupKeyByCaseId.get(analysis.caseId) ?? null;
    const conversationInput = input.conversations.find((c) => c.conversationId === analysis.conversationId);
    const conversationRowId = conversationInput?.conversationId ?? analysis.conversationId;

    const caseContent = mapCaseRowContent(analysis, conversationRowId);
    const caseAnalysisContent = mapCaseAnalysisRowContent(analysis);
    const semanticSourceHash = await computeSemanticSourceHash({
      rawWhatsAppExportText: conversationInput?.rawWhatsAppExportText ?? '',
      branchIdentityMappingVersion: BRANCH_IDENTITY_MAPPING_VERSION,
    });

    const casePlan = await planCase(supabaseClient, analysis.caseId);
    const planCaseEntry: PlanCaseEntry = { caseId: analysis.caseId, conversationId: analysis.conversationId, customerGroupKey: groupKey };
    if (!casePlan.exists) plan.casesToInsert.push(planCaseEntry);
    else if (casePlan.identityChanged) plan.casesToUpdateCanonicalIdentity.push(planCaseEntry);
    else plan.casesUnchanged.push(planCaseEntry);

    const analysisPlan = await planAnalysis(supabaseClient, analysis.caseId, semanticSourceHash);
    const planAnalysisEntry: PlanAnalysisEntry = {
      caseId: analysis.caseId,
      semanticSourceHash,
      currentAnalysisId: analysisPlan.currentAnalysisId,
      currentAnalysisVersion: analysisPlan.currentAnalysisVersion,
      nextAnalysisVersion: analysisPlan.nextAnalysisVersion,
    };
    if (analysisPlan.isNoOp) plan.analysesNoOp.push(planAnalysisEntry);
    else {
      plan.analysesToInsert.push(planAnalysisEntry);
      if (analysisPlan.currentAnalysisId) plan.analysesToSupersede.push(planAnalysisEntry);
    }

    // Attribution/policy-evaluation/match plans are keyed by analysis_id — when the analysis
    // itself doesn't exist yet (a first-ever run for this case), there is no analysis_id to plan
    // against; those entries are reported with analysisId: null and always classified "to insert"
    // (a brand-new case can never have an existing dependent row).
    const effectiveAnalysisId = analysisPlan.currentAnalysisId;

    const attributionInputHash = await computeAttributionInputHash({
      customerId: conversationCase.customerId,
      customerPhone: conversationCase.customerPhone,
      candidateInvoiceIds: analysis.invoiceCandidateIds,
      branchNameRaw: conversationCase.branchNameRaw,
    });
    let currentAttributionRowId: string | null = null;
    if (effectiveAnalysisId) {
      const { data } = await supabaseClient
        .from('sales_intelligence_attributions')
        .select('id, attribution_input_hash, attribution_engine_version')
        .eq('analysis_id', effectiveAnalysisId)
        .eq('is_current_evaluation', true)
        .maybeSingle();
      if (data && data.attribution_input_hash === attributionInputHash && data.attribution_engine_version === ENGINE_VERSIONS.attribution) {
        currentAttributionRowId = data.id;
      }
    }
    const planAttributionEntry: PlanAttributionEntry = {
      caseId: analysis.caseId,
      analysisId: effectiveAnalysisId,
      attributionInputHash,
      currentAttributionRowId,
      competingCaseIds: analysis.attribution.competingCaseIds,
    };
    if (currentAttributionRowId) plan.attributionsNoOp.push(planAttributionEntry);
    else plan.attributionsToInsert.push(planAttributionEntry);

    const activeItems = analysis.activeBasket ? (analysis.itemsByBasketId[analysis.activeBasket.basketId] ?? []) : [];
    const matchingInputHash = await computeMatchingInputHash({
      basketId: analysis.basketInvoiceMatch.basketId,
      basketVersion: analysis.basketInvoiceMatch.basketVersion,
      activeItems: activeItems.map((item) => ({ productNameRaw: item.productNameRaw, quantity: item.quantity })),
      selectedInvoiceId: analysis.basketInvoiceMatch.invoiceId,
      selectedInvoiceNumber: analysis.basketInvoiceMatch.invoiceNumber,
      matchingEngineVersion: ENGINE_VERSIONS.matching,
    });
    let currentMatchRowId: string | null = null;
    if (effectiveAnalysisId) {
      const { data } = await supabaseClient
        .from('sales_intelligence_basket_invoice_matches')
        .select('id, matching_input_hash, matching_engine_version')
        .eq('analysis_id', effectiveAnalysisId)
        .eq('is_current_evaluation', true)
        .maybeSingle();
      if (data && data.matching_input_hash === matchingInputHash && data.matching_engine_version === ENGINE_VERSIONS.matching) {
        currentMatchRowId = data.id;
      }
    }
    const planMatchEntry: PlanMatchEntry = { caseId: analysis.caseId, analysisId: effectiveAnalysisId, matchingInputHash, currentMatchRowId };
    if (currentMatchRowId) plan.matchesNoOp.push(planMatchEntry);
    else plan.matchesToInsert.push(planMatchEntry);

    if (!currentPolicyConfig) {
      plan.policyEvaluationsSkippedNoConfig.push({ caseId: analysis.caseId, analysisId: effectiveAnalysisId, policyInputHash: null, currentPolicyEvaluationId: null });
    } else {
      const policyContent = mapPolicyEvaluationRowContent(analysis, currentPolicyConfig.protocolPolicyEffectiveAt);
      const policyInputHash = await computePolicyInputHash({
        protocolApplicability: policyContent.protocolApplicability,
        caseEndedAt: conversationCase.endedAt,
        policyConfigId: currentPolicyConfig.policyConfigId,
      });
      let currentPolicyEvaluationId: string | null = null;
      if (effectiveAnalysisId) {
        const { data } = await supabaseClient
          .from('sales_intelligence_policy_evaluations')
          .select('policy_evaluation_id, policy_input_hash, policy_config_id')
          .eq('analysis_id', effectiveAnalysisId)
          .eq('is_current', true)
          .maybeSingle();
        if (data && data.policy_input_hash === policyInputHash && data.policy_config_id === currentPolicyConfig.policyConfigId) {
          currentPolicyEvaluationId = data.policy_evaluation_id;
        }
      }
      const planPolicyEvaluationEntry: PlanPolicyEvaluationEntry = {
        caseId: analysis.caseId,
        analysisId: effectiveAnalysisId,
        policyInputHash,
        currentPolicyEvaluationId,
      };
      if (currentPolicyEvaluationId) plan.policyEvaluationsNoOp.push(planPolicyEvaluationEntry);
      else plan.policyEvaluationsToInsert.push(planPolicyEvaluationEntry);
    }

    if (analysis.attribution.contradictions.includes('ambiguous_multiple_candidates')) {
      plan.conflicts.push({ caseId: analysis.caseId, kind: 'ambiguous_attribution', detail: 'Multiple invoice candidates scored ambiguously — see attribution.contradictions.' });
    }
    if (analysis.attribution.competingCaseIds.length > 0) {
      plan.conflicts.push({
        caseId: analysis.caseId,
        kind: 'competing_case_attribution',
        detail: `Competing with case(s): ${analysis.attribution.competingCaseIds.join(', ')}`,
      });
    }
    for (const warning of analysis.pipelineWarnings) {
      plan.warnings.push({ caseId: analysis.caseId, kind: 'pipeline_warning', detail: warning });
    }

    // Real-run persistence — CHOSEN ATOMICITY BOUNDARY (instruction #13): per-CASE, not
    // per-customer-group. A single Supabase JS client call cannot span a client-side multi-table
    // transaction, and building one mega-RPC that writes all 5 tables for an entire customer group
    // atomically would broaden the already-narrow, security-reviewed per-table RPCs (design doc
    // §26/§27 — instruction #7 explicitly warns against broadening an RPC's responsibilities, and
    // that reasoning applies just as much to inventing a NEW, much larger one). Instead: each
    // case's own 5-table chain (case upsert -> analysis -> attribution -> match -> policy
    // evaluation) is applied sequentially and its outcome recorded in full, success or failure,
    // in `caseOutcomes`. A failure partway through ONE case's chain never rolls back that case's
    // already-written rows (e.g. the case/analysis rows can legitimately exist even if the
    // attribution write then fails) — but it also never silently proceeds past the failure: the
    // remaining tables in THAT case's chain are simply not attempted, `outcome.success` is false,
    // and the batch moves on to the NEXT case rather than aborting the whole group. This is the
    // "safe staging/application strategy" instruction #13 accepts as an alternative to full
    // group-level atomicity — every outcome is visible and reportable, never a silent partial
    // write masquerading as success. A future phase could tighten this to per-case atomicity via
    // one additional narrowly-scoped RPC if partial per-case writes prove operationally unsafe;
    // H.1B does not build that RPC without evidence it's actually needed (instruction #7's own
    // "do not create an RPC unless atomicity actually requires it").
    if (!input.dryRun) {
      const outcome: CasePersistenceOutcome = {
        caseId: analysis.caseId,
        success: false,
        error: null,
        caseUpsert: null,
        analysis: null,
        policyEvaluation: null,
        attribution: null,
        match: null,
      };
      try {
        outcome.caseUpsert = await upsertSalesIntelligenceCase(supabaseClient, analysis.caseId, caseContent);
        outcome.analysis = await persistCaseAnalysis(
          supabaseClient,
          analysis.caseId,
          conversationInput?.rawWhatsAppExportText ?? '',
          caseAnalysisContent
        );
        outcome.attribution = await persistAttribution(
          supabaseClient,
          outcome.analysis.analysisId,
          analysis.caseId,
          {
            customerId: conversationCase.customerId,
            customerPhone: conversationCase.customerPhone,
            candidateInvoiceIds: analysis.invoiceCandidateIds,
            branchNameRaw: conversationCase.branchNameRaw,
          },
          mapAttributionRowContent(analysis)
        );
        outcome.match = await persistBasketInvoiceMatch(
          supabaseClient,
          outcome.analysis.analysisId,
          analysis.caseId,
          outcome.attribution.attributionRowId,
          activeItems.map((item) => ({ productNameRaw: item.productNameRaw, quantity: item.quantity })),
          mapBasketInvoiceMatchRowContent(analysis)
        );
        outcome.policyEvaluation = await persistPolicyEvaluation(
          supabaseClient,
          outcome.analysis.analysisId,
          analysis.caseId,
          analysis,
          currentPolicyConfig
        );
        outcome.success = true;
      } catch (err) {
        outcome.success = false;
        outcome.error = err instanceof Error ? err.message : String(err);
      }
      caseOutcomes.push(outcome);
    }
  }

  const persistencePlanningMs = Date.now() - planningStart;

  return {
    dryRun: input.dryRun,
    plan,
    caseOutcomes: input.dryRun ? null : caseOutcomes,
    caseAnalyses,
    performance: {
      conversations: input.conversations.length,
      cases: caseAnalyses.length,
      customerGroups: groups.length,
      candidateInvoiceFetches,
      previousTheoreticalFetchCount,
      candidateInvoicesEvaluated,
      purePipelineComputeMs,
      persistencePlanningMs,
    },
  };
}
