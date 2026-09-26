import { describe, expect, it } from 'vitest';
import type { WhatsAppConversationSession, WhatsAppParsedMessage } from '../whatsappConversationParser';
import {
  buildEpisodeResponseTurns,
  classifySmartConversation,
  extractValidatedStaffName,
} from '../whatsappSmartReviewCore';

function message(
  id: string,
  minute: number,
  direction: 'inbound' | 'outbound',
  text: string,
): WhatsAppParsedMessage {
  return {
    id,
    timestamp: new Date(2026, 8, 13, 3, minute, 0),
    rawTimestamp: '',
    sender: direction === 'outbound' ? 'You' : 'Customer',
    text,
    direction,
    kind: 'text',
    forwarded: false,
    raw: text,
  };
}

function session(messages: WhatsAppParsedMessage[]): WhatsAppConversationSession {
  return {
    id: 's1',
    startedAt: messages[0].timestamp,
    endedAt: messages[messages.length - 1].timestamp,
    messages,
    participants: ['You', 'Customer'],
    outboundStaffNames: [],
    customerName: 'Customer',
    mediaCount: 0,
  };
}

describe('whatsappSmartReviewCore', () => {
  it('extracts only the doctor name from a greeting, not the rest of the sentence', () => {
    expect(extractValidatedStaffName('أهلًا وسهلًا بحضرتك\nمع حضرتك د اسلام\nخدمة التوصيل متاحة على مدار ٢٤ ساعة')).toBe('اسلام');
    expect(extractValidatedStaffName('مع حضرتك د هدى من صيدليات دواء 🥼🥼')).toBe('هدى');
    expect(extractValidatedStaffName('مع حضرتك د هدى اقدر اساعد حضرتك ازاي؟')).toBeNull();
  });

  it('never carries response delay across separate sessions', () => {
    const first = session([
      message('c1', 0, 'inbound', 'محتاج صنف'),
      message('s1', 3, 'outbound', 'من عنيا لحضرتك'),
    ]);
    const second = session([
      { ...message('c2', 0, 'inbound', 'صباح الخير'), timestamp: new Date(2026, 8, 14, 9, 0, 0) },
      { ...message('s2', 1, 'outbound', 'صباح النور'), timestamp: new Date(2026, 8, 14, 9, 1, 0) },
    ]);
    expect(buildEpisodeResponseTurns(first)[0].responseLatencySeconds).toBe(180);
    expect(buildEpisodeResponseTurns(second)[0].responseLatencySeconds).toBe(60);
  });

  it('classifies a customer-service follow-up that turns into an order as a journey, not one flat label', () => {
    const result = classifySmartConversation(session([
      message('s0', 0, 'outbound', 'مع حضرتك نور من خدمة عملاء صيدليات دواء، حابين نطمن على مستوى الخدمة ورضا حضرتك'),
      message('c1', 2, 'inbound', 'السلام عليكم'),
      message('s1', 3, 'outbound', 'مع حضرتك د اسلام'),
      message('c2', 6, 'inbound', 'محتاج واحد من دا'),
      message('s2', 9, 'outbound', 'من عنيا لحضرتك'),
      message('c3', 11, 'inbound', 'وممكن فوار للحموضة'),
      message('s3', 15, 'outbound', 'هبعت لحضرتك فوار باذن الله'),
    ]));
    expect(result.primaryType).toBe('customer_service_followup');
    expect(result.journey).toContain('product_request');
    expect(result.finalIntent).toBe('product_request');
    expect(result.outcome).toBe('order_requested_unverified');
    expect(result.suggestedReviewCriteria).toContain('sales_closing');
  });

  it('treats a staff apology for delivery delay as service recovery without inventing a customer complaint', () => {
    const result = classifySmartConversation(session([
      message('c1', 0, 'inbound', 'محتاج الاوردر على العنوان'),
      message('s1', 1, 'outbound', 'ابعتهم لحضرتك على عنوان الششتاوي؟'),
      message('c2', 2, 'inbound', 'اه ان شاء الله'),
      message('s2', 3, 'outbound', 'ممكن يتاخر حاجة بسيطة'),
      message('s3', 20, 'outbound', 'انا متاسف لحضرتك عالتاخير الكبير وبنتابع مع المندوب'),
    ]));
    expect(result.journey).toContain('service_recovery');
    expect(result.journey).not.toContain('complaint_or_service_issue');
    expect(result.suggestedReviewCriteria).toContain('order_delay_handling');
  });

  it('keeps chat sale as unverified unless invoice truth confirms it', () => {
    const base = session([
      message('c1', 0, 'inbound', 'هحتاج واحد'),
      message('s1', 1, 'outbound', 'تم الارسال لحضرتك'),
    ]);
    expect(classifySmartConversation(base).outcome).toBe('order_requested_unverified');
    expect(classifySmartConversation(base, { invoiceVerified: true }).outcome).toBe('invoice_verified_sale');
  });

  it('ignores courtesy closing text when choosing the last meaningful interaction', () => {
    const result = classifySmartConversation(session([
      message('c1', 0, 'inbound', 'محتاج واحد من الصنف'),
      message('s1', 1, 'outbound', 'من عنيا لحضرتك'),
      message('s2', 2, 'outbound', 'صيدليات دواء تتشرف بخدمة حضرتك دائما وتحت أمر حضرتك في أي وقت'),
    ]));
    expect(result.lastMeaningfulMessageId).toBe('s1');
  });
});
