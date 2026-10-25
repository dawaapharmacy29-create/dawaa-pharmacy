// Sales Intelligence QA — read-only persisted canonical truth.
// Normal case open never re-runs the pipeline or resolves product identity.
// Missing snapshots are visible and require an explicit canonical refresh.
//
// Dataset size discipline: the Sales Intelligence dataset is a supervised backfill (currently ~150
// cases), never an unbounded high-volume table — the list fetch below caps at MAX_LIST_ROWS rather
// than paginating server-side, deliberately kept small per CLAUDE.md's standing constraint against
// unbounded high-volume reads.
import { parseWhatsAppExport, type WhatsAppParsedMessage } from '../../whatsappConversationParser';
import { readInvoiceItemCommercialMeta } from '../../invoices/invoiceItemCommercialMeta';
import {
  REVIEW_SOURCE_BATCH_INPUT_COLUMNS,
} from '../persistence/reviewSourceBatchAdapter';
import { deriveSaleProofStateFromPersisted } from './saleProofProjection';
import { resolveCustomerDisplayIdentity } from './customerDisplayIdentity';
import type {
  CanonicalSalesOutcomeAssessment,
  CaseBasketItem,
} from '../types';
import type { SaleProofAssessment } from '../saleProofState';
import type { QaCaseListRow, QaListFilters } from './types';
import { readPersistedProductTruth, type PersistedProductDisplay } from './persistedProductTruth';
import { loadCanonicalAnalyticalSources } from '../persistence/canonicalSourceGate';
import { readCanonicalCaseSaleTruth, type CanonicalCaseSaleTruth } from './canonicalCaseTruth';
import { readInvoiceRecordById } from '../../readModels/invoiceRecordReadModel';
import {
  compareQuotedAndActualUnitPrice,
  derivePricingExecutionAssessment,
} from '../salesPricingExecutionV1';
import {
  derivePersistedRecommendationConversionFactsV1,
  type RecommendationConversionFactV1,
} from '../recommendationConversionV1';

const MAX_LIST_ROWS = 2000;

