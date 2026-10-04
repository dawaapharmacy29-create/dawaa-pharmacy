// Canonical Sales Intelligence refresh service — the single implementation behind every
// refresh/backfill writer. Transports (HTTP, maintenance scripts) only authenticate the actor
// and load source rows; every business rule lives here:
//
//   load source context -> Canonical Source Gate -> exactly one Customer Case V22
//   -> Sales Intelligence pipeline -> persist intelligence
//   -> reconcile latest case set for each source conversation
//   -> canonical proof bridge (V44 RPC, the only Canonical Sale Proof writer)
//   -> followers of proven truth (request-action closure) and context-only enrichment
//
// No code path here writes verified_* / canonicalSaleProof on whatsapp_customer_cases_v22
// directly; dawaa_reconcile_sales_intelligence_case_v22_v1 is the only proof writer for active
// cases, while sales_intelligence_reconcile_case_set_v1 may only revoke proof owned by a case that
// has just left the latest canonical segmentation set.
import { runBatchPersistence } from '../persistence/batchPersistenceService';
import {
  REVIEW_SOURCE_BATCH_INPUT_COLUMNS,
  reviewSourceRowToBatchConversation,
} from '../persistence/reviewSourceBatchAdapter';
import {
  readInvoiceRecordById,
  readInvoiceRecordsByCustomerWindow,
} from '../../readModels/invoiceRecordReadModel';
import {
  evaluateCanonicalSourceGate,
  loadCanonicalSourceGateContext,
  type CanonicalSourceGateDecision,
} from '../persistence/canonicalSourceGate';
import { analyzeConversationEvaluation } from '../conversationEvaluation';
import { loadConversationEvaluationSystemEvidenceWithClient } from '../conversationEvaluationSystemEvidence';
import { persistAutomaticCaseConversationReviewWithClient } from '../conversationEvaluationPersistence';
import { hasPaymentSettlementHandoffText } from '../../whatsappConversationUnderstandingV32';

export const CASE_SET_RECONCILE_RPC = 'sales_intelligence_reconcile_case_set_v1';
export const CANONICAL_PROOF_WRITER_RPC = 'dawaa_reconcile_sales_intelligence_case_v22_v1';

/** Columns every transport must load for a review source before calling the service. */
export const CANONICAL_REFRESH_SOURCE_COLUMNS = [
  ...REVIEW_SOURCE_BATCH_INPUT_COLUMNS,
  'source_filename',
  'conversation_ended_at',
  'message_count',
  'created_at',
  'review_status',
].join(',');

export type BlockedSource = {
  sourceId: string;
  error: string;
  reason: string;
  v22CaseIds: string[];
  supersedingSourceIds: string[];
};

export type CaseSetReconciliation = {
  sourceId: string;
  ok: boolean;
  status: string;
  activeCaseIds: string[];
  retiredCaseIds: string[];
  reactivatedCaseIds: string[];
  error: string | null;
};

export type CanonicalProofReconciliation = {
  caseId: string;
  ok: boolean;
  status: string;
  [key: string]: unknown;
};

export interface CanonicalRefreshResult {
  status:
    | 'ok'
    | 'nothing_admitted'
    | 'persistence_partial_failure'
    | 'case_set_reconciliation_failure'
    | 'proof_bridge_transport_failure';
  dryRun: boolean;
  admittedSourceIds: string[];
  blockedSources: BlockedSource[];
  batch: Awaited<ReturnType<typeof runBatchPersistence>> | null;
  persistenceFailures: Array<{ caseId: string; error: unknown }>;
  caseSetReconciliation: CaseSetReconciliation[];
  canonicalReconciliation: CanonicalProofReconciliation[];
  actionReconciliation: { reconciledActions: number };
  complaintEnrichment: { enrichedComplaintActions: number };
  conversationEvaluations: Array<{
    caseId: string;
    sourceId: string;
    status: string;
    reviewId: string | null;
    finalScore: number | null;
    evidenceCoveragePercent: number | null;
    automaticReliabilityPercent: number | null;
    warning: string | null;
    error: string | null;
  }>;
}

function toBlocked(
  decision: Extract<CanonicalSourceGateDecision, { allowed: false }>
): BlockedSource {
  return {
    sourceId: decision.sourceId,
    error: decision.code,
    reason: decision.reason,
    v22CaseIds: decision.v22CaseIds,
    supersedingSourceIds: decision.supersedingSourceIds,
  };
}


