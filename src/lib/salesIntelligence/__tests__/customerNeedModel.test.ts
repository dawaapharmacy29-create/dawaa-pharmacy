import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildConversationUnderstandingV32 } from '@/lib/whatsappConversationUnderstandingV32';
import { buildCaseBaskets } from '@/lib/salesIntelligence/caseBasketEngine';
import { deriveConversationCases } from '@/lib/salesIntelligence/conversationCaseEngine';
import { deriveCustomerNeedModel } from '@/lib/salesIntelligence/customerNeedModel';
import { resolveActiveBasket } from '@/lib/salesIntelligence/basketInvoiceMatchingEngine';

function modelFor(raw: string) {
  const session = splitWhatsAppSessions(parseWhatsAppExport(raw), 24 * 60)[0];
  const understanding = buildConversationUnderstandingV32(session);
  expect(understanding.interactions).toHaveLength(1);
  const interaction = understanding.interactions[0];
  const messages = understanding.messages.filter((message) => interaction.messageIds.includes(message.id));
  const conversationCase = deriveConversationCases({
    understanding,
    conversationId: 'need-case',
  })[0];
  const { baskets, itemsByBasketId } = buildCaseBaskets(conversationCase.caseId, messages);
  const resolution = resolveActiveBasket(baskets);
  const activeBasket = resolution.outcome === 'selected' ? resolution.basket : null;
  return deriveCustomerNeedModel({
    caseId: conversationCase.caseId,
    messages,
    baskets,
    itemsByBasketId,
    activeBasket,
  });
}

describe('Customer Need Model', () => {
  it('links customer request -> staff recap -> accepted final basket as one product lifecycle', () => {
    const model = modelFor(`[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: تمام`);
    expect(model.primaryNeed).toContain('فيتامين د');
    expect(model.products).toHaveLength(1);
    expect(model.products[0].requestedQuantity).toBe(2);
    expect(model.products[0].offeredQuantity).toBe(2);
    expect(model.products[0].finalQuantity).toBe(2);
    expect(model.products[0].roles).toEqual(
      expect.arrayContaining(['requested', 'offered', 'accepted', 'final_basket'])
    );
    expect(model.unresolvedNeed).toBe(false);
  });

  it('marks a removed item rejected while the retained item remains final', () => {
    const model = modelFor(`[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د وشامبو
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
1 علبة فيتامين د
1 قطعة شامبو
إجمالي الحساب 200 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: شيل الشامبو`);
    const shampoo = model.products.find((product) => product.productNameRaw.includes('شامبو'));
    const vitamin = model.products.find((product) => product.productNameRaw.includes('فيتامين'));
    expect(shampoo?.roles).toContain('rejected');
    expect(shampoo?.roles).not.toContain('final_basket');
    expect(vitamin?.roles).toContain('final_basket');
  });

  it('records a substitution as an alternative lifecycle instead of overwriting history', () => {
    const model = modelFor(`[9/15/26, 9:00:00 AM] Customer: عايز 1 قطعة صابونة عادية
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
1 قطعة صابونة عادية
إجمالي الحساب 60 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: بدل الصابونة العادية هات التاني`);
    const oldProduct = model.products.find((product) => product.productNameRaw.includes('صابونة'));
    const replacement = model.products.find((product) => product.productNameRaw === 'التاني');
    expect(oldProduct?.roles).toContain('rejected');
    expect(replacement?.roles).toContain('alternative');
    expect(replacement?.roles).toContain('final_basket');
  });

  it('classifies explicit objections with their source message and stays conservative for unknowns', () => {
    const price = modelFor(`[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: موجود ب500 جنيه
[9/15/26, 9:02:00 AM] Customer: السعر غالي عليا`);
    expect(price.objections).toHaveLength(1);
    expect(price.objections[0].category).toBe('price');
    expect(price.objections[0].messageId).toBeTruthy();

    const correction = modelFor(`[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: تقصد فيتامين سي؟
[9/15/26, 9:02:00 AM] Customer: لا قصدي فيتامين د`);
    expect(correction.objections.some((item) => item.category === 'unknown')).toBe(true);
  });
});
