// V32 — additive, parallel evidence layer. Does NOT replace or touch any existing
// whatsappSmart*/whatsappCase*/whatsapp*V2x engine. Read-once, facts-only, no scoring.
// See conversation history for the full V32 scope agreement (Phase A/B/C only).
import type { WhatsAppConversationSession, WhatsAppParsedMessage } from './whatsappConversationParser';
import { extractIntroducedStaffName, isCustomerServiceIntroduction } from './whatsappConversationParser';
import {
  AUTOMATED_REPLY_RX,
  buildSemanticSignalsV32,
  computeRequestBurstIds,
  extractCorrectionSignals,
  extractProductReferenceSignals,
  extractRequestSignals,
  isAcceptanceOnly,
  isBareAcknowledgementOnly,
  isRejectionOnly,
  isOperationalServiceClosure,
  isOperationalServiceRequest,
  isRequestCandidate,
  isThanksOrClosingOnly,
  startsIndependentCommercialNeed,
  startsIndependentCommercialNeedDuringOpenService,
  type ConversationSemanticSignalV32,
} from './whatsappSemanticSignalsV32';

export type ParticipantRoleV32 = 'staff' | 'customer' | 'system' | 'unknown';

export interface ParticipantIdentityV32 {
  name: string;
  role: ParticipantRoleV32;
}

export interface NormalizedConversationMessageV32 {
  /** Canonical directory context, supplied per message; never inferred from home branch. */
  staffFunction?: 'customer_service';
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
  /** Id shared by 2+ consecutive customer messages sent in quick succession before any staff reply, or null. */
  requestBurstId: string | null;
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
  segmentationReason:
    | 'conversation_start'
    | 'time_gap'
    | 'reopened_after_closing'
    | 'topic_shift_marker'
    | 'new_commercial_need'
    | 'customer_service_new_need'
    | 'new_service_need';
  /**
   * Messages that stayed in this interaction across a time gap, and why. A gap alone never
   * splits or merges; these are the semantic ties that kept the case together.
   */
  continuationEvidence?: Array<{ messageId: string; reason: 'open_service_need_followup' | 'semantic_continuation' }>;
}

export interface ConversationUnderstandingV32 {
  version: 'whatsapp-conversation-understanding-v32';
  conversationId: string;
  participants: ParticipantIdentityV32[];
  customerName: string | null;
  staffNames: string[];
  messages: NormalizedConversationMessageV32[];
  interactions: ConversationInteractionV32[];
  /** Facts extracted once, shared by every criterion — see whatsappSemanticSignalsV32.ts. */
  signals: ConversationSemanticSignalV32[];
  byId: Map<string, NormalizedConversationMessageV32>;
}

const EMOJI_RX = /\p{Extended_Pictographic}/u;
const NON_EMOJI_MEANINGFUL_RX = /[\p{L}\p{N}]/u;

function isEmojiOnlyText(text: string): boolean {
  const trimmed = (text || '').trim();
  if (!trimmed) return false;
  if (!EMOJI_RX.test(trimmed)) return false;
  return !NON_EMOJI_MEANINGFUL_RX.test(trimmed);
}

const PLACEHOLDER_ONLY_RX =
  /^<[^<>]*\bomitted>$|^\[(?:voice message|image|video|document|file|sticker)\]$|^(?:this message was deleted|you deleted this message)$/i;
const FORWARDED_PREFIX_RX = /^\[Forwarded\]\s*/i;

function isPlaceholderOnlyText(text: string): boolean {
  const stripped = (text || '').trim().replace(FORWARDED_PREFIX_RX, '').trim();
  return PLACEHOLDER_ONLY_RX.test(stripped);
}

const INTERACTION_GAP_MS = 30 * 60 * 1000;
const SEMANTIC_CONTINUATION_MAX_GAP_MS = 6 * 60 * 60 * 1000;
const PRIOR_ORDER_REFERENCE_MAX_GAP_MS = 24 * 60 * 60 * 1000;
const PRIOR_ORDER_COMMITMENT_RX =
  /(?:اه|ايوه|تمام)?\s*(?:ابعته|ابعت(?:ه|وه|لي)?|هات(?:ه|ها)?)|من\s*عنيا.*(?:الطريق|عند\s*حضرتك)|جاري\s*(?:الارسال|الإرسال|التجهيز)|تم\s*(?:تأكيد|تاكيد).*الطلب|الطلب\s*اتأكد/i;
