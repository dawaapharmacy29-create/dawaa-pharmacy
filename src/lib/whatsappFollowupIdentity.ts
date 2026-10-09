// Stable Operation Identity — one deterministic, immutable key per real operation
// (conversation episode, operation type, reason).
//
//   followup_identity = fu1 | chat:<conversation fingerprint> | episode start | type | reason
//
// Every part comes from conversation evidence (message times, directions, text and the customer's
// contact label), never from an import/runtime instance (conversation_session_id, source id, case
// or session index, array position, generated ids, action UUID) and never from the CURRENT customer
// resolution. So the same operation keeps the same identity when:
//   * the same file is imported twice, retried, or re-processed,
//   * the same messages arrive under a different segmentation (coarse vs fine source, a Sales
//     Intelligence interaction that starts mid-episode, a longer or shorter export),
//   * the Smart Watcher, automatic ingest, the V22 backfill, Journey V15 and Sales Intelligence
//     each derive it, or steps/messages are processed in a different order,
//   * the customer is resolved later, unresolved later, or re-linked to another customer: who the
//     customer is stays a separate, mutable attribute of the row (customer_id), never its identity.
// A genuinely new episode (a later raw session after a >120-minute silence), a different
// operation type or a different reason yields a new identity, so two real operations never merge.
//
// Keys written before this contract (resolved customer anchor, or the positional V22 case anchor)
// are returned as guarded legacy aliases: lookups may reuse such a row only when its own stored
// evidence proves it is the same operation (legacyAliasMatches). A stored key is never rewritten.
import type { WhatsAppConversationSession } from './whatsappConversationParser';
import type { CanonicalCustomerIdentity } from './customers/canonicalCustomerIdentityResolver';
import {
  isValidEgyptianCustomerMobile,
  normalizeEgyptianCustomerPhone,
} from './customers/customerIdentity';

export const FOLLOWUP_IDENTITY_VERSION = 'fu1';
const EPISODE_GAP_MINUTES = 120;

/** The evidence a timeline message contributes to an identity (parser and V32 messages both fit). */
export interface OperationTimelineMessage {
  timestamp: Date;
  direction?: string | null;
  sender?: string | null;
  text?: string | null;
  /** Parser message kind (text/image/voice/.../system). */
  kind?: string | null;
  /** V32: WhatsApp system line. */
  isSystemGenerated?: boolean;
  /** V32: bare media placeholder. */
  isMediaPlaceholder?: boolean;
  /** Parser: media placeholder line. */
  mediaPlaceholder?: boolean;
}

const MEDIA_KINDS = new Set(['image', 'voice', 'video', 'document']);
/** Attachment lines as exported with or without media ("<Media omitted>", "x.jpg (file attached)"). */
const MEDIA_LINE = /omitted>|\(file attached\)|<attached:/i;

/** Plain code-unit comparison: no locale/ICU dependence, so every runtime orders identically. */
function compareText(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Order-independent timeline: time first, then content, never the array/import position. */
function sortedTimeline<T extends Pick<OperationTimelineMessage, 'timestamp'>>(messages: T[]): T[] {
  const content = (message: T) => {
    const row = message as Partial<OperationTimelineMessage>;
    return [row.direction ?? '', row.sender ?? '', row.text ?? ''].join('\u0001');
  };
  return messages
    .filter((message) => Number.isFinite(message.timestamp?.getTime?.()))
    .sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime() || compareText(content(a), content(b))
    );
}

/**
 * Conversation evidence only. WhatsApp system/metadata lines (encryption notice, "messages deleted",
 * group changes) differ between exports of the same chat, so they never open an episode or enter a
 * fingerprint.
 */
