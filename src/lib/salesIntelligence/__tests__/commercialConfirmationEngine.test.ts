import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildConversationUnderstandingV32 } from '@/lib/whatsappConversationUnderstandingV32';
import { deriveConversationCases } from '@/lib/salesIntelligence/conversationCaseEngine';
import { buildCaseBaskets } from '@/lib/salesIntelligence/caseBasketEngine';
import { deriveCommercialConfirmationState } from '@/lib/salesIntelligence/commercialConfirmationEngine';

/** Builds the case + baskets + Phase C events + assessment for the FIRST case in a fixture. */
function assessFirstCase(raw: string) {
  const sessions = splitWhatsAppSessions(parseWhatsAppExport(raw), 120);
  expect(sessions.length).toBeGreaterThan(0);
  const understanding = buildConversationUnderstandingV32(sessions[0]);
  const cases = deriveConversationCases({ understanding, conversationId: 'conv-1' });
  const interaction = understanding.interactions[0];
  const scoped = understanding.messages.filter((m) => interaction.messageIds.includes(m.id));
  const result = buildCaseBaskets(cases[0].caseId, scoped);
  const assessment = deriveCommercialConfirmationState(
    cases[0].caseId,
    result.baskets,
    result.summaryEvents,
    result.customerConfirmationEvents,
    result.staffFinalConfirmationEvents
  );
  return { theCase: cases[0], ...result, assessment };
}

