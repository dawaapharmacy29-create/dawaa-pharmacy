import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildConversationUnderstandingV32 } from '@/lib/whatsappConversationUnderstandingV32';

function oneSession(raw: string) {
  const sessions = splitWhatsAppSessions(parseWhatsAppExport(raw), 120);
  expect(sessions.length).toBeGreaterThan(0);
  return sessions[0];
}

describe('ConversationUnderstandingV32 (Shadow Mode, read-only, facts-only)', () => {
  it('normalizes messages and marks system/automated/emoji-only messages as non-meaningful', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: صباح الخير، عايز فيتامين د
[9/15/26, 9:00:30 AM] You: رسالة تلقائية: نحن خارج مواعيد العمل الرسمية نرد عليك أول الدوام
[9/15/26, 9:01:00 AM] Customer: 👍👍
[9/15/26, 9:02:00 AM] You: صباح النور، مع حضرتك د هبة من صيدليات دواء، تحت أمر حضرتك`;
    const session = oneSession(raw);
    const understanding = buildConversationUnderstandingV32(session);

    const automated = understanding.messages.find((m) => m.text.includes('رسالة تلقائية'));
    expect(automated?.isAutomated).toBe(true);
    expect(automated?.isMeaningful).toBe(false);

    const emojiOnly = understanding.messages.find((m) => m.text.trim() === '👍👍');
    expect(emojiOnly?.isEmojiOnly).toBe(true);
    expect(emojiOnly?.isMeaningful).toBe(false);

    const realReply = understanding.messages.find((m) => m.text.includes('مع حضرتك د هبة'));
    expect(realReply?.isMeaningful).toBe(true);
    expect(realReply?.role).toBe('staff');

    const trigger = understanding.messages.find((m) => m.text.includes('عايز فيتامين د'));
    expect(trigger?.role).toBe('customer');
    expect(trigger?.isMeaningful).toBe(true);
  });

  it('segments a conversation with a large time gap into two separate interactions', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د
[9/15/26, 9:01:00 AM] You: متوفر بسعر 250 جنيه
[9/15/26, 9:02:00 AM] Customer: تمام هطلبه
[9/15/26, 9:50:00 AM] Customer: بالمناسبة عندكم شامبو للشعر؟
[9/15/26, 9:51:00 AM] You: أيوه متوفر`;
    const session = oneSession(raw);
    const understanding = buildConversationUnderstandingV32(session);

    expect(understanding.interactions.length).toBe(2);
    const [first, second] = understanding.interactions;
    expect(first.messageIds.length).toBe(3);
    expect(second.messageIds.length).toBe(2);
    expect(second.segmentationReason).toBe('time_gap');

    const shampooTrigger = understanding.byId.get(second.triggerMessageId || '');
    expect(shampooTrigger?.text).toContain('شامبو');
  });

  it('keeps a single interaction when messages are close in time with no topic gap', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د
[9/15/26, 9:01:00 AM] You: متوفر بسعر 250 جنيه
[9/15/26, 9:02:00 AM] Customer: تمام ابعته`;
    const session = oneSession(raw);
    const understanding = buildConversationUnderstandingV32(session);
    expect(understanding.interactions.length).toBe(1);
    expect(understanding.interactions[0].messageIds.length).toBe(3);
  });

  it('V32.2: segments a new interaction on an explicit topic-shift marker even without a time gap', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د
[9/15/26, 9:01:00 AM] You: متوفر بسعر 250 جنيه
[9/15/26, 9:02:00 AM] Customer: تمام هطلبه
[9/15/26, 9:03:00 AM] Customer: بالمناسبة عندكم شامبو للشعر؟
[9/15/26, 9:04:00 AM] You: أيوه متوفر`;
    const session = oneSession(raw);
    const understanding = buildConversationUnderstandingV32(session);
    expect(understanding.interactions.length).toBe(2);
    expect(understanding.interactions[1].segmentationReason).toBe('topic_shift_marker');
    const shampooTrigger = understanding.byId.get(understanding.interactions[1].triggerMessageId || '');
    expect(shampooTrigger?.text).toContain('شامبو');
  });
});


describe('V32 fulfillment continuity across silence', () => {
  it('keeps an explicit same-order delivery follow-up in one interaction across a 45-minute gap', () => {
    const raw = `[9/15/26, 9:30:55 PM] محمد الكموني17777: [Forwarded] Isis teenderm gel for sensitive skin بديل الغسول
[9/15/26, 9:35:06 PM] You: تحب نبعته لحضرتك باذن الله ؟
[9/15/26, 9:42:30 PM] محمد الكموني17777: اه ابعته
[9/15/26, 9:42:57 PM] You: من عنيا لحضرتك مسافه الطريق ويكون عند حضرتك
[9/15/26, 10:28:27 PM] محمد الكموني17777: حضرتك بعت الاوردر
[9/15/26, 10:28:58 PM] You: اه يا فندم المندوب في الطريق لحضرتك`;
    const understanding = buildConversationUnderstandingV32(oneSession(raw));
    expect(understanding.interactions).toHaveLength(1);
  });

  it('still splits a genuinely different topic after a 45-minute gap', () => {
    const raw = `[9/15/26, 9:00:00 PM] Customer: عايز فيتامين د
[9/15/26, 9:02:00 PM] Customer: اه ابعته
[9/15/26, 9:03:00 PM] You: من عنيا لحضرتك مسافة الطريق
[9/15/26, 9:48:00 PM] Customer: بالمناسبة عندكم شامبو للشعر؟`;
    const understanding = buildConversationUnderstandingV32(oneSession(raw));
    expect(understanding.interactions).toHaveLength(2);
  });
});


describe('conversation case classification certainty', () => {
  it('reaches 100% only for an explicit commercial journey, without proving the sale itself', () => {
    const raw = `[9/15/26, 9:30:55 PM] Customer: Isis teenderm gel for sensitive skin
[9/15/26, 9:35:06 PM] You: تحب نبعته لحضرتك؟
[9/15/26, 9:42:30 PM] Customer: اه ابعته
[9/15/26, 9:42:57 PM] You: من عنيا لحضرتك مسافة الطريق`;
    const understanding = buildConversationUnderstandingV32(oneSession(raw));
    const cases = deriveConversationCases({
      understanding,
      conversationId: 'conv-explicit',
      customerIdHint: 'customer-1',
      customerPhoneHint: '01000000000',
      branchNameRawHint: 'فرع شكري',
    });
    expect(cases).toHaveLength(1);
    expect(cases[0].caseType).toBe('sales_opportunity');
    expect(cases[0].confidence.level).toBe('proven');
    expect(cases[0].confidence.score).toBe(1);
    expect(cases[0].confidence.ruleIds).toContain('case.classification.explicit_commercial_journey');
  });
});
