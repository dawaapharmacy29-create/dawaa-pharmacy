// Sales Intelligence QA Review UI — data access + live evidence re-derivation.
//
// READ ONLY, by construction:
//   - The list/detail fetchers below only ever SELECT from sales_intelligence_current_case_analyses,
//     sales_intelligence_current_attributions, sales_intelligence_basket_invoice_matches (filtered
//     to is_current_evaluation), sales_intelligence_current_policy_evaluations, sales_intelligence_cases
//     and whatsapp_review_sources. Nothing here ever calls .insert/.update/.upsert/.delete or any
//     sales_intelligence_write_* RPC.
//   - `deriveLiveCaseEvidence` re-runs the SAME deterministic, already-committed pipeline
//     (runSalesIntelligencePipeline) purely in memory against the case's own already-persisted raw
//     conversation text, to reconstruct the full evidence chain (basket items, evidence lists, rule
//     ids, contradictions) that the persisted rows summarize but don't store item-by-item — this is
//     the exact same technique used for the H.1C.1 reconciliation investigation. It writes nothing
//     back; it is display-only explainability for the QA reviewer.
//
// Dataset size discipline: the Sales Intelligence dataset is a supervised backfill (currently ~150
// cases), never an unbounded high-volume table — the list fetch below caps at MAX_LIST_ROWS rather
// than paginating server-side, deliberately kept small per CLAUDE.md's standing constraint against
// unbounded high-volume reads.
import { parseWhatsAppExport, type WhatsAppParsedMessage } from '../../whatsappConversationParser';
import { runSalesIntelligencePipeline } from '../salesIntelligencePipeline';
import type { SalesIntelligenceCaseAnalysis } from '../types';
import type { QaCaseListRow, QaListFilters } from './types';

const MAX_LIST_ROWS = 2000;

interface RawCaseAnalysisRow {
  analysis_id: string;
  case_id: string;
  case_type: string;
  identity_branch_name_raw: string | null;
  case_started_at: string;
  case_ended_at: string | null;
  historical_closure_level: string;
  protocol_applicability: string;
  attribution_level: string;
  integrity_evaluation_scope: string;
  needs_human_review: boolean;
  human_review_reasons: string[] | null;
}

interface RawAttributionRow {
  analysis_id: string;
  selected_invoice_number: string | null;
  competing_case_ids: string[] | null;
}

/** Pure — no I/O — so it's directly unit-testable without a Supabase mock. */
export function mergeCaseListRows(analyses: RawCaseAnalysisRow[], attributions: RawAttributionRow[]): QaCaseListRow[] {
  const attributionByAnalysisId = new Map(attributions.map((row) => [row.analysis_id, row]));
  return analyses.map((analysis) => {
    const attribution = attributionByAnalysisId.get(analysis.analysis_id);
    return {
      caseId: analysis.case_id,
      analysisId: analysis.analysis_id,
      branchNameRaw: analysis.identity_branch_name_raw,
      caseStartedAt: analysis.case_started_at,
      caseEndedAt: analysis.case_ended_at,
      caseType: analysis.case_type,
      historicalClosureLevel: analysis.historical_closure_level,
      protocolApplicability: analysis.protocol_applicability,
      attributionLevel: analysis.attribution_level,
      integrityEvaluationScope: analysis.integrity_evaluation_scope,
      selectedInvoiceNumber: attribution?.selected_invoice_number ?? null,
      competingCaseCount: attribution?.competing_case_ids?.length ?? 0,
      needsHumanReview: analysis.needs_human_review,
      humanReviewReasons: analysis.human_review_reasons ?? [],
    };
  });
}

