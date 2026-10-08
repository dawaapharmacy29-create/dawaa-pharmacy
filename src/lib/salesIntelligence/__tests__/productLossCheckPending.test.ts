// Canonical rule: only a real UNAVAILABLE fact is product-loss evidence. A check_pending stock
// check ("هراجع لحضرتك التوفر") is unresolved operational demand — kept in Unavailable Demand and
// Follow-up — never ProductLossEvidence(stock_unavailable).
import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildConversationUnderstandingV32 } from '@/lib/whatsappConversationUnderstandingV32';
import { runSalesIntelligencePipeline } from '@/lib/salesIntelligence/salesIntelligencePipeline';
import { deriveLostOpportunity } from '@/lib/salesIntelligence/lostOpportunityEngine';
import type { SalesIntelligenceCaseAnalysis } from '@/lib/salesIntelligence/types';
import { productStatus } from '@/lib/salesIntelligence/qa/caseIntelligencePresentation';

function analyze(lines: string[]) {
  const raw = lines.map((line, i) => `[9/15/26, 9:${String(i).padStart(2, '0')}:00 AM] ${line}`).join('\n');
  const result = runSalesIntelligencePipeline({
    conversationId: 'loss-check-pending',
    rawWhatsAppExportText: raw,
    resolveInvoiceCandidates: () => [],
    staffIdBySender: { You: 'staff-1' },
  });
  expect(result.caseAnalyses.length).toBeGreaterThan(0);
  return { analysis: result.caseAnalyses[0], raw };
}

function asProven({ analysis, raw }: { analysis: SalesIntelligenceCaseAnalysis; raw: string }) {
  const messages = buildConversationUnderstandingV32(splitWhatsAppSessions(parseWhatsAppExport(raw), 24 * 60)[0]).messages;
  return deriveLostOpportunity({
    caseId: analysis.caseId,
    messages,
    customerNeed: analysis.customerNeed,
    unavailableDemand: analysis.unavailableDemand,
    commercialConfirmation: analysis.commercialConfirmation,
    journeyState: analysis.journeyState,
    salesOutcome: { ...analysis.salesOutcome, outcome: 'sale_proven', saleProofState: 'proven', isSaleCountable: true, isRevenueCountable: true },
  });
}

const product = (a: SalesIntelligenceCaseAnalysis, name: string) => a.customerNeed.products.find((p) => p.productNameRaw.includes(name))!;
const activeReasons = (a: SalesIntelligenceCaseAnalysis) => a.followUp.opportunities.filter((o) => o.status !== 'suppressed').map((o) => o.reason);