const FULFILLMENT_FOLLOWUP_RX =
  /(?:بعت|بعتوا|اتبعت|اتبعث).*?(?:الاوردر|الأوردر|الطلب)|(?:الاوردر|الأوردر|الطلب).*?(?:فين|وصل|اتبعت|اتبعث)|المندوب.*?(?:فين|وصل|الطريق)|(?:وصل|استلمت|استلمه).*?(?:الاوردر|الأوردر|الطلب)/i;
const PRIOR_ORDER_REFERENCE_RX =
  /(?:بخصوص|بالنسبة\s*ل).*?(?:الاوردر|الأوردر|الطلب)|(?:الاوردر|الأوردر|الطلب).*?(?:اللي\s*فات|السابق|بتاعي|بتاعتي|القديم)|المندوب.*?(?:فين|وصل|الطريق)/i;
const ORDER_DETAIL_CONTINUATION_RX =
  /العنوان|عنواني|اللوكيشن|الموقع|رقمي|رقم\s*(?:الموبايل|التليفون)|الموبايل|التليفون|الدور|الشقه|الشقة|العماره|العمارة/i;
// Settlement after an already-committed order is fulfillment of that same commercial need, not a
// new need. Keep this deliberately narrow: only an explicit staff payment/transfer handoff can
// bridge a long gap; generic greetings, promotions or unrelated outreach never qualify.
const PAYMENT_SETTLEMENT_CONTINUATION_RX =
  /رقم\s*التحويل|(?:صوره|صورة)\s*التحويل|استاذن[^\n]{0,80}(?:صوره|صورة)[^\n]{0,40}التحويل|رابط\s*الدفع|لينك\s*الدفع/i;

/** Shared semantic guard: an explicit staff payment/transfer handoff, never a generic phone mention. */
export function hasPaymentSettlementHandoffText(text: string): boolean {
  return PAYMENT_SETTLEMENT_CONTINUATION_RX.test(text || '');
}
// An open operational need (a requested nurse visit) keeps its follow-ups in the same case for
// up to 12 hours; past that, a chase needs its own explicit reference.
const OPEN_SERVICE_NEED_MAX_GAP_MS = 12 * 60 * 60 * 1000;

/** The latest service request in the current case that nothing has closed yet. */
function openServiceNeed(current: NormalizedConversationMessageV32[]): NormalizedConversationMessageV32 | null {
  let open: NormalizedConversationMessageV32 | null = null;
  for (const message of current) {
    if (isOperationalServiceRequest(message)) open = message;
    else if (open && isOperationalServiceClosure(message)) open = null;
  }
  return open;
}

/** A customer turn that continues an open service need: anything that does not start a new need. */
function continuesOpenServiceNeed(
  current: NormalizedConversationMessageV32[],
  next: NormalizedConversationMessageV32,
  gapMs: number
): boolean {
  if (next.role !== 'customer' || !next.isMeaningful || gapMs > OPEN_SERVICE_NEED_MAX_GAP_MS) return false;
  return Boolean(openServiceNeed(current)) && !startsIndependentCommercialNeedDuringOpenService(next);
}

const ADDITIVE_REQUEST_RX =
  /(?:^|\s)(?:وكمان|كمان|وزود|زود|ضيف|معاهم|معاه|مع\s*الطلب)(?:\s|$)/i;
const STAFF_PENDING_REPLY_RX =
  /لحظات|ثواني|دقيق[ةه]|اشوف|أشوف|هشوف|هراجع|هتأكد|هاتأكد|جاري\s*(?:المراجعه|المراجعة|البحث)/i;
const CLOSING_RX = /شكر(?:ا|ًا)?\s*لتواصلك|تحت\s*أمرك\s*دائم(?:ا|ًا)?|يومك\s*سعيد|في\s*خدمتك\s*دائم(?:ا|ًا)?/i;
const TOPIC_SHIFT_MARKER_RX = /بالمناسبة|كمان\s*حاجة|سؤال\s*تاني|بس\s*كمان\s*عايز|في\s*مشكلة\s*تاني[ةه]|حاجة\s*تانية\s*خالص/i;
const CUSTOMER_COURTESY_RESPONSE_RX =
  /^(?:ولا\s*يهمك(?:\s+يا\s+(?:حبيبتي|حبيبي|فندم))?|العفو(?:\s+يا\s+فندم)?|شك(?:را|رًا)(?:\s+على\s+ذوق\s+حضرتك)?|ربنا\s+(?:يكرمك|يخليك)|تسلم(?:ي)?)[!.، ]*$/iu;

