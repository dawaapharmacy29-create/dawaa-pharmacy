import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildConversationUnderstandingV32 } from '@/lib/whatsappConversationUnderstandingV32';
import { deriveConversationCases } from '@/lib/salesIntelligence/conversationCaseEngine';
import { buildCaseBaskets, deriveCaseStatusFromBasket } from '@/lib/salesIntelligence/caseBasketEngine';

/** Builds cases + baskets for the FIRST case in a single-interaction fixture. */
function firstCaseWithBaskets(raw: string) {
  const sessions = splitWhatsAppSessions(parseWhatsAppExport(raw), 120);
  expect(sessions.length).toBeGreaterThan(0);
  const understanding = buildConversationUnderstandingV32(sessions[0]);
  const cases = deriveConversationCases({ understanding, conversationId: 'conv-1' });
  const interaction = understanding.interactions[0];
  const scoped = understanding.messages.filter((m) => interaction.messageIds.includes(m.id));
  const { baskets, itemsByBasketId } = buildCaseBaskets(cases[0].caseId, scoped);
  return { cases, theCase: cases[0], baskets, itemsByBasketId };
}

function itemsOf(itemsByBasketId: Record<string, { productNameRaw: string }[]>, basketId: string) {
  return itemsByBasketId[basketId] || [];
}

