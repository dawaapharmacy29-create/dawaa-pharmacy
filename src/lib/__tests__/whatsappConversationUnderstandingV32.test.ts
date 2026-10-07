import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildConversationUnderstandingV32 } from '@/lib/whatsappConversationUnderstandingV32';

function oneSession(raw: string, gapMinutes = 120) {
  const sessions = splitWhatsAppSessions(parseWhatsAppExport(raw), gapMinutes);
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

  it('V8: keeps post-invoice courtesy replies inside the same commercial interaction', () => {
    const raw = `[9/27/26, 8:20:00 PM] Customer: تمام ابعته
[9/27/26, 8:31:00 PM] You: جاري الإرسال
[9/27/26, 8:34:00 PM] You: تفاصيل الفاتورة 74880
[9/27/26, 8:35:00 PM] Customer: ولا يهمك يا حبيبتي
[9/27/26, 8:36:00 PM] Customer: شكرا على ذوق حضرتك`;
    const session = oneSession(raw);
    const understanding = buildConversationUnderstandingV32(session);

    expect(understanding.interactions).toHaveLength(1);
    expect(understanding.interactions[0].messageIds).toHaveLength(5);
  });

  it('V8: keeps a delayed same-order fulfillment follow-up despite a gap over 30 minutes', () => {
    const raw = `[9/27/26, 8:00:00 PM] Customer: تمام ابعته
[9/27/26, 8:02:00 PM] You: جاري الإرسال
[9/27/26, 8:50:00 PM] Customer: المندوب فين؟
[9/27/26, 8:51:00 PM] You: في الطريق لحضرتك`;
    const session = oneSession(raw);
    const understanding = buildConversationUnderstandingV32(session);

    expect(understanding.interactions).toHaveLength(1);
  });

  it('V8: keeps a delayed payment settlement handoff inside the fulfilled order interaction', () => {
    const raw = `[9/27/26, 9:03:34 PM] Customer: لوسمحت كنت محتاجه علبتين لبن هيرو بيبي نيوتروني دفنس 3
[9/27/26, 9:06:00 PM] You: جاري الارسال
[9/28/26, 2:52:09 AM] You: اتفضل رقم التحويل يا فندم 01028308235 واستاذن حضرتك في صورة التحويل
[9/28/26, 3:08:09 AM] Customer: الحساب كام من فضلك
[9/28/26, 3:08:36 AM] You: 778 ان شاء الله
[9/28/26, 3:09:45 AM] Customer: [Forwarded] <image omitted>
[9/28/26, 3:10:40 AM] You: وصل شكرا جزيلا`;
    const session = oneSession(raw, Number.MAX_SAFE_INTEGER);
    const understanding = buildConversationUnderstandingV32(session);

    expect(understanding.interactions).toHaveLength(1);
    expect(understanding.interactions[0].messageIds).toHaveLength(7);
  });

  it('V8: does not use prior order commitment to absorb unrelated staff outreach after a long gap', () => {
    const raw = `[9/27/26, 8:00:00 PM] Customer: عايز فيتامين د
[9/27/26, 8:02:00 PM] You: جاري الإرسال
[9/28/26, 2:52:00 AM] You: مساء الخير يا فندم، نتشرف بخدمة حضرتك`;
    const session = oneSession(raw, Number.MAX_SAFE_INTEGER);
    const understanding = buildConversationUnderstandingV32(session);

    expect(understanding.interactions).toHaveLength(2);
    expect(understanding.interactions[1].segmentationReason).toBe('time_gap');
  });

  it('V8: opens a new case only for an explicit non-additive commercial request after fulfillment', () => {
    const raw = `[9/27/26, 8:00:00 PM] Customer: تمام ابعته
[9/27/26, 8:02:00 PM] You: جاري الإرسال
[9/27/26, 8:05:00 PM] Customer: عايز شامبو للشعر
[9/27/26, 8:06:00 PM] You: حاضر تحت أمر حضرتك`;
    const session = oneSession(raw);
    const understanding = buildConversationUnderstandingV32(session);

    expect(understanding.interactions).toHaveLength(2);
    expect(understanding.interactions[1].segmentationReason).toBe('new_commercial_need');
    const trigger = understanding.byId.get(understanding.interactions[1].triggerMessageId || '');
    expect(trigger?.text).toContain('شامبو');
  });
});
