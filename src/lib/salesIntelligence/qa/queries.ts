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
import { deriveCasesOnly, runSalesIntelligencePipeline } from '../salesIntelligencePipeline';
import { buildInvoiceCandidateQuery, fetchInvoiceCandidates } from '../invoiceCandidateRetrieval';
import { deriveSaleProofState } from '../saleProofState';
import { deriveSaleProofStateFromPersisted } from './saleProofProjection';
import { resolveCustomerDisplayIdentity } from './customerDisplayIdentity';
import type { SalesIntelligenceCaseAnalysis } from '../types';
import type { SaleProofAssessment } from '../saleProofState';
import type { QaCaseListRow, QaListFilters } from './types';
import { rankProductCandidates } from '../../productMatching';

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
  commercial_confirmation_state?: string | null;
  attribution_level: string;
  integrity_evaluation_scope: string;
  needs_human_review: boolean;
  human_review_reasons: string[] | null;
}

interface RawAttributionRow {
  analysis_id: string;
  selected_invoice_id?: string | null;
  selected_invoice_number: string | null;
  competing_case_ids: string[] | null;
  candidate_count?: number | null;
  attribution_level?: string | null;
  identity_conflict?: string | null;
  branch_conflict?: boolean | null;
  is_official_for_staff_evaluation?: boolean | null;
  legacy_evidence_used?: boolean | null;
  primary_evidence?: unknown[] | null;
  contradictions?: string[] | null;
  rule_ids?: string[] | null;
  confidence_score?: number | null;
}

interface RawCaseIdentityRow {
  case_id: string;
  conversation_id?: string | null;
  customer_id?: string | null;
  customer_phone?: string | null;
}

interface RawConversationIdentityRow {
  id: string;
  customer_name?: string | null;
  customer_code?: string | null;
  customer_phone?: string | null;
}

interface RawMatchRow {
  analysis_id: string;
  integrity_evaluation_scope?: string | null;
  item_evidence_ready?: boolean | null;
  header_evidence_ready?: boolean | null;
  total_match?: string | null;
  differences?: unknown[] | null;
  needs_human_review?: boolean | null;
  human_review_reasons?: string[] | null;
}

/**
 * Pure — no I/O — so it's directly unit-testable without a Supabase mock. `saleProofState`/
 * `proofSource`/etc. are computed via deriveSaleProofStateFromPersisted() (saleProofProjection.ts)
 * — this function NEVER decides Sale Proof State itself, only joins rows and hands them to that
 * shared helper (Final Pilot Readiness: "ممنوع duplication لمنطق Sale Proof").
 */
