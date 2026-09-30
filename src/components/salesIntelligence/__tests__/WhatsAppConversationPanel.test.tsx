import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport } from '@/lib/whatsappConversationParser';
import { WhatsAppConversationPanel, visibleWhatsAppMessageText } from '@/components/salesIntelligence/WhatsAppConversationPanel';

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
