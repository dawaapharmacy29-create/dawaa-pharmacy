// V32 — additive, parallel evidence layer. Does NOT replace or touch any existing
// whatsappSmart*/whatsappCase*/whatsapp*V2x engine. Read-once, facts-only, no scoring.
// See conversation history for the full V32 scope agreement (Phase A/B/C only).
import type { WhatsAppConversationSession, WhatsAppParsedMessage } from './whatsappConversationParser';

export type ParticipantRoleV32 = 'staff' | 'customer' | 'system' | 'unknown';

export interface ParticipantIdentityV32 {
  name: string;
  role: ParticipantRoleV32;
}

export interface NormalizedConversationMessageV32 {
  id: string;
  timestamp: Date;
  direction: 'inbound' | 'outbound' | 'system';
  role: ParticipantRoleV32;
  sender: string;
  text: string;
  /** WhatsApp system line (encryption notice, missed call, etc.) — never evidence of staff/customer behavior. */
  isSystemGenerated: boolean;
  /** Known auto-responder phrasing (e.g. out-of-hours bot reply) — not a human reply. */
  isAutomated: boolean;
  /** Message has visible content but it is only emoji/punctuation — not meaningful text. */
  isEmojiOnly: boolean;
  /** A bare media placeholder line (e.g. "<image omitted>") with no caption text of its own. */
  isMediaPlaceholder: boolean;
  /** Non-empty, non-system, non-automated, not emoji-only — the only messages criteria may cite as evidence. */
  isMeaningful: boolean;
  /** Id of the ConversationInteractionV32 this message was assigned to. */
  interactionId: string | null;
}

export interface ConversationInteractionV32 {
  id: string;
  index: number;
  messageIds: string[];
  startedAt: Date;
  endedAt: Date;
  /** First meaningful inbound message that opened this interaction, if any. */
  triggerMessageId: string | null;
  /** Staff who sent at least one meaningful outbound message inside this interaction. */
  primaryStaffNames: string[];
  /** Why the segmentation boundary was drawn here — kept for reviewability, not a business rule. */
  segmentationReason: 'conversation_start' | 'time_gap' | 'reopened_after_closing';
}

export interface ConversationUnderstandingV32 {
  version: 'whatsapp-conversation-understanding-v32';
  conversationId: string;
  participants: ParticipantIdentityV32[];
  customerName: string | null;
  staffNames: string[];
  messages: NormalizedConversationMessageV32[];
  interactions: ConversationInteractionV32[];
  byId: Map<string, NormalizedConversationMessageV32>;
}

const AUTOMATED_REPLY_RX =
  /رسال[ةه]\s*(آلي[ةه]|تلقائي[ةه])|رد\s*تلقائي|هذه\s*رساله\s*تلقائيه|out\s*of\s*office|automated\s*reply|بعيد[ًا]?\s*عن\s*مكتبي|خارج\s*مواعيد\s*العمل\s*الرسمي[ةه]?\s*نرد\s*عليك/i;

// Matches an entire string made up only of emoji / VS16 / ZWJ / whitespace / punctuation, with at least one emoji.
const EMOJI_RX = /\p{Extended_Pictographic}/u;
const NON_EMOJI_MEANINGFUL_RX = /[\p{L}\p{N}]/u;

function isEmojiOnlyText(text: string): boolean {
  const trimmed = (text || '').trim();
  if (!trimmed) return false;
  if (!EMOJI_RX.test(trimmed)) return false;
  return !NON_EMOJI_MEANINGFUL_RX.test(trimmed);
}

const INTERACTION_GAP_MS = 30 * 60 * 1000; // 30 minutes of silence -> treat as a new topic/interaction
const CLOSING_RX = /شكر[اً]?\s*لتواصلك|تحت\s*أمرك\s*دائم[اً]?|يومك\s*سعيد|في\s*خدمتك\s*دائم[اً]?/i;

