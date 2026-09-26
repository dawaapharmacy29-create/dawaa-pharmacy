import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildConversationUnderstandingV32 } from '@/lib/whatsappConversationUnderstandingV32';
import { deriveConversationCases } from '@/lib/salesIntelligence/conversationCaseEngine';
import { buildCaseBaskets } from '@/lib/salesIntelligence/caseBasketEngine';
import { deriveCommercialConfirmationState } from '@/lib/salesIntelligence/commercialConfirmationEngine';
import { deriveHistoricalCommercialClosureAssessment } from '@/lib/salesIntelligence/historicalCommercialClosureEngine';

/** Runs raw text through the real B/B.2/C pipeline and derives historical closure for the FIRST case. */
function closureForFirstCase(raw: string) {
  const sessions = splitWhatsAppSessions(parseWhatsAppExport(raw), 120);
  expect(sessions.length).toBeGreaterThan(0);
  const understanding = buildConversationUnderstandingV32(sessions[0]);
  const cases = deriveConversationCases({ understanding, conversationId: 'conv-1' });
  const interaction = understanding.interactions[0];
  const scoped = understanding.messages.filter((m) => interaction.messageIds.includes(m.id));
  const { baskets, itemsByBasketId, summaryEvents, customerConfirmationEvents, staffFinalConfirmationEvents } =
    buildCaseBaskets(cases[0].caseId, scoped);
  const commercial = deriveCommercialConfirmationState(
    cases[0].caseId,
    baskets,
    summaryEvents,
    customerConfirmationEvents,
    staffFinalConfirmationEvents
  );
  const latest = baskets[baskets.length - 1];
  const activeItems = latest ? (itemsByBasketId[latest.basketId] ?? []) : [];
  const closure = deriveHistoricalCommercialClosureAssessment(
    cases[0].caseId,
    scoped,
    commercial,
    activeItems,
    latest?.announcedTotal != null
  );
  return { theCase: cases[0], baskets, activeItems, commercial, closure };
}

