import type { WhatsAppConversationSession, WhatsAppParsedMessage } from './whatsappConversationParser';

export type SmartStaffRole = 'pharmacist' | 'customer_service' | 'unknown';
export type SmartOwnershipConfidence = 'verified_intro' | 'unassigned';

export interface SmartStaffIdentity {
  name: string;
  role: SmartStaffRole;
  evidenceMessageId: string;
  confidence: 'verified_intro';
}

export interface SmartOwnershipEpisode {
  id: string;
  ownerName: string | null;
  ownerRole: SmartStaffRole;
  confidence: SmartOwnershipConfidence;
  startedAt: Date;
  endedAt: Date;
  messageIds: string[];
  inboundMessageIds: string[];
  outboundMessageIds: string[];
  introEvidenceMessageId: string | null;
  eligibleForScoring: boolean;
}

export interface SmartOwnershipHandoff {
  from: string | null;
  to: string;
  at: Date;
  evidenceMessageId: string;
}

export interface SmartIdentityTransition extends SmartOwnershipHandoff {
  acrossGap: boolean;
}

export interface SmartOwnershipTimeline {
  episodes: SmartOwnershipEpisode[];
  handoffs: SmartOwnershipHandoff[];
  identityTransitions: SmartIdentityTransition[];
  identityEvents: SmartStaffIdentity[];
  verifiedStaff: SmartStaffIdentity[];
  unassignedMessageIds: string[];
}

const normalizeArabic = (value: unknown) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[أإآ]/g, 'ا')
  .replace(/ى/g, 'ي')
  .replace(/ة/g, 'ه')
  .replace(/[\u064B-\u065F]/g, '')
  .replace(/\s+/g, ' ');

function cleanName(raw: string) {
  const value = String(raw || '')
    .replace(/[🥼💊🌷🌹🤍💚💙✨🚗]+/g, ' ')
    .replace(/[،,.؛;:]+$/g, '')
    .trim();
  const words = value.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 4 || value.length > 40) return null;
  if (/(اقدر|أقدر|اساعد|أساعد|حضرتك|الخدمه|الخدمة|صيدليات|دواء|التوصيل)/i.test(value)) return null;
  return value;
}

export function extractSmartStaffIdentity(message: WhatsAppParsedMessage): SmartStaffIdentity | null {
  if (message.direction !== 'outbound') return null;
  const text = String(message.text || '');

  const pharmacistPatterns = [
    /مع\s+حضرتك\s+(?:د\.?|دكتور(?:ه|ة)?|دكتوره)\s*([^\n،,.]+)/i,
    /معاك(?:ي)?\s+(?:د\.?|دكتور(?:ه|ة)?|دكتوره)\s*([^\n،,.]+)/i,
  ];
  for (const pattern of pharmacistPatterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const name = cleanName(match[1].split(/\s+من\s+/i)[0]);
    if (name) return { name, role: 'pharmacist', evidenceMessageId: message.id, confidence: 'verified_intro' };
  }

  const servicePatterns = [
    /مع\s+حضرتك\s+([^\n،,.]{1,40}?)\s+من\s+خدم(?:ة|ه)\s*عملاء/i,
    /معاك(?:ي)?\s+([^\n،,.]{1,40}?)\s+من\s+خدم(?:ة|ه)\s*عملاء/i,
  ];
  for (const pattern of servicePatterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const name = cleanName(match[1]);
    if (name) return { name, role: 'customer_service', evidenceMessageId: message.id, confidence: 'verified_intro' };
  }

  return null;
}

function sameIdentity(a: SmartStaffIdentity | null, b: SmartStaffIdentity | null) {
  if (!a || !b) return false;
  return normalizeArabic(a.name) === normalizeArabic(b.name) && a.role === b.role;
}