function lastMeaningfulOfRole(
  current: NormalizedConversationMessageV32[],
  role: ParticipantRoleV32
): NormalizedConversationMessageV32 | null {
  for (let i = current.length - 1; i >= 0; i -= 1) {
    const message = current[i];
    if (message.isMeaningful && message.role === role) return message;
  }
  return null;
}

function currentHasOrderCommitment(current: NormalizedConversationMessageV32[]): boolean {
  return current.some(
    (message) =>
      message.role === 'staff' &&
      message.isMeaningful &&
      PRIOR_ORDER_COMMITMENT_RX.test(message.text)
  );
}

function currentHasMeaningfulStaff(current: NormalizedConversationMessageV32[]): boolean {
  return current.some((message) => message.role === 'staff' && message.isMeaningful);
}

function hasPendingCustomerNeed(current: NormalizedConversationMessageV32[]): boolean {
  const customer = lastMeaningfulOfRole(current, 'customer');
  if (!customer || !isRequestCandidate(customer)) return false;
  const staff = lastMeaningfulOfRole(current, 'staff');
  if (!staff || customer.timestamp.getTime() > staff.timestamp.getTime()) return true;
  return STAFF_PENDING_REPLY_RX.test(staff.text);
}

function hasResolvedProductReferenceContinuation(
  current: NormalizedConversationMessageV32[],
  next: NormalizedConversationMessageV32
): boolean {
  if (next.role !== 'customer' || !next.isMeaningful) return false;
  const context = [...current.filter((m) => m.isMeaningful).slice(-5), next];
  return extractProductReferenceSignals(context).some(
    (signal) => signal.messageId === next.id && signal.extractedValue !== 'unknown'
  );
}

function hasLinkedCorrectionContinuation(
  current: NormalizedConversationMessageV32[],
  next: NormalizedConversationMessageV32
): boolean {
  if (next.role !== 'customer' || !next.isMeaningful) return false;
  const context = [...current.filter((m) => m.isMeaningful).slice(-5), next];
  return extractCorrectionSignals(context).some(
    (signal) => signal.messageId === next.id && (signal.relatedMessageIds?.length ?? 0) > 0
  );
}

function isCustomerCourtesyOrResponseOnly(text: string): boolean {
  const value = (text || '').trim();
  return (
    isAcceptanceOnly(value) ||
    isRejectionOnly(value) ||
    isBareAcknowledgementOnly(value) ||
    isThanksOrClosingOnly(value) ||
    CUSTOMER_COURTESY_RESPONSE_RX.test(value)
  );
}

function isCustomerResponseContinuation(
  current: NormalizedConversationMessageV32[],
  next: NormalizedConversationMessageV32
): boolean {
  if (next.role !== 'customer' || !next.isMeaningful || !currentHasMeaningfulStaff(current)) return false;
  return isCustomerCourtesyOrResponseOnly(next.text);
}

function isSameOrderContinuation(
  current: NormalizedConversationMessageV32[],
  next: NormalizedConversationMessageV32,
  gapMs: number
): boolean {
  if (gapMs > PRIOR_ORDER_REFERENCE_MAX_GAP_MS || next.role !== 'customer' || !next.isMeaningful) return false;
  if (!currentHasOrderCommitment(current)) return false;
  return (
    FULFILLMENT_FOLLOWUP_RX.test(next.text) ||
    PRIOR_ORDER_REFERENCE_RX.test(next.text) ||
    ORDER_DETAIL_CONTINUATION_RX.test(next.text)
  );
}

function isPaymentSettlementContinuation(
  current: NormalizedConversationMessageV32[],
  next: NormalizedConversationMessageV32,
  gapMs: number
): boolean {
  if (gapMs > PRIOR_ORDER_REFERENCE_MAX_GAP_MS || next.role !== 'staff' || !next.isMeaningful) return false;
  return currentHasOrderCommitment(current) && hasPaymentSettlementHandoffText(next.text);
}

