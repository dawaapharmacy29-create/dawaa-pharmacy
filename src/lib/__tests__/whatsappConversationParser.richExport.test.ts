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

describe('rich WhatsApp markdown export', () => {
  it('interprets dated TXT and markdown clocks in Cairo in both winter and summer', () => {
    for (const sample of [
      { date: '1/15/26', heading: 'January 15, 2026', expected: '2026-01-15T07:00:00.000Z' },
      { date: '9/15/26', heading: 'September 15, 2026', expected: '2026-09-15T06:00:00.000Z' },
    ]) {
      const txt = parseWhatsAppExport(`[${sample.date}, 9:00:00 AM] Customer: صباح الخير`);
      const md = parseWhatsAppExport(`## ${sample.heading}\n\n[9:00 AM] **Customer:** صباح الخير`);
      expect(txt[0].timestamp.toISOString()).toBe(sample.expected);
      expect(md[0].timestamp.toISOString()).toBe(sample.expected);
      expect(txt[0].id).toBe(md[0].id);
    }
  });

  it('keeps the Cairo date across UTC midnight and preserves explicit trusted timeline anchors', () => {
    const raw = '[9/15/26, 12:30:00 AM] Customer: مساء الخير\n[9/15/26, 12:35:00 AM] You: أهلا';
    const parsed = parseWhatsAppExport(raw);
    expect(parsed[0].timestamp.toISOString()).toBe('2026-09-14T21:30:00.000Z');
    const anchored = parseWhatsAppExport(raw, {
      trustedConversationStartedAt: '2026-09-15T00:30:00.000Z',
    });
    expect(anchored[0].timestamp.toISOString()).toBe('2026-09-15T00:30:00.000Z');
    expect(anchored[1].timestamp.toISOString()).toBe('2026-09-15T00:35:00.000Z');
  });

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