describe('Historical Commercial Closure Engine (Sales Intelligence Phase G.1) — Golden Cases', () => {
  it('1. no purchase intent at all (pure thanks/closing) -> unknown', () => {
    const { closure } = closureForFirstCase(`[9/15/26, 9:00:00 AM] Customer: شكرا
[9/15/26, 9:01:00 AM] You: تحت أمرك دائما`);
    expect(closure.closureLevel).toBe('unknown');
    expect(closure.purchaseIntentDetected).toBe(false);
  });

  it('2. real Dawaa pattern D — price/availability inquiry only, staff never gets a reply -> not_closed', () => {
    // Real conversation id 9b58b947-ab63-4277-862c-64a6a4a822b0 (Phase G shadow sample, project jkjqeqkshllustwlzzbf).
    const { closure } = closureForFirstCase(`[9/12/26, 9:51:32 PM] Customer: ده موجود
[9/12/26, 9:52:36 PM] You: لحظات اشوفه لحضرتك
[9/12/26, 10:36:37 PM] You: حضرتك تحب نبتعه باذن الله`);
    expect(closure.purchaseIntentDetected).toBe(true);
    expect(closure.customerAcceptanceDetected).toBe(false);
    expect(closure.staffFulfillmentIntentDetected).toBe(false);
    expect(closure.closureLevel).toBe('not_closed');
  });

  it('3. real Dawaa pattern A — بكام/ب170ج + bare "ابعته" + "عنيا حاضر" + "تم الارسال" -> strongly_inferred', () => {
    // Real conversation id 167b0383-2b71-4a5d-abf8-bd5157d4c29d (verbatim quoted lines).
    const { closure } = closureForFirstCase(`[9/12/26, 9:07:51 AM] Customer: سعره كام
[9/12/26, 9:08:07 AM] You: ب170ج
[9/12/26, 9:08:25 AM] Customer: ابعته
[9/12/26, 9:08:46 AM] You: عنيا حاضر
[9/12/26, 9:16:17 AM] You: تم الارسال`);
    expect(closure.customerAcceptanceDetected).toBe(true);
    expect(closure.staffFulfillmentIntentDetected).toBe(true);
    expect(closure.closureLevel).toBe('strongly_inferred');
    expect(closure.primaryMessageIds.length).toBeGreaterThan(0);
  });

  it('4. real Dawaa pattern — forwarded product + "اه ابعته" + "من عنيا" commitment -> strongly_inferred', () => {
    // Real conversation id 9a59338b-f1ca-4b68-bd3b-c081fee914a8 (verbatim quoted lines).
    const { closure } = closureForFirstCase(`[9/15/26, 9:31:16 PM] Customer: موجود عندكم الغسول ده
[9/15/26, 9:32:09 PM] You: موجود باذن الله يافندم
[9/15/26, 9:35:06 PM] You: تحب نبعته لحضرتك باذن الله ؟
[9/15/26, 9:42:30 PM] Customer: اه ابعته
[9/15/26, 9:42:57 PM] You: من عنيا لحضرتك مسافه الطريق ويكون عند حضرتك`);
    expect(closure.customerAcceptanceDetected).toBe(true);
    expect(closure.staffFulfillmentIntentDetected).toBe(true);
    expect(closure.closureLevel).toBe('strongly_inferred');
  });

  it('5. staff fulfillment intent alone, with NO prior customer acceptance signal -> weakly_inferred, not strongly_inferred', () => {
    const { closure } = closureForFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د
[9/15/26, 9:01:00 AM] You: تم الارسال`);
    expect(closure.staffFulfillmentIntentDetected).toBe(true);
    expect(closure.customerAcceptanceDetected).toBe(false);
    expect(closure.closureLevel).toBe('weakly_inferred');
  });

  it('6. customer acceptance alone, with no staff fulfillment-intent reply yet -> weakly_inferred', () => {
    const { closure } = closureForFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د
[9/15/26, 9:01:00 AM] You: ب100ج
[9/15/26, 9:02:00 AM] Customer: ابعته`);
    expect(closure.customerAcceptanceDetected).toBe(true);
    expect(closure.staffFulfillmentIntentDetected).toBe(false);
    expect(closure.closureLevel).toBe('weakly_inferred');
  });

  it('7. the FORMAL Phase C path (commercial_confirmation_complete) is mirrored as explicit, never re-derived independently', () => {
    const { closure, commercial } = closureForFirstCase(`[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: ايوه تمام
[9/15/26, 9:03:00 AM] You: تمام يا فندم، تم تأكيد الطلب وجاري الإرسال`);
    expect(commercial.currentState).toBe('commercial_confirmation_complete');
    expect(closure.closureLevel).toBe('explicit');
  });

  it('8. organic closure does NOT equal invoice proof — closureLevel is independent of any invoice/attribution field entirely', () => {
    const { closure } = closureForFirstCase(`[9/12/26, 9:07:51 AM] Customer: سعره كام
[9/12/26, 9:08:07 AM] You: ب170ج
[9/12/26, 9:08:25 AM] Customer: ابعته
[9/12/26, 9:08:46 AM] You: عنيا حاضر
[9/12/26, 9:16:17 AM] You: تم الارسال`);
    // The type itself carries no invoiceId/invoiceNumber/sale-outcome field at all — structurally
    // impossible to mistake for invoice or sale proof (see HistoricalCommercialClosureAssessment's
    // own doc comment in types.ts) — this assessment is derived purely from message-level evidence.
    expect(Object.keys(closure).sort()).toEqual(
      [
        'caseId', 'purchaseIntentDetected', 'customerAcceptanceDetected', 'staffFulfillmentIntentDetected',
        'basketReconstructable', 'announcedValueAvailable', 'closureLevel', 'primaryMessageIds',
        'confidence', 'needsHumanReview', 'ruleIds',
      ].sort()
    );
    expect(closure.closureLevel).toBe('strongly_inferred');
  });

  it('10. "تمام ابعته" with multiple distinct unresolved products in play stays ambiguous — capped at weakly_inferred, needsHumanReview true, never guessed', () => {
    const { closure, activeItems } = closureForFirstCase(`[9/14/26, 1:00:00 AM] Customer: عايز 3 علب انتينال
[9/14/26, 1:01:00 AM] You: تمام
[9/14/26, 1:02:00 AM] Customer: وعايز 2 علبة ستريبتوكين كمان
[9/14/26, 1:03:00 AM] Customer: تمام ابعته
[9/14/26, 1:04:00 AM] You: تم الارسال`);
    expect(activeItems.length).toBeGreaterThan(1);
    expect(closure.customerAcceptanceDetected).toBe(true);
    expect(closure.staffFulfillmentIntentDetected).toBe(true);
    expect(closure.closureLevel).toBe('weakly_inferred');
    expect(closure.needsHumanReview).toBe(true);
  });

  it('9. never fabricates basket reconstruction — a price-only exchange with no product/quantity signal stays basketReconstructable=false even at strongly_inferred closure', () => {
    const { closure } = closureForFirstCase(`[9/12/26, 9:07:51 AM] Customer: سعره كام
[9/12/26, 9:08:07 AM] You: ب170ج
[9/12/26, 9:08:25 AM] Customer: ابعته
[9/12/26, 9:08:46 AM] You: عنيا حاضر
[9/12/26, 9:16:17 AM] You: تم الارسال`);
    expect(closure.closureLevel).toBe('strongly_inferred');
    expect(closure.basketReconstructable).toBe(false);
    expect(closure.announcedValueAvailable).toBe(false);
  });
});
