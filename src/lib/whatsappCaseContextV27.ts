import type { WhatsAppConversationSession, WhatsAppMessageKind } from './whatsappConversationParser';
import { buildWhatsAppCustomerCaseEngineV22, type WhatsAppCustomerCaseEngineV22, type WhatsAppCustomerCaseV22 } from './whatsappCustomerCaseEngineV22';

export interface WhatsAppCaseContextV27 {
  caseItem: WhatsAppCustomerCaseV22;
  sessionIds: string[];
  mergedSession: WhatsAppConversationSession;
}

export interface WhatsAppCaseContextEngineV27 {
  version: 'whatsapp-case-context-v27';
  caseEngine: WhatsAppCustomerCaseEngineV22;
  contexts: WhatsAppCaseContextV27[];
  bySessionId: Map<string, WhatsAppCaseContextV27>;
}

const MEDIA_KINDS = new Set<WhatsAppMessageKind>(['image', 'voice', 'video', 'document']);

function uniq<T>(rows: T[]) { return [...new Set(rows)]; }

function mergeSessions(sessions: WhatsAppConversationSession[], caseItem: WhatsAppCustomerCaseV22): WhatsAppConversationSession {
  const messages = sessions.flatMap((session) => session.messages).slice().sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const first = messages[0];
  const last = messages[messages.length - 1];
  const mediaKinds = messages.reduce((acc, message) => {
    acc[message.kind] = (acc[message.kind] || 0) + 1;
    return acc;
  }, {} as Record<WhatsAppMessageKind, number>);
  return {
    id: 'case:' + caseItem.id,
    startedAt: first?.timestamp || new Date(caseItem.startedAt),
    endedAt: last?.timestamp || new Date(caseItem.lastEventAt),
    messages,
    participants: uniq(sessions.flatMap((session) => session.participants)),
    outboundStaffNames: uniq(sessions.flatMap((session) => session.outboundStaffNames)),
    customerName: sessions.find((session) => session.customerName)?.customerName || null,
    mediaCount: messages.filter((message) => MEDIA_KINDS.has(message.kind)).length,
    mediaKinds,
    missingMediaCount: messages.filter((message) => MEDIA_KINDS.has(message.kind) && !message.mediaAvailable).length,
    replyCount: messages.filter((message) => Boolean(message.replyTo?.text)).length,
    forwardedCount: messages.filter((message) => message.forwarded).length,
  };
}

export function buildWhatsAppCaseContextsV27(sessions: WhatsAppConversationSession[]): WhatsAppCaseContextEngineV27 {
  const caseEngine = buildWhatsAppCustomerCaseEngineV22(sessions);
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const contexts = caseEngine.cases.map((caseItem) => {
    const caseSessions = caseItem.sessionIds.map((sessionId) => sessionById.get(sessionId)).filter((session): session is WhatsAppConversationSession => Boolean(session));
    return { caseItem, sessionIds: caseItem.sessionIds, mergedSession: mergeSessions(caseSessions, caseItem) };
  });
  const bySessionId = new Map<string, WhatsAppCaseContextV27>();
  for (const context of contexts) for (const sessionId of context.sessionIds) bySessionId.set(sessionId, context);
  return { version: 'whatsapp-case-context-v27', caseEngine, contexts, bySessionId };
}