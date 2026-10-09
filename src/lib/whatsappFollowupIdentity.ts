// Stable Operation Identity — one deterministic key per real operation
// (customer or conversation, raw episode, operation type, reason).
//
//   followup_identity = fu1 | anchor | episode start | operation type | reason
//
// Every part comes from source evidence (message timestamps, senders, text, canonical customer),
// never from an import/runtime instance (conversation_session_id, source id, case or session
// index, array position, action UUID). So the same operation keeps the same identity when:
//   * the same file is imported twice, retried, or re-processed,
//   * the same messages arrive under a different segmentation (coarse vs fine source, a Sales
//     Intelligence interaction that starts mid-episode, a longer or shorter export),
//   * the Smart Watcher, automatic ingest, the V22 backfill and Sales Intelligence each derive it,
//   * pipeline steps or messages are processed in a different order.
// A genuinely new episode (a later raw session after a >120-minute silence), a different
// operation type or a different reason yields a new identity, so two real operations never merge.
//
// Anchor: the resolved canonical customer (id, phone or code). When the customer is unresolved,
// the conversation episode fingerprint (customer contact label + opening message of the raw
// episode) is used; the filename is metadata only. A resolved run also matches the conversation
// anchor as an alias, so a customer resolved after a first import keeps the same operation.
import type { WhatsAppConversationSession } from './whatsappConversationParser';
import type { CanonicalCustomerIdentity } from './customers/canonicalCustomerIdentityResolver';

export const FOLLOWUP_IDENTITY_VERSION = 'fu1';
const EPISODE_GAP_MINUTES = 120;

/** The evidence a timeline message contributes to an identity (parser and V32 messages both fit). */
export interface OperationTimelineMessage {
  timestamp: Date;
  direction?: string | null;
  sender?: string | null;
  text?: string | null;
}

/** Order-independent timeline: time first, then content, never the array/import position. */
function sortedTimeline<T extends Pick<OperationTimelineMessage, 'timestamp'>>(messages: T[]): T[] {
  const content = (message: T) => {
    const row = message as Partial<OperationTimelineMessage>;
    return [row.direction ?? '', row.sender ?? '', row.text ?? ''].join('\u0001');
  };
  return [...messages].sort(
    (a, b) =>
      a.timestamp.getTime() - b.timestamp.getTime() || content(a).localeCompare(content(b))
  );
}

/** Two independent 32-bit FNV-1a passes (~64 bits); deterministic and synchronous. */
function stableDigest(value: string): string {
  const pass = (seed: number) => {
    let hash = seed;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36).padStart(7, '0');
  };
  return pass(2166136261) + pass(0x811c9dc5 ^ 0x5bd1e995);
}

/** Stable timestamp tokens embedded in WhatsApp message ids (epoch-ms prefix). */
export function followupEvidenceTimestampKeys(value: unknown): string[] {
  const rows = Array.isArray(value) ? value : [];
  return Array.from(
    new Set(
      rows
        .map((item) => /^([0-9]{13})(?:-|$)/.exec(String(item ?? '').trim())?.[1] || '')
        .filter(Boolean)
    )
  ).sort();
}


export function normalizeFollowupKeyPart(value: unknown): string {
  return String(value ?? '')
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, '-');
}

function resolvedCustomerAnchor(
  identity: Pick<CanonicalCustomerIdentity, 'customerId' | 'normalizedPhone' | 'customerCode'>
): string | null {
  if (identity.customerId) return `customer:${identity.customerId}`;
  if (identity.normalizedPhone) return `phone:${identity.normalizedPhone}`;
  if (identity.customerCode) return `code:${normalizeFollowupKeyPart(identity.customerCode)}`;
  return null;
}

/**
 * Customer anchor from canonical identity evidence only.
 * Filename is never an identity fallback. When the customer is unresolved, callers must provide
 * the deterministic canonical case-unit id so unrelated exports cannot collapse into one task.
 */