function hasStrongSemanticContinuation(
  current: NormalizedConversationMessageV32[],
  next: NormalizedConversationMessageV32,
  gapMs: number
): boolean {
  if (!current.length || gapMs < 0) return false;
  if (isPaymentSettlementContinuation(current, next, gapMs)) return true;
  if (
    next.role === 'staff' &&
    next.isMeaningful &&
    gapMs <= SEMANTIC_CONTINUATION_MAX_GAP_MS &&
    hasPendingCustomerNeed(current)
  ) {
    return true;
  }
  if (next.role !== 'customer' || !next.isMeaningful) return false;
  if (continuesOpenServiceNeed(current, next, gapMs)) return true;
  if (isSameOrderContinuation(current, next, gapMs)) return true;
  if (gapMs <= SEMANTIC_CONTINUATION_MAX_GAP_MS) {
    // A bounded answer to explicit customer-service outreach stays with that
    // outreach even after the transport time gap. A new request is excluded.
    if (current.some(isServiceMessage) && !isExplicitCommercialRequest(next) &&
        /الوالد|والدي|الخدم[ةه]|التمريض|الممرض|اتحسن|تحسن|الحمد\s*لله/u.test(next.text)) return true;
    if (hasResolvedProductReferenceContinuation(current, next)) return true;
    if (hasLinkedCorrectionContinuation(current, next)) return true;
    if (isCustomerResponseContinuation(current, next)) return true;
  }
  return false;
}

function shouldKeepSemanticContinuation(
  current: NormalizedConversationMessageV32[],
  next: NormalizedConversationMessageV32,
  gapMs: number
): boolean {
  if (hasStrongSemanticContinuation(current, next, gapMs)) return true;
  return (
    gapMs <= INTERACTION_GAP_MS &&
    next.role === 'customer' &&
    next.isMeaningful &&
    currentHasOrderCommitment(current) &&
    ADDITIVE_REQUEST_RX.test(next.text)
  );
}

function isExplicitCommercialRequest(message: NormalizedConversationMessageV32): boolean {
  if (message.role !== 'customer' || !message.isMeaningful) return false;
  return extractRequestSignals([message]).some(
    (signal) => signal.messageId === message.id && signal.ruleId === 'request.explicit_verb'
  );
}

function normalizeMessage(
  message: WhatsAppParsedMessage,
  staffNames: Set<string>,
  customerName: string | null
): NormalizedConversationMessageV32 {
  const isSystemGenerated = message.direction === 'system' || message.kind === 'system';
  const isAutomated = !isSystemGenerated && AUTOMATED_REPLY_RX.test(message.text || '');
  const isEmojiOnly = !isSystemGenerated && isEmojiOnlyText(message.text || '');
  const hasText = Boolean((message.text || '').trim());
  const isMediaPlaceholder = Boolean(message.mediaPlaceholder) || isPlaceholderOnlyText(message.text);
  const hasRealContent = NON_EMOJI_MEANINGFUL_RX.test((message.text || '').trim());
  const isMeaningful =
    hasText && hasRealContent && !isSystemGenerated && !isAutomated && !isEmojiOnly && !isMediaPlaceholder;

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
    requestBurstId: null,
  };
}

/** A new explicit order/consultation after a welfare exchange is a new interaction,
 * even within minutes. A physician handoff alone, or another answer to the welfare
 * question, cannot split the same issue. Keep a preceding doctor introduction with
 * the new need when it is the trailing staff-only part of the exchange. */
function isServiceMessage(message: NormalizedConversationMessageV32): boolean {
  return message.staffFunction === 'customer_service' || isCustomerServiceIntroduction(message);
}

function serviceToNewNeedBoundary(current: NormalizedConversationMessageV32[], next: NormalizedConversationMessageV32): number | null {
  const consultation = (m: NormalizedConversationMessageV32) => m.role === 'customer' && m.isMeaningful &&
    /(?:عايز|عاوز|محتاج|ممكن|عندي).{0,30}(?:استشار[ةه]|سؤال\s*طبي)|(?:ممكن|عايز|عاوز)\s*(?:اسأل|أسأل)\s*(?:ال)?دكتور/u.test(m.text);
  if (!current.some(isServiceMessage) ||
      !(isExplicitCommercialRequest(next) || consultation(next)) ||
      current.some((m) => isExplicitCommercialRequest(m) || consultation(m))) return null;
  let lastCustomerIndex = -1;
  current.forEach((m, i) => { if (m.role === 'customer' && m.isMeaningful) lastCustomerIndex = i; });
  if (lastCustomerIndex < 0) return null;
  const trailingIntro = current.findIndex((m, i) => i > lastCustomerIndex &&
    m.direction === 'outbound' && Boolean(extractIntroducedStaffName(m)) && !isCustomerServiceIntroduction(m));
  return trailingIntro >= 0 ? trailingIntro : current.length;
}

