import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildConversationUnderstandingV32 } from '@/lib/whatsappConversationUnderstandingV32';
import { deriveConversationCases } from '@/lib/salesIntelligence/conversationCaseEngine';
import { buildCaseBaskets } from '@/lib/salesIntelligence/caseBasketEngine';
import {
  assessOrderConfirmationProtocol,
  deriveCommercialConfirmationState,
  deriveOrderConfirmationProtocolApplicability,
} from '@/lib/salesIntelligence/commercialConfirmationEngine';
import { deriveHistoricalCommercialClosureAssessment } from '@/lib/salesIntelligence/historicalCommercialClosureEngine';
import type { CommercialConfirmationAssessment, HistoricalCommercialClosureAssessment } from '@/lib/salesIntelligence/types';

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
  const protocol = assessOrderConfirmationProtocol(assessment);
  return { theCase: cases[0], scoped, ...result, assessment, protocol };
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

    it('9. a modification supersedes v1, and v1\'s own total stays attached to it exclusively', () => {
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
    });

    it('10. v2 becomes active only once ITS own new total-announcement wording is stated, never inheriting v1\'s', () => {
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
      expect(baskets[1].announcedTotal?.amount).toBe(250);
      expect(baskets[1].announcedTotal?.basketVersion).toBe(2);
    });

    it('10b. the full announced-total lifecycle: old total stays on v1, v2 stays null through an unrelated price mention, and only activates on v2\'s own total wording', () => {
      const { baskets } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: تمام
[9/15/26, 9:03:00 AM] Customer: كمان عايز شامبو للشعر
[9/15/26, 9:04:00 AM] You: شامبو سعره 70 جنيه بس
[9/15/26, 9:05:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
1 قطعة شامبو
إجمالي الحساب 250 جنيه
هل الطلب كده كامل؟`);
      expect(baskets.length).toBe(2);
      // v1's total (180) is untouched, exclusively attached to the superseded v1 record.
      expect(baskets[0].announcedTotal?.amount).toBe(180);
      // v2's FINAL total is 250 — the intervening unrelated per-item price mention ("شامبو سعره 70
      // جنيه بس", no إجمالي/الحساب/مجموع keyword) was never promoted to the order total.
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

  // Phase C.1 hardening: every state left in the public CommercialConfirmationState union must be
  // provably reachable — see the reachability audit in types.ts's doc comment on the union itself.
  describe('State reachability (Phase C.1)', () => {
    it('basket_in_progress is reachable: no final summary yet', () => {
      const { assessment } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د
[9/15/26, 9:01:00 AM] You: متوفر بسعر 90 جنيه`);
      expect(assessment.currentState).toBe('basket_in_progress');
    });

    it('awaiting_customer_confirmation is reachable: summary presented, not yet confirmed', () => {
      const { assessment } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟`);
      expect(assessment.currentState).toBe('awaiting_customer_confirmation');
    });

    it('customer_confirmed is reachable: customer confirmed, staff has not yet', () => {
      const { assessment } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: تمام`);
      expect(assessment.currentState).toBe('customer_confirmed');
    });

    it('modified_after_confirmation is reachable: modified, current version has no NEW summary yet', () => {
      const { assessment } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: تمام
[9/15/26, 9:03:00 AM] Customer: خليهم 3 بدل 2`);
      expect(assessment.currentState).toBe('modified_after_confirmation');
    });

    it('a modified version that HAS its own new summary reports awaiting_customer_confirmation, not modified_after_confirmation', () => {
      // Regression for the Phase C.1 reordering fix: once the current version earns its own
      // fresh final summary, the case has genuinely moved past the modification.
      const { assessment } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
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
هل الطلب كده كامل؟`);
      expect(assessment.modificationAfterConfirmation).toBe(true);
      expect(assessment.currentState).toBe('awaiting_customer_confirmation');
    });

    it('commercial_confirmation_complete is reachable: summary + customer confirm + staff confirm', () => {
      const { assessment } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: ايوه تمام
[9/15/26, 9:03:00 AM] You: تمام يا فندم، تم تأكيد الطلب وجاري الإرسال`);
      expect(assessment.currentState).toBe('commercial_confirmation_complete');
    });

    it('rejected is reachable: whole-basket rejection', () => {
      const { assessment } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: لا خلاص مش عايز الطلب`);
      expect(assessment.currentState).toBe('rejected');
    });

    it('unknown is reachable: a case with zero baskets (e.g. no meaningful messages)', () => {
      const assessment = deriveCommercialConfirmationState('case-empty', [], [], [], []);
      expect(assessment.currentState).toBe('unknown');
      expect(assessment.needsHumanReview).toBe(true);
    });
  });

  describe('Protocol Compliance (Phase C.1)', () => {
    it('a full protocol-compliant case has protocolCompliant=true and no missing steps', () => {
      const { protocol } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: ايوه تمام
[9/15/26, 9:03:00 AM] You: تمام يا فندم، تم تأكيد الطلب وجاري الإرسال`);
      expect(protocol.protocolCompliant).toBe(true);
      expect(protocol.missingProtocolSteps).toEqual([]);
    });

    it('commercial_confirmation_complete can hold TRUE while protocolCompliant is FALSE (legacy conversation with no announced total)', () => {
      // A real summary + real customer acceptance + real staff "جاري الإرسال" with no total ever
      // stated aloud — a valid commercial confirmation, but not protocol-compliant on the total step.
      const { assessment, protocol } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: تمام
[9/15/26, 9:03:00 AM] You: جاري الإرسال`);
      expect(assessment.currentState).toBe('commercial_confirmation_complete');
      expect(protocol.protocolCompliant).toBe(false);
      expect(protocol.missingProtocolSteps).toEqual(['announced_total']);
    });

    it('an incomplete case reports every missing protocol step, not just one', () => {
      const { protocol } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د
[9/15/26, 9:01:00 AM] You: متوفر بسعر 90 جنيه`);
      expect(protocol.protocolCompliant).toBe(false);
      expect(protocol.missingProtocolSteps).toEqual([
        'final_basket_summary',
        'announced_total',
        'customer_final_confirmation',
        'staff_final_confirmation',
      ]);
    });
  });

  describe('Superseded confirmation auditability (Phase C.1)', () => {
    it('v1\'s confirmation event and basket record stay intact after v2 supersedes it — the full chain is queryable', () => {
      const { baskets, customerConfirmationEvents } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: تمام
[9/15/26, 9:03:00 AM] Customer: خليهم 3 بدل 2`);
      expect(baskets.length).toBe(2);
      // Which basket version was confirmed:
      const v1Confirmation = customerConfirmationEvents.find((e) => e.basketVersion === 1);
      expect(v1Confirmation).toBeDefined();
      expect(v1Confirmation!.basketId).toBe(baskets[0].basketId);
      // The confirmed basket's own record still carries that fact, even though superseded:
      expect(baskets[0].status).toBe('superseded');
      expect(baskets[0].confirmedByCustomerAt).not.toBeNull();
      // Which later basket version replaced it:
      expect(baskets[0].supersededByBasketId).toBe(baskets[1].basketId);
      // v2 has NOT inherited v1's confirmation — no confirmation event exists yet for v2.
      expect(customerConfirmationEvents.some((e) => e.basketVersion === 2)).toBe(false);
    });
  });

  describe('Staff final confirmation timing across a version boundary (Phase C.1)', () => {
    it('a staff message after a POST-CONFIRMATION modification never combines with the old (superseded) customer confirmation', () => {
      // v1 confirmed -> customer modifies to v2 -> staff says "جاري الإرسال" while v2 is still a
      // bare draft (no summary, no customer confirmation for v2 yet). This must NOT be read as a
      // staff final confirmation for v2 — staff confirmation only ever belongs to a version that
      // has its OWN customer confirmation, never a prior version's.
      const { baskets, staffFinalConfirmationEvents, assessment } = assessFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: تمام
[9/15/26, 9:03:00 AM] Customer: كمان عايز شامبو للشعر
[9/15/26, 9:04:00 AM] You: جاري الإرسال`);
      expect(baskets.length).toBe(2);
      expect(baskets[1].confirmedAt).toBeNull();
      expect(staffFinalConfirmationEvents.length).toBe(0);
      expect(assessment.staffConfirmed).toBe(false);
      expect(assessment.currentState).not.toBe('commercial_confirmation_complete');
      expect(assessment.currentState).toBe('modified_after_confirmation');
    });
  });

  describe('Protocol Applicability (Phase G.1 / G.2)', () => {
    function commercial(overrides: Partial<CommercialConfirmationAssessment> = {}): CommercialConfirmationAssessment {
      return {
        caseId: 'c1', basketId: 'b1', basketVersion: 1,
        summaryPresented: false, customerConfirmed: false, staffConfirmed: false,
        announcedTotalPresent: false, modificationAfterConfirmation: false,
        currentState: 'basket_in_progress',
        primaryMessageIds: [], ruleIds: [],
        confidence: { level: 'weakly_inferred', score: 0.5, ruleIds: [], evidence: [] },
        needsHumanReview: false, humanReviewReasons: [],
        ...overrides,
      };
    }

    /** Defaults to "no historical evidence at all" — most unit tests below only care about caseType/commercial. */
    function historicalClosure(overrides: Partial<HistoricalCommercialClosureAssessment> = {}): HistoricalCommercialClosureAssessment {
      return {
        caseId: 'c1',
        purchaseIntentDetected: false,
        customerAcceptanceDetected: false,
        staffFulfillmentIntentDetected: false,
        basketReconstructable: false,
        announcedValueAvailable: false,
        closureLevel: 'unknown',
        primaryMessageIds: [],
        confidence: { level: 'unknown', score: 0.2, ruleIds: [], evidence: [] },
        needsHumanReview: false,
        ruleIds: [],
        ...overrides,
      };
    }

    it('1. information-only with no meaningful basket items and no closure evidence -> not_applicable', () => {
      const applicability = deriveOrderConfirmationProtocolApplicability({
        caseType: 'information_only',
        commercial: commercial({ currentState: 'unknown' }),
        hasMeaningfulBasketItems: false,
        historicalClosure: historicalClosure(),
      });
      expect(applicability).toBe('not_applicable');
    });

    it('2. a follow-up caseType is always not_applicable, regardless of basket state or closure evidence', () => {
      const applicability = deriveOrderConfirmationProtocolApplicability({
        caseType: 'follow_up',
        commercial: commercial({ currentState: 'basket_in_progress' }),
        hasMeaningfulBasketItems: true,
        historicalClosure: historicalClosure({ closureLevel: 'strongly_inferred', purchaseIntentDetected: true }),
      });
      expect(applicability).toBe('not_applicable');
    });

    it('3. a complaint caseType is always not_applicable', () => {
      const applicability = deriveOrderConfirmationProtocolApplicability({
        caseType: 'complaint',
        commercial: commercial({ currentState: 'basket_in_progress' }),
        hasMeaningfulBasketItems: true,
        historicalClosure: historicalClosure(),
      });
      expect(applicability).toBe('not_applicable');
    });

    it('4. a real commercial opportunity with a draft basket but no closure evidence (price inquiry) -> not_reached', () => {
      const applicability = deriveOrderConfirmationProtocolApplicability({
        caseType: 'sales_opportunity',
        commercial: commercial({ currentState: 'basket_in_progress' }),
        hasMeaningfulBasketItems: true,
        historicalClosure: historicalClosure({ closureLevel: 'not_closed', purchaseIntentDetected: true }),
      });
      expect(applicability).toBe('not_reached');
    });

    it('5. a real commercial signal (sales_opportunity) with no captured item yet -> not_reached, even before any item is parseable', () => {
      // A real-data regression: a price-quote-only exchange ("سعره كام" -> "170ج") never gets a
      // captured basket item (no quantity+unit phrase, no resolvable pronoun), but Phase B's own
      // caseType classification already confirms real commercial intent — this must never read as
      // "not an order flow at all" just because our item-extraction regex found nothing to parse.
      const applicability = deriveOrderConfirmationProtocolApplicability({
        caseType: 'sales_opportunity',
        commercial: commercial({ currentState: 'basket_in_progress' }),
        hasMeaningfulBasketItems: false,
        historicalClosure: historicalClosure({ closureLevel: 'not_closed', purchaseIntentDetected: true }),
      });
      expect(applicability).toBe('not_reached');
    });

    it('5b. a bare acknowledgement with NO request signal and no closure evidence at all -> not_applicable', () => {
      const applicability = deriveOrderConfirmationProtocolApplicability({
        caseType: 'information_only',
        commercial: commercial({ currentState: 'basket_in_progress' }),
        hasMeaningfulBasketItems: false,
        historicalClosure: historicalClosure(),
      });
      expect(applicability).toBe('not_applicable');
    });

    it('6. a summary was presented (awaiting customer confirmation) -> applicable (formal evidence alone is sufficient)', () => {
      const applicability = deriveOrderConfirmationProtocolApplicability({
        caseType: 'sales_opportunity',
        commercial: commercial({ currentState: 'awaiting_customer_confirmation', summaryPresented: true }),
        hasMeaningfulBasketItems: true,
        historicalClosure: historicalClosure(),
      });
      expect(applicability).toBe('applicable');
    });

    it('7. commercial_confirmation_complete -> applicable', () => {
      const applicability = deriveOrderConfirmationProtocolApplicability({
        caseType: 'sales_opportunity',
        commercial: commercial({ currentState: 'commercial_confirmation_complete', summaryPresented: true, customerConfirmed: true, staffConfirmed: true }),
        hasMeaningfulBasketItems: true,
        historicalClosure: historicalClosure({ closureLevel: 'explicit' }),
      });
      expect(applicability).toBe('applicable');
    });

    it('8. real-data regression: a price-only inquiry ("ده موجود" -> "لحظات اشوفه" -> silence) is not_reached end-to-end', () => {
      const { theCase, assessment, itemsByBasketId, baskets, scoped } = assessFirstCase(`[9/12/26, 9:51:32 PM] Customer: ده موجود
[9/12/26, 9:52:36 PM] You: لحظات اشوفه لحضرتك
[9/12/26, 10:36:37 PM] You: حضرتك تحب نبتعه باذن الله`);
      const hasMeaningfulBasketItems = baskets.some((b) => (itemsByBasketId[b.basketId] ?? []).length > 0);
      const latest = baskets[baskets.length - 1];
      const closure = deriveHistoricalCommercialClosureAssessment(
        theCase.caseId, scoped, assessment, itemsByBasketId[latest?.basketId] ?? [], latest?.announcedTotal != null
      );
      const applicability = deriveOrderConfirmationProtocolApplicability({
        caseType: theCase.caseType,
        commercial: assessment,
        hasMeaningfulBasketItems,
        historicalClosure: closure,
      });
      expect(applicability).toBe('not_reached');
    });

    it('9. STRONG historical closure without a formal summary -> applicable (Phase G.2 calibration, formal summary is a compliance step, never an applicability prerequisite)', () => {
      const applicability = deriveOrderConfirmationProtocolApplicability({
        caseType: 'sales_opportunity',
        commercial: commercial({ currentState: 'basket_in_progress' }),
        hasMeaningfulBasketItems: false,
        historicalClosure: historicalClosure({
          closureLevel: 'strongly_inferred', purchaseIntentDetected: true,
          customerAcceptanceDetected: true, staffFulfillmentIntentDetected: true,
        }),
      });
      expect(applicability).toBe('applicable');
    });

    it('10. WEAK/ambiguous closure is never automatically applicable — a reconstructable basket + one signal is flagged unknown, not silently promoted', () => {
      const applicability = deriveOrderConfirmationProtocolApplicability({
        caseType: 'sales_opportunity',
        commercial: commercial({ currentState: 'basket_in_progress' }),
        hasMeaningfulBasketItems: true,
        historicalClosure: historicalClosure({
          closureLevel: 'weakly_inferred', purchaseIntentDetected: true,
          customerAcceptanceDetected: true, basketReconstructable: true,
        }),
      });
      expect(applicability).toBe('unknown');
    });

    it('11. WEAK closure with no reconstructable basket at all stays not_reached — real commercial signal, but too thin to call a closing moment', () => {
      const applicability = deriveOrderConfirmationProtocolApplicability({
        caseType: 'sales_opportunity',
        commercial: commercial({ currentState: 'basket_in_progress' }),
        hasMeaningfulBasketItems: false,
        historicalClosure: historicalClosure({
          closureLevel: 'weakly_inferred', purchaseIntentDetected: true, customerAcceptanceDetected: true,
        }),
      });
      expect(applicability).toBe('not_reached');
    });

    it('12. a strongly_inferred closure that the closure engine itself flagged as ambiguous (needsHumanReview) is downgraded to unknown, never silently applicable', () => {
      const applicability = deriveOrderConfirmationProtocolApplicability({
        caseType: 'sales_opportunity',
        commercial: commercial({ currentState: 'basket_in_progress' }),
        hasMeaningfulBasketItems: true,
        historicalClosure: historicalClosure({
          closureLevel: 'strongly_inferred', purchaseIntentDetected: true,
          customerAcceptanceDetected: true, staffFulfillmentIntentDetected: true, needsHumanReview: true,
        }),
      });
      expect(applicability).toBe('unknown');
    });

    it('13. applicability does not depend on any policy effective date — it is derived purely from case/closure evidence', () => {
      // deriveOrderConfirmationProtocolApplicability's signature has no date parameter at all —
      // this is a structural guarantee, not just a behavioral one (see salesIntegrityEngine.ts's
      // own deriveProtocolPolicyComplianceState for where the date is actually consumed).
      const a1 = deriveOrderConfirmationProtocolApplicability({
        caseType: 'sales_opportunity',
        commercial: commercial({ currentState: 'basket_in_progress' }),
        hasMeaningfulBasketItems: false,
        historicalClosure: historicalClosure({ closureLevel: 'strongly_inferred', purchaseIntentDetected: true, customerAcceptanceDetected: true, staffFulfillmentIntentDetected: true }),
      });
      expect(a1).toBe('applicable');
    });

    it('14. real-data regression: "ده موجود" pattern real closure is not_closed (no acceptance ever detected) -> not_reached, not applicable', () => {
      const { theCase, assessment, itemsByBasketId, baskets, scoped } = assessFirstCase(`[9/12/26, 9:51:32 PM] Customer: ده موجود
[9/12/26, 9:52:36 PM] You: لحظات اشوفه لحضرتك
[9/12/26, 10:36:37 PM] You: حضرتك تحب نبتعه باذن الله`);
      const latest = baskets[baskets.length - 1];
      const closure = deriveHistoricalCommercialClosureAssessment(
        theCase.caseId, scoped, assessment, itemsByBasketId[latest?.basketId] ?? [], latest?.announcedTotal != null
      );
      expect(closure.closureLevel).toBe('not_closed');
      const hasMeaningfulBasketItems = baskets.some((b) => (itemsByBasketId[b.basketId] ?? []).length > 0);
      const applicability = deriveOrderConfirmationProtocolApplicability({
        caseType: theCase.caseType, commercial: assessment, hasMeaningfulBasketItems, historicalClosure: closure,
      });
      expect(applicability).toBe('not_reached');
    });
  });
});
