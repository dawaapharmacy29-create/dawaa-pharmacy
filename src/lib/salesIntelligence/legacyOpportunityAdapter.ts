// Sales Intelligence — Legacy Evidence Adapter Boundary.
//
// `whatsapp_sales_opportunities_v17` (and its `whatsapp_evidence_facts_v17` companion) already
// tracks a per-conversation opportunity stage/status with staff/product/quantity attribution and
// invoice-item-level matching fields — see the Phase A report §9. Per the explicit architectural
// decision before Phase B:
//   - V17 may CONTRIBUTE EVIDENCE to the new engine.
//   - V17 must NEVER become the canonical source of ConversationCase/CaseBasket/SaleAttribution/
//     CaseOutcome — those are decided by the new engine after combining all evidence sources.
//   - Nothing here writes back to V17.
//   - Nothing here re-implements V17's own matching logic — this is a translation boundary only,
//     turning V17's already-computed fields into typed, confidence-scored EvidenceRef-shaped
//     facts that a later Phase D attribution engine can weigh alongside other evidence.
//
// Pure functions only. No Supabase calls — callers pass in the row shape they already fetched.
import type { ConfidenceAssessment, ConfidenceLevel, EvidenceRef } from './types';

/** The subset of whatsapp_sales_opportunities_v17 columns this adapter reads — see Phase A report §9. */
export interface LegacyOpportunityRowV17 {
  id: string;
  rootSourceId: string | null;
  currentStage: string | null;
  status: string | null;
  attributedStaffId: string | null;
  attributedStaffName: string | null;
  productId: string | null;
  productName: string | null;
  quantity: number | null;
  matchedInvoiceId: string | null;
  matchedInvoiceNumber: string | null;
  matchedInvoiceValue: number | null;
  matchedInvoiceItemId: string | null;
  matchedInvoiceItemValue: number | null;
  confidence: number | null;
  leakageReason: string | null;
}

export type LegacyEvidenceKind =
  | 'legacy_stage_status'
  | 'legacy_staff_attribution'
  | 'legacy_product_attribution'
  | 'legacy_invoice_header_match'
  | 'legacy_invoice_item_match'
  | 'legacy_leakage_reason';

/**
 * One translated, objective fact derived from a single V17 row/field group — never a re-judged
 * conclusion. `confidence` here reflects how much weight the NEW engine should give this
 * specific legacy fact as evidence, not a copy of V17's own `confidence` column (that column
 * measures something V17-internal we don't reinterpret blindly — see rule below).
 */
export interface LegacyOpportunityEvidence {
  kind: LegacyEvidenceKind;
  sourceOpportunityId: string;
  ref: EvidenceRef;
  confidence: ConfidenceAssessment;
}

const SOURCE_TABLE = 'whatsapp_sales_opportunities_v17';

function assessment(level: ConfidenceLevel, score: number, ruleId: string, evidence: EvidenceRef[]): ConfidenceAssessment {
  return { level, score, ruleIds: [ruleId], evidence };
}

/**
 * Translates one V17 opportunity row into a set of typed evidence facts. Deliberately
 * conservative: V17's own item-level invoice match (`matchedInvoiceItemId`) is treated as
 * `strongly_inferred` evidence (not `proven`) because the NEW engine has not independently
 * re-verified it against a CaseBasket yet — only Phase D's SaleAttribution engine, combining this
 * with other evidence sources, may eventually reach `proven`.
 */
export function adaptLegacyOpportunityEvidence(row: LegacyOpportunityRowV17): LegacyOpportunityEvidence[] {
  const evidence: LegacyOpportunityEvidence[] = [];
  const baseRef = (description: string): EvidenceRef => ({
    sourceTable: SOURCE_TABLE,
    sourceId: row.id,
    description,
  });

  if (row.currentStage || row.status) {
    const ref = baseRef(`V17 opportunity ${row.id}: current_stage="${row.currentStage ?? 'null'}", status="${row.status ?? 'null'}".`);
    evidence.push({
      kind: 'legacy_stage_status',
      sourceOpportunityId: row.id,
      ref,
      confidence: assessment('weakly_inferred', 0.4, 'legacy.stage_status.contextual_only', [ref]),
    });
  }

  if (row.attributedStaffId || row.attributedStaffName) {
    const ref = baseRef(`V17 opportunity ${row.id} attributed staff: id="${row.attributedStaffId ?? 'null'}", name="${row.attributedStaffName ?? 'null'}".`);
    evidence.push({
      kind: 'legacy_staff_attribution',
      sourceOpportunityId: row.id,
      ref,
      confidence: assessment('strongly_inferred', 0.6, 'legacy.staff_attribution.v17_recorded', [ref]),
    });
  }

  if (row.productId || row.productName) {
    const ref = baseRef(`V17 opportunity ${row.id} product: id="${row.productId ?? 'null'}", name="${row.productName ?? 'null'}", quantity=${row.quantity ?? 'null'}.`);
    evidence.push({
      kind: 'legacy_product_attribution',
      sourceOpportunityId: row.id,
      ref,
      confidence: assessment('weakly_inferred', 0.45, 'legacy.product_attribution.v17_recorded', [ref]),
    });
  }

  if (row.matchedInvoiceNumber || row.matchedInvoiceId) {
    const ref = baseRef(`V17 opportunity ${row.id} matched invoice header: number="${row.matchedInvoiceNumber ?? 'null'}", value=${row.matchedInvoiceValue ?? 'null'}.`);
    evidence.push({
      kind: 'legacy_invoice_header_match',
      sourceOpportunityId: row.id,
      ref,
      confidence: assessment('strongly_inferred', 0.65, 'legacy.invoice_header_match.v17_recorded', [ref]),
    });
  }

  if (row.matchedInvoiceItemId) {
    const ref = baseRef(`V17 opportunity ${row.id} matched invoice ITEM: item_id="${row.matchedInvoiceItemId}", value=${row.matchedInvoiceItemValue ?? 'null'}.`);
    evidence.push({
      kind: 'legacy_invoice_item_match',
      sourceOpportunityId: row.id,
      ref,
      // Not 'proven': this engine has not independently re-verified the item match against a
      // CaseBasket yet (sales_invoice_items_v21 is not reliably populated — see Phase A report §10).
      confidence: assessment('strongly_inferred', 0.7, 'legacy.invoice_item_match.v17_recorded_not_reverified', [ref]),
    });
  }

  if (row.leakageReason) {
    const ref = baseRef(`V17 opportunity ${row.id} recorded leakage reason: "${row.leakageReason}".`);
    evidence.push({
      kind: 'legacy_leakage_reason',
      sourceOpportunityId: row.id,
      ref,
      confidence: assessment('weakly_inferred', 0.4, 'legacy.leakage_reason.contextual_only', [ref]),
    });
  }

  return evidence;
}