/** Pure — no I/O. Applies every list filter + the search box + the one active quick filter. */
export function filterCaseListRows(rows: QaCaseListRow[], filters: QaListFilters): QaCaseListRow[] {
  const search = filters.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.branch !== 'all' && (row.branchNameRaw ?? '') !== filters.branch) return false;
    if (filters.caseType !== 'all' && row.caseType !== filters.caseType) return false;
    if (filters.historicalClosureLevel !== 'all' && row.historicalClosureLevel !== filters.historicalClosureLevel) return false;
    if (filters.protocolApplicability !== 'all' && row.protocolApplicability !== filters.protocolApplicability) return false;
    if (filters.attributionLevel !== 'all' && row.attributionLevel !== filters.attributionLevel) return false;
    if (filters.needsHumanReview === 'yes' && !row.needsHumanReview) return false;
    if (filters.needsHumanReview === 'no' && row.needsHumanReview) return false;
    if (filters.competingAttribution === 'yes' && row.competingCaseCount === 0) return false;
    if (filters.competingAttribution === 'no' && row.competingCaseCount > 0) return false;
    if (filters.invoiceStatus === 'has_invoice' && !row.selectedInvoiceNumber) return false;
    if (filters.invoiceStatus === 'no_invoice' && row.selectedInvoiceNumber) return false;

    switch (filters.quickFilter) {
      case 'strongly_inferred_closure':
        if (row.historicalClosureLevel !== 'strongly_inferred') return false;
        break;
      case 'applicable_cases':
        if (row.protocolApplicability !== 'applicable') return false;
        break;
      case 'strongly_inferred_attribution':
        if (row.attributionLevel !== 'strongly_inferred') return false;
        break;
      case 'competing_attribution':
        if (row.competingCaseCount === 0) return false;
        break;
      case 'unknown_cases':
        if (row.historicalClosureLevel !== 'unknown' && row.protocolApplicability !== 'unknown' && row.attributionLevel !== 'unknown') return false;
        break;
      case 'needs_human_review':
        if (!row.needsHumanReview) return false;
        break;
      case 'no_basket':
        if (!row.humanReviewReasons.includes('no_basket_state_for_case')) return false;
        break;
      case 'multiple_unresolved_products':
        if (!row.humanReviewReasons.includes('possible_unsegmented_multiple_requests')) return false;
        break;
      default:
        break;
    }

    if (!search) return true;
    return (
      row.caseId.toLowerCase().includes(search) ||
      (row.selectedInvoiceNumber ?? '').toLowerCase().includes(search)
    );
  });
}

export async function fetchQaCaseList(supabaseClient: any): Promise<QaCaseListRow[]> {
  const [{ data: analyses, error: analysesError }, { data: attributions, error: attributionsError }] = await Promise.all([
    supabaseClient
      .from('sales_intelligence_current_case_analyses')
      .select(
        'analysis_id, case_id, case_type, identity_branch_name_raw, case_started_at, case_ended_at, historical_closure_level, protocol_applicability, attribution_level, integrity_evaluation_scope, needs_human_review, human_review_reasons'
      )
      .order('case_started_at', { ascending: false })
      .limit(MAX_LIST_ROWS),
    supabaseClient
      .from('sales_intelligence_current_attributions')
      .select('analysis_id, selected_invoice_number, competing_case_ids')
      .limit(MAX_LIST_ROWS),
  ]);
  if (analysesError) throw analysesError;
  if (attributionsError) throw attributionsError;
  return mergeCaseListRows((analyses ?? []) as RawCaseAnalysisRow[], (attributions ?? []) as RawAttributionRow[]);
}

export const QA_BRANCH_OPTIONS_QUERY = 'identity_branch_name_raw';

