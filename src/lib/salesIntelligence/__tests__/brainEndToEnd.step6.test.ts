import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { runSalesIntelligencePipeline } from '@/lib/salesIntelligence/salesIntelligencePipeline';
import { readCaseIntelligence } from '@/lib/salesIntelligence/qa/caseIntelligencePresentation';
import { CaseIntelligenceWorkspace, type CaseIntelligenceTab } from '@/components/salesIntelligence/CaseIntelligenceWorkspace';
import type { SalesIntelligenceCaseAnalysis } from '@/lib/salesIntelligence/types';

// STEP 6 — Fresh end-to-end validation of the analytical brain. Every scenario enters as a raw
// WhatsApp export and is checked across the whole chain (interaction -> customer -> staff -> need ->
// products -> quantities -> availability -> alternatives -> basket -> confirmation -> invoice ->
// Sale Proof -> outcome -> demand -> lost -> follow-up -> Case Intelligence -> Workspace).
// Sale Proof uses the canonical trusted-invoice test double; a candidate alone is never a sale.

const t = (h: number, m: number) => `[9/15/26, ${h > 12 ? h - 12 : h}:${String(m).padStart(2, '0')}:00 ${h < 12 ? 'AM' : 'PM'}]`;
const PROOF = (id: string, amount: number) => ({
  trustedInvoiceId: id,
  invoices: [{ id, customer_id: 'cust-1', invoice_datetime: '2026-09-15T09:10:00.000Z', net_amount: amount }],
});

interface Run {
  raw: string;
  trustedInvoiceId?: string;
  invoices?: any[];
  staffMap?: Record<string, string>;
  resolved?: boolean;
}

function run({ raw, trustedInvoiceId, invoices, staffMap, resolved = true }: Run): SalesIntelligenceCaseAnalysis[] {
  return runSalesIntelligencePipeline({
    conversationId: 'step6',
    rawWhatsAppExportText: raw,
    resolveInvoiceCandidates: () => invoices ?? [],
    trustedInvoiceId: trustedInvoiceId ?? null,
    customerIdHint: resolved ? 'cust-1' : null,
    customerIdentityStatus: resolved ? 'resolved' : 'unresolved',
    branchNameRawHint: 'فرع شكري',
    staffIdBySender: staffMap,
  }).caseAnalyses;
}

const products = (a: SalesIntelligenceCaseAnalysis) => a.customerNeed.products.map((p) => p.productNameRaw).sort();
const product = (a: SalesIntelligenceCaseAnalysis, name: string) => a.customerNeed.products.find((p) => p.productNameRaw === name)!;
const basket = (a: SalesIntelligenceCaseAnalysis) =>
  (a.activeBasket ? a.itemsByBasketId[a.activeBasket.basketId] : []).map((i) => `${i.productNameRaw}x${i.quantity}`).sort();
const actionable = (a: SalesIntelligenceCaseAnalysis) => a.followUp.opportunities.filter((o) => o.status === 'actionable');
const render = (a: SalesIntelligenceCaseAnalysis, tab: CaseIntelligenceTab) =>
  renderToStaticMarkup(
    createElement(CaseIntelligenceWorkspace, {
      view: readCaseIntelligence({ evidence_snapshot: JSON.parse(JSON.stringify({ caseIntelligence: a.caseIntelligence })) }),
      initialTab: tab,
    })
  );