export function mergeCaseListRows(
  analyses: RawCaseAnalysisRow[],
  attributions: RawAttributionRow[],
  matches: RawMatchRow[] = [],
  cases: RawCaseIdentityRow[] = [],
  conversations: RawConversationIdentityRow[] = []
): QaCaseListRow[] {
  const attributionByAnalysisId = new Map(attributions.map((row) => [row.analysis_id, row]));
  const matchByAnalysisId = new Map(matches.map((row) => [row.analysis_id, row]));
  const caseByCaseId = new Map(cases.map((row) => [row.case_id, row]));
  const conversationById = new Map(conversations.map((row) => [row.id, row]));
  const caseCountByConversationId = new Map<string, number>();
  const currentCaseIds = new Set(analyses.map((row) => row.case_id));
  for (const row of cases) {
    if (!currentCaseIds.has(row.case_id)) continue;
    const id = row.conversation_id ?? null;
    if (!id) continue;
    caseCountByConversationId.set(id, (caseCountByConversationId.get(id) ?? 0) + 1);
  }
  return analyses.map((analysis) => {
    const attribution = attributionByAnalysisId.get(analysis.analysis_id) ?? null;
    const match = matchByAnalysisId.get(analysis.analysis_id) ?? null;
    const caseIdentity = caseByCaseId.get(analysis.case_id) ?? null;
    const conversationId = caseIdentity?.conversation_id ?? null;
    const conversationIdentity = conversationId ? conversationById.get(conversationId) ?? null : null;
    const displayIdentity = resolveCustomerDisplayIdentity({
      sourceName: conversationIdentity?.customer_name ?? null,
      sourceCode: conversationIdentity?.customer_code ?? null,
      sourcePhone: conversationIdentity?.customer_phone ?? null,
      fallbackPhone: caseIdentity?.customer_phone ?? null,
    });
    const proof: SaleProofAssessment = deriveSaleProofStateFromPersisted(analysis.case_id, analysis, attribution, match);
    return {
      caseId: analysis.case_id,
      analysisId: analysis.analysis_id,
      conversationId,
      customerName: displayIdentity.name,
      customerCode: displayIdentity.code,
      customerPhone: displayIdentity.phone,
      conversationCaseCount: conversationId ? (caseCountByConversationId.get(conversationId) ?? 1) : 1,
      branchNameRaw: analysis.identity_branch_name_raw,
      caseStartedAt: analysis.case_started_at,
      caseEndedAt: analysis.case_ended_at,
      caseType: analysis.case_type,
      historicalClosureLevel: analysis.historical_closure_level,
      protocolApplicability: analysis.protocol_applicability,
      attributionLevel: analysis.attribution_level,
      integrityEvaluationScope: analysis.integrity_evaluation_scope,
      selectedInvoiceId: attribution?.selected_invoice_id ?? null,
      selectedInvoiceNumber: attribution?.selected_invoice_number ?? null,
      candidateCount: attribution?.candidate_count ?? 0,
      competingCaseCount: attribution?.competing_case_ids?.length ?? 0,
      needsHumanReview: analysis.needs_human_review,
      humanReviewReasons: analysis.human_review_reasons ?? [],
      saleProofState: proof.state,
      proofSource: proof.proofSource,
      trustedInvoiceId: proof.trustedInvoiceId,
      itemEvidenceReady: proof.itemEvidenceReady,
      invoiceEvidenceScope: proof.invoiceEvidenceScope,
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
    if (filters.saleProofState !== 'all' && row.saleProofState !== filters.saleProofState) return false;
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
      case 'proof_proven':
        if (row.saleProofState !== 'proven') return false;
        break;
      case 'proof_strongly_supported':
        if (row.saleProofState !== 'strongly_supported') return false;
        break;
      case 'proof_weakly_supported':
        if (row.saleProofState !== 'weakly_supported') return false;
        break;
      case 'proof_unknown':
        if (row.saleProofState !== 'unknown') return false;
        break;
      case 'proof_contradicted':
        if (row.saleProofState !== 'contradicted') return false;
        break;
      case 'has_invoice':
        if (!row.selectedInvoiceNumber) return false;
        break;
      case 'no_invoice':
        if (row.selectedInvoiceNumber) return false;
        break;
      default:
        break;
    }

    if (!search) return true;
    return (
      row.caseId.toLowerCase().includes(search) ||
      (row.selectedInvoiceNumber ?? '').toLowerCase().includes(search) ||
      (row.customerName ?? '').toLowerCase().includes(search) ||
      (row.customerCode ?? '').toLowerCase().includes(search) ||
      (row.customerPhone ?? '').toLowerCase().includes(search)
    );
  });
}

