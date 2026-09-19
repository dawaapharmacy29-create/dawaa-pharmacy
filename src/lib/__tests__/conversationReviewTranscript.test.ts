import { describe, expect, it } from 'vitest';
import type { WhatsAppConversationSession, WhatsAppParsedMessage } from '../whatsappConversationParser';
import { buildConversationReviewSnapshot, parseConversationReviewSnapshot, snapshotFromReviewRow } from '../conversationReviewTranscript';

function msg(id: string, at: string, direction: 'inbound' | 'outbound', text: string): WhatsAppParsedMessage {
  return { id, timestamp: new Date(at), rawTimestamp: at, sender: direction === 'outbound' ? 'You' : 'Customer', text, direction, kind: 'text', forwarded: false, raw: text };
}

const session: WhatsAppConversationSession = {
  id: 's1',
  startedAt: new Date('2026-09-13T03:00:00'),
  endedAt: new Date('2026-09-13T03:05:00'),
  messages: [],
  participants: ['You', 'Customer'],
  outboundStaffNames: [],
  customerName: 'عميل',
  mediaCount: 0,
};

describe('conversationReviewTranscript', () => {
  it('keeps scored and context messages explicitly separated', () => {
    const messages = [
      msg('ctx','2026-09-13T03:00:00','outbound','مع حضرتك د اسلام'),
      msg('in','2026-09-13T03:01:00','inbound','محتاج الصنف ده'),
      msg('out','2026-09-13T03:02:00','outbound','من عنيا لحضرتك'),
    ];
    const snapshot = buildConversationReviewSnapshot({
      session: { ...session, messages },
      displayMessages: messages,
      scoredMessageIds: ['in','out'],
      contextMessageIds: ['ctx'],
      evidenceMessageIds: ['in'],
      staffName: 'اسلام',
      staffRole: 'pharmacist',
      sourceFileName: 'chat.zip',
      from: new Date('2026-09-13T03:01:00'),
      to: new Date('2026-09-13T03:02:00'),
      decision: { decision: 'issue', reasons: ['ملاحظة'], affectedCriteria: ['sales_closing'], evidenceMessageIds: ['in'], safeToQuickApprove: false },
    });
    expect(snapshot.messages.map((m) => [m.id, m.scope])).toEqual([['ctx','context'],['in','scored'],['out','scored']]);
    expect(snapshot.messages.find((m) => m.id === 'in')?.evidence).toBe(true);
  });

  it('can be restored from raw_scores without new database columns', () => {
    const messages = [msg('m1','2026-09-13T03:01:00','inbound','السلام عليكم')];
    const snapshot = buildConversationReviewSnapshot({
      session: { ...session, messages }, displayMessages: messages,
      scoredMessageIds: ['m1'], contextMessageIds: [], staffName: 'اسلام', staffRole: 'pharmacist',
      decision: { decision: 'clear', reasons: [], affectedCriteria: [], evidenceMessageIds: [], safeToQuickApprove: true },
    });
    expect(parseConversationReviewSnapshot(JSON.stringify(snapshot))?.staffName).toBe('اسلام');
    expect(snapshotFromReviewRow({ raw_scores: { conversation_snapshot: snapshot } })?.messages[0].id).toBe('m1');
  });

  it('outboundBurstMetrics is additive and read-only: absent when not passed, present and round-trips through JSON when passed', () => {
    const messages = [msg('m1', '2026-09-13T03:01:00', 'inbound', 'السلام عليكم')];
    const withoutMetrics = buildConversationReviewSnapshot({
      session: { ...session, messages }, displayMessages: messages,
      scoredMessageIds: ['m1'], contextMessageIds: [], staffName: 'اسلام', staffRole: 'pharmacist',
      decision: { decision: 'clear', reasons: [], affectedCriteria: [], evidenceMessageIds: [], safeToQuickApprove: true },
    });
    expect(withoutMetrics.outboundBurstMetrics).toBeUndefined();

    const metrics = [{ staffName: 'اسلام', staffId: null, outboundMessages: 2, burstCount: 1, repliedBursts: 1, burstReplyRatePct: 100 }];
    const withMetrics = buildConversationReviewSnapshot({
      session: { ...session, messages }, displayMessages: messages,
      scoredMessageIds: ['m1'], contextMessageIds: [], staffName: 'اسلام', staffRole: 'pharmacist',
      decision: { decision: 'clear', reasons: [], affectedCriteria: [], evidenceMessageIds: [], safeToQuickApprove: true },
      outboundBurstMetrics: metrics,
    });
    expect(withMetrics.outboundBurstMetrics).toEqual(metrics);
    expect(parseConversationReviewSnapshot(JSON.stringify(withMetrics))?.outboundBurstMetrics).toEqual(metrics);
  });

  it('staffIdentity (resolved staff_id, branch, confidence, source) round-trips through JSON unchanged', () => {
    const messages = [msg('m1', '2026-09-13T03:01:00', 'inbound', 'السلام عليكم')];
    const identity = {
      staffId: 's1', accountId: 'a1', canonicalStaffName: 'اسلام محمد', displayName: 'اسلام',
      role: 'pharmacist', branch: 'فرع الشامي', identityConfidence: 91,
      identitySource: 'v15_resolved_id' as const, ambiguous: false, candidates: [],
    };
    const snapshot = buildConversationReviewSnapshot({
      session: { ...session, messages }, displayMessages: messages,
      scoredMessageIds: ['m1'], contextMessageIds: [], staffName: 'اسلام', staffRole: 'pharmacist',
      decision: { decision: 'clear', reasons: [], affectedCriteria: [], evidenceMessageIds: [], safeToQuickApprove: true },
      staffIdentity: identity,
    });
    expect(snapshot.staffIdentity).toEqual(identity);
    expect(parseConversationReviewSnapshot(JSON.stringify(snapshot))?.staffIdentity).toEqual(identity);

    const withoutIdentity = buildConversationReviewSnapshot({
      session: { ...session, messages }, displayMessages: messages,
      scoredMessageIds: ['m1'], contextMessageIds: [], staffName: 'اسلام', staffRole: 'pharmacist',
      decision: { decision: 'clear', reasons: [], affectedCriteria: [], evidenceMessageIds: [], safeToQuickApprove: true },
    });
    expect(withoutIdentity.staffIdentity).toBeUndefined();
  });
});
