// Inverse / negative regressions for the shared staff-commitment grammar and the canonical
// Operational Disposition — all through the real runSalesIntelligencePipeline entry point
// (except J, which pins the disposition precedence rule directly on canonical inputs).
import { describe, expect, it } from 'vitest';
import { buildCanonicalProduct, countNormalizedNames, type RawProductRow } from '../pharmacyProducts/canonicalProduct';
import { normalizePharmacyText } from '../pharmacyProducts/pharmacyNormalization';
import { buildPharmacyProductIndex } from '../pharmacyProducts/pharmacyProductResolverV2';
import { runSalesIntelligencePipeline } from '../salesIntelligencePipeline';
import { deriveCaseOperationalDisposition } from '../caseOperationalDispositionEngine';
import type { FollowUpOpportunity, LostOpportunityAssessment } from '../types';

const ROWS: RawProductRow[] = [
  { id: 'gast-tab', name: 'GAST-REG 100MG 30 TAB', product_code: '58009', normalized_name: 'gast reg 100mg 30 tab', category: null, price: 72, source: 'catalog_import' },
  { id: 'gast-amp', name: 'GAST-REG 50MG 3AMP', product_code: '40049', normalized_name: 'gast reg 50mg 3amp', category: null, price: 33, source: 'catalog_import' },
  { id: 'gast-syrup', name: 'GAST-REG SYRUP', product_code: '4620', normalized_name: 'gast reg syrup', category: null, price: 33, source: 'catalog_import' },
  { id: 'zurcal-amp', name: 'Zurcal 40mg 3 AMP', product_code: '77001', normalized_name: 'zurcal 40mg 3 amp', category: null, price: 120, source: 'catalog_import' },
];
const counts = countNormalizedNames(ROWS);
const INDEX = buildPharmacyProductIndex(ROWS.map((row) => buildCanonicalProduct(row, counts, normalizePharmacyText)));

function run(lines: string[]) {
  const raw = lines.map((line, i) => `[9/15/26, 9:${String(i).padStart(2, '0')}:00 AM] ${line}`).join('\n');
  const result = runSalesIntelligencePipeline({
    conversationId: 'inverse-e2e',
    rawWhatsAppExportText: raw,
    customerIdHint: 'cust-1',
    customerCodeHint: '17',
    customerIdentityStatus: 'resolved',
    staffIdBySender: { You: 'staff-1' },
    resolveInvoiceCandidates: () => [],
    productIndex: INDEX,
  });
  expect(result.caseAnalyses).toHaveLength(1);
  return result.caseAnalyses[0];
}

const active = (a: ReturnType<typeof run>) => a.followUp.opportunities.filter((o) => o.status !== 'suppressed');
const reasons = (a: ReturnType<typeof run>) => active(a).map((o) => o.reason);

describe('operational disposition — inverse cases', () => {
  it('A: "هراجع لحضرتك التوفر" after one product need -> check_pending, actionable pharmacy obligation', () => {
    const a = run(['Customer: جاست ريج أمبول', 'You: تحت أمر حضرتك، هراجع لحضرتك التوفر.']);
    expect(a.customerNeed.products[0].availability).toBe('check_pending');
    expect(reasons(a)).toEqual(['stock_check_pending']);
    expect(a.operationalDisposition).toMatchObject({ state: 'action_required_pharmacy', nextBestAction: 'complete_stock_check_and_reply', assignedStaffId: 'staff-1' });
  });

  it('B: the same promise followed later by staff "متوفر" -> check completed, no stale open promise', () => {
    const a = run(['Customer: جاست ريج أمبول', 'You: هراجع لحضرتك التوفر', 'You: متوفر يا فندم']);
    expect(a.customerNeed.products[0].availability).toBe('available');
    expect(reasons(a)).not.toContain('stock_check_pending');
    expect(reasons(a)).not.toContain('staff_promised_check');
    expect(a.operationalDisposition!.decisiveFollowUpReason).not.toBe('stock_check_pending');
  });

  it('C: followed by staff "مش متوفر" -> unavailable; follow-up from demand rules, not a stale check', () => {
    const a = run(['Customer: جاست ريج أمبول', 'You: هراجع لحضرتك التوفر', 'You: للأسف مش متوفر حاليا']);
    expect(a.customerNeed.products[0].availability).toBe('unavailable');
    expect(reasons(a)).not.toContain('stock_check_pending');
    expect(reasons(a)).not.toContain('staff_promised_check');
    expect(reasons(a)).toContain('stock_unavailable');
    expect(a.operationalDisposition!.state).toBe('awaiting_stock');
  });

  it('D: staff asks "حضرتك محتاج كام علبة؟" -> awaiting_customer, not awaiting_pharmacy', () => {
    const a = run(['Customer: جاست ريج أمبول', 'You: متوفر يا فندم، حضرتك محتاج كام علبة؟']);
    expect(a.operationalDisposition!.state).toBe('awaiting_customer');
    expect(a.operationalDisposition!.actionOwner).toBe('customer');
  });

  it('E: staff asks for the missing prescription -> awaiting_customer until supplied', () => {
    const a = run(['Customer: محتاج جاست ريج أمبول', 'You: ممكن تبعت صورة الروشتة يا فندم']);
    expect(reasons(a)).toContain('prescription_incomplete');
    expect(a.operationalDisposition!.state).toBe('awaiting_customer');
  });

  it('F: customer "هفكر وأرد" -> awaiting_customer', () => {
    const a = run(['Customer: جاست ريج أمبول', 'You: متوفر يا فندم سعره 33 جنيه', 'Customer: تمام هفكر وأرد']);
    expect(a.operationalDisposition!.state).toBe('awaiting_customer');
  });

  it('G: customer wording like "هراجع التوفر" never creates a staff obligation', () => {
    const a = run(['Customer: جاست ريج أمبول', 'Customer: هراجع التوفر عندكم وأرد عليكم']);
    expect(a.customerNeed.products.every((p) => p.availability !== 'check_pending')).toBe(true);
    expect(reasons(a)).not.toContain('stock_check_pending');
    expect(reasons(a)).not.toContain('staff_promised_check');
  });

  it('H: past tense "راجعت التوفر" does not create a new pending promise', () => {
    const a = run(['Customer: جاست ريج أمبول', 'You: راجعت التوفر يا فندم']);
    expect(a.customerNeed.products[0].availability).not.toBe('check_pending');
    expect(reasons(a)).not.toContain('stock_check_pending');
    expect(reasons(a)).not.toContain('staff_promised_check');
  });

  it('I: two product needs -> a generic check is never attached to a random product', () => {
    const a = run(['Customer: جاست ريج أمبول', 'Customer: Zurcal 40mg 3 AMP', 'You: هراجع لحضرتك التوفر']);
    expect(a.customerNeed.products.every((p) => p.availability !== 'check_pending')).toBe(true);
    expect(a.customerNeed.unlinkedAvailability.map((row) => row.state)).toContain('check_pending');
    // Still an operational obligation, but interaction-scoped (no product guessed).
    const generic = active(a).find((o) => o.reason === 'staff_promised_check');
    expect(generic?.productId ?? null).toBeNull();
    expect(a.operationalDisposition).toMatchObject({ state: 'action_required_pharmacy', productIds: [] });
  });

  it('K: partial overall pipeline evidence does not block the strongly evidenced obligation', () => {
    const a = run(['Customer: جاست ريج أمبول', 'You: هراجع لحضرتك التوفر']);
    expect(a.status).not.toBe('analyzed');
    expect(a.operationalDisposition!.state).toBe('action_required_pharmacy');
    expect(a.operationalDisposition!.confidence.score).toBeGreaterThan(0.5);
  });
});

