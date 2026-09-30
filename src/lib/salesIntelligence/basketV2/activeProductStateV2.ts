// Phase I.B.3.1 — Active Product State V2 (instructions #6-#9).
//
// Sits BETWEEN ProductMention extraction and the ConversationEntityGraph (instruction #21's
// architecture: ProductResolverV2 -> ProductMention extraction -> active discourse state ->
// ConversationEntityGraph -> Basket V2) — a distinct, independently testable layer, never merged
// into Basket. Built ON TOP of productMentionTracker.ts's computeActiveProductCandidates (reused
// as-is, never re-derived): that function already answers "which identities are still active";
// this module answers the NEW question instructions #6-#9 require — "active for WHAT commercial
// purpose" — since a bare staff recommendation and a customer's own confirmed order are both
// "active" in the plain mention-recency sense but must never be treated as equally strong order
// candidates (instruction #8's own worked example).
import type { NormalizedConversationMessageV32 } from '../../whatsappConversationUnderstandingV32';
import { extractRejectionSignals } from '../../whatsappSemanticSignalsV32';
import { stripRequestPrefix } from '../caseBasketEngine';
import { computeActiveProductCandidates } from '../quantityReference/productMentionTracker';
import type { ProductMentionV2 } from '../quantityReference/quantityReferenceTypes';

/**
 * The full vocabulary instructions #6/#8/#9 name. This module's own computeActiveProductStateV2()
 * only ever PRODUCES 'recommendation_only' | 'availability_only' | 'requested' — the other three
 * ('confirmed', 'rejected', 'substituted') require information this mention-level function
 * structurally does not have (a BASKET_CONFIRMED event, a rejection that stuck with no later
 * re-mention, or an accepted substitution edge) and are reserved for a future enrichment pass
 * closer to the graph/basket layers, never guessed here. Honest about the gap rather than
 * fabricating a value: 'rejected' in particular can never be this function's own output, because
 * computeActiveProductCandidates() (reused as-is) already drops an identity ENTIRELY once it is
 * rejected with no later re-mention — anything reaching this function was, by construction, never
 * in that state, or was re-mentioned and is active again.
 */
export type CommercialMentionState = 'recommendation_only' | 'availability_only' | 'requested' | 'confirmed' | 'rejected' | 'substituted';

export interface ActiveProductDecayFactors {
  /** Messages elapsed since this identity's own last mention, as of the evaluation point — never used ALONE to decide activity (instruction #7: "Do not use time alone"). */
  messageDistance: number;
  /** True when a DIFFERENT identity was mentioned more recently than this one — the conversation's focus has moved on. */
  topicShifted: boolean;
  /** True when a whole-item customer rejection was ever evidenced for this identity at any point in its history (not necessarily still "active" — computeActiveProductCandidates already drops an identity outright once a rejection with no later re-mention occurs; this flag survives even a later re-mention, for QA visibility). */
  explicitlyRejected: boolean;
}

export interface ActiveProductStateV2 {
  identityKey: string;
  /** null for a still-unresolved text-key identity — never invented. */
  canonicalProductId: string | null;
  lastMentionMessageId: string;
  lastMentionMessageIndex: number;
  lastCommercialAction: CommercialMentionState;
  sourceSpeaker: 'customer' | 'staff';
  /** True ONLY for 'requested' (this function's own output never includes 'confirmed' — see
   * CommercialMentionState's doc comment) — instruction #8/#9's own distinction. A bare
   * recommendation or availability check is real discourse but never counts as order-eligible by
   * itself. */
  active: boolean;
  decayFactors: ActiveProductDecayFactors;
}

const AVAILABILITY_OR_PRICE_QUESTION_RX = /موجود[ةه]?|متوفر[ةه]?|متاح[ةه]?|عندك(?:م)?|بكام|كام(?:\s*كده)?|سعر[ةه]?/i;

/**
 * I.B.3.1 instructions #6-#9 — per-identity commercial discourse state, computed fresh for the
 * window strictly before `beforeMessageIndex` (same contract as computeActiveProductCandidates,
 * which this function calls as its base candidate set and never re-derives). Every factor is
 * exposed on the result (instruction #7's "Expose factors for QA") rather than folded into one
 * opaque score.
 */