function segmentInteractions(messages: NormalizedConversationMessageV32[]): ConversationInteractionV32[] {
  if (!messages.length) return [];
  const interactions: ConversationInteractionV32[] = [];
  let current: NormalizedConversationMessageV32[] = [];
  let reason: ConversationInteractionV32['segmentationReason'] = 'conversation_start';
  let sawClosingSinceLastMeaningfulInbound = false;
  let continuationEvidence: NonNullable<ConversationInteractionV32['continuationEvidence']> = [];

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
      ...(continuationEvidence.length ? { continuationEvidence } : {}),
    });
    current = [];
    continuationEvidence = [];
    sawClosingSinceLastMeaningfulInbound = false;
  };

  messages.forEach((message, i) => {
    const prev = messages[i - 1];
    let longGapContinuation: NonNullable<ConversationInteractionV32['continuationEvidence']>[number] | null = null;
    if (prev && current.length) {
      const previousMeaningful = [...current].reverse().find((candidate) => candidate.isMeaningful) || prev;
      const gapMs = message.timestamp.getTime() - previousMeaningful.timestamp.getTime();
      const semanticContinuation = shouldKeepSemanticContinuation(current, message, gapMs);
      const fulfilledCurrentOrder = currentHasOrderCommitment(current);
      const additiveRequest = ADDITIVE_REQUEST_RX.test(message.text);
      const serviceBoundary = serviceToNewNeedBoundary(current, message);
      const interactionCountBefore = interactions.length;
      if (gapMs > INTERACTION_GAP_MS && semanticContinuation && message.isMeaningful) {
        longGapContinuation = {
          messageId: message.id,
          reason: continuesOpenServiceNeed(current, message, gapMs) ? 'open_service_need_followup' : 'semantic_continuation',
        };
      }

      const openService = Boolean(openServiceNeed(current));
      if (openService && startsIndependentCommercialNeedDuringOpenService(message)) {
        // A medicine/price/availability request is its own case even minutes after a nurse request.
        flush();
        reason = 'new_commercial_need';
      } else if (!openService && isOperationalServiceRequest(message) &&
          current.some((m) => m.role === 'customer' && m.isMeaningful && startsIndependentCommercialNeed(m)) &&
          !startsIndependentCommercialNeed(message)) {
        // A nurse request after a medicine order is a separate service case, whatever the gap.
        flush();
        reason = 'new_service_need';
      } else if (serviceBoundary !== null) {
        const trailing = current.splice(serviceBoundary);
        flush();
        current = trailing;
        reason = 'customer_service_new_need';
      } else if (gapMs > INTERACTION_GAP_MS && !semanticContinuation) {
        flush();
        reason = 'time_gap';
      } else if (
        message.role === 'customer' &&
        message.isMeaningful &&
        TOPIC_SHIFT_MARKER_RX.test(message.text) &&
        !hasStrongSemanticContinuation(current, message, gapMs)
      ) {
        flush();
        reason = 'topic_shift_marker';
      } else if (
        message.role === 'customer' &&
        message.isMeaningful &&
        sawClosingSinceLastMeaningfulInbound &&
        !semanticContinuation &&
        !isCustomerCourtesyOrResponseOnly(message.text)
      ) {
        flush();
        reason = 'reopened_after_closing';
      } else if (
        fulfilledCurrentOrder &&
        isExplicitCommercialRequest(message) &&
        !additiveRequest &&
        !semanticContinuation
      ) {
        flush();
        reason = 'new_commercial_need';
      }
      // Recorded only when the message really stayed in the same case.
      if (longGapContinuation && interactions.length === interactionCountBefore) continuationEvidence.push(longGapContinuation);
    }

    if (message.role === 'staff' && message.isMeaningful && CLOSING_RX.test(message.text)) {
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
  session: WhatsAppConversationSession,
  context: { customerServiceMessageIds?: ReadonlySet<string> } = {}
): ConversationUnderstandingV32 {
  const staffNames = new Set(session.outboundStaffNames || []);
  const messages = session.messages
    .slice()
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    .map((message) => normalizeMessage(message, staffNames, session.customerName));
  for (const message of messages) {
    if (message.role === 'staff' && context.customerServiceMessageIds?.has(message.id)) message.staffFunction = 'customer_service';
  }

  const interactions = segmentInteractions(messages);

  const burstIdByMessageId = computeRequestBurstIds(messages);
  messages.forEach((message) => {
    message.requestBurstId = burstIdByMessageId.get(message.id) || null;
  });

  const signals = buildSemanticSignalsV32(messages);

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
    signals,
    byId: new Map(messages.map((m) => [m.id, m])),
  };
}