describe('operational disposition — J: sale proof never erases a real future obligation', () => {
  const lost = (state: LostOpportunityAssessment['state']): LostOpportunityAssessment => ({
    caseId: 'c', state, waitingOn: null, reason: null, stage: 'unknown', responsibility: 'unknown', recoverability: 'none',
    productKeys: [], productLosses: [], staffFacts: [], evidenceMessageIds: ['m1'],
    confidence: { level: 'proven', score: 1, ruleIds: ['won.canonical_sale_proven'], evidence: [] }, explanation: 'won.canonical_sale_proven',
  });
  const opportunity = (reason: FollowUpOpportunity['reason']): FollowUpOpportunity => ({
    followUpKey: `fu-${reason}`, caseId: 'c', customerId: 'cust', status: 'actionable', reason, priority: 'high',
    productKey: null, productId: null, productRaw: null, quantity: null, demandKey: null, duePolicy: 'same_shift',
    requestedDelayDays: null, dueAt: null, assignedRole: 'delivery_team', assignedStaffId: null, assignedStaffName: null,
    goal: 'g', nextBestAction: 'resolve_delivery_status', blocker: null, suppressedBy: null, evidenceMessageIds: ['m9'],
    confidence: { level: 'strongly_inferred', score: 0.85, ruleIds: [], evidence: [] },
  });
  const journey = { caseId: 'c', currentState: 'sale_proven', reachedStates: [], evidenceMessageIds: [], reasonCodes: [], confidence: { level: 'proven', score: 1, ruleIds: [], evidence: [] }, reviewRequired: false } as any;

  it('proven sale + unresolved delivery obligation -> commercial won, operational awaiting_delivery', () => {
    const d = deriveCaseOperationalDisposition({
      caseId: 'c', lostOpportunity: lost('won'), journeyState: journey,
      followUp: { caseId: 'c', decision: 'actionable', opportunities: [opportunity('delivery_unresolved')], notNeededReason: null },
    });
    expect(d).toMatchObject({ state: 'awaiting_delivery', actionOwner: 'delivery', commercialState: 'won', nextBestAction: 'resolve_delivery_status' });
  });

  it('proven sale + explicit callback promise -> action required by the pharmacy', () => {
    const d = deriveCaseOperationalDisposition({
      caseId: 'c', lostOpportunity: lost('won'), journeyState: journey,
      followUp: { caseId: 'c', decision: 'actionable', opportunities: [opportunity('delivery_unresolved'), opportunity('callback_requested')], notNeededReason: null },
    });
    expect(d.state).toBe('action_required_pharmacy');
    expect(d.commercialState).toBe('won');
  });

  it('proven sale with no open obligation -> closed', () => {
    const d = deriveCaseOperationalDisposition({
      caseId: 'c', lostOpportunity: lost('won'), journeyState: journey,
      followUp: { caseId: 'c', decision: 'not_needed', opportunities: [], notNeededReason: 'sale_proven' },
    });
    expect(d).toMatchObject({ state: 'closed', actionOwner: 'none', waitingOn: null });
  });

  it('a suppressed follow-up never decides the disposition', () => {
    const suppressed = { ...opportunity('staff_promised_check'), status: 'suppressed' as const, suppressedBy: 'sale_proven' as const };
    const d = deriveCaseOperationalDisposition({
      caseId: 'c', lostOpportunity: lost('won'), journeyState: journey,
      followUp: { caseId: 'c', decision: 'suppressed', opportunities: [suppressed], notNeededReason: null },
    });
    expect(d.state).toBe('closed');
  });
});
