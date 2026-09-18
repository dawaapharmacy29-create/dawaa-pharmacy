import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildUnifiedConversationIntelligence, summarizePortfolio } from '@/lib/whatsappUnifiedIntelligenceV4';

function oneSession(raw: string) {
  const messages = parseWhatsAppExport(raw);
  const sessions = splitWhatsAppSessions(messages, 120);
  expect(sessions.length).toBeGreaterThan(0);
  return sessions[0];
}

describe('WhatsApp Review V4 unified intelligence', () => {
  it('parses a normal English/Windows export and detects a completed sale', () => {
    const session = oneSession(`[9/15/26, 9:00:00 AM] Customer: صباح الخير، فيتامين د متوفر وبكام؟\n[9/15/26, 9:01:00 AM] You: صباح النور، مع حضرتك د هبة من صيدليات دواء. متوفر بسعر 250 جنيه\n[9/15/26, 9:02:00 AM] You: تحب نضيفه على أوردر حضرتك؟\n[9/15/26, 9:03:00 AM] Customer: تمام ابعته\n[9/15/26, 9:04:00 AM] You: تم تأكيد الطلب وهيتم التوصيل، تحت أمر حضرتك في أي وقت`);
    const result = buildUnifiedConversationIntelligence(session);
    expect(result.outcome).toBe('sold');
    expect(result.followupRequired).toBe(false);
    expect(result.commercialEligible).toBe(true);
    expect(result.commercialScore).toBeGreaterThan(50);
    expect(result.serviceScore).toBeGreaterThan(60);
  });

  it('detects stockout without alternative as an urgent lost-sale risk', () => {
    const session = oneSession(`[9/15/26, 9:00:00 AM] Customer: المنتج ده موجود؟\n[9/15/26, 9:01:00 AM] You: لا مش موجود حاليا`);
    const result = buildUnifiedConversationIntelligence(session);
    expect(result.lostSales.some((x) => x.severity === 'high')).toBe(true);
    expect(result.priority).toBe('urgent');
    expect(result.followupRequired).toBe(true);
  });

  it('forces human approval for high-risk dosage context', () => {
    const session = oneSession(`[9/15/26, 9:00:00 AM] Customer: ابني عنده حرارة، جرعة طفل كام؟\n[9/15/26, 9:01:00 AM] You: الجرعة 5 مل مرتين يوميا بعد الأكل`);
    const result = buildUnifiedConversationIntelligence(session);
    expect(result.medicalSafetyFlags.some((x) => x.severity === 'high')).toBe(true);
    expect(result.requiresHumanApproval).toBe(true);
  });

  it('infers pharmacy sender when export does not label messages as You', () => {
    const session = oneSession(`[15/09/2026, 09:00 ص] أحمد: صباح الخير، المنتج متوفر؟\n[15/09/2026, 09:01 ص] صيدليات دواء: مساء الخير، مع حضرتك د هبة من صيدليات دواء. متوفر لحضرتك\n[15/09/2026, 09:02 ص] أحمد: تمام ابعته\n[15/09/2026, 09:03 ص] صيدليات دواء: تم تأكيد الطلب وهيتم التوصيل`);
    expect(session.messages.filter((m) => m.direction === 'outbound').length).toBeGreaterThan(0);
    expect(session.outboundStaffNames.length).toBeGreaterThan(0);
    expect(buildUnifiedConversationIntelligence(session).outcome).toBe('sold');
  });

  it('creates a portfolio summary for batch review', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: فيتامين د متوفر؟\n[9/15/26, 9:01:00 AM] You: مع حضرتك د هبة من صيدليات دواء. متوفر\n[9/15/26, 9:02:00 AM] Customer: تمام ابعته\n[9/15/26, 9:03:00 AM] You: تم تأكيد الطلب\n[9/15/26, 12:30:00 PM] Customer: منتج تاني موجود؟\n[9/15/26, 12:31:00 PM] You: لا مش موجود`;
    const sessions = splitWhatsAppSessions(parseWhatsAppExport(raw), 120);
    const portfolio = summarizePortfolio(sessions);
    expect(portfolio.sessions).toBe(2);
    expect(portfolio.salesEligible).toBeGreaterThan(0);
    expect(portfolio.urgent).toBeGreaterThan(0);
  });
});