function conversationEvidence<T extends OperationTimelineMessage>(messages: T[]): T[] {
  return messages.filter(
    (message) =>
      message.direction !== 'system' && message.kind !== 'system' && !message.isSystemGenerated
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
  for (const current of sorted) {
    if (current.timestamp.getTime() < start) continue;
    const previous = rows[rows.length - 1];
    if (previous && current.timestamp.getTime() - previous.timestamp.getTime() > EPISODE_GAP_MINUTES * 60_000)
      break;
    rows.push(current);
  }
  return rows;
}

/**
 * The customer's contact label as exported. A label that is a phone number is reduced to the
 * canonical mobile, so "+20 100 …" and "0100…" are the same contact; any other label is normalized
 * text. A saved name and a bare number stay DIFFERENT on purpose: nothing in the export proves they
 * are the same person (see conversationEpisodeAnchor).
 */
function contactToken(label: string | null | undefined): string {
  const raw = String(label ?? '').trim();
  if (/^[+\d\s\-().\u0660-\u0669\u200e\u200f\u202a-\u202e]+$/.test(raw) && isValidEgyptianCustomerMobile(raw))
    return `tel:${normalizeEgyptianCustomerPhone(raw)}`;
  return normalizeFollowupKeyPart(raw) || '-';
}

/** Content of one message: media is its kind only (exports with/without attachments differ). */
function messageToken(message: OperationTimelineMessage): string {
  const media =
    message.isMediaPlaceholder ||
    message.mediaPlaceholder ||
    MEDIA_KINDS.has(String(message.kind || '')) ||
    MEDIA_LINE.test(String(message.text || ''));
  const content = media ? 'media' : normalizeFollowupKeyPart(message.text) || '-';
  return [String(message.timestamp.getTime()), normalizeFollowupKeyPart(message.direction) || '-', content].join(':');
}

/**
 * Conversation fingerprint of the raw episode around `at`, from evidence only:
 *   contact label (first inbound sender) + opening message + first inbound message (time,
 *   direction, text; media by kind; system lines ignored; staff sender labels never used).
 * It survives re-import, re-segmentation, message order and export growth (later messages never
 * change the opening ones). The contact label is kept deliberately: without it, two customers who
 * answer the same staff broadcast with the same words in the same minute would collapse into one
 * operation. So the same chat exported from two devices with different saved names stays two
 * operations (conservative: duplicate rather than a wrong merge). Null without conversation messages.
 */
export function conversationEpisodeAnchor(
  timeline: OperationTimelineMessage[],
  at: Date
): string | null {
  const episode = episodeMessages(conversationEvidence(timeline), at);
  const opener = episode[0];
  if (!opener) return null;
  const firstInbound = episode.find((message) => message.direction === 'inbound') ?? null;
  const evidence = [
    contactToken(firstInbound?.sender),
    messageToken(opener),
    firstInbound ? messageToken(firstInbound) : '-',
  ].join('|');
  return `chat:${stableDigest(evidence)}`;
}

export type LegacyAliasKind = 'legacy_customer' | 'legacy_case';

export interface LegacyOperationAlias {
  key: string;
  kind: LegacyAliasKind;
}

export interface StableOperationIdentity {
  /** The immutable key new rows are written under (customer resolution never enters it). */
  identity: string;
  /**
   * Keys the SAME operation may have been stored under before this contract, exactly as the old
   * writer built them (episode over every message; resolved customer anchor or positional case
   * anchor). Bounded (at most two), deterministic, read-only: a row found under one is reused only
   * when legacyAliasMatches() confirms it from the row's own evidence.
   */
  aliases: LegacyOperationAlias[];
}

/** Legacy (pre-contract) inputs. Only used to FIND rows written before; never written. */
export interface LegacyOperationIdentityInput {
  /** Current canonical customer resolution (legacy rows of resolved customers used it as anchor). */
  customer?: Pick<CanonicalCustomerIdentity, 'status' | 'customerId' | 'normalizedPhone' | 'customerCode'> | null;
  /** Pre-contract unresolved anchor (the V22 case session id). */
  caseAnchor?: string | null;
}

/**
 * The single Stable Operation Identity contract. Pure: the result depends only on the arguments
 * (no clock, no randomness, no locale, no call order, no input array order).
 * Throws `followup_customer_anchor_unresolved` when there is no conversation evidence at all.
 */
export function stableOperationIdentity(input: {
  timeline: OperationTimelineMessage[];
  evidenceAt: Date;
  operationType: string;
  reasonKey?: string | null;
  legacy?: LegacyOperationIdentityInput | null;
}): StableOperationIdentity {
  const anchor = conversationEpisodeAnchor(input.timeline, input.evidenceAt);
  if (!anchor) throw new Error('followup_customer_anchor_unresolved');
  const evidence = sortedTimeline(conversationEvidence(input.timeline));
  const keyFor = (customerAnchor: string, episode: Date) =>
    buildFollowupIdentity({
      customerAnchor,
      episodeStartedAt: episode,
      followupType: input.operationType,
      reasonKey: input.reasonKey ?? null,
    });
  const identity = keyFor(anchor, episodeStartedAt(evidence, input.evidenceAt));

  // Legacy keys reproduce the pre-contract writer byte for byte (its episode read every message).
  const legacyEpisode = episodeStartedAt(input.timeline, input.evidenceAt);
  const legacyCustomer = input.legacy?.customer;
  const customerAnchor =
    legacyCustomer?.status === 'resolved' ? resolvedCustomerAnchor(legacyCustomer) : null;
  const caseAnchor = normalizeFollowupKeyPart(input.legacy?.caseAnchor || '');
  const aliases: LegacyOperationAlias[] = [];
  const add = (key: string, kind: LegacyAliasKind) => {
    if (key !== identity && !aliases.some((alias) => alias.key === key)) aliases.push({ key, kind });
  };
  if (customerAnchor) add(keyFor(customerAnchor, legacyEpisode), 'legacy_customer');
  if (caseAnchor) add(keyFor(`case:${caseAnchor}`, legacyEpisode), 'legacy_case');
  return { identity, aliases };
}

/**
 * Evidence check for reusing a row found under a legacy alias. A legacy key alone is not proof:
 * a positional case anchor (`<start>-<index>`) can repeat across chats, and a customer anchor
 * spans every chat of that customer. So:
 *   * legacy_case: the row must cite at least one of the SAME message ids (ids embed the time,
 *     the export position and the sender, so only the same export layout of the same chat matches);
 *     signal rows (no ids) must have the same evidence time and the same evidence text;
 *   * legacy_customer: the customer is canonical, so the same evidence is enough (a shared
 *     evidence id, overlapping message-id timestamps, or both rows evidence-free; signal rows:
 *     the same evidence time).
 * Anything else is not the same operation and is never reused.
 */
export function legacyAliasMatches(
  kind: LegacyAliasKind,
  current: { evidenceIds?: unknown; evidenceAt?: Date | null; evidenceQuote?: string | null },
  stored: { evidence?: unknown; evidence_timestamp?: string | null; evidence_quote?: string | null }
): boolean {
  if (Array.isArray(stored.evidence)) {
    const currentIds = (Array.isArray(current.evidenceIds) ? current.evidenceIds : []).map(String);
    const storedIds = stored.evidence.map(String);
    const sameIds = currentIds.some((id) => storedIds.includes(id));
    if (kind === 'legacy_case' || sameIds) return sameIds;
    const currentTimes = followupEvidenceTimestampKeys(currentIds);
    const storedTimes = followupEvidenceTimestampKeys(storedIds);
    if (!currentTimes.length && !storedTimes.length) return !currentIds.length && !storedIds.length;
    return currentTimes.some((time) => storedTimes.includes(time));
  }
  const storedAt = Date.parse(String(stored.evidence_timestamp || ''));
  if (!current.evidenceAt || !Number.isFinite(storedAt) || storedAt !== current.evidenceAt.getTime())
    return false;
  if (kind === 'legacy_customer') return true;
  return (
    Boolean(normalizeFollowupKeyPart(current.evidenceQuote)) &&
    normalizeFollowupKeyPart(current.evidenceQuote) === normalizeFollowupKeyPart(stored.evidence_quote)
  );
}

/**
 * The one row a candidate operation maps to: the row under its immutable key; otherwise exactly
 * one legacy row that legacyAliasMatches() confirms. Two or more confirmed legacy rows are an
 * ambiguity (never pick one); no confirmed row means a new operation.
 */
export function resolveOperationOwner<Row extends { id?: unknown; followup_identity?: string | null }>(
  stable: StableOperationIdentity,
  rows: Row[],
  confirm: (alias: LegacyOperationAlias, row: Row) => boolean
): { status: 'current'; row: Row } | { status: 'legacy'; row: Row } | { status: 'ambiguous'; rows: Row[] } | { status: 'none' } {
  const current = rows.find((row) => row.followup_identity === stable.identity);
  if (current) return { status: 'current', row: current };
  const confirmed = new Map<string, Row>();
  for (const alias of stable.aliases)
    for (const row of rows)
      if (row.followup_identity === alias.key && confirm(alias, row)) confirmed.set(String(row.id ?? alias.key), row);
  const matches = [...confirmed.values()];
  if (matches.length === 1) return { status: 'legacy', row: matches[0] };
  if (matches.length > 1) return { status: 'ambiguous', rows: matches };
  return { status: 'none' };
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
  session: WhatsAppConversationSession;
  /** Stable V22/case-unit start. Required for evidence-free manual-review identity. */
  caseStartedAt?: string | Date | null;
  /** Pre-contract inputs, used only to find rows written before this contract. */
  legacy?: LegacyOperationIdentityInput | null;
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
    timeline: context.session.messages,
    evidenceAt,
    operationType: action.action_type,
    reasonKey: action.product_name ?? null,
    legacy: context.legacy ?? null,
  });
}