describe('Case Basket Engine (Sales Intelligence Phase B.2) — Golden Cases', () => {
  describe('Basket item extraction', () => {
    it('B1. a single product stated with an explicit quantity and unit is captured as proven', () => {
      const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: متوفر`;
      const { baskets, itemsByBasketId } = firstCaseWithBaskets(raw);
      expect(baskets.length).toBe(1);
      expect(baskets[0].status).toBe('draft');
      const items = itemsOf(itemsByBasketId, baskets[0].basketId);
      expect(items.length).toBe(1);
      expect(items[0].productNameRaw).toBe('فيتامين د');
      expect(items[0].quantity).toBe(2);
      expect(items[0].unit).toBe('علبة');
      expect(items[0].resolutionStatus).toBe('proven');
    });

    it('B2. a consolidated multi-product staff summary parses every line item and the announced total', () => {
      const raw = `[9/15/26, 9:00:00 AM] Customer: عايز انتينال وستريبتوكين وزوركال
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
3 علب انتينال
2 علبة ستريبتوكين
1 شريط زوركال
إجمالي الحساب 1000 جنيه`;
      const { baskets, itemsByBasketId } = firstCaseWithBaskets(raw);
      expect(baskets.length).toBe(1);
      expect(baskets[0].status).toBe('awaiting_confirmation');
      expect(baskets[0].announcedTotal?.amount).toBe(1000);
      const items = itemsOf(itemsByBasketId, baskets[0].basketId);
      expect(items.map((i) => i.productNameRaw)).toEqual(['انتينال', 'ستريبتوكين', 'زوركال']);
      expect(items.map((i) => i.quantity)).toEqual([3, 2, 1]);
      expect(items.every((i) => i.resolutionStatus === 'proven')).toBe(true);
    });

    it('B3. a product named by staff and referenced back by the customer ("هات منه") resolves to the prior offer', () => {
      const raw = `[9/15/26, 9:00:00 AM] You: عندنا سيروم فيتامين سي
[9/15/26, 9:01:00 AM] Customer: هات منه`;
      const { theCase, baskets, itemsByBasketId } = firstCaseWithBaskets(raw);
      // The resolved reference makes this a real commercial signal, unlike B4 below.
      expect(theCase.status).toBe('basket_building');
      expect(theCase.confidence.level).toBe('strongly_inferred');
      const items = itemsOf(itemsByBasketId, baskets[0].basketId);
      expect(items.length).toBe(1);
      expect(items[0].productNameRaw).toBe('عندنا سيروم فيتامين سي');
      expect(items[0].resolutionStatus).toBe('partially_proven');
      expect(items[0].confidence.level).toBe('strongly_inferred');
    });

    it('B4. a reference with no prior staff offer to resolve against stays unknown, never guessed', () => {
      const raw = `[9/15/26, 9:00:00 AM] Customer: هات منه`;
      const { theCase, baskets, itemsByBasketId } = firstCaseWithBaskets(raw);
      // No resolvable commercial signal — stays at the weaker classification, not basket_building.
      expect(theCase.status).toBe('sales_opportunity');
      expect(theCase.confidence.level).toBe('weakly_inferred');
      const items = itemsOf(itemsByBasketId, baskets[0].basketId);
      expect(items.length).toBe(1);
      expect(items[0].resolutionStatus).toBe('unknown');
      expect(items[0].confidence.level).toBe('unknown');
    });
  });

  describe('Confirmation and basket versioning', () => {
    it('C1. a customer confirmation ("تمام") directly after a final summary confirms that basket version', () => {
      const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل لحضرتك؟
[9/15/26, 9:02:00 AM] Customer: تمام`;
      const { baskets } = firstCaseWithBaskets(raw);
      expect(baskets.length).toBe(1);
      expect(baskets[0].status).toBe('confirmed');
      expect(baskets[0].confirmedByCustomerAt).toBe('2026-09-15T09:02:00.000Z');
      expect(baskets[0].announcedTotal?.amount).toBe(180);
      expect(deriveCaseStatusFromBasket('basket_building', baskets[0])).toBe('customer_confirmed');
    });

    it('C2. a customer adding a new item after the summary supersedes v1 and opens v2 carrying the old item forward', () => {
      const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل لحضرتك؟
[9/15/26, 9:02:00 AM] Customer: كمان عايز شامبو للشعر`;
      const { baskets, itemsByBasketId } = firstCaseWithBaskets(raw);
      expect(baskets.length).toBe(2);
      expect(baskets[0].status).toBe('superseded');
      expect(baskets[0].supersededByBasketId).toBe(baskets[1].basketId);
      expect(baskets[1].status).toBe('draft');
      const v2Items = itemsOf(itemsByBasketId, baskets[1].basketId);
      expect(v2Items.map((i) => i.productNameRaw)).toEqual(['فيتامين د', 'شامبو للشعر']);
      expect(v2Items[1].quantity).toBeNull();
      expect(v2Items[1].resolutionStatus).toBe('partially_proven');
    });

    it('C3. a customer quantity change after the summary supersedes v1 and v2 carries the corrected quantity', () => {
      const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل لحضرتك؟
[9/15/26, 9:02:00 AM] Customer: خليهم 3 بدل 2`;
      const { baskets, itemsByBasketId } = firstCaseWithBaskets(raw);
      expect(baskets.length).toBe(2);
      expect(baskets[0].status).toBe('superseded');
      const v2Items = itemsOf(itemsByBasketId, baskets[1].basketId);
      expect(v2Items.length).toBe(1);
      expect(v2Items[0].quantity).toBe(3);
    });

    it('C4. a generic "تمام" immediately after the summary (no explicit "هل الطلب كامل" question) still links and confirms', () => {
      const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
[9/15/26, 9:02:00 AM] Customer: تمام`;
      const { baskets } = firstCaseWithBaskets(raw);
      expect(baskets[0].status).toBe('confirmed');
      expect(baskets[0].confirmedByCustomerAt).toBe('2026-09-15T09:02:00.000Z');
    });

    it('C5. a generic "تمام" too far past the summary (outside the lookback window) is NOT linked or confirmed', () => {
      const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل لحضرتك؟
[9/15/26, 9:02:00 AM] You: تحت أمرك في أي وقت
[9/15/26, 9:03:00 AM] You: إحنا موجودين لو احتجت حاجة
[9/15/26, 9:04:00 AM] You: يسعدنا خدمتك دايمًا
[9/15/26, 9:05:00 AM] You: ولو في أي استفسار تاني تحت أمرك
[9/15/26, 9:06:00 AM] You: بالتوفيق يا فندم
[9/15/26, 9:07:00 AM] Customer: تمام`;
      const { cases, baskets } = firstCaseWithBaskets(raw);
      expect(cases.length).toBe(1);
      expect(baskets.length).toBe(1);
      expect(baskets[0].status).toBe('awaiting_confirmation');
      expect(baskets[0].confirmedByCustomerAt).toBeNull();
    });

    it('C6. rejecting one item from a multi-item basket removes only that item in the new version', () => {
      const raw = `[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د وشامبو
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
1 علبة فيتامين د
1 قطعة شامبو
إجمالي الحساب 200 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: شيل الشامبو`;
      const { baskets, itemsByBasketId } = firstCaseWithBaskets(raw);
      expect(baskets.length).toBe(2);
      const v1Items = itemsOf(itemsByBasketId, baskets[0].basketId);
      expect(v1Items.map((i) => i.productNameRaw)).toEqual(['فيتامين د', 'شامبو']);
      const v2Items = itemsOf(itemsByBasketId, baskets[1].basketId);
      expect(v2Items.map((i) => i.productNameRaw)).toEqual(['فيتامين د']);
    });

    it('C7. rejecting the whole basket cancels it and creates no new version', () => {
      const raw = `[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: مش عايز الطلب خالص`;
      const { baskets } = firstCaseWithBaskets(raw);
      expect(baskets.length).toBe(1);
      expect(baskets[0].status).toBe('cancelled');
      expect(deriveCaseStatusFromBasket('basket_building', baskets[0])).toBe('cancelled');
    });

    it('C8. a substitution replaces the basket focus item with the customer\'s own wording, never an invented product identity', () => {
      const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 1 قطعة صابونة عادية
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
1 قطعة صابونة عادية
إجمالي الحساب 60 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: بدل الصابونة العادية هات التاني`;
      const { baskets, itemsByBasketId } = firstCaseWithBaskets(raw);
      expect(baskets.length).toBe(2);
      const v2Items = itemsOf(itemsByBasketId, baskets[1].basketId);
      expect(v2Items.length).toBe(1);
      expect(v2Items[0].productNameRaw).toBe('التاني');
      expect(v2Items[0].resolutionStatus).toBe('partially_proven');
      expect(v2Items[0].confidence.level).toBe('weakly_inferred');
    });

    it('C9. multiple sequential modifications produce a correctly-superseding v1 -> v2 -> v3 chain', () => {
      const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: كمان عايز شامبو للشعر
[9/15/26, 9:03:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
1 قطعة شامبو
إجمالي الحساب 250 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:04:00 AM] Customer: خليهم 3 بدل 2`;
      const { baskets, itemsByBasketId } = firstCaseWithBaskets(raw);
      expect(baskets.length).toBe(3);
      expect(baskets[0].status).toBe('superseded');
      expect(baskets[0].supersededByBasketId).toBe(baskets[1].basketId);
      expect(baskets[1].status).toBe('superseded');
      expect(baskets[1].supersededByBasketId).toBe(baskets[2].basketId);
      expect(baskets[2].status).toBe('draft');
      const v3Items = itemsOf(itemsByBasketId, baskets[2].basketId);
      expect(v3Items.map((i) => i.productNameRaw)).toEqual(['فيتامين د', 'شامبو']);
      expect(v3Items[0].quantity).toBe(3);
      expect(v3Items[1].quantity).toBe(1);
    });
  });
});
