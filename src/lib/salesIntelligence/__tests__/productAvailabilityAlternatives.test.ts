import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildConversationUnderstandingV32 } from '@/lib/whatsappConversationUnderstandingV32';
import {
  classifyAvailabilityStatementV32,
  classifyCustomerOfferResponseV32,
  extractAlternativeOfferSignals,
  extractAvailabilitySignals,
} from '@/lib/whatsappSemanticSignalsV32';
import { buildCaseBaskets } from '@/lib/salesIntelligence/caseBasketEngine';
import { deriveConversationCases } from '@/lib/salesIntelligence/conversationCaseEngine';
import { deriveCustomerNeedModel } from '@/lib/salesIntelligence/customerNeedModel';
import { resolveActiveBasket } from '@/lib/salesIntelligence/basketInvoiceMatchingEngine';

// BRAIN STEP 4B — Product Availability + Alternative Intelligence.
// Availability/alternatives extend the SAME Customer Need product lifecycle; they are never a
// second product extraction. Only staff statements assert stock, each fact is attributed to its
// own sender, and anything that cannot be tied to exactly one product stays unlinked evidence.

function understandingOf(raw: string, staffNames: string[] = []) {
  const session = splitWhatsAppSessions(parseWhatsAppExport(raw), 24 * 60)[0];
  if (staffNames.length) session.outboundStaffNames = [...(session.outboundStaffNames || []), ...staffNames];
  return buildConversationUnderstandingV32(session);
}

function needFor(raw: string, options: { staffNames?: string[]; staffIdBySender?: Record<string, string> } = {}) {
  const understanding = understandingOf(raw, options.staffNames);
  const messages = understanding.messages;
  const conversationCase = deriveConversationCases({ understanding, conversationId: 'availability-case' })[0];
  const { baskets, itemsByBasketId } = buildCaseBaskets(conversationCase.caseId, messages);
  const resolution = resolveActiveBasket(baskets);
  return deriveCustomerNeedModel({
    caseId: conversationCase.caseId,
    messages,
    baskets,
    itemsByBasketId,
    activeBasket: resolution.outcome === 'selected' ? resolution.basket : null,
    staffIdBySender: options.staffIdBySender,
  });
}

describe('V32 availability signals — staff statements only', () => {
  it('classifies staff stock statements', () => {
    expect(classifyAvailabilityStatementV32('الصنف مش موجود حاليًا')).toBe('unavailable');
    expect(classifyAvailabilityStatementV32('للأسف غير متوفر عندنا')).toBe('unavailable');
    expect(classifyAvailabilityStatementV32('موجود يا فندم')).toBe('available');
    expect(classifyAvailabilityStatementV32('لحظة أتأكد من توفره')).toBe('check_pending');
    expect(classifyAvailabilityStatementV32('مش موجود حاليًا، تحب بديل؟')).toBe('unavailable');
  });

  it('a question clause is never a stock fact', () => {
    expect(classifyAvailabilityStatementV32('هو مش موجود؟')).toBeNull();
    expect(classifyAvailabilityStatementV32('موجود؟')).toBeNull();
  });

  it('a customer asking "هو مش موجود؟" produces no availability signal', () => {
    const understanding = understandingOf(`[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة كونجستال
[9/15/26, 9:01:00 AM] Customer: هو مش موجود؟`);
    expect(extractAvailabilitySignals(understanding.messages)).toHaveLength(0);
  });

  it('alternative offers come from staff; a generic offer counts only after unavailability', () => {
    const understanding = understandingOf(`[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة كونجستال
[9/15/26, 9:01:00 AM] You: كونجستال مش متوفر حاليًا
[9/15/26, 9:02:00 AM] You: ممكن أقدم لحضرتك كومتركس`);
    const signals = extractAlternativeOfferSignals(understanding.messages);
    expect(signals).toHaveLength(1);
    expect(signals[0].extractedValue).toBe('كومتركس');
    expect(signals[0].relatedMessageIds).toHaveLength(1);

    const plainOffer = understandingOf(`[9/15/26, 9:00:00 AM] Customer: عايز حاجة للبرد
[9/15/26, 9:01:00 AM] You: ممكن أقدم لحضرتك كومتركس`);
    expect(extractAlternativeOfferSignals(plainOffer.messages)).toHaveLength(0);
  });

  it('classifies the customer answer to an offer', () => {
    expect(classifyCustomerOfferResponseV32('تمام هاته')).toBe('accepted');
    expect(classifyCustomerOfferResponseV32('لا مش عايزه')).toBe('rejected');
    expect(classifyCustomerOfferResponseV32('هفكر وأرد عليك')).toBe('considering');
    expect(classifyCustomerOfferResponseV32('يعني ايه المادة الفعالة')).toBeNull();
  });
});