export function computeActiveProductStateV2(
  messages: NormalizedConversationMessageV32[],
  mentions: ProductMentionV2[],
  beforeMessageIndex: number
): ActiveProductStateV2[] {
  const candidates = computeActiveProductCandidates(messages, mentions, beforeMessageIndex);
  const rejectionSignals = extractRejectionSignals(messages.slice(0, beforeMessageIndex));
  const rejectedMessageIds = new Set(rejectionSignals.map((s) => s.messageId));
  const mentionById = new Map(mentions.map((m) => [m.mentionId, m] as const));
  const messageById = new Map(messages.map((m) => [m.id, m] as const));

  return candidates.map((candidate) => {
    const identityMentions = candidate.mentionIds.map((id) => mentionById.get(id)).filter((m): m is ProductMentionV2 => Boolean(m));
    const lastMention = mentionById.get(candidate.lastMentionId) ?? identityMentions[identityMentions.length - 1];

    const customerMentionsForIdentity = identityMentions.filter((m) => m.role === 'customer_request');
    // A genuine order verb (عايز/عاوز/محتاج/ممكن/هات/ابعت) was actually STRIPPED from the message —
    // reuses stripRequestPrefix (caseBasketEngine.ts) as-is, never re-derives what counts as an
    // order verb.
    const hadGenuineOrderVerb = customerMentionsForIdentity.some((m) => {
      const message = messageById.get(m.sourceMessageId);
      return message ? stripRequestPrefix(message.text).length < message.text.trim().length : false;
    });
    const hadAvailabilityOrPriceQuestion = customerMentionsForIdentity.some((m) => {
      const message = messageById.get(m.sourceMessageId);
      return message ? AVAILABILITY_OR_PRICE_QUESTION_RX.test(message.text) : false;
    });

    const wasEverRejected = identityMentions.some((m) => rejectedMessageIds.has(m.sourceMessageId));

    let lastCommercialAction: CommercialMentionState;
    if (hadGenuineOrderVerb) {
      lastCommercialAction = 'requested';
    } else if (customerMentionsForIdentity.length > 0 && hadAvailabilityOrPriceQuestion) {
      // Instruction #9's own example: "عندك انتينال؟" — a real customer engagement, but a QUESTION,
      // never itself a request. Only a LATER genuine order verb (a fresh mention, or the existing
      // I.B.3 quantity-linking path for a bare follow-up like "هات علبتين") ever upgrades this.
      lastCommercialAction = 'availability_only';
    } else if (customerMentionsForIdentity.length > 0) {
      // The customer named it in their own words with neither a recognized order verb nor a
      // recognized question marker (e.g. a plain reply naming the product). Treated as a request,
      // never silently downgraded to a bare recommendation — this is still the CUSTOMER's own
      // statement, not staff-only content.
      lastCommercialAction = 'requested';
    } else {
      // Every mention of this identity came from staff (an offer/recommendation) with no customer
      // engagement at all yet — instruction #8's own "ممكن Nexium أو Zurcal" example.
      lastCommercialAction = 'recommendation_only';
    }

    const topicShifted = candidates.some((other) => other.identityKey !== candidate.identityKey && other.lastMessageIndex > candidate.lastMessageIndex);

    return {
      identityKey: candidate.identityKey,
      canonicalProductId: candidate.identityKey.startsWith('text:') ? null : candidate.identityKey,
      lastMentionMessageId: candidate.lastMentionId,
      lastMentionMessageIndex: candidate.lastMessageIndex,
      lastCommercialAction,
      sourceSpeaker: lastMention?.role === 'customer_request' ? 'customer' : 'staff',
      active: lastCommercialAction === 'requested',
      decayFactors: {
        messageDistance: beforeMessageIndex - candidate.lastMessageIndex,
        topicShifted,
        explicitlyRejected: wasEverRejected,
      },
    };
  });
}

/** The single order-eligible candidate, when exactly one exists — never invented when zero or
 * multiple are order-eligible (mirrors every other "sole active candidate" gate in this codebase). */
export function soleActiveOrderCandidate(states: ActiveProductStateV2[]): ActiveProductStateV2 | null {
  const eligible = states.filter((s) => s.active);
  return eligible.length === 1 ? eligible[0] : null;
}
