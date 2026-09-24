import { describe, expect, it } from 'vitest';
import {
  detectWhatsAppExportFormat,
  parseWhatsAppExport,
  splitWhatsAppSessions,
} from '@/lib/whatsappConversationParser';

const sample = `# WhatsApp Chat Export: عميل تجريبي 1234
Export date: September 14, 2026 at 7:00 PM

---

## September 14, 2026

[1:12 AM] **عميل تجريبي 1234:** [Voice message]

[1:15 AM] **You:** أهلًا وسهلًا بحضرتك
مع حضرتك د أحمد
خدمة التوصيل متاحة على مدار ٢٤ ساعة

[1:17 AM] **You:** هل يوجد عرض آخر؟

[1:17 AM] **عميل تجريبي 1234:**
> _You: هل يوجد عرض آخر؟_
لا

[1:20 AM] **عميل تجريبي 1234:** [Forwarded] [Image] صورة المنتج المطلوب

[1:21 AM] **You:** تركيز إيه يا فندم؟

[1:22 AM] **عميل تجريبي 1234:**
> _You: تركيز إيه يا فندم؟_
25

[5:30 PM] **عميل تجريبي 1234:** مساء الخير

[5:31 PM] **You:** أهلًا بحضرتك
مع حضرتك د ندى
`;

describe('time-only WhatsApp markdown export', () => {
  const timeOnly = `[4:27 PM] **عبد الرحمن ابو عرب 17765:** لو سمحت بامبرز بي بم مقاس ٤ موجود؟\n\n[4:30 PM] **You:** موجود ان شاء الله`;

  it('detects time-only markdown but refuses to invent a calendar date without a trusted anchor', () => {
    expect(detectWhatsAppExportFormat(timeOnly)).toBe('md');
    expect(parseWhatsAppExport(timeOnly)).toHaveLength(0);
  });

  it('parses time-only markdown when persisted conversation_started_at supplies the trusted date', () => {
    const messages = parseWhatsAppExport(timeOnly, { trustedConversationStartedAt: '2026-09-15T13:27:00.000Z' });
    expect(messages).toHaveLength(2);
    // The first time-only message is anchored to persisted conversation_started_at exactly, not
    // interpreted in the Node/Vercel machine timezone. The second follows the raw local clock delta.
    expect(messages[0].timestamp.toISOString()).toBe('2026-09-15T13:27:00.000Z');
    expect(messages[1].timestamp.toISOString()).toBe('2026-09-15T13:30:00.000Z');
    expect(messages[0].sender).toContain('عبد الرحمن');
    expect(messages[1].direction).toBe('outbound');
  });
});

describe('I.B.4 — real Shami time-only markdown regressions', () => {
  it('recovers the previously-unparseable خالد فوده source using only its trusted persisted date', () => {
    const raw = `[6:04 PM] **خالد فوده 9281:** الحمدلله احسن كتير\n\n[6:05 PM] **You:** يارب ديما بخير وصحه وسعاده يا فندم يارب`;
    const withoutAnchor = parseWhatsAppExport(raw);
    const withAnchor = parseWhatsAppExport(raw, { trustedConversationStartedAt: '2026-09-15T15:04:00.000Z' });

    expect(withoutAnchor).toHaveLength(0);
    expect(withAnchor).toHaveLength(2);
    expect(withAnchor[0].timestamp.toISOString()).toBe('2026-09-15T15:04:00.000Z');
    expect(withAnchor[1].timestamp.toISOString()).toBe('2026-09-15T15:05:00.000Z');
    expect(withAnchor[0].sender).toBe('خالد فوده 9281');
    expect(withAnchor[1].sender).toBe('You');
    expect(withAnchor[1].direction).toBe('outbound');
  });

  it('parses reply quotes and multiple messages from the عبد الرحمن ابو عرب time-only source without inventing a date', () => {
    const raw = `[4:27 PM] **عبد الرحمن ابو عرب 17765:** لو سمحت بامبرز بي بم مقاس ٤ موجود؟\n\n[4:34 PM] **You:**\n> _عبد الرحمن ابو عرب 17765: لو سمحت بامبرز بي بم مقاس ٤ موجود؟_\nموجود ان شاء الله\n\n[4:35 PM] **عبد الرحمن ابو عرب 17765:** كام قطعه؟\n\n[4:36 PM] **You:** 58 ا شاء الله`;
    const messages = parseWhatsAppExport(raw, { trustedConversationStartedAt: '2026-09-15T13:27:00.000Z' });

    expect(messages).toHaveLength(4);
    expect(messages[1].replyTo?.sender).toBe('عبد الرحمن ابو عرب 17765');
    expect(messages[1].replyTo?.text).toContain('بامبرز');
    expect(messages[1].text).toBe('موجود ان شاء الله');
    expect(messages[3].direction).toBe('outbound');
  });
});