describe('Customer Need lifecycle — availability + alternatives', () => {
  it('a stock question answered "unavailable" becomes an unavailable requested product', () => {
    const model = needFor(`[9/15/26, 9:00:00 AM] Customer: عندكم بانادول اكسترا؟
[9/15/26, 9:01:00 AM] You: للأسف مش موجود حاليًا`);
    const product = model.products.find((p) => p.productNameRaw.includes('بانادول'));
    expect(product).toBeDefined();
    expect(product!.roles).toContain('requested');
    expect(product!.availability).toBe('unavailable');
    expect(product!.availabilityEvidence[0].staffSender).toBe('You');
    expect(product!.availabilityEvidence[0].staffId).toBeNull();
    expect(model.unlinkedAvailability).toHaveLength(0);
  });

  it('the latest staff statement wins: check_pending then available', () => {
    const model = needFor(`[9/15/26, 9:00:00 AM] Customer: عندكم بانادول اكسترا؟
[9/15/26, 9:01:00 AM] You: لحظة أتأكد من توفره
[9/15/26, 9:03:00 AM] You: موجود يا فندم`);
    const product = model.products.find((p) => p.productNameRaw.includes('بانادول'))!;
    expect(product.availabilityEvidence.map((e) => e.state)).toEqual(['check_pending', 'available']);
    expect(product.availability).toBe('available');
  });

  it('a customer-only "هو مش موجود؟" never marks the product unavailable', () => {
    const model = needFor(`[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة كونجستال
[9/15/26, 9:01:00 AM] Customer: هو مش موجود؟`);
    expect(model.products.every((p) => p.availability === 'unknown')).toBe(true);
  });

  it('links an accepted alternative to the unavailable original, keeping the requested quantity', () => {
    const model = needFor(`[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة كونجستال
[9/15/26, 9:01:00 AM] You: كونجستال مش متوفر حاليًا، ممكن بدل منه نجيب كومتركس
[9/15/26, 9:02:00 AM] Customer: تمام هاته`);
    const original = model.products.find((p) => p.productNameRaw.includes('كونجستال'))!;
    expect(original.requestedQuantity).toBe(1);
    expect(original.availability).toBe('unavailable');
    expect(original.alternatives).toHaveLength(1);
    expect(original.alternatives[0].productNameRaw).toContain('كومتركس');
    expect(original.alternatives[0].response).toBe('accepted');
    expect(original.alternatives[0].offeredByStaffSender).toBe('You');
    expect(original.alternatives[0].responseMessageId).toBeTruthy();
  });

  it.each([
    ['لا مش عايزه', 'rejected'],
    ['هفكر وأرد عليك', 'considering'],
  ])('customer answer "%s" -> alternative %s', (answer, expected) => {
    const model = needFor(`[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة كونجستال
[9/15/26, 9:01:00 AM] You: كونجستال مش متوفر حاليًا، فيه بديل كومتركس
[9/15/26, 9:02:00 AM] Customer: ${answer}`);
    const original = model.products.find((p) => p.productNameRaw.includes('كونجستال'))!;
    expect(original.alternatives[0].response).toBe(expected);
  });

  it('no customer reply after the offer -> no_response', () => {
    const model = needFor(`[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة كونجستال
[9/15/26, 9:01:00 AM] You: كونجستال مش متوفر حاليًا، فيه بديل كومتركس`);
    const original = model.products.find((p) => p.productNameRaw.includes('كونجستال'))!;
    expect(original.alternatives[0].response).toBe('no_response');
  });

  it('attributes each fact to its own sender — never the first staff member', () => {
    const model = needFor(
      `[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة كونجستال
[9/15/26, 9:01:00 AM] د. سارة: كونجستال مش متوفر حاليًا
[9/15/26, 9:02:00 AM] د. أحمد: فيه بديل كومتركس
[9/15/26, 9:03:00 AM] Customer: تمام هاته`,
      { staffNames: ['د. سارة', 'د. أحمد'], staffIdBySender: { 'د. أحمد': 'staff-ahmed' } }
    );
    const original = model.products.find((p) => p.productNameRaw.includes('كونجستال'))!;
    expect(original.availabilityEvidence[0].staffSender).toBe('د. سارة');
    expect(original.availabilityEvidence[0].staffId).toBeNull();
    expect(original.alternatives[0].offeredByStaffSender).toBe('د. أحمد');
    expect(original.alternatives[0].offeredByStaffId).toBe('staff-ahmed');
  });

  it('an unnamed "unavailable" with two open requests stays unlinked instead of being guessed', () => {
    const model = needFor(`[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة كونجستال
[9/15/26, 9:00:20 AM] Customer: وكمان 1 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: للأسف مش موجود حاليًا`);
    expect(model.products.length).toBeGreaterThanOrEqual(2);
    expect(model.products.every((p) => p.availability === 'unknown')).toBe(true);
    expect(model.unlinkedAvailability).toHaveLength(1);
    expect(model.unlinkedAvailability[0].linkBasis).toBe('unlinked');
  });
});

describe('alternative phrase stops at the end of its clause', () => {
  it('"…نجيب كومتركس، وفيتامين د موجود" -> "كومتركس"', () => {
    const understanding = understandingOf(`[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة كونجستال
[9/15/26, 9:01:00 AM] You: كونجستال مش موجود حاليًا، ممكن بدل منه نجيب كومتركس، وفيتامين د موجود`);
    expect(extractAlternativeOfferSignals(understanding.messages)[0].extractedValue).toBe('كومتركس');
  });
});

