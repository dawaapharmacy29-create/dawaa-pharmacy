// Stable Follow-up Identity — one deterministic key per (customer, episode, follow-up type, reason).
//
//   followup_identity = fu1 | customer anchor | episode start | follow-up type | reason
//
// It never depends on an import/session instance (conversation_session_id, source id, the index of
// an item inside a case unit), so the same follow-up is reused when:
//   * the same file is imported twice,
//   * the same messages arrive under a different segmentation (coarse vs fine source),
//   * the Smart Watcher and automatic ingest both process the conversation,
//   * the export grows later (appended messages do not move an earlier episode).
// A genuinely new episode (a later raw session after a >120-minute silence) or a different reason
// yields a new identity, so a new follow-up is allowed.
//
// Customer anchor comes from the Canonical Customer Identity (resolved customer id, phone or code).
// When unresolved, the deterministic canonical case-unit id is used; filename is metadata only.
import type {
  WhatsAppConversationSession,
  WhatsAppParsedMessage,
} from './whatsappConversationParser';
import type { CanonicalCustomerIdentity } from './customers/canonicalCustomerIdentityResolver';

export const FOLLOWUP_IDENTITY_VERSION = 'fu1';
const EPISODE_GAP_MINUTES = 120;

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
  if (identity?.status === 'resolved' && identity.customerId)
    return `customer:${identity.customerId}`;
  if (identity?.normalizedPhone) return `phone:${identity.normalizedPhone}`;
  if (identity?.customerCode) return `code:${normalizeFollowupKeyPart(identity.customerCode)}`;
  const caseAnchor = normalizeFollowupKeyPart(canonicalCaseAnchor || '');
  if (caseAnchor) return `case:${caseAnchor}`;
  throw new Error('followup_customer_anchor_unresolved');
}

/**
 * Start of the raw 120-minute session containing `at`. Depends only on the message timeline, so
 * it is identical for every segmentation that keeps raw sessions whole (Case Context V27 units,
 * legacy coarse/day sources) and does not move when later messages are appended.
 */
export function episodeStartedAt(messages: WhatsAppParsedMessage[], at: Date): Date {
  const sorted = [...messages].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
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
  customerAnchor: string;
  session: WhatsAppConversationSession;
  /** Stable V22/case-unit start. Required for evidence-free manual-review identity. */
  caseStartedAt?: string | Date | null;
}

/** Identity for an operational action row (customer_request, *_followup, manual_review). */
export function operationalActionFollowupIdentity(
  context: FollowupIdentityContext,
  action: { action_type: string; product_name?: string | null; evidence?: unknown }
): string | null {
  const evidenceAt = followupEvidenceAt(
    context.session,
    action.evidence,
    context.caseStartedAt
  );
  if (!evidenceAt) return null;
  return buildFollowupIdentity({
    customerAnchor: context.customerAnchor,
    episodeStartedAt: episodeStartedAt(context.session.messages, evidenceAt),
    followupType: action.action_type,
    reasonKey: action.product_name ?? null,
  });
}