describe('Lost Opportunity — check_pending is not a product loss', () => {
  it('A. requested product + "هراجع لحضرتك التوفر" -> check_pending, no ProductLossEvidence, open waiting staff', () => {
    const { analysis } = analyze(['Customer: عايز 1 علبة كونجستال', 'You: تحت أمر حضرتك، هراجع لحضرتك التوفر.']);
    expect(product(analysis, 'كونجستال').availability).toBe('check_pending');
    expect(analysis.lostOpportunity.productLosses).toEqual([]);
    expect(analysis.lostOpportunity).toMatchObject({ state: 'open', waitingOn: 'staff', reason: null, explanation: 'open.staff_checking_availability' });
    // The demand itself is preserved for operational stock checking + follow-up.
    expect(analysis.unavailableDemand.map((d) => d.availabilityState)).toEqual(['check_pending']);
    expect(activeReasons(analysis)).toEqual(['stock_check_pending']);
    expect(analysis.operationalDisposition!.state).toBe('action_required_pharmacy');
    const viewProduct = analysis.caseIntelligence.products.find((p) => p.productNameRaw.includes('كونجستال'))!;
    expect(viewProduct.lossOutcome).toBeNull();
    expect(viewProduct.lossReason).toBeNull();
    // QA display reads the stated availability; never "غير متوفر — قابل للاسترداد" for a pending check.
    expect(productStatus(viewProduct, analysis.salesOutcome.outcome).label).toBe('جاري مراجعة التوفر');
  });

  it('B. later "متوفر" -> no product loss and the stale check_pending obligation closes', () => {
    const { analysis } = analyze(['Customer: عايز 1 علبة كونجستال', 'You: هراجع لحضرتك التوفر', 'You: كونجستال متوفر يا فندم']);
    expect(product(analysis, 'كونجستال').availability).toBe('available');
    expect(analysis.lostOpportunity.productLosses).toEqual([]);
    expect(analysis.unavailableDemand).toEqual([]);
    expect(activeReasons(analysis)).not.toContain('stock_check_pending');
    expect(activeReasons(analysis)).not.toContain('staff_promised_check');
  });

  it('C. later "مش متوفر" -> now recoverable stock_unavailable product evidence', () => {
    const { analysis } = analyze(['Customer: عايز 1 علبة كونجستال', 'You: هراجع لحضرتك التوفر', 'You: للأسف كونجستال مش متوفر حاليا']);
    expect(product(analysis, 'كونجستال').availability).toBe('unavailable');
    expect(analysis.lostOpportunity.productLosses).toHaveLength(1);
    expect(analysis.lostOpportunity.productLosses[0]).toMatchObject({ outcome: 'recoverable', reason: 'stock_unavailable' });
  });

  it('D. unavailable + accepted alternative -> replaced_by_alternative backed by a real unavailable fact', () => {
    const { analysis } = analyze([
      'Customer: عايز 1 علبة كونجستال',
      'You: كونجستال مش متوفر حاليًا، ممكن بدل منه نجيب كومتركس',
      'Customer: تمام هاته',
    ]);
    const loss = analysis.lostOpportunity.productLosses.find((p) => p.requestedProductRaw.includes('كونجستال'))!;
    expect(loss).toMatchObject({ outcome: 'replaced_by_alternative', reason: 'stock_unavailable' });
    const demand = analysis.unavailableDemand.find((d) => d.demandKey === loss.demandKey)!;
    expect(demand.availabilityState).toBe('unavailable');
  });

  it('E. unavailable + rejected alternative -> alternative_rejected semantics unchanged', () => {
    const { analysis } = analyze([
      'Customer: عايز 1 علبة كونجستال',
      'You: كونجستال مش متوفر حاليًا، ممكن بدل منه نجيب كومتركس',
      'Customer: لا مش عايز البديل',
    ]);
    const loss = analysis.lostOpportunity.productLosses.find((p) => p.requestedProductRaw.includes('كونجستال'))!;
    expect(loss.reason).toBe('alternative_rejected');
    expect(['recoverable', 'lost']).toContain(loss.outcome);
  });

  it('F. multiple products + unlinked check_pending -> never invents a product loss', () => {
    const { analysis } = analyze(['Customer: عايز 1 علبة كونجستال', 'Customer: وكمان 2 علبة فيتامين د', 'You: هراجع لحضرتك التوفر']);
    expect(analysis.customerNeed.unlinkedAvailability.map((row) => row.state)).toContain('check_pending');
    expect(analysis.lostOpportunity.productLosses).toEqual([]);
  });

  it('G. proven sale of A + check_pending B -> sale truth separate; B stays open demand, not lost', () => {
    const run = analyze([
      'Customer: عايز 1 علبة كونجستال',
      'Customer: وكمان 2 علبة فيتامين د',
      'You: فيتامين د موجود، وكونجستال هراجع لحضرتك التوفر',
      'You: حضرتك تأمر بـ:\n2 علبة فيتامين د\nإجمالي الحساب 180 جنيه\nهل الطلب كده كامل؟',
      'Customer: تمام',
    ]);
    expect(product(run.analysis, 'كونجستال').availability).toBe('check_pending');
    const lost = asProven(run);
    expect(lost.state).toBe('won');
    expect(lost.productLosses.some((p) => p.requestedProductRaw.includes('كونجستال'))).toBe(false);
    expect(run.analysis.unavailableDemand.some((d) => d.availabilityState === 'check_pending')).toBe(true);
    expect(activeReasons(run.analysis)).toContain('stock_check_pending');
  });
});