describe('Commercial Confirmation Engine (Sales Intelligence Phase C) — Golden Cases', () => {
  describe('Final Summary', () => {
    it('1. a clear multi-item final summary produces exactly one summary event', () => {
      const { summaryEvents, baskets } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز انتينال وستريبتوكين
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
3 علب انتينال
2 علبة ستريبتوكين
إجمالي الحساب 500 جنيه`);
      expect(summaryEvents.length).toBe(1);
      expect(summaryEvents[0].basketVersion).toBe(baskets[0].version);
    });

    it('2. ordinary product/availability discussion is NOT treated as a final summary', () => {
      const { summaryEvents } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د
[9/15/26, 9:01:00 AM] You: متوفر عندنا 2 علبة فيتامين د بسعر 180 جنيه`);
      expect(summaryEvents.length).toBe(0);
    });

    it('3. a product list mentioned informally, without a closing recap marker, is NOT a final summary', () => {
      const { summaryEvents, assessment } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د وشامبو
[9/15/26, 9:01:00 AM] You: عندنا فيتامين د وشامبو للشعر متوفرين
[9/15/26, 9:02:00 AM] Customer: تمام هفكر`);
      expect(summaryEvents.length).toBe(0);
      expect(assessment.currentState).toBe('basket_in_progress');
    });

    it('4. a final summary presented after a long basket-building conversation is still recognized', () => {
      const { summaryEvents } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د
[9/15/26, 9:01:00 AM] You: متوفر بسعر 90 جنيه
[9/15/26, 9:02:00 AM] Customer: كمان عايز شامبو
[9/15/26, 9:03:00 AM] You: تمام متوفر شامبو كمان
[9/15/26, 9:04:00 AM] Customer: طيب ابعتهملي
[9/15/26, 9:05:00 AM] You: حضرتك تأمر بـ:
1 علبة فيتامين د
1 قطعة شامبو
إجمالي الحساب 150 جنيه
هل الطلب كده كامل لحضرتك؟`);
      expect(summaryEvents.length).toBe(1);
    });
  });

  describe('Announced Total', () => {
    it('5. "الحساب كله 1000 جنيه" is extracted as the announced total', () => {
      const { baskets } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
الحساب كله 1000 جنيه`);
      expect(baskets[0].announcedTotal?.amount).toBe(1000);
    });

    it('6. "الإجمالي 1000" (no unit word) is extracted as the announced total', () => {
      const { baskets } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
الإجمالي 1000`);
      expect(baskets[0].announcedTotal?.amount).toBe(1000);
    });

    it('7. a single product\'s price must NOT become the announced order total', () => {
      const { baskets } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د سعرها 90 جنيه للعلبة
هل الطلب كده كامل؟`);
      expect(baskets[0].announcedTotal).toBeNull();
    });

    it('8. a delivery fee alone must NOT become the announced order total', () => {
      const { baskets } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
مصاريف التوصيل 20 جنيه
هل الطلب كده كامل؟`);
      expect(baskets[0].announcedTotal).toBeNull();
    });

    it('9-10. a modification supersedes v1\'s total; v2 gets its own new total, never the old one carried forward', () => {
      const { baskets } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: كمان عايز شامبو للشعر
[9/15/26, 9:03:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
1 قطعة شامبو
إجمالي الحساب 250 جنيه
هل الطلب كده كامل؟`);
      expect(baskets.length).toBe(2);
      expect(baskets[0].status).toBe('superseded');
      expect(baskets[0].announcedTotal?.amount).toBe(180);
      expect(baskets[1].announcedTotal?.amount).toBe(250);
    });
  });

  describe('Customer Confirmation', () => {
    it('11. a linked "ايوه تمام" confirms the active basket version', () => {
      const { baskets, customerConfirmationEvents } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: ايوه تمام`);
      expect(baskets[0].status).toBe('confirmed');
      expect(customerConfirmationEvents.length).toBe(1);
      expect(customerConfirmationEvents[0].relatedSummaryMessageId).not.toBeNull();
    });

    it('12. an unrelated "تمام" with no prior final summary does NOT confirm anything', () => {
      const { baskets, customerConfirmationEvents } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د
[9/15/26, 9:01:00 AM] You: متوفر بسعر 90 جنيه
[9/15/26, 9:02:00 AM] Customer: تمام`);
      expect(baskets[0].status).not.toBe('confirmed');
      expect(customerConfirmationEvents.length).toBe(0);
    });

    it('13. "خلاص ابعته" confirms the active basket', () => {
      const { baskets } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: خلاص ابعته`);
      expect(baskets[0].status).toBe('confirmed');
    });

    it('14. a customer question instead of a confirmation leaves the basket awaiting confirmation, untouched', () => {
      const { baskets, itemsByBasketId, assessment } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: هو السعر ده شامل التوصيل؟`);
      expect(baskets.length).toBe(1);
      expect(baskets[0].status).toBe('awaiting_confirmation');
      expect(itemsByBasketId[baskets[0].basketId].length).toBe(1);
      expect(assessment.currentState).toBe('awaiting_customer_confirmation');
    });
  });

  describe('Modification after confirmation', () => {
    it('15. adding an item after confirmation opens v2; v1 stays historically confirmed', () => {
      const { baskets, assessment } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: تمام
[9/15/26, 9:03:00 AM] Customer: كمان عايز شامبو للشعر`);
      expect(baskets.length).toBe(2);
      expect(baskets[0].status).toBe('superseded');
      expect(baskets[0].confirmedByCustomerAt).not.toBeNull();
      expect(assessment.modificationAfterConfirmation).toBe(true);
      expect(assessment.currentState).toBe('modified_after_confirmation');
    });

    it('16. removing an item after confirmation opens v2', () => {
      const { baskets, assessment } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د وشامبو
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
1 علبة فيتامين د
1 قطعة شامبو
إجمالي الحساب 200 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: تمام
[9/15/26, 9:03:00 AM] Customer: شيل الشامبو`);
      expect(baskets.length).toBe(2);
      expect(assessment.currentState).toBe('modified_after_confirmation');
    });

    it('17. changing quantity after confirmation opens v2', () => {
      const { baskets, itemsByBasketId } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: تمام
[9/15/26, 9:03:00 AM] Customer: خليهم 3 بدل 2`);
      expect(baskets.length).toBe(2);
      expect(itemsByBasketId[baskets[1].basketId][0].quantity).toBe(3);
    });

    it('18. substituting an item after confirmation opens v2', () => {
      const { baskets, itemsByBasketId } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز 1 قطعة صابونة عادية
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
1 قطعة صابونة عادية
إجمالي الحساب 60 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: تمام
[9/15/26, 9:03:00 AM] Customer: بدل الصابونة العادية هات التاني`);
      expect(baskets.length).toBe(2);
      expect(itemsByBasketId[baskets[1].basketId][0].productNameRaw).toBe('التاني');
    });

    it('19. the superseded v1 confirmation stays historically true but is no longer the active state', () => {
      const { baskets } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: تمام
[9/15/26, 9:03:00 AM] Customer: خليهم 3 بدل 2`);
      // v1's own historical confirmation fact is preserved on its (now superseded) record...
      expect(baskets[0].confirmedByCustomerAt).not.toBeNull();
      expect(baskets[0].status).toBe('superseded');
      expect(baskets[0].supersededByBasketId).toBe(baskets[1].basketId);
      // ...but v2 (the active version) has NOT inherited that confirmation.
      expect(baskets[1].confirmedByCustomerAt).toBeNull();
      expect(baskets[1].status).not.toBe('confirmed');
    });
  });

  describe('Rejection', () => {
    it('20. rejecting one item modifies the basket into a new version, never a whole cancellation', () => {
      const { baskets, itemsByBasketId } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د وشامبو
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
1 علبة فيتامين د
1 قطعة شامبو
إجمالي الحساب 200 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: شيل الشامبو`);
      expect(baskets.length).toBe(2);
      expect(baskets[1].status).not.toBe('cancelled');
      expect(itemsByBasketId[baskets[1].basketId].map((i) => i.productNameRaw)).toEqual(['فيتامين د']);
    });

    it('21. rejecting the whole order cancels the case (rejected), producing no new version', () => {
      const { baskets, assessment } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: لا خلاص مش عايز الطلب`);
      expect(baskets.length).toBe(1);
      expect(baskets[0].status).toBe('cancelled');
      expect(assessment.currentState).toBe('rejected');
    });
  });

  describe('Staff Final Confirmation', () => {
    it('22. staff "جاري الإرسال" after customer confirmation is a valid staff final confirmation', () => {
      const { staffFinalConfirmationEvents, assessment } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: تمام
[9/15/26, 9:03:00 AM] You: تمام يا فندم، جاري الإرسال`);
      expect(staffFinalConfirmationEvents.length).toBe(1);
      expect(assessment.staffConfirmed).toBe(true);
    });

    it('23. staff "جاري الإرسال" BEFORE any customer confirmation is never counted as staff final confirmation', () => {
      const { staffFinalConfirmationEvents, assessment } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
[9/15/26, 9:02:00 AM] You: جاري الإرسال`);
      expect(staffFinalConfirmationEvents.length).toBe(0);
      expect(assessment.staffConfirmed).toBe(false);
      expect(assessment.currentState).not.toBe('commercial_confirmation_complete');
    });

    it('24. a bare "حاضر" alone is never sufficient as a staff final confirmation', () => {
      const { staffFinalConfirmationEvents, assessment } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: تمام
[9/15/26, 9:03:00 AM] You: حاضر`);
      expect(staffFinalConfirmationEvents.length).toBe(0);
      expect(assessment.currentState).toBe('customer_confirmed');
    });

    it('25. customer confirmation with no staff final confirmation stays at customer_confirmed only', () => {
      const { assessment } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: تمام`);
      expect(assessment.currentState).toBe('customer_confirmed');
      expect(assessment.staffConfirmed).toBe(false);
    });
  });

  describe('End-to-End', () => {
    it('26. summary -> total -> customer confirms -> staff confirms => commercial_confirmation_complete', () => {
      const { assessment } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: ايوه تمام
[9/15/26, 9:03:00 AM] You: تمام يا فندم، تم تأكيد الطلب بقيمة 180 جنيه وجاري التجهيز والإرسال`);
      expect(assessment.currentState).toBe('commercial_confirmation_complete');
      expect(assessment.summaryPresented).toBe(true);
      expect(assessment.customerConfirmed).toBe(true);
      expect(assessment.staffConfirmed).toBe(true);
    });

    it('27. summary -> customer confirms -> customer modifies => NOT complete', () => {
      const { assessment } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: تمام
[9/15/26, 9:03:00 AM] Customer: خليهم 3 بدل 2`);
      expect(assessment.currentState).not.toBe('commercial_confirmation_complete');
      expect(assessment.currentState).toBe('modified_after_confirmation');
    });

    it('28. v1 confirm -> modify -> v2 summary -> new total -> confirm -> staff confirm => only v2 is active/complete', () => {
      const { baskets, assessment } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: تمام
[9/15/26, 9:03:00 AM] Customer: كمان عايز شامبو للشعر
[9/15/26, 9:04:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
1 قطعة شامبو
إجمالي الحساب 250 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:05:00 AM] Customer: ايوه تمام
[9/15/26, 9:06:00 AM] You: تمام يا فندم، تم تأكيد الطلب وجاري الإرسال`);
      expect(baskets.length).toBe(2);
      expect(assessment.basketId).toBe(baskets[1].basketId);
      expect(assessment.basketVersion).toBe(2);
      expect(assessment.currentState).toBe('commercial_confirmation_complete');
      expect(assessment.announcedTotalPresent).toBe(true);
      expect(baskets[1].announcedTotal?.amount).toBe(250);
    });
  });
});