const SALE_A = `${t(9, 0)} Customer: عايز 2 علبة بانادول اكسترا
${t(9, 1)} You: موجود يا فندم، العلبة ب 60 جنيه
${t(9, 2)} Customer: تمام ابعتهم`;
const B = `${t(9, 0)} Customer: عايز كونجستال
${t(9, 1)} You: كونجستال مش موجود، ممكن بدل منه كومتركس
${t(9, 2)} Customer: تمام هات كومتركس`;
const C = `${t(9, 0)} Customer: عايز كونجستال
${t(9, 1)} You: كونجستال مش موجود، فيه كومتركس بدل منه
${t(9, 2)} Customer: لا، أنا عايز كونجستال نفسه`;
const K = `${t(9, 0)} Customer: عايز كونجستال
${t(9, 1)} د. سارة: كونجستال مش موجود
${t(9, 2)} د. أحمد: ممكن كومتركس بدل منه
${t(9, 3)} د. منى: هتابع مع حضرتك`;
const K_STAFF = { 'د. سارة': 'staff-sara', 'د. أحمد': 'staff-ahmed', 'د. منى': 'staff-mona' };
const L = `${t(9, 0)} Customer: عايز بانادول اكسترا و كونجستال
${t(9, 1)} You: بانادول اكسترا موجود، وكونجستال مش موجود
${t(9, 2)} Customer: خلاص ابعت البانادول بس
${t(9, 3)} You: تم تأكيد الطلب`;
const R = `${t(9, 0)} Customer: عايز كونجستال
${t(9, 1)} You: كونجستال مش متوفر، ممكن بدل منه نجيب كومتركس`;

