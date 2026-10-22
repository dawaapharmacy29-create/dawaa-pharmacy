import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport } from '@/lib/whatsappConversationParser';
import { caseMessageScope, WhatsAppConversationPanel, visibleWhatsAppMessageText } from '@/components/salesIntelligence/WhatsAppConversationPanel';

function renderRaw(raw: string) {
  const messages = parseWhatsAppExport(raw);
  return renderToStaticMarkup(createElement(WhatsAppConversationPanel, {
    messages,
    customerName: 'عميل اختبار',
    customerCode: '2490',
    customerPhone: '01000000000',
    branch: 'فرع شكري',
    caseStartedAt: null,
    caseEndedAt: null,
  }));
}

describe('WhatsAppConversationPanel', () => {
  it('renders unavailable image/voice as WhatsApp media cards without leaking export placeholder text', () => {
    const html = renderRaw(`[9/28/26, 6:51:59 AM] Customer: <image omitted>
[9/28/26, 6:52:10 AM] You: <voice message omitted>`);

    expect(html).toContain('صورة');
    expect(html).toContain('رسالة صوتية');
    expect(html).toContain('الملف غير متاح في التصدير');
    expect(html.toLowerCase()).not.toContain('image omitted');
    expect(html.toLowerCase()).not.toContain('voice message omitted');
  });

  it('keeps a real caption while stripping only the technical media placeholder line', () => {
    const [message] = parseWhatsAppExport(`[9/28/26, 6:51:59 AM] Customer: <image omitted>
دي الروشتة يا دكتور`);
    expect(visibleWhatsAppMessageText(message)).toBe('دي الروشتة يا دكتور');

    const html = renderRaw(`[9/28/26, 6:51:59 AM] Customer: <image omitted>
دي الروشتة يا دكتور`);
    expect(html).toContain('دي الروشتة يا دكتور');
    expect(html.toLowerCase()).not.toContain('image omitted');
  });
});

describe('export markers in Arabic', () => {
  it('shows media, forwarded and deleted markers in Arabic without changing captions', async () => {
    const { arabicExportMarkers } = await import('@/components/salesIntelligence/WhatsAppConversationPanel');
    expect(arabicExportMarkers('[Forwarded] <image omitted>')).toBe(['↪ رسالة محوَّلة', '📷 صورة غير مرفقة بملف التصدير'].join('\n'));
    expect(arabicExportMarkers('<voice message omitted>')).toBe('🎤 رسالة صوتية غير مرفقة بملف التصدير');
    expect(arabicExportMarkers('You deleted this message')).toBe('تم حذف هذه الرسالة');
    expect(arabicExportMarkers('عايز GASTROBIOTIC 550')).toBe('عايز GASTROBIOTIC 550');
  });
});

describe('case-only view', () => {
  it('offers a case-only switch and highlights the case by its exact message ids', async () => {
    const { createElement: h } = await import('react');
    const { renderToStaticMarkup: render } = await import('react-dom/server');
    const messages = parseWhatsAppExport([
      '[9/27/26, 10:54:07 AM] You: مع حضرتك هبه من خدمة عملاء صيدليات دواء',
      '[9/28/26, 1:01:04 AM] Customer: خليهم علبتين كولونا',
    ].join('\n'));
    const html = render(h(WhatsAppConversationPanel, {
      messages, customerName: 'عميل', customerCode: null, customerPhone: null, branch: null,
      caseStartedAt: null, caseEndedAt: null, caseMessageIds: [messages[1].id],
    }));
    expect(html).toContain('عرض الحالة فقط');
    expect(html).toContain('المحادثة الأصلية كاملة (2 رسالة)');
  });

  it('case-only selects exactly the stored case message ids, and falls back visibly when they no longer match', async () => {
    const { createElement: h } = await import('react');
    const { renderToStaticMarkup: render } = await import('react-dom/server');
    const messages = parseWhatsAppExport([
      '[9/27/26, 10:54:07 AM] You: مع حضرتك هبه من خدمة عملاء صيدليات دواء',
      '[9/28/26, 1:01:04 AM] Customer: خليهم علبتين كولونا',
      '[9/28/26, 2:17:35 AM] Customer: ممكن تبعت حد مالتمريض',
    ].join('\n'));
    const exact = caseMessageScope(messages, { caseMessageIds: [messages[1].id], caseStartedAt: null, caseEndedAt: null });
    expect(messages.filter(exact.isInCase).map((m) => m.id)).toEqual([messages[1].id]);
    expect(exact.idsFallback).toBe(false);

    const scope = { caseMessageIds: ['stale-id'], caseStartedAt: messages[2].timestamp.toISOString(), caseEndedAt: messages[2].timestamp.toISOString() };
    const stale = caseMessageScope(messages, scope);
    expect(stale.idsFallback).toBe(true);
    expect(messages.filter(stale.isInCase).map((m) => m.id)).toEqual([messages[2].id]);
    const html = render(h(WhatsAppConversationPanel, { messages, customerName: 'عميل', customerCode: null, customerPhone: null, branch: null, ...scope }));
    expect(html).toContain('تعذر مطابقة رسائل الحالة المحفوظة');
  });
});