export async function fetchQaCaseList(supabaseClient: any): Promise<QaCaseListRow[]> {
  const [
    { data: analyses, error: analysesError },
    { data: attributions, error: attributionsError },
    { data: matches, error: matchesError },
    { data: cases, error: casesError },
    { data: conversations, error: conversationsError },
  ] = await Promise.all([
    supabaseClient
      .from('sales_intelligence_current_case_analyses')
      .select(
        'analysis_id, case_id, case_type, identity_branch_name_raw, case_started_at, case_ended_at, historical_closure_level, protocol_applicability, commercial_confirmation_state, attribution_level, integrity_evaluation_scope, needs_human_review, human_review_reasons'
      )
      .order('case_started_at', { ascending: false })
      .limit(MAX_LIST_ROWS),
    supabaseClient
      .from('sales_intelligence_current_attributions')
      .select(
        'analysis_id, selected_invoice_id, selected_invoice_number, competing_case_ids, candidate_count, attribution_level, identity_conflict, branch_conflict, is_official_for_staff_evaluation, legacy_evidence_used, primary_evidence, contradictions, rule_ids, confidence_score'
      )
      .limit(MAX_LIST_ROWS),
    // Not a "current_*" view (none exists for this table) — filtered directly, same as fetchQaCaseDetail.
    supabaseClient
      .from('sales_intelligence_basket_invoice_matches')
      .select('analysis_id, integrity_evaluation_scope, item_evidence_ready, header_evidence_ready, total_match, differences, needs_human_review, human_review_reasons')
      .eq('is_current_evaluation', true)
      .limit(MAX_LIST_ROWS),
    supabaseClient
      .from('sales_intelligence_cases')
      .select('case_id, conversation_id, customer_id, customer_phone')
      .limit(MAX_LIST_ROWS),
    supabaseClient
      .from('whatsapp_review_sources')
      .select('id, customer_name, customer_code, customer_phone')
      .limit(MAX_LIST_ROWS),
  ]);
  if (analysesError) throw analysesError;
  if (attributionsError) throw attributionsError;
  if (matchesError) throw matchesError;
  if (casesError) throw casesError;
  if (conversationsError) throw conversationsError;
  return mergeCaseListRows(
    (analyses ?? []) as RawCaseAnalysisRow[],
    (attributions ?? []) as RawAttributionRow[],
    (matches ?? []) as RawMatchRow[],
    (cases ?? []) as RawCaseIdentityRow[],
    (conversations ?? []) as RawConversationIdentityRow[]
  );
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
    customerId: string | null;
    customerName: string | null;
    customerCode: string | null;
    customerPhone: string | null;
  } | null;
  /** All persisted case slices belonging to the same raw conversation, for honest segmentation navigation. */
  siblingCases: Array<{
    caseId: string;
    startedAt: string | null;
    endedAt: string | null;
    isCurrent: boolean;
  }>;
  /** Parsed transcript messages (whatsappConversationParser.parseWhatsAppExport) — never re-interpreted, just rendered. */
  transcript: WhatsAppParsedMessage[];
  /**
   * Fresh read-only re-derivation of this exact case using the trusted source timeline plus the
   * current real invoice candidates for THIS case window. It performs SELECTs only and runs the
   * same pure pipeline in memory; it never writes. The detail UI prefers this fresh projection so
   * stale persisted snapshots cannot keep showing a temporally invalid invoice after an engine fix.
   */
  liveEvidence: SalesIntelligenceCaseAnalysis | null;
  /** Canonical Sale Proof derived from the fresh read-only pipeline, when reproducible. */
  liveSaleProof: SaleProofAssessment | null;
  /**
   * The canonical I.C.2 Sale Proof State, computed from `persisted.attributionRow`/`matchRow`/
   * `analysisRow` via deriveSaleProofStateFromPersisted() (saleProofProjection.ts) — the SAME
   * function the list page uses. Never derived from `liveEvidence` (which runs with zero invoice
   * candidates and would misrepresent the real, batch-computed attribution).
   */
  saleProof: SaleProofAssessment;
  catalogProductMatches: Array<{
    sourceMessageId: string;
    rawPhrase: string;
    productId: string;
    productCode: string;
    productName: string;
    price: number | null;
    score: number;
    label: string;
  }>;
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
  let siblingCases: QaCaseDetailBundle['siblingCases'] = [];
  let transcript: WhatsAppParsedMessage[] = [];
  let liveEvidence: SalesIntelligenceCaseAnalysis | null = null;
  let liveSaleProof: SaleProofAssessment | null = null;

  if (caseRow?.conversation_id) {
    const { data: conversationRow } = await supabaseClient
      .from('whatsapp_review_sources')
      .select('id, raw_text, branch, conversation_started_at, conversation_ended_at, customer_id, customer_name, customer_code, customer_phone')
      .eq('id', caseRow.conversation_id)
      .maybeSingle();
    if (conversationRow?.raw_text) {
      let customerName = conversationRow.customer_name ?? null;
      let customerCode = conversationRow.customer_code ?? null;
      let customerPhone = conversationRow.customer_phone ?? caseRow?.customer_phone ?? null;

      // Source rows are preferred because they are the exact conversation identity snapshot.
      // If older sources predate those denormalized fields, fill display-only identity from customers.
      if ((!customerName || !customerCode || !customerPhone) && conversationRow.customer_id) {
        const { data: customerRow } = await supabaseClient
          .from('customers')
          .select('name, customer_name, customer_code, code, phone, customer_phone, mobile, whatsapp')
          .eq('id', conversationRow.customer_id)
          .maybeSingle();
        if (customerRow) {
          customerName = customerName ?? customerRow.name ?? customerRow.customer_name ?? null;
          customerCode = customerCode ?? customerRow.customer_code ?? customerRow.code ?? null;
          customerPhone = customerPhone ?? customerRow.customer_phone ?? customerRow.phone ?? customerRow.mobile ?? customerRow.whatsapp ?? null;
        }
      }

      // The export itself often carries a concatenated identity such as "محمد الكموني17777".
      // Resolve that first; if the source/customer_id snapshot still lacks a phone, use the
      // resolved Dawaa customer code as a deterministic display-only lookup into customers.
      let displayIdentity = resolveCustomerDisplayIdentity({
        sourceName: customerName,
        sourceCode: customerCode,
        sourcePhone: customerPhone,
      });

      if (!displayIdentity.phone && displayIdentity.code) {
        const { data: byCustomerCode } = await supabaseClient
          .from('customers')
          .select('name, customer_name, customer_code, code, phone, customer_phone, mobile, whatsapp')
          .eq('customer_code', displayIdentity.code)
          .limit(2);
        let matchedCustomer = Array.isArray(byCustomerCode) && byCustomerCode.length === 1 ? byCustomerCode[0] : null;

        if (!matchedCustomer) {
          const { data: byLegacyCode } = await supabaseClient
            .from('customers')
            .select('name, customer_name, customer_code, code, phone, customer_phone, mobile, whatsapp')
            .eq('code', displayIdentity.code)
            .limit(2);
          matchedCustomer = Array.isArray(byLegacyCode) && byLegacyCode.length === 1 ? byLegacyCode[0] : null;
        }

        if (matchedCustomer) {
          displayIdentity = resolveCustomerDisplayIdentity({
            sourceName: displayIdentity.name,
            sourceCode: displayIdentity.code,
            sourcePhone: displayIdentity.phone,
            fallbackName: matchedCustomer.name ?? matchedCustomer.customer_name ?? null,
            fallbackCode: matchedCustomer.customer_code ?? matchedCustomer.code ?? null,
            fallbackPhone: matchedCustomer.customer_phone ?? matchedCustomer.phone ?? matchedCustomer.mobile ?? matchedCustomer.whatsapp ?? null,
          });
        }
      }

      conversation = {
        id: conversationRow.id,
        rawText: conversationRow.raw_text,
        branch: conversationRow.branch,
        startedAt: conversationRow.conversation_started_at,
        endedAt: conversationRow.conversation_ended_at,
        customerId: conversationRow.customer_id ?? caseRow?.customer_id ?? null,
        customerName: displayIdentity.name,
        customerCode: displayIdentity.code,
        customerPhone: displayIdentity.phone,
      };

      const { data: siblingCaseRows } = await supabaseClient
        .from('sales_intelligence_cases')
        .select('case_id, case_started_at, case_ended_at')
        .eq('conversation_id', conversationRow.id)
        .order('case_started_at', { ascending: true })
        .limit(MAX_LIST_ROWS);

      const siblingIds = (siblingCaseRows ?? []).map((row: any) => row.case_id);
      let activeSiblingIds = new Set<string>();
      if (siblingIds.length) {
        const { data: currentSiblingAnalyses } = await supabaseClient
          .from('sales_intelligence_case_analyses')
          .select('case_id')
          .in('case_id', siblingIds)
          .eq('is_current', true);
        activeSiblingIds = new Set((currentSiblingAnalyses ?? []).map((row: any) => row.case_id));
      }

      siblingCases = (siblingCaseRows ?? [])
        .filter((row: any) => activeSiblingIds.has(row.case_id))
        .map((row: any) => ({
          caseId: row.case_id,
          startedAt: row.case_started_at ?? null,
          endedAt: row.case_ended_at ?? null,
          isCurrent: row.case_id === caseId,
        }));

      transcript = parseWhatsAppExport(conversationRow.raw_text, {
        trustedConversationStartedAt: conversationRow.conversation_started_at ?? null,
      });
      try {
        const baseInput = {
          conversationId: conversationRow.id,
          rawWhatsAppExportText: conversationRow.raw_text,
          trustedConversationStartedAt: conversationRow.conversation_started_at ?? null,
          customerIdHint: conversationRow.customer_id ?? caseRow?.customer_id ?? null,
          customerPhoneHint: conversationRow.customer_phone ?? caseRow?.customer_phone ?? null,
          branchNameRawHint: conversationRow.branch ?? caseRow?.branch_name_raw ?? null,
        };
        const segmented = deriveCasesOnly(baseInput);
        const targetCase = segmented.cases.find((candidate) => candidate.caseId === caseId) ?? null;
        let freshCandidates: any[] = [];
        if (targetCase) {
          freshCandidates = await fetchInvoiceCandidates(
            supabaseClient,
            buildInvoiceCandidateQuery({
              caseId: targetCase.caseId,
              customerId: targetCase.customerId,
              customerPhone: targetCase.customerPhone,
              branchNameRaw: targetCase.branchNameRaw,
              caseStartedAt: targetCase.startedAt,
              caseEndedAt: targetCase.endedAt,
            })
          );
          siblingCases = segmented.cases.map((candidate) => ({
            caseId: candidate.caseId,
            startedAt: candidate.startedAt,
            endedAt: candidate.endedAt,
            isCurrent: candidate.caseId === caseId,
          }));
        }

        const result = runSalesIntelligencePipeline({
          ...baseInput,
          competingSelections: [],
          resolveInvoiceCandidates: (context) => context.caseId === caseId ? freshCandidates : [],
        });
        liveEvidence = result.caseAnalyses.find((a) => a.caseId === caseId) ?? null;
        if (liveEvidence) {
          liveSaleProof = deriveSaleProofState({
            attribution: liveEvidence.attribution,
            basketInvoiceMatch: liveEvidence.basketInvoiceMatch,
            integrityAssessment: liveEvidence.integrityAssessment,
          });
        }
      } catch {
        liveEvidence = null;
        liveSaleProof = null;
      }
    }
  }

  const persistedSaleProof = deriveSaleProofStateFromPersisted(caseId, analysisRow, attributionRow ?? null, matchRow ?? null);
  const saleProof = liveSaleProof ?? persistedSaleProof;

  // Read-only catalog matching for reviewer visibility. This does NOT mutate Basket/SaleProof.
  const catalogProductMatches: QaCaseDetailBundle['catalogProductMatches'] = [];
  const seenProductIds = new Set<string>();
  const productBearingMessages = transcript
    .filter((message) => message.direction === 'inbound' && /[A-Za-z]{3,}/.test(message.text))
    .slice(0, 8);

  for (const message of productBearingMessages) {
    const rawPhrase = message.text.replace(/^\s*\[Forwarded\]\s*/i, '').trim();
    const tokens = rawPhrase
      .toLowerCase()
      .replace(/[^a-z0-9\u0600-\u06ff\s]/gi, ' ')
      .split(/\s+/)
      .filter((token) => token.length >= 3 && !['forwarded', 'for', 'skin', 'بديل', 'الغسول'].includes(token))
      .slice(0, 5);
    const candidateMap = new Map<string, any>();

    for (const token of tokens.slice(0, 4)) {
      const { data } = await supabaseClient
        .from('products')
        .select('id, product_code, name, price')
        .ilike('normalized_name', `%${token}%`)
        .limit(40);
      for (const row of data ?? []) if (row?.id) candidateMap.set(String(row.id), row);
    }

    // Small spelling bridge for common joined brand words seen in WhatsApp (e.g. "teenderm" vs
    // catalog "teen derm"). It only broadens candidate discovery; ranking still decides the match.
    const joined = tokens.find((token) => token.length >= 7);
    if (joined) {
      const halves = [];
      for (let i = 3; i <= joined.length - 3; i += 1) halves.push([joined.slice(0, i), joined.slice(i)]);
      for (const [left, right] of halves.slice(0, 8)) {
        const { data } = await supabaseClient
          .from('products')
          .select('id, product_code, name, price')
          .ilike('normalized_name', `%${left}%`)
          .ilike('normalized_name', `%${right}%`)
          .limit(20);
        for (const row of data ?? []) if (row?.id) candidateMap.set(String(row.id), row);
      }
    }

    const ranked = rankProductCandidates({ name: rawPhrase }, Array.from(candidateMap.values()));
    const best = ranked[0];
    if (!best || best.score < 20 || !best.product.id || seenProductIds.has(String(best.product.id))) continue;
    seenProductIds.add(String(best.product.id));
    catalogProductMatches.push({
      sourceMessageId: message.id,
      rawPhrase,
      productId: String(best.product.id),
      productCode: String(best.product.product_code ?? ''),
      productName: String(best.product.name ?? ''),
      price: best.product.price == null ? null : Number(best.product.price),
      score: best.score,
      label: best.label,
    });
  }

  return {
    persisted: { caseRow: caseRow ?? null, analysisRow, attributionRow: attributionRow ?? null, matchRow: matchRow ?? null, policyEvaluationRow: policyEvaluationRow ?? null },
    conversation,
    siblingCases,
    transcript,
    liveEvidence,
    liveSaleProof,
    saleProof,
    catalogProductMatches,
  };
}