interface RawCaseAnalysisRow {
  analysis_id: string;
  case_id: string;
  canonical_sales_outcome?: unknown;
  /** evidence_snapshot->caseBranch (v48+). */
  case_branch?: { branch?: string | null; decided?: boolean; basis?: string } | null;
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

const CANONICAL_SALES_OUTCOMES = new Set([
  'sale_proven',
  'order_confirmed_unproven',
  'customer_confirmed_unproven',
  'open_opportunity',
  'customer_rejected',
  'information_only',
  'needs_review',
  'unknown',
]);

function readCanonicalSalesOutcome(value: unknown): Pick<
  CanonicalSalesOutcomeAssessment,
  'outcome' | 'isSaleCountable'
> & { saleProofState?: SaleProofAssessment['state'] } | null {
  if (!value || typeof value !== 'object') return null;
  const outcome = (value as Record<string, unknown>).outcome;
  const isSaleCountable = (value as Record<string, unknown>).isSaleCountable;
  if (
    typeof outcome !== 'string' ||
    !CANONICAL_SALES_OUTCOMES.has(outcome) ||
    typeof isSaleCountable !== 'boolean'
  ) return null;
  return {
    outcome: outcome as CanonicalSalesOutcomeAssessment['outcome'],
    isSaleCountable,
    ...(['proven', 'strongly_supported', 'weakly_supported', 'unknown', 'contradicted'].includes(String((value as Record<string, unknown>).saleProofState))
      ? { saleProofState: (value as Record<string, unknown>).saleProofState as SaleProofAssessment['state'] } : {}),
  };
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
  source_filename?: string | null;
  customer_id?: string | null;
  customer_name?: string | null;
  customer_code?: string | null;
  customer_phone?: string | null;
  conversation_started_at?: string | null;
  conversation_ended_at?: string | null;
  message_count?: number | null;
  created_at?: string | null;
  review_status?: string | null;
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
 * Pure — no I/O — so it's directly unit-testable without a Supabase mock. The saved canonical
 * sale proof takes precedence, exactly as on case detail. For older snapshots, `saleProofState`/
 * `proofSource`/etc. are computed via deriveSaleProofStateFromPersisted() (saleProofProjection.ts)
 * — this function NEVER decides Sale Proof State itself, only joins rows and hands them to that
 * shared helper (Final Pilot Readiness: "ممنوع duplication لمنطق Sale Proof").
 */
export function mergeCaseListRows(
  analyses: RawCaseAnalysisRow[],
  attributions: RawAttributionRow[],
  matches: RawMatchRow[] = [],
  cases: RawCaseIdentityRow[] = [],
  conversations: RawConversationIdentityRow[] = [],
  /** Canonical Analytical Source ids (loadCanonicalAnalyticalSources). Omitted = no source filter. */
  canonicalConversationIds?: ReadonlySet<string>
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
  return analyses
    .filter((analysis) => {
      const caseIdentity = caseByCaseId.get(analysis.case_id) ?? null;
      const conversationId = caseIdentity?.conversation_id ?? null;
      return !conversationId || !canonicalConversationIds || canonicalConversationIds.has(conversationId);
    })
    .map((analysis) => {
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
    // The persisted canonical outcome is the same source used by case detail. Legacy rows
    // without that snapshot retain the conservative projection; do not infer a new sale here.
    const canonicalSalesOutcome = readCanonicalSalesOutcome(analysis.canonical_sales_outcome);
    return {
      caseId: analysis.case_id,
      analysisId: analysis.analysis_id,
      conversationId,
      customerName: displayIdentity.name,
      customerCode: displayIdentity.code,
      customerPhone: displayIdentity.phone,
      conversationCaseCount: conversationId ? (caseCountByConversationId.get(conversationId) ?? 1) : 1,
      ...listCaseBranch(analysis),
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
      saleProofState: canonicalSalesOutcome?.saleProofState ?? proof.state,
      canonicalSalesOutcome,
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
        'analysis_id, case_id, canonical_sales_outcome:evidence_snapshot->canonicalSalesOutcome, case_branch:evidence_snapshot->caseBranch, case_type, identity_branch_name_raw, case_started_at, case_ended_at, historical_closure_level, protocol_applicability, commercial_confirmation_state, attribution_level, integrity_evaluation_scope, needs_human_review, human_review_reasons'
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
      .select('id, source_filename, customer_id, customer_name, customer_code, customer_phone, conversation_started_at, conversation_ended_at, message_count, created_at, review_status')
      .limit(MAX_LIST_ROWS),
  ]);
  if (analysesError) throw analysesError;
  if (attributionsError) throw attributionsError;
  if (matchesError) throw matchesError;
  if (casesError) throw casesError;
  if (conversationsError) throw conversationsError;
  const conversationRows = (conversations ?? []) as RawConversationIdentityRow[];
  const { canonicalIds } = await loadCanonicalAnalyticalSources(supabaseClient, conversationRows);
  return mergeCaseListRows(
    (analyses ?? []) as RawCaseAnalysisRow[],
    (attributions ?? []) as RawAttributionRow[],
    (matches ?? []) as RawMatchRow[],
    (cases ?? []) as RawCaseIdentityRow[],
    conversationRows,
    canonicalIds
  );
}

export const QA_BRANCH_OPTIONS_QUERY = 'identity_branch_name_raw, case_branch:evidence_snapshot->caseBranch';

/** Branch filter options = the canonical case branches the list rows actually carry. */
export async function fetchQaBranchOptions(supabaseClient: any): Promise<string[]> {
  const { data, error } = await supabaseClient
    .from('sales_intelligence_current_case_analyses')
    .select(QA_BRANCH_OPTIONS_QUERY)
    .limit(MAX_LIST_ROWS);
  if (error) throw error;
  const set = new Set<string>();
  for (const row of data ?? []) {
    const branch = listCaseBranch(row as RawCaseAnalysisRow).branchNameRaw;
    if (branch) set.add(branch);
  }
  return Array.from(set).sort();
}

/**
 * The list's case branch is the persisted canonical caseBranch when the analysis has one (v48+):
 * decided → its branch, undecided → null. Older analyses carry no caseBranch; their only case
 * branch is identity_branch_name_raw (the analysis-time operational branch).
 */
export function listCaseBranch(
  analysis: Pick<RawCaseAnalysisRow, 'case_branch' | 'identity_branch_name_raw'>
): Pick<QaCaseListRow, 'branchNameRaw' | 'caseBranchBasis'> {
  const caseBranch = analysis.case_branch;
  if (caseBranch && typeof caseBranch === 'object') {
    return {
      branchNameRaw: caseBranch.decided && caseBranch.branch ? caseBranch.branch : null,
      caseBranchBasis: (caseBranch.basis ?? 'unresolved') as QaCaseListRow['caseBranchBasis'],
    };
  }
  return { branchNameRaw: analysis.identity_branch_name_raw ?? null, caseBranchBasis: null };
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
    /** Persisted source-level conversation staff identity; display context only, never sale ownership. */
    staffId: string | null;
    staffName: string | null;
    invoiceMatchConfidence: number | null;
    invoiceMatchReason: string | null;
    invoiceLinkConfirmed: boolean;
    invoiceLinkConfirmedInvoiceId: string | null;
    invoiceLinkConfirmedInvoiceNumber: string | null;
  } | null;
  /** Snapshot-lineage status. Old contained exports remain readable for audit, never current truth. */
  sourceSnapshot: {
    isCanonical: boolean;
    canonicalSourceId: string | null;
  };
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
   * The business truth for THIS case exactly as the canonical writers persisted it: the current
   * analysis' canonicalSalesOutcome, the current attribution and the V22 sale ledger entry. The
   * window renders these values; it never re-derives a sales decision.
   */
  canonicalTruth: CanonicalCaseSaleTruth;
  /**
   * Explanation only (contradictions, rule ids, evidence scope) projected from the persisted
   * attribution/match rows. Its `state` is never rendered as the case's proof state.
   */
  persistedProofEvidence: SaleProofAssessment;
  /** Persisted canonical basket projection. The compatibility name is retained for callers. */
  conversationReread: {
    activeBasket: { announcedTotal: { amount: number } | null } | null;
    basketItems: CaseBasketItem[];
  } | null;
  /** Explicit warning when no supported case-scoped product snapshot is available. */
  conversationRereadError: string | null;
  quotedBasketV2Items: Array<{
    productId: string;
    productCode: string | null;
    productName: string | null;
    quantity: number | null;
    unitPrice: number | null;
    lineTotal: number | null;
  }>;
  recommendationConversions: RecommendationConversionFactV1[];
  invoiceItemFacts: Array<{
    id: string;
    invoiceId: string | null;
    invoiceNumber: string;
    lineNo: number | null;
    productId: string | null;
    productCode: string | null;
    productName: string;
    quantity: number | null;
    effectiveQuantity: number | null;
    unitName: string | null;
    unitPrice: number | null;
    itemDiscountAmount: number | null;
    itemDiscountPercent: number | null;
    allocatedInvoiceDiscountAmount: number | null;
    grossLineAmount: number | null;
    netLineAmount: number | null;
    returnedQuantity: number | null;
    sellerName: string | null;
    staffId: string | null;
    staffName: string | null;
    catalogCurrentPrice: number | null;
    pricingStatus: string;
    effectiveUnitPrice: number | null;
    quotedUnitPrice: number | null;
    quotedLineTotal: number | null;
    quotedPriceStatus: string;
    quotedPriceDifference: number | null;
    quotedPriceDifferencePercent: number | null;
    matchedOfferId: string | null;
    matchedOfferTitle: string | null;
    pricingNeedsReview: boolean;
    bconnectInvoiceNetAmount: number | null;
    headerInvoiceNetAmount: number | null;
    financialNetDifference: number | null;
    financialNetMatch: boolean | null;
  }>;
  /** Official B-Connect invoice staff identity. Null when the attribution is not official or no invoice exists. */
  invoiceStaffTruth: {
    invoiceStaffIdRaw: string | null;
    invoiceStaffNameRaw: string | null;
    canonicalStaffId: string | null;
    canonicalStaffName: string | null;
    canonicalStaffRole: string | null;
    canonicalStaffBranch: string | null;
    resolutionStatus: 'resolved_by_staff_id' | 'resolved_by_unique_name' | 'ambiguous_name' | 'missing_invoice_staff' | 'unresolved';
    itemEvidenceAvailable: boolean;
  } | null;
  candidateInvoice: {
    id: string;
    invoiceNumber: string;
    customerName: string | null;
    customerCode: string | null;
    /** sales_invoices.customer_id as stored — null means no durable customer link on the invoice. */
    customerId: string | null;
    branch: string | null;
    staffName: string | null;
    invoiceDatetime: string | null;
    total: number | null;
  } | null;
  catalogProductMatches: PersistedProductDisplay[];
}

export interface QaCaseDetailLoadOptions {
  /** Aborted when the selected case changes; the loader stops between read stages. */
  signal?: AbortSignal;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('qa_case_detail_load_aborted', 'AbortError');
}

export async function fetchQaCaseDetail(
  supabaseClient: any,
  caseId: string,
  options: QaCaseDetailLoadOptions = {}
): Promise<QaCaseDetailBundle | null> {
  const { signal } = options;
  const [{ data: caseRow }, { data: analysisRow, error: analysisError }] = await Promise.all([
    supabaseClient.from('sales_intelligence_cases').select('*').eq('case_id', caseId).maybeSingle(),
    supabaseClient.from('sales_intelligence_current_case_analyses').select('*').eq('case_id', caseId).maybeSingle(),
  ]);
  if (analysisError) throw analysisError;
  if (!analysisRow) return null;
  throwIfAborted(signal);

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
  const productTruth = readPersistedProductTruth(caseId, analysisRow);
  const conversationReread: QaCaseDetailBundle['conversationReread'] = {activeBasket: productTruth.basket, basketItems: productTruth.basketItems};
  const conversationRereadError = productTruth.warning;
  const quotedBasketV2Items: QaCaseDetailBundle['quotedBasketV2Items'] = productTruth.basketItems.filter(item => item.productId).map(item => ({productId: item.productId!, productCode: item.productCode ?? null, productName: item.canonicalName ?? null, quantity: item.quantity, unitPrice: item.unitPrice, lineTotal: item.lineTotal}));
  const caseScopedMessageIds = new Set(productTruth.messageIds);
  let sourceAnalysisJson: any = null;
  let sourceSnapshot: QaCaseDetailBundle['sourceSnapshot'] = { isCanonical: true, canonicalSourceId: null };

  throwIfAborted(signal);
  if (caseRow?.conversation_id) {
    const { data: conversationRow } = await supabaseClient
      .from('whatsapp_review_sources')
      .select([...REVIEW_SOURCE_BATCH_INPUT_COLUMNS, 'staff_name', 'invoice_match_confidence', 'invoice_match_reason', 'source_filename', 'conversation_ended_at', 'message_count', 'created_at', 'analysis_json', 'review_status'].join(','))
      .eq('id', caseRow.conversation_id)
      .maybeSingle();
    if (conversationRow?.raw_text) {
      sourceAnalysisJson = conversationRow.analysis_json ?? null;
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
        staffId: conversationRow.staff_id ?? null,
        staffName: conversationRow.staff_name ?? null,
        invoiceMatchConfidence: conversationRow.invoice_match_confidence == null
          ? null
          : Number(conversationRow.invoice_match_confidence),
        invoiceMatchReason: conversationRow.invoice_match_reason == null
          ? null
          : String(conversationRow.invoice_match_reason),
        invoiceLinkConfirmed: conversationRow.invoice_link_confirmed === true,
        invoiceLinkConfirmedInvoiceId: conversationRow.invoice_link_confirmed_invoice_id ?? null,
        invoiceLinkConfirmedInvoiceNumber: conversationRow.invoice_link_confirmed_invoice_number ?? null,
      };

      if (conversationRow.source_filename) {
        const { data: relatedSnapshots } = await supabaseClient
          .from('whatsapp_review_sources')
          .select('id, source_filename, customer_id, customer_name, customer_code, customer_phone, conversation_started_at, conversation_ended_at, message_count, created_at, review_status')
          .eq('source_filename', conversationRow.source_filename)
          .limit(MAX_LIST_ROWS);
        const familyRows = (relatedSnapshots ?? []).some((row: any) => String(row.id) === String(conversationRow.id))
          ? relatedSnapshots
          : [...(relatedSnapshots ?? []), conversationRow];
        const resolution = await loadCanonicalAnalyticalSources(supabaseClient, familyRows as any[]);
        const decision: any = resolution.decisions.get(String(conversationRow.id));
        sourceSnapshot = {
          isCanonical: Boolean(decision?.allowed),
          canonicalSourceId: decision?.allowed
            ? String(conversationRow.id)
            : decision?.supersedingSourceIds?.[0] ?? null,
        };
      } else {
        const resolution = await loadCanonicalAnalyticalSources(supabaseClient, [conversationRow as any]);
        const decision: any = resolution.decisions.get(String(conversationRow.id));
        sourceSnapshot = {
          isCanonical: Boolean(decision?.allowed),
          canonicalSourceId: decision?.allowed ? String(conversationRow.id) : null,
        };
      }

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
      throwIfAborted(signal);

    }
  }

  throwIfAborted(signal);
  // Canonical sale ledger: the V22 case linked to THIS SI case. Read only; visibility is decided
  // by RLS and a hidden row becomes an explicit 'v22_not_visible' state, never a different truth.
  const linkedV22CaseId = caseRow?.source_case_id_v22 ? String(caseRow.source_case_id_v22) : null;
  let v22Row: Record<string, any> | null = null;
  if (linkedV22CaseId) {
    const { data } = await supabaseClient
      .from('whatsapp_customer_cases_v22')
      .select('id, proposed_outcome, confirmed_outcome, verified_invoice_id, verified_invoice_number, verified_revenue, verified_sale_at, canonical_sale_proof:case_json->canonicalSaleProof')
      .eq('id', linkedV22CaseId)
      .maybeSingle();
    v22Row = data ?? null;
  }
  const canonicalTruth = readCanonicalCaseSaleTruth({
    caseId,
    analysisRow,
    attributionRow: attributionRow ?? null,
    linkedV22CaseId,
    v22Row,
  });
  const persistedProofEvidence = deriveSaleProofStateFromPersisted(caseId, analysisRow, attributionRow ?? null, matchRow ?? null);

  // Identity is read from the selected analysis only; no product search or pipeline on open.
  const catalogProductMatches = productTruth.products;

  const invoiceItemFacts: QaCaseDetailBundle['invoiceItemFacts'] = [];
  let candidateInvoice: QaCaseDetailBundle['candidateInvoice'] = null;
  const selectedInvoiceId = canonicalTruth.attribution?.selectedInvoiceId ?? null;

  throwIfAborted(signal);
  if (selectedInvoiceId) {
    const [{ data: itemRows, error: itemRowsError }, { data: invoiceHeader }] = await Promise.all([
      supabaseClient
        .from('sales_invoice_items_v21')
        .select('id,invoice_id,invoice_number,line_no,product_id,product_code,product_name,quantity,unit_price,line_total,raw_data')
        .eq('invoice_id', selectedInvoiceId)
        .order('line_no', { ascending: true })
        .limit(500),
      readInvoiceRecordById(selectedInvoiceId, supabaseClient).then((data) => ({ data })),
    ]);
    // A failed line read is not "no imported lines": the reviewer must see it failed.
    if (itemRowsError) throw itemRowsError;
    if (invoiceHeader) {
      const rawTotal = [
        invoiceHeader.net_amount,
        invoiceHeader.discounted_amount,
        invoiceHeader.amount,
        invoiceHeader.gross_amount,
        invoiceHeader.net_total,
        invoiceHeader.total_amount,
      ].find((value) => value != null);
      const totalValue = rawTotal == null ? null : Number(rawTotal);
      candidateInvoice = {
        id: String(invoiceHeader.id),
        invoiceNumber: String(invoiceHeader.invoice_number ?? invoiceHeader.invoice_no ?? ''),
        customerName: invoiceHeader.customer_name == null ? null : String(invoiceHeader.customer_name),
        customerCode: invoiceHeader.customer_code == null ? null : String(invoiceHeader.customer_code),
        customerId: invoiceHeader.customer_id == null ? null : String(invoiceHeader.customer_id),
        branch: String(invoiceHeader.branch_name ?? invoiceHeader.branch ?? '').trim() || null,
        staffName: String(invoiceHeader.seller_name ?? invoiceHeader.normalized_seller_name ?? invoiceHeader.staff_name ?? '').trim() || null,
        invoiceDatetime: String(invoiceHeader.invoice_datetime ?? invoiceHeader.close_datetime ?? invoiceHeader.invoice_date ?? invoiceHeader.sale_date ?? '').trim() || null,
        total: totalValue != null && Number.isFinite(totalValue) ? totalValue : null,
      };
    }

    const productCodes = Array.from(new Set((itemRows ?? []).map((row: any) => String(row.product_code ?? '').trim()).filter(Boolean)));
    const productIds = Array.from(new Set((itemRows ?? []).map((row: any) => String(row.product_id ?? '').trim()).filter(Boolean)));
    const productsByKey = new Map<string, any>();

    // Independent bounded exact lookups share one transport round. Merge in the original
    // code-then-ID order so canonical ID precedence is unchanged by response arrival order.
    const productResults = await Promise.all([
      productCodes.length
        ? supabaseClient.from('products').select('id,product_code,name,price').in('product_code', productCodes).limit(1000)
        : Promise.resolve({ data: [] }),
      productIds.length
        ? supabaseClient.from('products').select('id,product_code,name,price').in('id', productIds).limit(1000)
        : Promise.resolve({ data: [] }),
    ]);
    for (const { data } of productResults) {
      for (const product of data ?? []) {
        if (product.id) productsByKey.set(`id:${product.id}`, product);
        if (product.product_code) productsByKey.set(`code:${product.product_code}`, product);
      }
    }

    const saleDay = String(invoiceHeader?.invoice_datetime ?? invoiceHeader?.sale_date ?? '').slice(0, 10);
    const branch = String(invoiceHeader?.branch_name ?? invoiceHeader?.branch ?? '').trim();
    let offers: any[] = [];

    if (productCodes.length && saleDay) {
      const { data } = await supabaseClient
        .from('offers')
        .select('id,title,branch,item_code,final_price,start_date,end_date,status,active')
        .in('item_code', productCodes)
        .lte('start_date', saleDay)
        .gte('end_date', saleDay)
        .limit(1000);
      offers = (data ?? []).filter((offer: any) => {
        if (offer.active === false) return false;
        const offerBranch = String(offer.branch ?? '').trim();
        return !offerBranch || !branch || offerBranch === branch;
      });
    }

    for (const row of itemRows ?? []) {
      const meta = readInvoiceItemCommercialMeta(row.raw_data);
      const product = productsByKey.get(`id:${row.product_id}`) ?? productsByKey.get(`code:${row.product_code}`) ?? null;
      const lineOffers = offers
        .filter((offer: any) => String(offer.item_code ?? '') === String(row.product_code ?? ''))
        .map((offer: any) => ({
          id: String(offer.id),
          title: offer.title == null ? null : String(offer.title),
          finalPrice: offer.final_price == null ? null : Number(offer.final_price),
        }));
      const pricing = derivePricingExecutionAssessment(
        {
          quantity: row.quantity == null ? null : Number(row.quantity),
          returnedQuantity: meta.returnedQuantity == null ? null : Number(meta.returnedQuantity),
          effectiveQuantity:
            meta.effectiveQuantity == null
              ? (
                  row.quantity == null
                    ? null
                    : Math.max(0, Number(row.quantity) - Math.max(0, Number(meta.returnedQuantity ?? 0)))
                )
              : Number(meta.effectiveQuantity),
          unitPrice: row.unit_price == null ? null : Number(row.unit_price),
          itemDiscountAmount: meta.itemDiscountAmount == null ? null : Number(meta.itemDiscountAmount),
          itemDiscountPercent: meta.itemDiscountPercent == null ? null : Number(meta.itemDiscountPercent),
          grossLineAmount: meta.grossLineAmount == null ? null : Number(meta.grossLineAmount),
          netLineAmount: meta.netLineAmount == null ? (row.line_total == null ? null : Number(row.line_total)) : Number(meta.netLineAmount),
          invoiceDiscountAmount: meta.invoiceDiscountAmount == null ? null : Number(meta.invoiceDiscountAmount),
          allocatedInvoiceDiscountAmount:
            meta.allocatedInvoiceDiscountAmount == null
              ? null
              : Number(meta.allocatedInvoiceDiscountAmount),
        },
        lineOffers
      );

      const quoted = quotedBasketV2Items.find((item) =>
        (row.product_id && item.productId === String(row.product_id)) ||
        (row.product_code && item.productCode === String(row.product_code))
      ) ?? null;
      const quotedPrice = compareQuotedAndActualUnitPrice(
        quoted?.unitPrice ?? null,
        pricing.effectiveUnitPrice
      );

      invoiceItemFacts.push({
        id: String(row.id),
        invoiceId: row.invoice_id == null ? null : String(row.invoice_id),
        invoiceNumber: String(row.invoice_number ?? ''),
        lineNo: row.line_no == null ? null : Number(row.line_no),
        productId: row.product_id == null ? null : String(row.product_id),
        productCode: row.product_code == null ? null : String(row.product_code),
        productName: String(row.product_name ?? product?.name ?? ''),
        quantity: row.quantity == null ? null : Number(row.quantity),
        effectiveQuantity:
          meta.effectiveQuantity == null
            ? (
                row.quantity == null
                  ? null
                  : Math.max(0, Number(row.quantity) - Math.max(0, Number(meta.returnedQuantity ?? 0)))
              )
            : Number(meta.effectiveQuantity),
        unitName: meta.unitName == null ? null : String(meta.unitName),
        unitPrice: row.unit_price == null ? null : Number(row.unit_price),
        itemDiscountAmount: meta.itemDiscountAmount == null ? null : Number(meta.itemDiscountAmount),
        itemDiscountPercent: meta.itemDiscountPercent == null ? null : Number(meta.itemDiscountPercent),
        allocatedInvoiceDiscountAmount:
          meta.allocatedInvoiceDiscountAmount == null
            ? null
            : Number(meta.allocatedInvoiceDiscountAmount),
        grossLineAmount: meta.grossLineAmount == null ? null : Number(meta.grossLineAmount),
        netLineAmount: meta.netLineAmount == null ? (row.line_total == null ? null : Number(row.line_total)) : Number(meta.netLineAmount),
        returnedQuantity: meta.returnedQuantity == null ? null : Number(meta.returnedQuantity),
        sellerName: invoiceHeader?.seller_name == null && invoiceHeader?.normalized_seller_name == null
          ? null
          : String(invoiceHeader?.seller_name ?? invoiceHeader?.normalized_seller_name),
        staffId: invoiceHeader?.staff_id == null ? null : String(invoiceHeader.staff_id),
        staffName: invoiceHeader?.staff_name == null && invoiceHeader?.seller_name == null
          ? null
          : String(invoiceHeader?.staff_name ?? invoiceHeader?.seller_name),
        catalogCurrentPrice: product?.price == null ? null : Number(product.price),
        pricingStatus: pricing.status,
        effectiveUnitPrice: pricing.effectiveUnitPrice,
        quotedUnitPrice: quoted?.unitPrice ?? null,
        quotedLineTotal: quoted?.lineTotal ?? null,
        quotedPriceStatus: quotedPrice.status,
        quotedPriceDifference: quotedPrice.absoluteDifference,
        quotedPriceDifferencePercent: quotedPrice.relativeDifferencePercent,
        matchedOfferId: pricing.matchedOfferId,
        matchedOfferTitle: pricing.matchedOfferTitle,
        pricingNeedsReview: pricing.needsHumanReview,
        bconnectInvoiceNetAmount:
          meta.invoiceNetAmount == null ? null : Number(meta.invoiceNetAmount),
        headerInvoiceNetAmount:
          invoiceHeader?.net_amount == null ? null : Number(invoiceHeader.net_amount),
        financialNetDifference:
          meta.invoiceNetAmount == null || invoiceHeader?.net_amount == null
            ? null
            : Number((Number(meta.invoiceNetAmount) - Number(invoiceHeader.net_amount)).toFixed(2)),
        financialNetMatch:
          meta.invoiceNetAmount == null || invoiceHeader?.net_amount == null
            ? null
            : Math.abs(Number(meta.invoiceNetAmount) - Number(invoiceHeader.net_amount)) <= 0.02,
      });
    }
  }

  let invoiceStaffTruth: QaCaseDetailBundle['invoiceStaffTruth'] = null;
  const { data: invoiceStaffTruthRow, error: invoiceStaffTruthError } = await supabaseClient
    .from('sales_intelligence_invoice_staff_truth_v1')
    .select('invoice_staff_id_raw,invoice_staff_name_raw,canonical_staff_id,canonical_staff_name,canonical_staff_role,canonical_staff_branch,staff_resolution_status,item_evidence_available')
    .eq('case_id', caseId)
    .maybeSingle();
  if (invoiceStaffTruthError) throw invoiceStaffTruthError;
  if (invoiceStaffTruthRow) {
    invoiceStaffTruth = {
      invoiceStaffIdRaw: invoiceStaffTruthRow.invoice_staff_id_raw ?? null,
      invoiceStaffNameRaw: invoiceStaffTruthRow.invoice_staff_name_raw ?? null,
      canonicalStaffId: invoiceStaffTruthRow.canonical_staff_id ?? null,
      canonicalStaffName: invoiceStaffTruthRow.canonical_staff_name ?? null,
      canonicalStaffRole: invoiceStaffTruthRow.canonical_staff_role ?? null,
      canonicalStaffBranch: invoiceStaffTruthRow.canonical_staff_branch ?? null,
      resolutionStatus: invoiceStaffTruthRow.staff_resolution_status,
      itemEvidenceAvailable: Boolean(invoiceStaffTruthRow.item_evidence_available),
    };
  }

  const rawJourneySummary = sourceAnalysisJson?.operational?.productJourney ?? null;
  const scopedJourneySummary = rawJourneySummary && Array.isArray(rawJourneySummary.journeys)
    ? {
        ...rawJourneySummary,
        journeys: rawJourneySummary.journeys.filter((journey: any) => {
          const recommendationEvent =
            journey?.events?.find((event: any) => event?.stage === 'recommended') ??
            journey?.events?.find((event: any) => event?.stage === 'alternative_offered') ??
            null;
          if (!recommendationEvent) return false;
          return Array.isArray(recommendationEvent.messageIds) &&
            recommendationEvent.messageIds.some((id: string) => caseScopedMessageIds.has(id));
        }),
      }
    : null;

  const recommendationConversions = derivePersistedRecommendationConversionFactsV1({
    journeySummary: scopedJourneySummary,
    participantMessages: Array.isArray(sourceAnalysisJson?.participantRoles?.messages)
      ? sourceAnalysisJson.participantRoles.messages.map((row: any) => ({
          messageId: String(row.messageId ?? ''),
          role: row.role == null ? null : String(row.role),
          staffName: row.staffName == null ? null : String(row.staffName),
          staffId: row.staffId == null ? null : String(row.staffId),
        }))
      : [],
    invoiceLines: invoiceItemFacts.map((item) => ({
      productId: item.productId,
      productCode: item.productCode,
      productName: item.productName,
      quantity: item.effectiveQuantity,
      netLineAmount: item.netLineAmount,
      staffId: item.staffId,
      staffName: item.staffName,
    })),
    invoiceEvidenceLevel:
      attributionRow?.selected_invoice_id &&
      attributionRow?.attribution_level === 'proven' &&
      attributionRow?.is_official_for_staff_evaluation
        ? 'official'
        : attributionRow?.selected_invoice_id
          ? 'candidate'
          : 'unavailable',
  });

  return {
    persisted: { caseRow: caseRow ?? null, analysisRow, attributionRow: attributionRow ?? null, matchRow: matchRow ?? null, policyEvaluationRow: policyEvaluationRow ?? null },
    conversation,
    sourceSnapshot,
    siblingCases,
    transcript,
    canonicalTruth,
    persistedProofEvidence,
    conversationReread,
    conversationRereadError,
    quotedBasketV2Items,
    recommendationConversions,
    invoiceStaffTruth,
    candidateInvoice,
    invoiceItemFacts,
    catalogProductMatches,
  };
}

