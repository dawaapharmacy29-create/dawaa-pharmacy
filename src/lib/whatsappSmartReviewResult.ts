import type { WhatsAppConversationSession, WhatsAppParsedMessage } from './whatsappConversationParser';
import { classifySmartConversation, type SmartConversationStage, type SmartConversationOutcome } from './whatsappSmartReviewCore';
import { buildSmartOwnershipTimeline, type SmartStaffRole } from './whatsappSmartReviewOwnership';

export interface SmartOwnedReviewSummary {
  staffName: string;
  role: SmartStaffRole;
  startedAt: Date;
  endedAt: Date;
  messageIds: string[];
  inboundCount: number;
  outboundCount: number;
  primaryTypes: SmartConversationStage[];
  journey: SmartConversationStage[];
  finalIntent: SmartConversationStage | 'unknown';
  outcome: SmartConversationOutcome;
  responseTurnCount: number;
  unansweredTurns: number;
  slowResponseTurns: number;
  maxResponseSeconds: number | null;
  suggestedReviewCriteria: string[];
  reviewReasons: string[];
  evidenceMessageIds: string[];
  requiresHumanReview: boolean;
}

export interface SmartConversationReviewResult {
  sessionId: string;
  staffSummaries: SmartOwnedReviewSummary[];
  unassignedMessageIds: string[];
  handoffs: Array<{ from: string | null; to: string; at: Date; evidenceMessageId: string }>;
  safeForOfficialScoring: boolean;
  blockingReasons: string[];
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function buildEpisodeSession(source: WhatsAppConversationSession, messages: WhatsAppParsedMessage[]): WhatsAppConversationSession {
  const first = messages[0];
  const last = messages[messages.length - 1];
  return {
    ...source,
    id: `${source.id}-owned-${first.timestamp.getTime()}-${last.timestamp.getTime()}`,
    startedAt: first.timestamp,
    endedAt: last.timestamp,
    messages,
    participants: unique(messages.map((m) => m.sender)),
    customerName: messages.find((m) => m.direction === 'inbound')?.sender || source.customerName,
    mediaCount: messages.filter((m) => ['image', 'voice', 'video', 'document'].includes(m.kind)).length,
  };
}

function aggregateOutcome(outcomes: SmartConversationOutcome[]): SmartConversationOutcome {
  if (outcomes.includes('needs_review')) return 'needs_review';
  if (outcomes.includes('service_issue_open')) return 'service_issue_open';
  if (outcomes.includes('service_issue_recovered')) return 'service_issue_recovered';
  if (outcomes.includes('invoice_verified_sale')) return 'invoice_verified_sale';
  if (outcomes.includes('order_requested_unverified')) return 'order_requested_unverified';
  if (outcomes.includes('open')) return 'open';
  return outcomes[0] || 'needs_review';
}

export function buildSmartConversationReviewResult(
  session: WhatsAppConversationSession,
  options?: {
    invoiceVerified?: boolean;
    invoiceMatchAmbiguous?: boolean;
    ownershipGapMinutes?: number;
  },
): SmartConversationReviewResult {
  const timeline = buildSmartOwnershipTimeline(session, options?.ownershipGapMinutes ?? 120);
  const byStaff = new Map<string, { name: string; role: SmartStaffRole; episodes: WhatsAppParsedMessage[][] }>();
  const messageMap = new Map(session.messages.map((m) => [m.id, m]));

  for (const episode of timeline.episodes) {
    if (!episode.eligibleForScoring || !episode.ownerName) continue;
    const messages = episode.messageIds.map((id) => messageMap.get(id)).filter(Boolean) as WhatsAppParsedMessage[];
    if (!messages.length) continue;
    const key = `${episode.ownerName}::${episode.ownerRole}`;
    const existing = byStaff.get(key) || { name: episode.ownerName, role: episode.ownerRole, episodes: [] };
    existing.episodes.push(messages);
    byStaff.set(key, existing);
  }

  const staffSummaries: SmartOwnedReviewSummary[] = [];

  for (const staff of byStaff.values()) {
    const classified = staff.episodes.map((messages) => classifySmartConversation(
      buildEpisodeSession(session, messages),
      { invoiceVerified: options?.invoiceVerified, invoiceMatchAmbiguous: options?.invoiceMatchAmbiguous },
    ));
    const allMessages = staff.episodes.flat();
    const allTurns = classified.flatMap((item) => item.responseTurns);
    const responseSeconds = allTurns
      .map((turn) => turn.responseLatencySeconds)
      .filter((value): value is number => Number.isFinite(value));
    const journey = unique(classified.flatMap((item) => item.journey));
    const finalClassification = classified[classified.length - 1];
    staffSummaries.push({
      staffName: staff.name,
      role: staff.role,
      startedAt: allMessages[0].timestamp,
      endedAt: allMessages[allMessages.length - 1].timestamp,
      messageIds: allMessages.map((m) => m.id),
      inboundCount: allMessages.filter((m) => m.direction === 'inbound').length,
      outboundCount: allMessages.filter((m) => m.direction === 'outbound').length,
      primaryTypes: unique(classified.map((item) => item.primaryType).filter((x): x is SmartConversationStage => x !== 'unknown')),
      journey,
      finalIntent: finalClassification?.finalIntent || 'unknown',
      outcome: aggregateOutcome(classified.map((item) => item.outcome)),
      responseTurnCount: allTurns.length,
      unansweredTurns: allTurns.filter((turn) => turn.noResponse).length,
      slowResponseTurns: allTurns.filter((turn) => !turn.noResponse && Number(turn.responseLatencySeconds) > 600).length,
      maxResponseSeconds: responseSeconds.length ? Math.max(...responseSeconds) : null,
      suggestedReviewCriteria: unique(classified.flatMap((item) => item.suggestedReviewCriteria)),
      reviewReasons: unique(classified.flatMap((item) => item.reviewReasons)),
      evidenceMessageIds: unique(classified.flatMap((item) => item.evidenceMessageIds)),
      requiresHumanReview: classified.some((item) => item.requiresHumanReview),
    });
  }

  const blockingReasons: string[] = [];
  if (timeline.unassignedMessageIds.length) blockingReasons.push('يوجد رسائل خارج ملكية موظف مؤكدة ويجب عدم نسبها تلقائيًا لأي شخص');
  if (!staffSummaries.length) blockingReasons.push('لم يتم العثور على أي مسؤول مؤكد بصيغة تعريف موثوقة');
  if (options?.invoiceMatchAmbiguous) blockingReasons.push('ربط الفاتورة غير مؤكد');

  return {
    sessionId: session.id,
    staffSummaries,
    unassignedMessageIds: timeline.unassignedMessageIds,
    handoffs: timeline.handoffs.map((handoff) => ({ ...handoff })),
    safeForOfficialScoring: blockingReasons.length === 0 && staffSummaries.every((item) => !item.requiresHumanReview),
    blockingReasons,
  };
}
