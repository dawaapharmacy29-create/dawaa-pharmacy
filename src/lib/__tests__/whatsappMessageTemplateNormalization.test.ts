import { describe, expect, it } from 'vitest';
import { buildMessageTemplateKey, aggregateBestMessages } from '@/lib/whatsappMessageTemplateNormalization';

describe('buildMessageTemplateKey', () => {
  it('groups the same template sent to different customers under one templateKey', () => {
    const a = buildMessageTemplateKey('أهلًا يا أحمد، حبينا نطمن عليك 😊', 'أحمد');
    const b = buildMessageTemplateKey('أهلًا يا نور،   حبينا نطمن عليك  😊😊😊', 'نور');
    expect(a.templateKey).toBe(b.templateKey);
  });

  it('keeps the readable display text with a placeholder instead of the raw customer name', () => {
    const { displayText } = buildMessageTemplateKey('أهلًا يا أحمد، إزيك؟', 'أحمد');
    expect(displayText).toContain('{{name}}');
    expect(displayText).not.toContain('أحمد');
  });

  it('does NOT corrupt an unrelated word that merely contains the customer name as a substring', () => {
    // "نور" (short, common name) is a substring of "منور" (unrelated word) — must not be replaced.
    const { displayText } = buildMessageTemplateKey('الدوا ده بيخلي بشرتك منور وصحتك أحسن', 'نور');
    expect(displayText).toContain('منور');
    expect(displayText).not.toContain('{{name}}');
  });

  it('still replaces the name when it appears as a real standalone word, even short', () => {
    const { displayText } = buildMessageTemplateKey('صباح الخير يا نور، عامله ايه؟', 'نور');
    expect(displayText).toContain('{{name}}');
    expect(displayText).not.toMatch(/(?<![\p{L}\p{N}])نور(?![\p{L}\p{N}])/u);
  });

  it('two different messages that only differ by an unrelated word inside a similar name-bearing sentence do not collapse into one template', () => {
    const a = buildMessageTemplateKey('تمام يا نور هظبطلك الطلب', 'نور');
    const b = buildMessageTemplateKey('تمام يا نور هظبطلك التوصيل', 'نور'); // "الطلب" vs "التوصيل" — different meaning
    expect(a.templateKey).not.toBe(b.templateKey);
  });
});

describe('aggregateBestMessages', () => {
  function candidate(text: string, gotReply: boolean, templateKey?: string) {
    return {
      messageId: Math.random().toString(),
      text,
      templateKey: templateKey ?? buildMessageTemplateKey(text).templateKey,
      staffName: 'أحمد',
      burstId: 'b1',
      gotReply,
    };
  }

  it('groups by templateKey, not raw text, and computes a reply rate', () => {
    const key = buildMessageTemplateKey('تمام هظبطلك الطلب').templateKey;
    const candidates = [
      candidate('تمام هظبطلك الطلب', true, key),
      candidate('تمام  هظبطلك   الطلب', false, key),
      candidate('تمام هظبطلك الطلب!!', true, key),
    ];
    const best = aggregateBestMessages(candidates as any);
    expect(best).toHaveLength(1);
    expect(best[0].sentCount).toBe(3);
    expect(best[0].repliedCount).toBe(2);
    expect(best[0].replyRate).toBeCloseTo(66.7, 1);
  });

  it('marks a template sent only twice as preliminary, not a confident "best message"', () => {
    const key = buildMessageTemplateKey('رسالة نادرة').templateKey;
    const candidates = [candidate('رسالة نادرة', true, key), candidate('رسالة نادرة', true, key)];
    const best = aggregateBestMessages(candidates as any);
    expect(best[0].sampleSizeLabel).toBe('preliminary');
  });

  it('marks a template sent 5+ times as a reliable sample', () => {
    const key = buildMessageTemplateKey('رسالة متكررة كتير').templateKey;
    const candidates = Array.from({ length: 5 }, () => candidate('رسالة متكررة كتير', true, key));
    const best = aggregateBestMessages(candidates as any);
    expect(best[0].sampleSizeLabel).toBe('ok');
  });
});
