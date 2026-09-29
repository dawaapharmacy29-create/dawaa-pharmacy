import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { extractConversationSignals } from '@/lib/whatsappConversationSignals';

function oneSession(raw: string) {
  const sessions = splitWhatsAppSessions(parseWhatsAppExport(raw), 120);
  expect(sessions).toHaveLength(1);
  return sessions[0];
}

describe('whatsappConversationSignals', () => {
  it('measures one response cycle for a burst of consecutive customer messages', () => {
    const session = oneSession(`[9/15/26, 9:00:00 AM] Customer: صباح الخير
[9/15/26, 9:00:10 AM] Customer: محتاج منتج
[9/15/26, 9:00:20 AM] Customer: لو سمحت بسرعة
[9/15/26, 9:02:00 AM] You: أهلا وسهلا بحضرتك، لحظة أشوفه`);
    const signals = extractConversationSignals(session);

    expect(signals.responseWaits).toHaveLength(1);
    expect(signals.firstResponseSeconds).toBe(120);
    expect(signals.unansweredInboundCount).toBe(0);
  });

  it('counts one unanswered inbound burst, not every message in the burst', () => {
    const session = oneSession(`[9/15/26, 9:00:00 AM] Customer: مساء الخير
[9/15/26, 9:00:05 AM] Customer: المنتج موجود؟
[9/15/26, 9:00:12 AM] Customer: لو سمحت`);
    const signals = extractConversationSignals(session);

    expect(signals.responseWaits).toHaveLength(1);
    expect(signals.unansweredInboundCount).toBe(1);
  });

  it('does not treat generic "لسه" as a complaint without a negative service context', () => {
    const session = oneSession(`[9/15/26, 9:00:00 AM] Customer: صباح الخير
[9/15/26, 9:01:00 AM] You: المنتج لسه في المخزن وهتأكد لحضرتك`);
    expect(extractConversationSignals(session).complaintOrEscalationDetected).toBe(false);
  });

  it('still detects explicit delayed-delivery complaint wording', () => {
    const session = oneSession(`[9/15/26, 9:00:00 AM] Customer: الطلب لسه مجاش ومتأخر جدا
[9/15/26, 9:01:00 AM] You: بنعتذر لحضرتك وهنتابع حالا`);
    const signals = extractConversationSignals(session);
    expect(signals.complaintOrEscalationDetected).toBe(true);
    expect(signals.apologyDetected).toBe(true);
  });
});