export async function fetchQaBranchOptions(supabaseClient: any): Promise<string[]> {
  const { data, error } = await supabaseClient
    .from('sales_intelligence_current_case_analyses')
    .select('identity_branch_name_raw')
    .limit(MAX_LIST_ROWS);
  if (error) throw error;
  const set = new Set<string>();
  for (const row of data ?? []) {
    if (row.identity_branch_name_raw) set.add(row.identity_branch_name_raw as string);
  }
  return Array.from(set).sort();
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export interface QaCaseDetailBundle {
  /** The persisted, immutable rows exactly as saved — "what got recorded." */
  persisted: {
    caseRow: Record<string, any> | null;
    analysisRow: Record<string, any>;
    attributionRow: Record<string, any> | null;
    matchRow: Record<string, any> | null;
    policyEvaluationRow: Record<string, any> | null;
  };
  /** The raw source conversation, read-only. */
  conversation: {
    id: string;
    rawText: string;
    branch: string | null;
    startedAt: string | null;
    endedAt: string | null;
  } | null;
  /** Parsed transcript messages (whatsappConversationParser.parseWhatsAppExport) — never re-interpreted, just rendered. */
  transcript: WhatsAppParsedMessage[];
  /**
   * Live, in-memory re-derivation of this caseId's conversation-only evidence (case segmentation,
   * basket items/quantities/unresolved products, historical-closure evidence) — see module
   * comment. Deliberately run with NO invoice candidates (resolveInvoiceCandidates returns []),
   * so `liveEvidence.attribution` / `liveEvidence.basketInvoiceMatch` / `liveEvidence.integrityAssessment`
   * are NOT reproductions of the real, batch-computed persisted values and must never be rendered
   * as such — the UI must read attribution/matching/integrity from `persisted` instead. The only
   * fields this exists for are `activeBasket`/`itemsByBasketId`/`historicalClosure`, which depend
   * only on the raw conversation text and were never persisted item-by-item anywhere. Null when
   * the live re-run could not reproduce this exact caseId (e.g. raw text no longer parseable) —
   * the detail page must then fall back to the persisted summary fields only, never invent evidence.
   */
  liveEvidence: SalesIntelligenceCaseAnalysis | null;
}

export async function fetchQaCaseDetail(supabaseClient: any, caseId: string): Promise<QaCaseDetailBundle | null> {
  const [{ data: caseRow }, { data: analysisRow, error: analysisError }] = await Promise.all([
    supabaseClient.from('sales_intelligence_cases').select('*').eq('case_id', caseId).maybeSingle(),
    supabaseClient.from('sales_intelligence_current_case_analyses').select('*').eq('case_id', caseId).maybeSingle(),
  ]);
  if (analysisError) throw analysisError;
  if (!analysisRow) return null;

  const [{ data: attributionRow }, { data: matchRow }, { data: policyEvaluationRow }] = await Promise.all([
    supabaseClient
      .from('sales_intelligence_current_attributions')
      .select('*')
      .eq('analysis_id', analysisRow.analysis_id)
      .maybeSingle(),
    supabaseClient
      .from('sales_intelligence_basket_invoice_matches')
      .select('*')
      .eq('analysis_id', analysisRow.analysis_id)
      .eq('is_current_evaluation', true)
      .maybeSingle(),
    supabaseClient
      .from('sales_intelligence_current_policy_evaluations')
      .select('*')
      .eq('analysis_id', analysisRow.analysis_id)
      .maybeSingle(),
  ]);

  let conversation: QaCaseDetailBundle['conversation'] = null;
  let transcript: WhatsAppParsedMessage[] = [];
  let liveEvidence: SalesIntelligenceCaseAnalysis | null = null;

  if (caseRow?.conversation_id) {
    const { data: conversationRow } = await supabaseClient
      .from('whatsapp_review_sources')
      .select('id, raw_text, branch, conversation_started_at, conversation_ended_at, customer_id, customer_phone')
      .eq('id', caseRow.conversation_id)
      .maybeSingle();
    if (conversationRow?.raw_text) {
      conversation = {
        id: conversationRow.id,
        rawText: conversationRow.raw_text,
        branch: conversationRow.branch,
        startedAt: conversationRow.conversation_started_at,
        endedAt: conversationRow.conversation_ended_at,
      };
      transcript = parseWhatsAppExport(conversationRow.raw_text);
      try {
        const result = runSalesIntelligencePipeline({
          conversationId: conversationRow.id,
          rawWhatsAppExportText: conversationRow.raw_text,
          customerIdHint: conversationRow.customer_id,
          customerPhoneHint: conversationRow.customer_phone,
          branchNameRawHint: conversationRow.branch,
          competingSelections: [],
          resolveInvoiceCandidates: () => [],
        });
        liveEvidence = result.caseAnalyses.find((a) => a.caseId === caseId) ?? null;
      } catch {
        liveEvidence = null;
      }
    }
  }

  return {
    persisted: { caseRow: caseRow ?? null, analysisRow, attributionRow: attributionRow ?? null, matchRow: matchRow ?? null, policyEvaluationRow: policyEvaluationRow ?? null },
    conversation,
    transcript,
    liveEvidence,
  };
}