function normalizeMessage(
  message: WhatsAppParsedMessage,
  staffNames: Set<string>,
  customerName: string | null
): NormalizedConversationMessageV32 {
  const isSystemGenerated = message.direction === 'system' || message.kind === 'system';
  const isAutomated = !isSystemGenerated && AUTOMATED_REPLY_RX.test(message.text || '');
  const isEmojiOnly = !isSystemGenerated && isEmojiOnlyText(message.text || '');
  const hasText = Boolean((message.text || '').trim());
  // A bare media placeholder line (e.g. "<image omitted>") is not text evidence of a request or
  // a reply — only a caption sent alongside it (a separate message in WhatsApp's own export format) is.
  const isMediaPlaceholder = Boolean(message.mediaPlaceholder);
  const isMeaningful = hasText && !isSystemGenerated && !isAutomated && !isEmojiOnly && !isMediaPlaceholder;

  let role: ParticipantRoleV32 = 'unknown';
  if (isSystemGenerated) role = 'system';
  else if (message.direction === 'outbound' || staffNames.has(message.sender)) role = 'staff';
  else if (message.direction === 'inbound') role = 'customer';

  return {
    id: message.id,
    timestamp: message.timestamp,
    direction: message.direction,
    role,
    sender: message.sender,
    text: message.text || '',
    isSystemGenerated,
    isAutomated,
    isEmojiOnly,
    isMediaPlaceholder,
    isMeaningful,
    interactionId: null,
  };
}

function segmentInteractions(messages: NormalizedConversationMessageV32[]): ConversationInteractionV32[] {
  if (!messages.length) return [];
  const interactions: ConversationInteractionV32[] = [];
  let current: NormalizedConversationMessageV32[] = [];
  let reason: ConversationInteractionV32['segmentationReason'] = 'conversation_start';
  let sawClosingSinceLastMeaningfulInbound = false;

  const flush = () => {
    if (!current.length) return;
    const index = interactions.length;
    const id = `interaction:${index}`;
    const trigger = current.find((m) => m.role === 'customer' && m.isMeaningful) || null;
    const staffNames = Array.from(
      new Set(current.filter((m) => m.role === 'staff' && m.isMeaningful).map((m) => m.sender))
    );
    current.forEach((m) => {
      m.interactionId = id;
    });
    interactions.push({
      id,
      index,
      messageIds: current.map((m) => m.id),
      startedAt: current[0].timestamp,
      endedAt: current[current.length - 1].timestamp,
      triggerMessageId: trigger?.id || null,
      primaryStaffNames: staffNames,
      segmentationReason: reason,
    });
    current = [];
  };

  messages.forEach((message, i) => {
    const prev = messages[i - 1];
    if (prev) {
      const gapMs = message.timestamp.getTime() - prev.timestamp.getTime();
      if (gapMs > INTERACTION_GAP_MS) {
        flush();
        reason = 'time_gap';
      } else if (
        message.role === 'customer' &&
        message.isMeaningful &&
        sawClosingSinceLastMeaningfulInbound
      ) {
        flush();
        reason = 'reopened_after_closing';
      }
    }
    if (message.role === 'staff' && CLOSING_RX.test(message.text)) {
      sawClosingSinceLastMeaningfulInbound = true;
    }
    if (message.role === 'customer' && message.isMeaningful) {
      sawClosingSinceLastMeaningfulInbound = false;
    }
    current.push(message);
  });
  flush();
  return interactions;
}

export function buildConversationUnderstandingV32(
  session: WhatsAppConversationSession
): ConversationUnderstandingV32 {
  const staffNames = new Set(session.outboundStaffNames || []);
  const messages = session.messages
    .slice()
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    .map((message) => normalizeMessage(message, staffNames, session.customerName));

  const interactions = segmentInteractions(messages);

  const participants: ParticipantIdentityV32[] = [];
  const seen = new Set<string>();
  messages.forEach((message) => {
    if (seen.has(message.sender)) return;
    seen.add(message.sender);
    participants.push({ name: message.sender, role: message.role });
  });

  return {
    version: 'whatsapp-conversation-understanding-v32',
    conversationId: session.id,
    participants,
    customerName: session.customerName,
    staffNames: Array.from(staffNames),
    messages,
    interactions,
    byId: new Map(messages.map((m) => [m.id, m])),
  };
}
