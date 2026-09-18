import type { WhatsAppConversationSession, WhatsAppParsedMessage } from './whatsappConversationParser';
import { buildSmartOwnershipTimeline, type SmartStaffRole } from './whatsappSmartReviewOwnership';

export interface SmartReviewScopeInput {
  staffName?: string | null;
  role?: SmartStaffRole | null;
  from?: Date | null;
  to?: Date | null;
  contextMessages?: number;
}

export interface SmartReviewScopeResult {
  valid: boolean;
  blockingReasons: string[];
  originalMessageCount: number;
  scopedMessageCount: number;
  contextMessageCount: number;
  inScopeMessageIds: string[];
  contextMessageIds: string[];
  scoredSession: WhatsAppConversationSession | null;
  displayMessages: WhatsAppParsedMessage[];
}

const normalizeArabic = (value: unknown) => String(value || '')
  .trim().toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/[\u064B-\u065F]/g, '').replace(/\s+/g, ' ');

function cloneSession(source: WhatsAppConversationSession, messages: WhatsAppParsedMessage[], suffix: string): WhatsAppConversationSession {
  const first = messages[0];
  const last = messages[messages.length - 1];
  return {
    ...source,
    id: `${source.id}-${suffix}-${first.timestamp.getTime()}-${last.timestamp.getTime()}`,
    startedAt: first.timestamp,
    endedAt: last.timestamp,
    messages,
    participants: Array.from(new Set(messages.filter((m) => m.direction !== 'system').map((m) => m.sender))),
    mediaCount: messages.filter((m) => ['image', 'voice', 'video', 'document'].includes(m.kind)).length,
    missingMediaCount: messages.filter((m) => ['image', 'voice', 'video', 'document'].includes(m.kind) && !m.mediaAvailable).length,
  };
}

function addBoundedContext(
  ordered: WhatsAppParsedMessage[],
  inScopeIds: Set<string>,
  indexes: number[],
  contextCount: number,
) {
  const contextIds = new Set<string>();
  if (!indexes.length || contextCount <= 0) return contextIds;
  const sorted = Array.from(new Set(indexes)).sort((a, b) => a - b);
  const clusters: Array<{ start: number; end: number }> = [];
  for (const index of sorted) {
    const last = clusters[clusters.length - 1];
    if (!last || index > last.end + 1) clusters.push({ start: index, end: index });
    else last.end = index;
  }
  for (const cluster of clusters) {
    for (
      let i = Math.max(0, cluster.start - contextCount);
      i <= Math.min(ordered.length - 1, cluster.end + contextCount);
      i += 1
    ) {
      if (!inScopeIds.has(ordered[i].id)) contextIds.add(ordered[i].id);
    }
  }
  return contextIds;
}

export function applySmartReviewMessageScope(
  session: WhatsAppConversationSession,
  input: SmartReviewScopeInput,
): SmartReviewScopeResult {
  const ordered = session.messages.slice().sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const reasons: string[] = [];
  const fromMs = input.from?.getTime();
  const toMs = input.to?.getTime();

  if (Number.isFinite(fromMs) && Number.isFinite(toMs) && Number(fromMs) > Number(toMs)) {
    reasons.push('وقت البداية يجب أن يكون قبل وقت النهاية');
  }

  const timeline = buildSmartOwnershipTimeline(session, 120);
  const targetName = normalizeArabic(input.staffName);
  const targetRole = input.role || null;
  const ownedIds = new Set<string>();

  for (const episode of timeline.episodes) {
    if (!episode.eligibleForScoring || !episode.ownerName) continue;
    if (targetName && normalizeArabic(episode.ownerName) !== targetName) continue;
    if (targetRole && episode.ownerRole !== targetRole) continue;
    episode.messageIds.forEach((id) => ownedIds.add(id));
  }

  if (targetName && ownedIds.size === 0) reasons.push('لا توجد ملكية مؤكدة للمسؤول المحدد داخل هذه الجلسة');

  const inScope = ordered.filter((message) => {
    if ((targetName || targetRole) && !ownedIds.has(message.id)) return false;
    const ts = message.timestamp.getTime();
    if (Number.isFinite(fromMs) && ts < Number(fromMs)) return false;
    if (Number.isFinite(toMs) && ts > Number(toMs)) return false;
    return true;
  });

  if (!inScope.length) reasons.push('لا توجد رسائل قابلة للتقييم داخل النطاق المحدد');

  const inScopeIds = new Set(inScope.map((m) => m.id));
  const contextCount = Math.max(0, Math.min(10, input.contextMessages ?? 2));
  const indexes = inScope.map((m) => ordered.findIndex((x) => x.id === m.id)).filter((i) => i >= 0);
  const contextIds = addBoundedContext(ordered, inScopeIds, indexes, contextCount);

  const displayMessages = ordered.filter((m) => inScopeIds.has(m.id) || contextIds.has(m.id));
  const scoredSession = inScope.length ? cloneSession(session, inScope, 'smart-scope') : null;

  return {
    valid: reasons.length === 0,
    blockingReasons: reasons,
    originalMessageCount: ordered.length,
    scopedMessageCount: inScope.length,
    contextMessageCount: contextIds.size,
    inScopeMessageIds: inScope.map((m) => m.id),
    contextMessageIds: Array.from(contextIds),
    scoredSession,
    displayMessages,
  };
}
