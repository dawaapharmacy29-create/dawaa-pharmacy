// A1 regression fixture — "WhatsApp Chat with معاذ مزروع - 17.txt" — through the canonical chain:
//   persisted source raw_text (exact production format of source 4b2f3e27-…)
//   -> Canonical Source Gate (requires exactly one Customer Case V22 owner)
//   -> Sales Intelligence pipeline V20 -> Product/Need = GAST-REG 50MG 3AMP (40049)
//   -> follow-up promise "هراجع لحضرتك التوفر." at the end of the export = pending, no penalty.
// Catalog rows are the real GAST-REG `products` rows (same as productNeedResolutionE2E).
import { describe, expect, it } from 'vitest';
import { buildCanonicalProduct, countNormalizedNames, type RawProductRow } from '../pharmacyProducts/canonicalProduct';
import { normalizePharmacyText } from '../pharmacyProducts/pharmacyNormalization';
import { buildPharmacyProductIndex } from '../pharmacyProducts/pharmacyProductResolverV2';
import { runSalesIntelligencePipeline } from '../salesIntelligencePipeline';
import { evaluateCanonicalSourceGate, CANONICAL_SOURCE_GATE_CODES } from '../persistence/canonicalSourceGate';
import { PIPELINE_VERSION } from '../persistence/versions';
import { analyzeConversationEvaluationFollowUp } from '../conversationEvaluationFollowUp';

const SOURCE_ID = '4b2f3e27-6847-48f8-b2ef-dea4b319df0b';
const V22_CASE_ID = 'v22-case-a1';
const NOOR_STAFF_ID = '82b9c2a1-6139-4b07-9937-ef80a6e926d8';
const A1_RAW_TEXT =
  '10/06/2026, 9:00 AM - معاذ مزروع: جاست ريج أمبول\n' +
  '10/06/2026, 9:01 AM - نور: أهلًا وسهلًا بحضرتك 🌷 مع حضرتك د/ نور من صيدليات دواء. تحت أمر حضرتك، هراجع لحضرتك التوفر.\n';

const CATALOG_ROWS: RawProductRow[] = [
  { id: '6fb1480c-936b-452b-9c42-8d364782e2af', name: 'GAST-REG 100MG 30 TAB', product_code: '58009', normalized_name: 'gast reg 100mg 30 tab', category: null, price: 72, source: 'catalog_import' },
  { id: '0b7a430f-7023-4d79-846f-128ea4c1fec2', name: 'GAST-REG 200 MG 20 TAB', product_code: '21304', normalized_name: 'gast reg 200 mg 20 tab', category: null, price: 14.4, source: 'catalog_import' },
  { id: '48b9373a-5a06-4fba-8fc8-de159e21894b', name: 'GAST-REG 200 MG 30 TAB', product_code: '57353', normalized_name: 'gast reg 200 mg 30 tab', category: null, price: 84, source: 'catalog_import' },
  { id: '65ccef56-825a-4c31-93c8-a3bdaffd0488', name: 'GAST-REG 50MG 3AMP', product_code: '40049', normalized_name: 'gast reg 50mg 3amp', category: null, price: 33, source: 'catalog_import' },
  { id: '334d0058-8daf-4dbd-ab1a-83cb8d1966af', name: 'GAST-REG SYRUP', product_code: '4620', normalized_name: 'gast reg syrup', category: null, price: 33, source: 'catalog_import' },
];
const counts = countNormalizedNames(CATALOG_ROWS);
const INDEX = buildPharmacyProductIndex(
  CATALOG_ROWS.map((row) => buildCanonicalProduct(row, counts, normalizePharmacyText))
);

const sourceRow = {
  id: SOURCE_ID,
  review_status: 'ready_quick',
  source_filename: 'WhatsApp Chat with معاذ مزروع - 17.txt',
  conversation_started_at: '2026-10-06T06:00:00.000Z',
  conversation_ended_at: '2026-10-06T06:01:00.000Z',
  raw_text: A1_RAW_TEXT,
};