export function followupCustomerAnchor(
  identity: Pick<
    CanonicalCustomerIdentity,
    'status' | 'customerId' | 'normalizedPhone' | 'customerCode'
  > | null,
  canonicalCaseAnchor?: string | null
): string {
  const resolved = identity?.status === 'resolved' ? resolvedCustomerAnchor(identity) : null;
  if (resolved) return resolved;
  const caseAnchor = normalizeFollowupKeyPart(canonicalCaseAnchor || '');
  if (caseAnchor) return `case:${caseAnchor}`;
  throw new Error('followup_customer_anchor_unresolved');
}

/**
 * Start of the raw 120-minute session containing `at`. Depends only on the message timeline, so
 * it is identical for every segmentation that keeps raw sessions whole (Case Context V27 units,
 * legacy coarse/day sources) and does not move when later messages are appended.
 */
export function episodeStartedAt(messages: Array<Pick<OperationTimelineMessage, 'timestamp'>>, at: Date): Date {
  const sorted = sortedTimeline(messages);
  const target = at.getTime();
  let start = sorted[0]?.timestamp ?? at;
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index].timestamp;
    if (current.getTime() > target) break;
    const previous = sorted[index - 1]?.timestamp;
    if (!previous || current.getTime() - previous.getTime() > EPISODE_GAP_MINUTES * 60_000)
      start = current;
  }
  return start;
}

export function buildFollowupIdentity(input: {
  customerAnchor: string;
  episodeStartedAt: Date;
  followupType: string;
  reasonKey?: string | null;
}): string {
  const episode = new Date(
    Math.floor(input.episodeStartedAt.getTime() / 60_000) * 60_000
  ).toISOString();
  return [
    FOLLOWUP_IDENTITY_VERSION,
    input.customerAnchor,
    episode,
    normalizeFollowupKeyPart(input.followupType),
    normalizeFollowupKeyPart(input.reasonKey) || '-',
  ].join('|');
}

/** Messages of the raw 120-minute episode that contains `at` (empty when the timeline is). */
function episodeMessages<T extends Pick<OperationTimelineMessage, 'timestamp'>>(
  messages: T[],
  at: Date
): T[] {
  const sorted = sortedTimeline(messages);
  if (!sorted.length) return [];
  const start = episodeStartedAt(sorted, at).getTime();
  const rows: T[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index];
    if (current.timestamp.getTime() < start) continue;
    const previous = rows[rows.length - 1];
    if (previous && current.timestamp.getTime() - previous.timestamp.getTime() > EPISODE_GAP_MINUTES * 60_000)
      break;
    rows.push(current);
  }
  return rows;
}

/**
 * Conversation anchor for an unresolved customer: the customer contact label (first inbound sender
 * of the episode) plus the episode's opening message. It depends only on what was said, by whom and
 * when, so it survives re-import, re-segmentation and message order, while two chats (even a staff
 * broadcast sent to many customers in the same minute) keep different anchors. Null without messages.
 */
export function conversationEpisodeAnchor(
  timeline: OperationTimelineMessage[],
  at: Date
): string | null {
  const episode = episodeMessages(timeline, at);
  const opener = episode[0];
  if (!opener) return null;
  const contact = episode.find((message) => message.direction === 'inbound')?.sender ?? '';
  const evidence = [
    normalizeFollowupKeyPart(contact) || '-',
    String(opener.timestamp.getTime()),
    normalizeFollowupKeyPart(opener.direction) || '-',
    normalizeFollowupKeyPart(opener.sender) || '-',
    normalizeFollowupKeyPart(opener.text) || '-',
  ].join('|');
  return `chat:${stableDigest(evidence)}`;
}

export interface StableOperationIdentity {
  /** The key new rows are written under. */
  identity: string;
  /**
   * Keys the SAME operation may already be stored under: the conversation-anchored key when the
   * customer is resolved now, and the pre-contract case-anchored key (legacy rows). Lookups match
   * all of them; writers never rewrite an existing row's identity.
   */
  aliases: string[];
}