describe('STEP 6 — end-to-end analytical brain', () => {
  it('A. simple sale: one interaction, qty 2, available, accepted; won only after canonical proof', () => {
    const [a] = run({ raw: SALE_A });
    expect(run({ raw: SALE_A })).toHaveLength(1);
    expect(products(a)).toEqual(['بانادول اكسترا']);
    expect(product(a, 'بانادول اكسترا')).toMatchObject({ requestedQuantity: 2, finalQuantity: 2, availability: 'available' });
    expect(basket(a)).toEqual(['بانادول اكسترا x2'.replace(' x', 'x')]);
    expect(a.salesOutcome.outcome).not.toBe('sale_proven');
    expect(a.lostOpportunity.state).toBe('open');
    expect(a.followUp.decision).toBe('not_needed');
    const [proven] = run({ raw: SALE_A, ...PROOF('inv-a', 120) });
    expect(proven.salesOutcome.outcome).toBe('sale_proven');
    expect(proven.lostOpportunity.state).toBe('won');
    expect(proven.followUp.decision).toBe('not_needed');
  });

  it('B. unavailable + alternative accepted: X demand kept, basket holds Y only, no follow-up', () => {
    const [a] = run({ raw: B });
    expect(products(a)).toEqual(['كومتركس', 'كونجستال']);
    expect(product(a, 'كونجستال').availability).toBe('unavailable');
    expect(product(a, 'كونجستال').alternatives[0]).toMatchObject({ productNameRaw: 'كومتركس', response: 'accepted' });
    expect(product(a, 'كونجستال').roles).not.toContain('rejected');
    expect(basket(a)).toEqual(['كومتركسxnull']);
    expect(a.unavailableDemand).toHaveLength(1);
    expect(a.unavailableDemand[0]).toMatchObject({ requestedProductRaw: 'كونجستال', alternativeResponse: 'accepted', followUpCandidate: false });
    expect(a.lostOpportunity.state).not.toBe('lost');
    expect(a.lostOpportunity.productLosses[0]).toMatchObject({ requestedProductRaw: 'كونجستال', outcome: 'replaced_by_alternative' });
    expect(actionable(a)).toHaveLength(0);
  });

  it('C. unavailable + alternative rejected: demand remains, recoverable, stock follow-up, no fake sale', () => {
    const [a] = run({ raw: C });
    expect(product(a, 'كونجستال').alternatives[0]).toMatchObject({ productNameRaw: 'كومتركس', response: 'rejected' });
    expect(a.unavailableDemand[0]).toMatchObject({ alternativeResponse: 'rejected', followUpCandidate: true });
    expect(a.lostOpportunity).toMatchObject({ state: 'recoverable', reason: 'alternative_rejected' });
    expect(actionable(a).map((o) => o.reason)).toEqual(['stock_unavailable']);
    expect(a.salesOutcome.outcome).not.toBe('sale_proven');
  });

  it('D. staff promises a stock check: check_pending, attributed to the promiser, high-priority obligation, not lost', () => {
    const [a] = run({ raw: `${t(9, 0)} Customer: عندكم كونجستال؟\n${t(9, 1)} د. منى: هتأكد من توفره وأرجع لحضرتك`, staffMap: { 'د. منى': 'staff-mona' } });
    expect(product(a, 'كونجستال').availability).toBe('check_pending');
    expect(a.unavailableDemand[0]).toMatchObject({ availabilityState: 'check_pending', statedByStaffName: 'د. منى', statedByStaffId: 'staff-mona' });
    const [followUp] = actionable(a);
    expect(followUp).toMatchObject({ reason: 'stock_check_pending', priority: 'high', assignedStaffId: 'staff-mona' });
    expect(a.lostOpportunity.state).not.toBe('lost');
  });

  it('E. customer question "X مش موجود؟" + staff "موجود": available, no demand, no loss, no follow-up', () => {
    const [a] = run({ raw: `${t(9, 0)} Customer: كونجستال مش موجود؟\n${t(9, 1)} You: موجود يا فندم` });
    expect(products(a)).toEqual(['كونجستال']);
    expect(product(a, 'كونجستال').availability).toBe('available');
    expect(a.unavailableDemand).toHaveLength(0);
    expect(a.lostOpportunity.state).not.toBe('lost');
    expect(a.followUp.decision).toBe('not_needed');
  });

  it('F. price objection + "هفكر": recoverable price, follow-up, not lost', () => {
    const [a] = run({ raw: `${t(9, 0)} Customer: عايز سيروم فيتامين سي\n${t(9, 1)} You: سعره 300 جنيه\n${t(9, 2)} Customer: غالي شوية، هفكر` });
    expect(products(a)).toEqual(['سيروم فيتامين سي']);
    expect(a.lostOpportunity).toMatchObject({ state: 'recoverable', reason: 'price', recoverability: 'medium' });
    expect(actionable(a)[0]).toMatchObject({ reason: 'price_objection', nextBestAction: 'follow_up_with_value_or_allowed_offer' });
  });

  it('G. "غالي، خلاص مش عايزه": lost price, no recoverability, follow-up suppressed', () => {
    const [a] = run({ raw: `${t(9, 0)} Customer: عايز سيروم فيتامين سي\n${t(9, 1)} You: سعره 300 جنيه\n${t(9, 2)} Customer: غالي، خلاص مش عايزه` });
    expect(a.lostOpportunity).toMatchObject({ state: 'lost', reason: 'price', recoverability: 'none' });
    expect(actionable(a)).toHaveLength(0);
  });

  it('H. bought elsewhere: lost competitor, no recoverability, no follow-up', () => {
    const [a] = run({ raw: `${t(9, 0)} Customer: عايز سيروم فيتامين سي\n${t(9, 1)} You: سعره 300 جنيه\n${t(9, 30)} Customer: خلاص جبته من صيدلية تانية` });
    expect(a.lostOpportunity).toMatchObject({ state: 'lost', reason: 'competitor', recoverability: 'none' });
    expect(actionable(a)).toHaveLength(0);
  });

  it('I. no staff reply: requested product only as stated, staff_no_response immediate obligation, no clock loss', () => {
    const [a] = run({ raw: `${t(9, 0)} Customer: عايز بانادول اكسترا لو سمحت` });
    expect(products(a)).toEqual(['بانادول اكسترا']);
    expect(product(a, 'بانادول اكسترا').requestedQuantity).toBeNull();
    expect(a.lostOpportunity).toMatchObject({ state: 'recoverable', reason: 'staff_no_response' });
    expect(actionable(a)[0]).toMatchObject({ reason: 'staff_no_response', duePolicy: 'immediate' });
  });

  it('J. customer silent after an offer that needs an answer: exactly one recovery, no decline', () => {
    const [a] = run({ raw: `${t(9, 0)} Customer: عايز بانادول اكسترا\n${t(9, 1)} You: موجود ب 60 جنيه، أجهزهولك؟` });
    expect(a.lostOpportunity).toMatchObject({ state: 'recoverable', reason: 'customer_no_response' });
    expect(actionable(a)).toHaveLength(1);
    expect(a.customerNeed.needDeclined).toBe(false);
  });

  it('K. multiple staff: unavailable -> A, alternative -> B, promise -> C', () => {
    const [a] = run({ raw: K, staffMap: K_STAFF });
    const facts = a.caseIntelligence.staff.facts.map((f) => `${f.staffSender}:${f.fact}`);
    expect(facts).toEqual(expect.arrayContaining(['د. سارة:stated_unavailable', 'د. أحمد:offered_alternative', 'د. منى:promised_follow_up']));
    expect(a.unavailableDemand[0]).toMatchObject({ statedByStaffId: 'staff-sara', alternativeOfferedByStaffId: 'staff-ahmed' });
    expect(actionable(a).find((o) => o.reason === 'staff_promised_check')).toMatchObject({ assignedStaffId: 'staff-mona' });
    expect(products(a)).toEqual(['كونجستال']);
  });

  it('L. mixed products: X in the proven sale, Y unavailable demand + product loss kept', () => {
    const [a] = run({ raw: L, ...PROOF('inv-l', 60) });
    expect(products(a)).toEqual(['بانادول اكسترا', 'كونجستال']);
    expect(basket(a)).toEqual(['بانادول اكستراxnull']);
    expect(a.salesOutcome.outcome).toBe('sale_proven');
    expect(a.lostOpportunity.state).toBe('won');
    expect(a.unavailableDemand.map((d) => d.requestedProductRaw)).toEqual(['كونجستال']);
    expect(a.lostOpportunity.productLosses).toEqual([expect.objectContaining({ requestedProductRaw: 'كونجستال', reason: 'stock_unavailable' })]);
    expect(actionable(a)).toHaveLength(0); // no explicit request to be notified for Y
  });

  it('M. a new need after a finished sale ("بالمناسبة ...") is a separate interaction with no leakage', () => {
    const cases = run({
      raw: `${t(9, 0)} Customer: عايز 1 علبة بانادول اكسترا
${t(9, 1)} You: حضرتك تأمر بـ:
1 علبة بانادول اكسترا
إجمالي الحساب 60 جنيه
هل الطلب كده كامل؟
${t(9, 2)} Customer: تمام
${t(9, 3)} You: تم تأكيد الطلب
${t(9, 20)} Customer: بالمناسبة عايز كونجستال كمان`,
    });
    expect(cases).toHaveLength(2);
    expect(new Set(cases.map((c) => c.caseId)).size).toBe(2);
    expect(products(cases[0])).toEqual(['بانادول اكسترا']);
    expect(products(cases[1])).toEqual(['كونجستال']);
    expect(cases[1].caseIntelligence.interaction.segmentationReason).toBe('topic_shift_marker');
  });

  it('N. a late staff answer to a pending question stays in the same interaction', () => {
    const cases = run({ raw: `${t(9, 0)} Customer: عندكم كونجستال؟\n${t(13, 0)} You: كونجستال موجود يا فندم` });
    expect(cases).toHaveLength(1);
    expect(product(cases[0], 'كونجستال').availability).toBe('available');
  });

  it('O. delivery complaint after a proven sale: sale kept, delivery follow-up, not a lost sale', () => {
    const [a] = run({
      raw: `${t(9, 0)} Customer: عايز 1 علبة بانادول اكسترا
${t(9, 1)} You: حضرتك تأمر بـ:
1 علبة بانادول اكسترا
إجمالي الحساب 60 جنيه
هل الطلب كده كامل؟
${t(9, 2)} Customer: تمام
${t(9, 3)} You: تم تأكيد الطلب وجاري الإرسال
${t(11, 0)} Customer: الأوردر لسه موصلش`,
      ...PROOF('inv-o', 60),
    });
    expect(a.salesOutcome.outcome).toBe('sale_proven');
    expect(a.lostOpportunity.state).toBe('won');
    expect(actionable(a)).toEqual([expect.objectContaining({ reason: 'delivery_unresolved', nextBestAction: 'resolve_delivery_status' })]);
  });

  it('P. courtesy close: not a request, not a no-response trigger, no follow-up', () => {
    const [a] = run({ raw: `${t(9, 0)} Customer: عايز بانادول اكسترا\n${t(9, 1)} You: موجود يا فندم، تحت أمر حضرتك` });
    expect(a.lostOpportunity.reason).toBeNull();
    expect(a.followUp.decision).toBe('not_needed');
  });

  it('Q. quantity revision: requested 2 kept in history, final basket 1, no duplicate product', () => {
    const [a] = run({ raw: `${t(9, 0)} Customer: عايز 2 علبة بانادول اكسترا\n${t(9, 1)} You: موجود يا فندم\n${t(9, 2)} Customer: خليهم علبة واحدة بس` });
    expect(products(a)).toEqual(['بانادول اكسترا']);
    expect(product(a, 'بانادول اكسترا')).toMatchObject({ requestedQuantity: 2, finalQuantity: 1 });
    expect(basket(a)).toEqual(['بانادول اكستراx1']);
    expect(a.basketHistory.length).toBe(2);
  });

  it('R. a staff sentence is never a product or basket line', () => {
    const [a] = run({ raw: R });
    expect(products(a)).toEqual(['كونجستال']);
    expect(product(a, 'كونجستال').alternatives[0].productNameRaw).toBe('كومتركس');
    expect(basket(a).some((line) => line.includes('مش متوفر'))).toBe(false);
  });

  it('S. "وكمان فيتامين د" resolves to the same requested product (connector words, not blind prefix stripping)', () => {
    const [a] = run({ raw: `${t(9, 0)} Customer: عايز فيتامين د\n${t(9, 1)} You: فيتامين د موجود ب 90 جنيه\n${t(9, 2)} Customer: وكمان فيتامين د` });
    expect(products(a)).toEqual(['فيتامين د']);
    // A product whose own name starts with "و" is never cut.
    const [b] = run({ raw: `${t(9, 0)} Customer: عايز ويكس` });
    expect(products(b)).toEqual(['ويكس']);
  });

  it('Workspace renders exactly the canonical output for A, B, C, K, L, R', () => {
    const [a] = run({ raw: SALE_A });
    expect(render(a, 'products')).toContain('بانادول اكسترا');
    const [b] = run({ raw: B });
    const bProducts = render(b, 'products');
    expect(bProducts).toContain('استُبدل ببديل');
    expect(bProducts).toContain('وافق على البديل');
    const [c] = run({ raw: C });
    expect(render(c, 'followup')).toContain('التواصل مع العميل عند توفر الصنف');
    const [k] = run({ raw: K, staffMap: K_STAFF });
    const kReview = render(k, 'review');
    expect(kReview).toContain('د. سارة: قال إن الصنف غير متوفر');
    expect(kReview).toContain('د. أحمد: عرض بديلًا');
    expect(kReview).toContain('د. منى: وعد بالمتابعة');
    const [l] = run({ raw: L, ...PROOF('inv-l', 60) });
    const lProducts = render(l, 'products');
    expect(lProducts).toContain('ضمن بيع مثبت');
    expect(lProducts).toContain('غير متوفر — قابل للاسترداد');
    const [r] = run({ raw: R });
    expect(render(r, 'products')).not.toContain('مش متوفر، ممكن');
  });
});