describe('A1 canonical chain — "جاست ريج أمبول"', () => {
  it('is refused by the Canonical Source Gate until a Customer Case V22 owns it (the original incident)', () => {
    const decision = evaluateCanonicalSourceGate(sourceRow, { siblings: [sourceRow], v22CaseIdsBySource: new Map() });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe(CANONICAL_SOURCE_GATE_CODES.missingCase);
  });

  it('is admitted once exactly one V22 case owns it', () => {
    const decision = evaluateCanonicalSourceGate(sourceRow, {
      siblings: [sourceRow],
      v22CaseIdsBySource: new Map([[SOURCE_ID, [V22_CASE_ID]]]),
    });
    expect(decision).toEqual({ allowed: true, sourceId: SOURCE_ID, v22CaseId: V22_CASE_ID });
  });

  it('runs on the canonical pipeline and resolves GAST-REG 50MG 3AMP / 40049', () => {
    expect(PIPELINE_VERSION).toBe('sales-intelligence-v21');
    const result = runSalesIntelligencePipeline({
      conversationId: SOURCE_ID,
      rawWhatsAppExportText: A1_RAW_TEXT,
      customerIdHint: '17fd9821-05c2-4ebb-93dd-38f202611a52',
      customerCodeHint: '17',
      customerNameHint: 'معاذ مزروع',
      customerIdentityStatus: 'resolved',
      staffIdBySender: { نور: NOOR_STAFF_ID },
      resolveInvoiceCandidates: () => [],
      productIndex: INDEX,
    });
    expect(result.caseAnalyses).toHaveLength(1);
    const [analysis] = result.caseAnalyses;
    expect(analysis.customerNeed.products).toHaveLength(1);
    const [product] = analysis.customerNeed.products;
    expect(product.productId).toBe('65ccef56-825a-4c31-93c8-a3bdaffd0488');
    expect(['proven', 'strongly_inferred']).toContain(product.confidence.level);

    expect(analysis.customerNeed.primaryNeed).toBe('جاست ريج أمبول');

    // Availability: the staff commitment is a pending stock check tied to the one open need.
    expect(product.availability).toBe('check_pending');
    expect(analysis.unavailableDemand).toHaveLength(1);
    expect(analysis.unavailableDemand[0].availabilityState).toBe('check_pending');

    // Follow-up: one specific, actionable obligation; no duplicate generic promise.
    expect(analysis.followUp.decision).toBe('actionable');
    const active = analysis.followUp.opportunities.filter((o) => o.status !== 'suppressed');
    expect(active.map((o) => o.reason)).toEqual(['stock_check_pending']);
    expect(active[0]).toMatchObject({
      status: 'actionable',
      productId: '65ccef56-825a-4c31-93c8-a3bdaffd0488',
      assignedStaffName: 'نور',
      assignedStaffId: NOOR_STAFF_ID,
      nextBestAction: 'complete_stock_check_and_reply',
    });
    expect(analysis.followUp.opportunities.some((o) => o.reason === 'staff_promised_check')).toBe(false);

    // Lost Opportunity agrees: open, waiting on staff.
    expect(analysis.lostOpportunity.state).toBe('open');
    expect(analysis.lostOpportunity.waitingOn).toBe('staff');

    // Canonical operational disposition (single owner), projected unchanged into the view.
    const disposition = analysis.caseIntelligence.operationalDisposition!;
    expect(disposition).toMatchObject({
      state: 'action_required_pharmacy',
      actionOwner: 'pharmacy',
      waitingOn: 'pharmacy',
      nextBestAction: 'complete_stock_check_and_reply',
      decisiveFollowUpReason: 'stock_check_pending',
      assignedStaffName: 'نور',
      assignedStaffId: NOOR_STAFF_ID,
      productIds: ['65ccef56-825a-4c31-93c8-a3bdaffd0488'],
      commercialState: 'open',
    });
    expect(disposition).toEqual(analysis.operationalDisposition);

    // Scoring maturity is separate: operationally actionable, but the promise is still pending.
    const followUp = analyzeConversationEvaluationFollowUp(analysis.caseIntelligence).item;
    expect(followUp.selectedOption).not.toBe('never');
    expect(followUp.pointsEarned).toBeNull();
    expect(followUp.lifecycle?.status).toBe('pending');
    expect(followUp.lifecycle?.penaltyEligible).toBe(false);
  });
});