/** The single Stable Operation Identity contract. Throws `followup_customer_anchor_unresolved`. */
export function stableOperationIdentity(input: {
  customer: Pick<CanonicalCustomerIdentity, 'status' | 'customerId' | 'normalizedPhone' | 'customerCode'> | null;
  timeline: OperationTimelineMessage[];
  evidenceAt: Date;
  operationType: string;
  reasonKey?: string | null;
  /** Pre-contract unresolved anchor (V22 case id) — alias only, never written for new rows. */
  legacyCaseAnchor?: string | null;
}): StableOperationIdentity {
  const conversationAnchor = conversationEpisodeAnchor(input.timeline, input.evidenceAt);
  const customerAnchor =
    input.customer?.status === 'resolved' ? resolvedCustomerAnchor(input.customer) : null;
  const primary = customerAnchor || conversationAnchor;
  if (!primary) throw new Error('followup_customer_anchor_unresolved');
  const episode = episodeStartedAt(input.timeline, input.evidenceAt);
  const keyFor = (anchor: string) =>
    buildFollowupIdentity({
      customerAnchor: anchor,
      episodeStartedAt: episode,
      followupType: input.operationType,
      reasonKey: input.reasonKey ?? null,
    });
  const identity = keyFor(primary);
  const legacyCase = normalizeFollowupKeyPart(input.legacyCaseAnchor || '');
  const aliases = [
    conversationAnchor,
    legacyCase ? `case:${legacyCase}` : null,
  ]
    .filter((anchor): anchor is string => Boolean(anchor) && anchor !== primary)
    .map(keyFor)
    .filter((key, index, rows) => key !== identity && rows.indexOf(key) === index);
  return { identity, aliases };
}

/** Evidence time of a follow-up. Empty-evidence actions use the canonical case start when supplied. */
export function followupEvidenceAt(
  session: WhatsAppConversationSession,
  evidenceMessageIds: unknown,
  canonicalCaseStartedAt?: string | Date | null
): Date | null {
  const ids = new Set((Array.isArray(evidenceMessageIds) ? evidenceMessageIds : []).map(String));
  const times = session.messages
    .filter((message) => ids.has(String(message.id)))
    .map((message) => message.timestamp.getTime());
  if (times.length) return new Date(Math.min(...times));
  if (canonicalCaseStartedAt) {
    const stable = canonicalCaseStartedAt instanceof Date
      ? canonicalCaseStartedAt
      : new Date(canonicalCaseStartedAt);
    if (!Number.isNaN(stable.getTime())) return stable;
  }
  return null;
}

export interface FollowupIdentityContext {
  /** Canonical Customer Identity of the case unit (null = unresolved). */
  customer: Pick<CanonicalCustomerIdentity, 'status' | 'customerId' | 'normalizedPhone' | 'customerCode'> | null;
  session: WhatsAppConversationSession;
  /** Stable V22/case-unit start. Required for evidence-free manual-review identity. */
  caseStartedAt?: string | Date | null;
  /** Pre-contract unresolved anchor (the V22 case session id) — matched as an alias only. */
  legacyCaseAnchor?: string | null;
}

/** Identity for an operational action row (customer_request, *_followup, manual_review). */
export function operationalActionFollowupIdentity(
  context: FollowupIdentityContext,
  action: { action_type: string; product_name?: string | null; evidence?: unknown }
): StableOperationIdentity | null {
  const evidenceAt = followupEvidenceAt(
    context.session,
    action.evidence,
    context.caseStartedAt
  );
  if (!evidenceAt) return null;
  return stableOperationIdentity({
    customer: context.customer,
    timeline: context.session.messages,
    evidenceAt,
    operationType: action.action_type,
    reasonKey: action.product_name ?? null,
    legacyCaseAnchor: context.legacyCaseAnchor ?? null,
  });
}
