import { describe, expect, it } from 'vitest';
import type { WhatsAppConversationSession, WhatsAppParsedMessage } from '../whatsappConversationParser';
import { runSmartReviewPipeline } from '../whatsappSmartReviewPipeline';

function msg(id: string, at: string, direction: 'inbound' | 'outbound', text: string): WhatsAppParsedMessage {
  return { id, timestamp: new Date(at), rawTimestamp: at, sender: direction === 'outbound' ? 'You' : 'Customer', text, direction, kind: 'text', forwarded: false, raw: text };
}

function session(messages: WhatsAppParsedMessage[]): WhatsAppConversationSession {
  return { id: 's1', startedAt: messages[0].timestamp, endedAt: messages[messages.length - 1].timestamp, messages, participants: ['You','Customer'], outboundStaffNames: [], customerName: 'Customer', mediaCount: 0 };
}

describe('whatsappSmartReviewPipeline', () => {
  const s = session([
    msg('a1','2026-09-13T03:01:00','outbound','مع حضرتك د اسلام'),
    msg('c1','2026-09-13T03:02:00','inbound','محتاج واحد من ده'),
    msg('a2','2026-09-13T03:03:00','outbound','من عنيا لحضرتك'),
    msg('b1','2026-09-13T03:04:00','outbound','مع حضرتك د شبل'),
    msg('c2','2026-09-13T03:05:00','inbound','لسه الاوردر موصلش'),
    msg('b2','2026-09-13T03:06:00','outbound','انا متاسف لحضرتك عالتاخير'),
  ]);

  it('keeps verified ownership even when the selected range excludes the intro message', () => {
    const result = runSmartReviewPipeline(s, {
      staffName: 'شبل', role: 'pharmacist',
      from: new Date('2026-09-13T03:05:00'),
      to: new Date('2026-09-13T03:06:00'),
      contextMessages: 1,
    });
    expect(result.scope.inScopeMessageIds).toEqual(['c2','b2']);
    expect(result.review?.staffSummaries[0].staffName).toBe('شبل');
    expect(result.review?.staffSummaries[0].messageIds).toEqual(['c2','b2']);
    expect(result.scope.contextMessageIds).toContain('b1');
  });

  it('never scores context messages', () => {
    const result = runSmartReviewPipeline(s, {
      staffName: 'شبل', role: 'pharmacist',
      from: new Date('2026-09-13T03:05:00'),
      to: new Date('2026-09-13T03:05:00'),
      contextMessages: 1,
    });
    expect(result.scope.inScopeMessageIds).toEqual(['c2']);
    expect(result.review?.staffSummaries[0].messageIds).toEqual(['c2']);
    expect(result.scope.displayMessages.map((m) => m.id)).toEqual(['b1','c2','b2']);
  });

  it('blocks invalid ranges before any review decision', () => {
    const result = runSmartReviewPipeline(s, {
      staffName: 'شبل', role: 'pharmacist',
      from: new Date('2026-09-13T03:06:00'),
      to: new Date('2026-09-13T03:05:00'),
    });
    expect(result.review).toBeNull();
    expect(result.decision.decision).toBe('detailed_review');
    expect(result.decision.safeToQuickApprove).toBe(false);
  });

  it('requires a verified staff selection before producing a scoped quick decision', () => {
    const result = runSmartReviewPipeline(s, { from: new Date('2026-09-13T03:02:00'), to: new Date('2026-09-13T03:03:00') });
    expect(result.review).toBeNull();
    expect(result.decision.reasons.join(' ')).toContain('اختيار المسؤول');
  });
});