function makeEpisode(index: number, messages: WhatsAppParsedMessage[], owner: SmartStaffIdentity | null): SmartOwnershipEpisode {
  const first = messages[0];
  const last = messages[messages.length - 1];
  return {
    id: `${first.timestamp.getTime()}-${index}-${owner ? normalizeArabic(owner.name).replace(/\s+/g, '-') : 'unassigned'}`,
    ownerName: owner?.name || null,
    ownerRole: owner?.role || 'unknown',
    confidence: owner ? 'verified_intro' : 'unassigned',
    startedAt: first.timestamp,
    endedAt: last.timestamp,
    messageIds: messages.map((message) => message.id),
    inboundMessageIds: messages.filter((message) => message.direction === 'inbound').map((message) => message.id),
    outboundMessageIds: messages.filter((message) => message.direction === 'outbound').map((message) => message.id),
    introEvidenceMessageId: owner?.evidenceMessageId || null,
    eligibleForScoring: Boolean(owner),
  };
}

export function buildSmartOwnershipTimeline(session: WhatsAppConversationSession, gapMinutes = 120): SmartOwnershipTimeline {
  const messages = session.messages
    .filter((message) => message.direction !== 'system' && message.kind !== 'system')
    .slice()
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  if (!messages.length) {
    return { episodes: [], handoffs: [], identityTransitions: [], identityEvents: [], verifiedStaff: [], unassignedMessageIds: [] };
  }

  const episodes: SmartOwnershipEpisode[] = [];
  const handoffs: SmartOwnershipHandoff[] = [];
  const identityTransitions: SmartIdentityTransition[] = [];
  const identityEvents: SmartStaffIdentity[] = [];
  const verifiedStaff: SmartStaffIdentity[] = [];
  const seenStaff = new Set<string>();
  let currentOwner: SmartStaffIdentity | null = null;
  let lastVerifiedIdentity: SmartStaffIdentity | null = null;
  let bucket: WhatsAppParsedMessage[] = [];
  let previous: WhatsAppParsedMessage | null = null;
  let gapResetSinceLastIdentity = false;

  const flush = () => {
    if (!bucket.length) return;
    episodes.push(makeEpisode(episodes.length, bucket, currentOwner));
    bucket = [];
  };

  for (const message of messages) {
    const gap = previous ? (message.timestamp.getTime() - previous.timestamp.getTime()) / 60000 : 0;
    if (previous && gap > gapMinutes) {
      flush();
      currentOwner = null;
      gapResetSinceLastIdentity = true;
    }

    const intro = extractSmartStaffIdentity(message);
    if (intro) {
      identityEvents.push(intro);
      const staffKey = `${normalizeArabic(intro.name)}|${intro.role}`;
      if (!seenStaff.has(staffKey)) {
        seenStaff.add(staffKey);
        verifiedStaff.push(intro);
      }

      if (lastVerifiedIdentity && !sameIdentity(lastVerifiedIdentity, intro)) {
        identityTransitions.push({
          from: lastVerifiedIdentity.name,
          to: intro.name,
          at: message.timestamp,
          evidenceMessageId: message.id,
          acrossGap: gapResetSinceLastIdentity,
        });
      }

      if (!sameIdentity(currentOwner, intro)) {
        const priorOwner = currentOwner;
        flush();
        if (priorOwner) {
          handoffs.push({ from: priorOwner.name, to: intro.name, at: message.timestamp, evidenceMessageId: message.id });
        }
        currentOwner = intro;
      }

      lastVerifiedIdentity = intro;
      gapResetSinceLastIdentity = false;
    }

    bucket.push(message);
    previous = message;
  }
  flush();

  return {
    episodes,
    handoffs,
    identityTransitions,
    identityEvents,
    verifiedStaff,
    unassignedMessageIds: episodes.filter((episode) => !episode.eligibleForScoring).flatMap((episode) => episode.messageIds),
  };
}

export function selectOwnedMessagesForStaff(
  session: WhatsAppConversationSession,
  staffName: string,
  gapMinutes = 120,
  role?: SmartStaffRole | null,
) {
  const target = normalizeArabic(staffName);
  const timeline = buildSmartOwnershipTimeline(session, gapMinutes);
  const allowedIds = new Set(
    timeline.episodes
      .filter((episode) =>
        episode.eligibleForScoring
        && normalizeArabic(episode.ownerName) === target
        && (!role || episode.ownerRole === role))
      .flatMap((episode) => episode.messageIds),
  );
  return session.messages.filter((message) => allowedIds.has(message.id));
}