describe('I.B.4 — trusted time-only timeline across midnight', () => {
  it('preserves chronology when the raw local clock rolls from PM to AM', () => {
    const raw = `[11:59 PM] **Customer:** قبل نص الليل\n\n[12:01 AM] **You:** بعد نص الليل`;
    const messages = parseWhatsAppExport(raw, { trustedConversationStartedAt: '2026-09-15T20:59:00.000Z' });
    expect(messages).toHaveLength(2);
    expect(messages[0].timestamp.toISOString()).toBe('2026-09-15T20:59:00.000Z');
    expect(messages[1].timestamp.toISOString()).toBe('2026-09-15T21:01:00.000Z');
    expect(messages[1].timestamp.getTime()).toBeGreaterThan(messages[0].timestamp.getTime());
  });
});

describe('rich WhatsApp markdown export', () => {
  it('detects markdown and keeps reply/media semantics without duplicating quote text into message body', () => {
    expect(detectWhatsAppExportFormat(sample)).toBe('md');
    const messages = parseWhatsAppExport(sample);
    expect(messages).toHaveLength(9);

    const reply = messages.find((message) => message.text === '25');
    expect(reply?.replyTo?.sender).toBe('You');
    expect(reply?.replyTo?.text).toContain('تركيز');
    expect(reply?.text).not.toContain('You:');

    const image = messages.find((message) => message.kind === 'image');
    expect(image?.forwarded).toBe(true);
    expect(image?.mediaPlaceholder).toBe(true);
    expect(image?.mediaAvailable).toBe(false);

    const voice = messages.find((message) => message.kind === 'voice');
    expect(voice?.mediaPlaceholder).toBe(true);
  });

  it('extracts introduced staff and splits independent conversations after long inactivity', () => {
    const sessions = splitWhatsAppSessions(parseWhatsAppExport(sample), 120);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].outboundStaffNames).toContain('أحمد');
    expect(sessions[1].outboundStaffNames).toContain('ندى');
    expect(sessions[0].replyCount).toBe(2);
    expect(sessions[0].forwardedCount).toBe(1);
    expect(sessions[0].missingMediaCount).toBe(2);
  });
});


describe('trusted TXT absolute timeline', () => {
  it('anchors explicit-date TXT to persisted conversation_started_at and preserves raw clock deltas', () => {
    const raw = `[9/15/26, 9:30:55 PM] محمد الكموني17777: Isis teenderm gel for sensitive skin
[9/15/26, 9:42:57 PM] You: من عنيا لحضرتك
[9/15/26, 10:28:27 PM] محمد الكموني17777: حضرتك بعت الاوردر`;
    const messages = parseWhatsAppExport(raw, { trustedConversationStartedAt: '2026-09-15T18:30:55.000Z' });
    expect(messages[0].timestamp.toISOString()).toBe('2026-09-15T18:30:55.000Z');
    expect(messages[1].timestamp.toISOString()).toBe('2026-09-15T18:42:57.000Z');
    expect(messages[2].timestamp.toISOString()).toBe('2026-09-15T19:28:27.000Z');
  });
});
