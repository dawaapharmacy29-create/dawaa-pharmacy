import type { WhatsAppConversationSession, WhatsAppParsedMessage } from './whatsappConversationParser';

export interface WhatsAppAnalysisScope {
  doctor?: string | null;
  from?: Date | null;
  to?: Date | null;
}

export interface WhatsAppAnalysisScopeResult {
  sessions: WhatsAppConversationSession[];
  originalMessageCount: number;
  scopedMessageCount: number;
  matchedSessionCount: number;
  detectedDoctors: string[];
}

const normalize = (value: unknown) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[أإآ]/g, 'ا')
  .replace(/ى/g, 'ي')
  .replace(/ة/g, 'ه')
  .replace(/[\u064B-\u065F]/g, '')
  .replace(/\s+/g, ' ');

function doctorMatches(session: WhatsAppConversationSession, doctor: string) {
  const target = normalize(doctor);
  if (!target) return true;
  const exactStaff = session.outboundStaffNames.some((name) => normalize(name) === target);
  if (exactStaff) return true;
  return session.messages.some((message) =>
    message.direction === 'outbound' && normalize(message.text).includes(target)
  );
}

function rebuildSession(
  source: WhatsAppConversationSession,
  messages: WhatsAppParsedMessage[],
  doctor?: string | null,
): WhatsAppConversationSession {
  const participants = Array.from(new Set(messages.filter((m) => m.direction !== 'system').map((m) => m.sender)));
  const mediaKinds = messages.reduce((acc, message) => {
    acc[message.kind] = (acc[message.kind] || 0) + 1;
    return acc;
  }, {} as NonNullable<WhatsAppConversationSession['mediaKinds']>);
  const mediaCount = messages.filter((m) => ['image', 'voice', 'video', 'document'].includes(m.kind)).length;
  const missingMediaCount = messages.filter((m) => ['image', 'voice', 'video', 'document'].includes(m.kind) && !m.mediaAvailable).length;
  const normalizedDoctor = normalize(doctor);
  const matchedDoctor = normalizedDoctor
    ? source.outboundStaffNames.find((name) => normalize(name) === normalizedDoctor) || doctor || null
    : null;
  return {
    ...source,
    id: `${source.id}-scope-${messages[0].timestamp.getTime()}-${messages[messages.length - 1].timestamp.getTime()}`,
    startedAt: messages[0].timestamp,
    endedAt: messages[messages.length - 1].timestamp,
    messages,
    participants,
    outboundStaffNames: matchedDoctor ? [String(matchedDoctor)] : source.outboundStaffNames,
    mediaCount,
    mediaKinds,
    missingMediaCount,
    replyCount: messages.filter((m) => Boolean(m.replyTo)).length,
    forwardedCount: messages.filter((m) => Boolean(m.forwarded)).length,
  };
}

export function collectDetectedDoctors(sessions: WhatsAppConversationSession[]) {
  return Array.from(new Set(sessions.flatMap((session) => session.outboundStaffNames).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ar'));
}

export function applyWhatsAppAnalysisScope(
  sessions: WhatsAppConversationSession[],
  scope: WhatsAppAnalysisScope,
): WhatsAppAnalysisScopeResult {
  const detectedDoctors = collectDetectedDoctors(sessions);
  const originalMessageCount = sessions.reduce((sum, session) => sum + session.messages.length, 0);
  const fromMs = scope.from?.getTime();
  const toMs = scope.to?.getTime();
  const scoped: WhatsAppConversationSession[] = [];

  for (const session of sessions) {
    if (scope.doctor && !doctorMatches(session, scope.doctor)) continue;
    const messages = session.messages.filter((message) => {
      const ts = message.timestamp.getTime();
      if (Number.isFinite(fromMs) && ts < Number(fromMs)) return false;
      if (Number.isFinite(toMs) && ts > Number(toMs)) return false;
      return true;
    });
    if (!messages.length) continue;
    scoped.push(rebuildSession(session, messages, scope.doctor));
  }

  return {
    sessions: scoped,
    originalMessageCount,
    scopedMessageCount: scoped.reduce((sum, session) => sum + session.messages.length, 0),
    matchedSessionCount: scoped.length,
    detectedDoctors,
  };
}

export function toLocalDateTimeInput(date: Date | null | undefined) {
  if (!date || Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
