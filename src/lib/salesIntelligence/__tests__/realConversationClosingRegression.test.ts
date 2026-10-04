import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildConversationUnderstandingV32 } from '@/lib/whatsappConversationUnderstandingV32';
import { deriveConversationCases } from '@/lib/salesIntelligence/conversationCaseEngine';
import { buildCaseBaskets } from '@/lib/salesIntelligence/caseBasketEngine';
import { deriveCommercialConfirmationState } from '@/lib/salesIntelligence/commercialConfirmationEngine';

function assessFirstCase(raw: string) {
  const sessions = splitWhatsAppSessions(parseWhatsAppExport(raw), 120);
  expect(sessions.length).toBeGreaterThan(0);
  const understanding = buildConversationUnderstandingV32(sessions[0]);
  const cases = deriveConversationCases({ understanding, conversationId: 'real-regression' });
  expect(cases.length).toBeGreaterThan(0);
  const interaction = understanding.interactions[0];
  const scoped = understanding.messages.filter((message) => interaction.messageIds.includes(message.id));
  const result = buildCaseBaskets(cases[0].caseId, scoped);
  const assessment = deriveCommercialConfirmationState(
    cases[0].caseId,
    result.baskets,
    result.summaryEvents,
    result.customerConfirmationEvents,
    result.staffFinalConfirmationEvents
  );
  return { ...result, assessment };
}

describe('real conversation closing regressions', () => {
  it('recognizes Mohamed El Gendy natural recap, customer confirmation, compact total, and fulfillment close', () => {
    const result = assessFirstCase(`[9/26/26, 9:46:41 PM] Customer: عايزه من دا 4
[9/26/26, 9:50:02 PM] You: يعني كدا 4 علب لبن مع 2 نوع شراب اللي الدكتور بيقولهم في الريكورد
[9/26/26, 9:50:08 PM] You: مظبوط كدا ان شاء الله؟
[9/26/26, 9:50:12 PM] Customer: ايوا
[9/26/26, 9:50:25 PM] Customer: كدا هيبقا كام
[9/26/26, 9:50:44 PM] You: حالا هبلغ حضرتك
[9/26/26, 9:56:48 PM] You: 1579ج ان شاء الله
[9/26/26, 9:58:03 PM] Customer: تمام
[9/26/26, 10:01:12 PM] You: جاري الارسال`);

    expect(result.summaryEvents).toHaveLength(1);
    expect(result.baskets.at(-1)?.announcedTotal?.amount).toBe(1579);
    expect(result.customerConfirmationEvents).toHaveLength(1);
    expect(result.staffFinalConfirmationEvents).toHaveLength(1);
    expect(result.assessment.currentState).toBe('commercial_confirmation_complete');
  });

  it('does not manufacture a product identity from an unresolved media deictic such as العلبه دي', () => {
    const result = assessFirstCase(`[9/27/26, 8:28:35 PM] Customer: لو سمحت يادكتور عايزه العلبه دي
[9/27/26, 8:28:37 PM] Customer: <image omitted>
[9/27/26, 8:30:00 PM] You: تحت امر حضرتك`);

    const activeBasket = result.baskets.at(-1);
    const items = activeBasket ? result.itemsByBasketId[activeBasket.basketId] ?? [] : [];
    expect(items.some((item) => ['دي', 'ده', 'دا'].includes(item.productNameRaw.trim()))).toBe(false);
  });
});