export type V22AnalysisContext = {
  id: string;
  journeyId: string | null;
  customerId: string | null;
  caseType: string | null;
  orderIntent: boolean;
  orderConfirmed: boolean;
};

const V22_ANALYSIS_CONTEXT_CHUNK = 40;
const PAYMENT_CONTINUATION_MAX_GAP_MS = 24 * 60 * 60 * 1000;

function sourceTime(value: unknown): number | null {
  const parsed = value ? Date.parse(String(value)) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Analysis-only assembly for a legacy fine-source split that represents one order lifecycle.
 * Canonical ownership remains on the order source; the payment follower is consumed only as
 * analysis context and its stale SI case-set is retired by the normal reconciliation pass.
 */
export function buildCanonicalAnalysisConversations(
  admitted: Record<string, unknown>[],
  v22CaseIdBySource: Map<string, string>,
  v22ContextByCaseId: Map<string, V22AnalysisContext>
): ReturnType<typeof reviewSourceRowToBatchConversation>[] {
  type Member = {
    source: Record<string, unknown>;
    sourceId: string;
    context: V22AnalysisContext;
  };

  const groups = new Map<string, Member[]>();
  for (const source of admitted) {
    const sourceId = String(source.id || '');
    const caseId = v22CaseIdBySource.get(sourceId) || '';
    const context = v22ContextByCaseId.get(caseId);
    const fileName = String(source.source_filename || '');
    if (!sourceId || !caseId || !context?.journeyId || !context.customerId || !fileName) continue;
    const key = `${fileName}|${context.journeyId}|${context.customerId}`;
    const members = groups.get(key) || [];
    members.push({ source, sourceId, context });
    groups.set(key, members);
  }

  const followersByAnchor = new Map<string, Set<string>>();
  const mergedFollowers = new Set<string>();
  for (const members of groups.values()) {
    const anchors = members.filter(
      (member) =>
        member.context.caseType === 'order' &&
        (member.context.orderIntent || member.context.orderConfirmed)
    );
    if (anchors.length !== 1) continue;
    const anchor = anchors[0];
    const anchorEnd = sourceTime(anchor.source.conversation_ended_at);
    if (anchorEnd === null) continue;

    const paymentFollowers = members.filter((member) => {
      if (member.sourceId === anchor.sourceId || member.context.caseType !== 'followup') return false;
      if (!hasPaymentSettlementHandoffText(String(member.source.raw_text || ''))) return false;
      const followerStart = sourceTime(member.source.conversation_started_at);
      if (followerStart === null || followerStart < anchorEnd) return false;
      return followerStart - anchorEnd <= PAYMENT_CONTINUATION_MAX_GAP_MS;
    });
    if (!paymentFollowers.length) continue;

    followersByAnchor.set(anchor.sourceId, new Set(paymentFollowers.map((row) => row.sourceId)));
    for (const follower of paymentFollowers) mergedFollowers.add(follower.sourceId);
  }

  const conversations: ReturnType<typeof reviewSourceRowToBatchConversation>[] = [];
  for (const source of admitted) {
    const sourceId = String(source.id || '');
    if (mergedFollowers.has(sourceId)) continue;
    const followerIds = followersByAnchor.get(sourceId);
    let analysisSource = source;
    if (followerIds?.size) {
      const parts = admitted
        .filter((row) => String(row.id || '') === sourceId || followerIds.has(String(row.id || '')))
        .sort(
          (a, b) =>
            (sourceTime(a.conversation_started_at) ?? 0) -
            (sourceTime(b.conversation_started_at) ?? 0)
        );
      analysisSource = {
        ...source,
        raw_text: parts
          .map((row) => String(row.raw_text || '').trim())
          .filter(Boolean)
          .join(String.fromCharCode(10)),
      };
    }
    conversations.push(
      reviewSourceRowToBatchConversation({
        ...(analysisSource as any),
        source_case_id_v22: v22CaseIdBySource.get(sourceId) || null,
      })
    );
  }
  return conversations;
}

async function loadV22AnalysisContexts(
  service: any,
  caseIds: string[]
): Promise<Map<string, V22AnalysisContext>> {
  const out = new Map<string, V22AnalysisContext>();
  const ids = Array.from(new Set(caseIds.map(String).filter(Boolean)));
  for (let index = 0; index < ids.length; index += V22_ANALYSIS_CONTEXT_CHUNK) {
    const { data, error } = await service
      .from('whatsapp_customer_cases_v22')
      .select('id,journey_id,customer_id,case_type,order_intent,order_confirmed')
      .in('id', ids.slice(index, index + V22_ANALYSIS_CONTEXT_CHUNK));
    if (error) throw new Error(`canonical_refresh_v22_context_lookup_failed: ${error.message}`);
    for (const row of data || []) {
      out.set(String(row.id), {
        id: String(row.id),
        journeyId: row.journey_id ? String(row.journey_id) : null,
        customerId: row.customer_id ? String(row.customer_id) : null,
        caseType: row.case_type ? String(row.case_type) : null,
        orderIntent: Boolean(row.order_intent),
        orderConfirmed: Boolean(row.order_confirmed),
      });
    }
  }
  return out;
}

/**
 * Runs the canonical refresh for already-loaded review source rows.
 * Throws only on infrastructure failures (gate lookups); business refusals are returned.
 */
export async function runCanonicalSalesIntelligenceRefresh(
  service: any,
  input: { sources: Record<string, unknown>[]; dryRun: boolean }
): Promise<CanonicalRefreshResult> {
  const sources = input.sources.filter(
    (row) => typeof row.raw_text === 'string' && String(row.raw_text).trim().length > 0
  );
  const empty = {
    dryRun: input.dryRun,
    batch: null,
    persistenceFailures: [],
    caseSetReconciliation: [],
    canonicalReconciliation: [],
    actionReconciliation: { reconciledActions: 0 },
    complaintEnrichment: { enrichedComplaintActions: 0 },
    conversationEvaluations: [],
  };

  // 1. Canonical Source Gate — one batched context load for all rows.
  const gateContext = await loadCanonicalSourceGateContext(service, sources as any[]);
  const decisions = sources.map((source) =>
    evaluateCanonicalSourceGate(source as any, gateContext)
  );
  const blockedSources = decisions
    .filter(
      (decision): decision is Extract<CanonicalSourceGateDecision, { allowed: false }> =>
        !decision.allowed
    )
    .map(toBlocked);
  const v22CaseIdBySource = new Map(
    decisions
      .filter(
        (decision): decision is Extract<CanonicalSourceGateDecision, { allowed: true }> =>
          decision.allowed
      )
      .map((decision) => [decision.sourceId, decision.v22CaseId])
  );
  const admitted = sources.filter((source) => v22CaseIdBySource.has(String(source.id || '')));
  const admittedSourceIds = admitted.map((source) => String(source.id));
  if (!admitted.length)
    return { ...empty, status: 'nothing_admitted', admittedSourceIds, blockedSources };

  // 2. Sales Intelligence pipeline + persistence, with the resolved Customer Case V22 identity.
  // Reassemble only an explicit same-journey payment-settlement followup into its single
  // order anchor for analysis. Canonical gate/source ownership remains unchanged.
  const v22ContextByCaseId = await loadV22AnalysisContexts(
    service,
    Array.from(new Set(v22CaseIdBySource.values()))
  );
  const conversations = buildCanonicalAnalysisConversations(
    admitted,
    v22CaseIdBySource,
    v22ContextByCaseId
  );
  const batch = await runBatchPersistence(service, { conversations, dryRun: input.dryRun });
  if (input.dryRun) return { ...empty, status: 'ok', admittedSourceIds, blockedSources, batch };

  const outcomes = batch.caseOutcomes || [];
  const persistenceFailures = outcomes
    .filter((row) => !row.success)
    .map((row) => ({ caseId: row.caseId, error: row.error }));
  if (persistenceFailures.length) {
    return {
      ...empty,
      status: 'persistence_partial_failure',
      admittedSourceIds,
      blockedSources,
      batch,
      persistenceFailures,
    };
  }

  // 3. Publish the latest canonical case set for every admitted source BEFORE proof or evaluation
  // followers run. An empty active set is meaningful: if the new engine derives zero cases, every
  // previously-active case for that source must retire. The DB RPC owns lifecycle + proof revoke.
  const caseSetReconciliation: CaseSetReconciliation[] = [];
  for (const source of admitted) {
    const sourceId = String(source.id || '');
    const activeCaseIds = batch.caseAnalyses
      .filter((row: any) => String(row.conversationId || '') === sourceId)
      .map((row: any) => String(row.caseId));
    const { data, error } = await service.rpc(CASE_SET_RECONCILE_RPC, {
      p_conversation_id: sourceId,
      p_active_case_ids: activeCaseIds,
    });
    const payload = data && typeof data === 'object' ? data : null;
    caseSetReconciliation.push({
      sourceId,
      ok: !error && payload?.ok !== false,
      status: error ? 'rpc_error' : String(payload?.status || 'empty_reconcile_result'),
      activeCaseIds,
      retiredCaseIds: Array.isArray(payload?.retiredCaseIds) ? payload.retiredCaseIds.map(String) : [],
      reactivatedCaseIds: Array.isArray(payload?.reactivatedCaseIds)
        ? payload.reactivatedCaseIds.map(String)
        : [],
      error: error?.message ?? null,
    });
  }
  if (caseSetReconciliation.some((row) => !row.ok || row.status !== 'reconciled')) {
    return {
      ...empty,
      status: 'case_set_reconciliation_failure',
      admittedSourceIds,
      blockedSources,
      batch,
      caseSetReconciliation,
    };
  }

  // 4. Canonical proof bridge — the ONLY writer of Canonical Sale Proof into Customer Case V22
  // for active cases. Truth is bidirectional (V46): the RPC re-reads the CURRENT persisted
  // analysis and promotes, keeps, moves (invoice A -> B) or revokes the proof this case wrote.
  const persisted = new Set(outcomes.filter((row) => row.success).map((row) => row.caseId));
  const reconcileCandidates = batch.caseAnalyses.filter((row: any) => persisted.has(row.caseId));
  const canonicalReconciliation: CanonicalProofReconciliation[] = [];
  for (const analysis of reconcileCandidates) {
    const { data, error } = await service.rpc(CANONICAL_PROOF_WRITER_RPC, {
      p_sales_case_id: analysis.caseId,
    });
    canonicalReconciliation.push({
      caseId: analysis.caseId,
      ...(error
        ? { ok: false, status: 'rpc_error', error: error.message }
        : data || { ok: false, status: 'empty_reconcile_result' }),
    });
  }
  if (canonicalReconciliation.some((row) => row.status === 'rpc_error')) {
    return {
      ...empty,
      status: 'proof_bridge_transport_failure',
      admittedSourceIds,
      blockedSources,
      batch,
      caseSetReconciliation,
      canonicalReconciliation,
    };
  }

  // 5. Conversation evaluation follower — only after Sales Intelligence persistence, case-set
  // reconciliation, and canonical proof reconciliation completed. This follower NEVER writes
  // doctor points/incentives. A failure here must not corrupt or roll back canonical sale truth.
  const conversationEvaluations: CanonicalRefreshResult['conversationEvaluations'] = [];
  for (const analysis of reconcileCandidates) {
    const view = analysis.caseIntelligence;
    const sourceId = String(analysis.conversationId || '');
    if (!view) {
      conversationEvaluations.push({
        caseId: analysis.caseId,
        sourceId,
        status: 'skipped_missing_case_intelligence',
        reviewId: null,
        finalScore: null,
        evidenceCoveragePercent: null,
        automaticReliabilityPercent: null,
        warning: null,
        error: null,
      });
      continue;
    }

    let systemEvidence = null;
    let warning: string | null = null;
    try {
      systemEvidence = await loadConversationEvaluationSystemEvidenceWithClient(service, view);
    } catch (error) {
      warning = `system_evidence_unavailable: ${error instanceof Error ? error.message : String(error)}`;
    }

    const evaluation = analyzeConversationEvaluation(view, systemEvidence);
    try {
      const persistedReview = await persistAutomaticCaseConversationReviewWithClient(service, {
        sourceId,
        view,
        evaluation,
      });
      conversationEvaluations.push({
        caseId: analysis.caseId,
        sourceId,
        status: persistedReview.status,
        reviewId: persistedReview.reviewId,
        finalScore: persistedReview.finalScore,
        evidenceCoveragePercent: evaluation.summary.evidenceCoveragePercent,
        automaticReliabilityPercent: evaluation.summary.automaticReliabilityPercent,
        warning,
        error: persistedReview.error,
      });
    } catch (error) {
      conversationEvaluations.push({
        caseId: analysis.caseId,
        sourceId,
        status: 'failed',
        reviewId: null,
        finalScore: evaluation.summary.autoScore,
        evidenceCoveragePercent: evaluation.summary.evidenceCoveragePercent,
        automaticReliabilityPercent: evaluation.summary.automaticReliabilityPercent,
        warning,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // 6. Followers of proven truth: close customer requests only for cases the proof writer accepted.
  const reconciledCaseIds = new Set(
    canonicalReconciliation
      .filter((row) => row.ok && ['reconciled', 'already_reconciled'].includes(String(row.status)))
      .map((row) => row.caseId)
  );
  let reconciledActions = 0;
  let enrichedComplaintActions = 0;
  for (const source of admitted) {
    const sourceId = String(source.id);
    const sourceAnalyses = batch.caseAnalyses.filter((row: any) => row.conversationId === sourceId);
    const provenAnalyses = sourceAnalyses.filter((row: any) => reconciledCaseIds.has(row.caseId));
    if (provenAnalyses.length) {
      reconciledActions += (
        await reconcileSoldCustomerRequestActions(service, sourceId, provenAnalyses)
      ).reconciledActions;
    }
    // Context only (review_required, never fault/sale assignment).
    enrichedComplaintActions += (
      await enrichComplaintFollowupContext(service, source, sourceAnalyses)
    ).enrichedComplaintActions;
  }

  return {
    ...empty,
    status: 'ok',
    admittedSourceIds,
    blockedSources,
    batch,
    caseSetReconciliation,
    canonicalReconciliation,
    actionReconciliation: { reconciledActions },
    complaintEnrichment: { enrichedComplaintActions },
    conversationEvaluations,
  };
}

export interface CanonicalBackfillResult {
  mode: 'apply' | 'dry-run';
  /** What the Canonical Source Gate admits/refuses for the scoped rows (= what apply may write). */
  gate: { admittedSourceIds: string[]; blockedSources: BlockedSource[] };
  refresh: CanonicalRefreshResult | null;
  /** Dry-run only: read-only analysis over the legacy preview rows. Never persisted. */
  preview: Awaited<ReturnType<typeof runBatchPersistence>> | null;
}

/**
 * Maintenance backfill entry point. `apply` writes only through runCanonicalSalesIntelligenceRefresh
 * (same gate, same V22 identity, same single proof writer as the HTTP transport).
 * Dry-run never writes: it reports the gate decisions and analyzes `previewRows` read-only.
 * previewRows is a temporary compatibility input for existing read-only regression fixtures that
 * still reference superseded sources; it can never reach a writer.
 */
export async function runCanonicalSalesIntelligenceBackfill(
  service: any,
  input: {
    rows: Record<string, unknown>[];
    apply: boolean;
    previewRows?: Record<string, unknown>[];
  }
): Promise<CanonicalBackfillResult> {
  if (input.apply) {
    const refresh = await runCanonicalSalesIntelligenceRefresh(service, {
      sources: input.rows,
      dryRun: false,
    });
    return {
      mode: 'apply',
      gate: {
        admittedSourceIds: refresh.admittedSourceIds,
        blockedSources: refresh.blockedSources,
      },
      refresh,
      preview: null,
    };
  }

  const rows = input.rows.filter(
    (row) => typeof row.raw_text === 'string' && String(row.raw_text).trim().length > 0
  );
  const gateContext = await loadCanonicalSourceGateContext(service, rows as any[]);
  const decisions = rows.map((row) => evaluateCanonicalSourceGate(row as any, gateContext));
  const gate = {
    admittedSourceIds: decisions.filter((d) => d.allowed).map((d) => d.sourceId),
    blockedSources: decisions
      .filter((d): d is Extract<CanonicalSourceGateDecision, { allowed: false }> => !d.allowed)
      .map(toBlocked),
  };
  const previewRows = (input.previewRows ?? input.rows).filter(
    (row) => typeof row.raw_text === 'string' && String(row.raw_text).trim().length > 0
  );
  const preview = previewRows.length
    ? await runBatchPersistence(service, {
        conversations: previewRows.map((row) => reviewSourceRowToBatchConversation(row as any)),
        dryRun: true,
      })
    : null;
  return { mode: 'dry-run', gate, refresh: null, preview };
}

async function reconcileSoldCustomerRequestActions(
  service: any,
  sourceId: string,
  caseAnalyses: any[]
) {
  const { data: actions, error: actionsError } = await service
    .from('whatsapp_conversation_actions')
    .select(
      'id,action_key,action_type,status,work_status,product_id,product_code,product_name,quantity,payload,confidence'
    )
    .eq('source_id', sourceId)
    .eq('action_type', 'customer_request')
    .in('status', ['proposed', 'ready', 'created']);

  if (actionsError) throw actionsError;
  if (!actions?.length) return { reconciledActions: 0 };

  let reconciledActions = 0;
  const reconciledIds = new Set<string>();

  for (const analysis of caseAnalyses) {
    const attribution = analysis?.attribution;
    const match = analysis?.basketInvoiceMatch;
    const invoiceId = String(attribution?.selectedInvoiceId || '').trim();
    const invoiceNumber = String(attribution?.selectedInvoiceNumber || '').trim();
    const attributionLevel = String(attribution?.attributionLevel || '');
    const contradictions = Array.isArray(attribution?.contradictions)
      ? attribution.contradictions
      : [];

    if (!invoiceId || !invoiceNumber) continue;
    // Closing a request as "sold" is a sale claim: it follows canonical proof only
    // (the analyses passed in are already restricted to V44-reconciled proven cases).
    if (attributionLevel !== 'proven') continue;
    if (contradictions.length > 0) continue;
    if (match?.itemMatch !== 'exact' || match?.itemEvidenceReady !== true) continue;

    const { data: invoiceItems, error: invoiceItemsError } = await service
      .from('sales_invoice_items_v21')
      .select('invoice_id,invoice_number,product_id,product_code,product_name,quantity,line_total')
      .eq('invoice_id', invoiceId);

    if (invoiceItemsError) throw invoiceItemsError;
    if (!invoiceItems?.length) continue;

    const invoiceValue = invoiceItems.reduce(
      (sum: number, row: any) => sum + (Number(row.line_total) || 0),
      0
    );

    for (const action of actions) {
      if (reconciledIds.has(String(action.id))) continue;
      if (!action.product_id) continue;

      const matchingLines = invoiceItems.filter(
        (row: any) => String(row.product_id || '') === String(action.product_id)
      );
      if (!matchingLines.length) continue;

      const soldQuantity = matchingLines.reduce(
        (sum: number, row: any) => sum + (Number(row.quantity) || 0),
        0
      );
      const primaryLine = matchingLines[0];
      const requestPrefix = String(action.action_key || '').match(/^(request:\d+:)/)?.[1] || null;
      const relatedActions = actions.filter((candidate: any) => {
        if (reconciledIds.has(String(candidate.id))) return false;
        if (String(candidate.id) === String(action.id)) return true;
        if (!requestPrefix) return false;
        return (
          String(candidate.action_key || '').startsWith(requestPrefix) && !candidate.product_id
        );
      });

      for (const related of relatedActions) {
        const nowIso = new Date().toISOString();
        const payload =
          related.payload && typeof related.payload === 'object' && !Array.isArray(related.payload)
            ? related.payload
            : {};

        const canonicalSale = {
          case_id: analysis.caseId,
          invoice_id: invoiceId,
          invoice_number: invoiceNumber,
          product_id: String(primaryLine.product_id || action.product_id || ''),
          product_code: String(primaryLine.product_code || action.product_code || ''),
          product_name: String(primaryLine.product_name || action.product_name || ''),
          sold_quantity: soldQuantity,
          invoice_value: invoiceValue,
          attribution_level: attributionLevel,
          item_match: match.itemMatch,
          verified_at: nowIso,
        };

        const { error: updateError } = await service
          .from('whatsapp_conversation_actions')
          .update({
            status: 'dismissed',
            work_status: 'completed',
            outcome: 'sold',
            outcome_note: 'تم إغلاق طلب العميل تلقائيًا بعد إثبات البيع وربطه بفاتورة فعلية.',
            completed_at: nowIso,
            target_table: 'sales_invoices',
            target_id: invoiceId,
            reason: 'تم إثبات بيع الطلب وربطه بفاتورة فعلية؛ لا يحتاج متابعة كطلب غير مغلق.',
            payload: { ...payload, canonical_sale: canonicalSale },
            updated_at: nowIso,
          })
          .eq('id', related.id);

        if (updateError) throw updateError;
        reconciledIds.add(String(related.id));
        reconciledActions += 1;
      }
    }
  }

  return { reconciledActions };
}

async function enrichComplaintFollowupContext(
  service: any,
  source: Record<string, unknown>,
  caseAnalyses: any[]
) {
  const sourceId = String(source.id || '');
  if (!sourceId) return { enrichedComplaintActions: 0 };

  const { data: actions, error: actionError } = await service
    .from('whatsapp_conversation_actions')
    .select('id,status,action_type,payload')
    .eq('source_id', sourceId)
    .eq('action_type', 'complaint_followup')
    .in('status', ['proposed', 'ready', 'created']);
  if (actionError) throw actionError;
  if (!actions?.length) return { enrichedComplaintActions: 0 };

  let invoiceId = '';
  let linkageBasis = '';
  for (const analysis of caseAnalyses) {
    const attribution = analysis?.attribution;
    const level = String(attribution?.attributionLevel || '');
    const selected = String(attribution?.selectedInvoiceId || '').trim();
    if (selected && ['proven', 'strongly_inferred'].includes(level)) {
      invoiceId = selected;
      linkageBasis = `canonical_${level}`;
      break;
    }
  }

  let invoice: any = null;
  if (invoiceId) {
    invoice = await readInvoiceRecordById(invoiceId, service);
  }

  if (!invoice) {
    const customerId = String(source.customer_id || '').trim();
    const customerCode = String(source.customer_code || '').trim();
    const startedAt = source.conversation_started_at
      ? new Date(String(source.conversation_started_at))
      : null;
    const endedAt = source.conversation_ended_at
      ? new Date(String(source.conversation_ended_at))
      : startedAt;
    if ((customerId || customerCode) && startedAt && !Number.isNaN(startedAt.getTime())) {
      const from = new Date(startedAt.getTime() - 2 * 3600_000).toISOString();
      const to = new Date(
        (endedAt && !Number.isNaN(endedAt.getTime()) ? endedAt.getTime() : startedAt.getTime()) +
          6 * 3600_000
      ).toISOString();
      const rows = await readInvoiceRecordsByCustomerWindow({
        queryStartIso: from,
        queryEndIso: to,
        ...(customerId ? { customerId } : { customerCode }),
        limit: 20,
        client: service,
      });
      if (rows.length) {
        const anchor = startedAt.getTime();
        invoice = [...rows].sort((a: any, b: any) => {
          const ad = Math.abs(new Date(String(a.invoice_datetime || 0)).getTime() - anchor);
          const bd = Math.abs(new Date(String(b.invoice_datetime || 0)).getTime() - anchor);
          return ad - bd;
        })[0];
        linkageBasis = 'customer_time_match';
      }
    }
  }

  if (!invoice) return { enrichedComplaintActions: 0 };

  let updated = 0;
  for (const action of actions) {
    const existingPayload =
      action.payload && typeof action.payload === 'object' && !Array.isArray(action.payload)
        ? action.payload
        : {};
    const deliveryContext = {
      invoice_id: String(invoice.id || ''),
      invoice_number: String(invoice.invoice_number || ''),
      invoice_datetime: invoice.invoice_datetime || null,
      branch: invoice.branch || null,
      delivery_staff: invoice.delivery_staff || null,
      sale_staff: invoice.staff_name || invoice.seller_name || null,
      linkage_basis: linkageBasis,
      review_required: true,
      responsibility_status: 'context_only_not_fault_assignment',
      linked_at: new Date().toISOString(),
    };
    const { error } = await service
      .from('whatsapp_conversation_actions')
      .update({
        payload: { ...existingPayload, delivery_context: deliveryContext },
        updated_at: new Date().toISOString(),
      })
      .eq('id', action.id);
    if (error) throw error;
    updated += 1;
  }
  return { enrichedComplaintActions: updated };
}
