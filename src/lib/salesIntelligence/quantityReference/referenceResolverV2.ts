// Phase I.B.2 — Reference Resolution V2.
//
// Replaces (beside, per instruction #24 — whatsappSemanticSignalsV32.resolveReference() is left
// untouched) the old strategy, which the I.B.2 baseline audit found to literally BE the
// "nearest-preceding-staff-message-wins" anti-pattern this phase's instruction #10 explicitly
// forbids: it only ever considered staff messages as candidates, and its only "ambiguity" check
// was a flat 2-minute gap between the two nearest staff candidates — never whether the customer's
// own reference genuinely distinguishes between two still-live products (see the worked example in
// instruction #10: two staff "X موجود"/"Y موجود" messages minutes apart, then "هات منه اتنين" —
// the old code always picked Y; this module returns `ambiguous`, matching the spec exactly).
//
// This resolver ONLY selects among candidates instructions #9-#17 define — it never invents a
// candidate, never resolves outside the scoped case (see the case-boundary regression test), and
// requires a real score MARGIN over the runner-up before calling something `resolved`, not just
// "it's the most recent one" (recency is one scored factor among several, never decisive alone).
import type { NormalizedConversationMessageV32 } from '../../whatsappConversationUnderstandingV32';
import { contextWindowV32 } from '../../whatsappSemanticSignalsV32';
import type { ProductMentionV2, ReferenceMentionV2, ReferenceSubstitutionContext, ReferenceType } from './quantityReferenceTypes';
import type { ActiveProductCandidate } from './productMentionTracker';
import { computeActiveProductCandidates, NOT_AVAILABLE_RX } from './productMentionTracker';

// Script-aware boundary (JS's \b never matches next to Arabic — see pharmacyNormalization.ts's own
// comment on the same issue) so a bare "ده" doesn't also match inside "بعده"/"كده".
const NB = '(?<![\\p{L}\\p{N}])';
const NA = '(?![\\p{L}\\p{N}])';

const REFERENCE_VOCAB: Array<[RegExp, ReferenceType]> = [
  [new RegExp(`${NB}(?:نفس\\s*اللي\\s*فات|نفس\\s*الكمي[ةه]|نفس\\s*ده|نفسه|نفسها)${NA}`, 'iu'), 'previous_item_reference'],
  [new RegExp(`${NB}(?:التاني[ةه]?|الأول|الاول)${NA}`, 'iu'), 'ordinal'],
  [new RegExp(`${NB}(?:اللي\\s*فوق|اللي\\s*حضرتك\\s*قول[تي]?\\s*عليه|البديل\\s*ده)${NA}`, 'iu'), 'relative_reference'],
  [new RegExp(`${NB}(?:واحد\\s*كمان(?:\\s*منه)?|كمان\\s*واحد|كمان\\s*منه)${NA}`, 'iu'), 'repetition'],
  [new RegExp(`${NB}(?:منه|منها|زيه|زيها)${NA}`, 'iu'), 'pronoun'],
  [new RegExp(`${NB}(?:ده|دي|دول|الاتنين)${NA}`, 'iu'), 'demonstrative'],
];

export function detectReferenceMentions(
  message: NormalizedConversationMessageV32
): Array<{ rawText: string; referenceType: ReferenceType }> {
  const found: Array<{ rawText: string; referenceType: ReferenceType }> = [];
  for (const [rx, type] of REFERENCE_VOCAB) {
    const match = message.text.match(rx);
    if (match) {
      found.push({ rawText: match[0], referenceType: type });
      break; // one reference classification per message — the dominant phrase, never double-count
    }
  }
  return found;
}

interface ScoredCandidate {
  candidate: ActiveProductCandidate;
  score: number;
  factors: string[];
}

const RESOLVED_MARGIN_THRESHOLD = 0.2;
const RESOLVED_FLOOR = 0.2;

/** Very weak, tie-breaking-only signal (instruction #9: "form/gender may be weak supporting evidence, never decisive alone"). */
function genderHint(rawText: string, candidateText: string): { delta: number; factor: string | null } {
  const refIsFeminine = /دي$|ها$/.test(rawText.trim());
  const refIsMasculine = /ده$|منه$/.test(rawText.trim());
  if (!refIsFeminine && !refIsMasculine) return { delta: 0, factor: null };
  const candidateIsFeminine = /[ةه]$/.test(candidateText.trim());
  if (refIsFeminine && candidateIsFeminine) return { delta: 0.05, factor: 'weak_gender_agreement' };
  if (refIsMasculine && !candidateIsFeminine) return { delta: 0.05, factor: 'weak_gender_agreement' };
  return { delta: -0.05, factor: 'weak_gender_mismatch' };
}

function scoreCandidates(
  candidates: ActiveProductCandidate[],
  referenceIndex: number,
  rawText: string,
  mentionsByIdentity: Map<string, ProductMentionV2[]>
): ScoredCandidate[] {
  const mostRecentIndex = Math.max(...candidates.map((c) => c.lastMessageIndex));
  return candidates.map((candidate) => {
    const factors: string[] = [];
    const distance = referenceIndex - candidate.lastMessageIndex;
    const recencyScore = 1 / (1 + distance);
    factors.push(`recency_distance_${distance}`);

    // Recency is deliberately a MINORITY of the score — instruction #9/#16: "do not use time/
    // recency alone." A candidate one message more recent than another must never win on that
    // fact alone; it needs corroborating signal (reinforcement, being the sole/topical candidate).
    let score = recencyScore * 0.3;

    if (candidate.lastMessageIndex === mostRecentIndex) {
      score += 0.1;
      factors.push('most_recently_mentioned');
    }
    if (candidate.lastMentionWasStaffOffer) {
      score += 0.08;
      factors.push('staff_offer_continuation');
    } else {
      score += 0.03;
      factors.push('customer_self_stated');
    }
    score -= 0.15 * (candidates.length - 1);
    if (candidates.length > 1) factors.push(`competing_candidate_count_${candidates.length - 1}`);

    const identityMentions = mentionsByIdentity.get(candidate.identityKey) ?? [];
    // Reinforcement: the SAME identity mentioned more than once close to the reference (e.g. the
    // customer names it, then staff explicitly re-confirms it) is real corroborating evidence a
    // single distant mention never has — distinct from raw recency of the LAST mention alone.
    const reinforcementBonus = Math.min(0.15, 0.05 * identityMentions.length);
    if (identityMentions.length > 1) factors.push(`reinforced_by_${identityMentions.length}_mentions`);
    score += reinforcementBonus;

    const lastMention = identityMentions.slice(-1)[0];
    if (lastMention) {
      const hint = genderHint(rawText, lastMention.rawText);
      if (hint.factor) {
        score += hint.delta;
        factors.push(hint.factor);
      }
    }

    return { candidate, score: Math.max(0, Math.min(1, score)), factors };
  });
}

/** Instruction #14 — the fact this reference resolves to a staff substitute, without erasing the original ask. */
function findSubstitutionContext(
  messages: NormalizedConversationMessageV32[],
  mentions: ProductMentionV2[],
  referenceIndex: number,
  selectedIdentityKey: string | null
): ReferenceSubstitutionContext | null {
  if (!selectedIdentityKey) return null;
  const { before } = contextWindowV32(messages, referenceIndex, 4, 0);
  const notAvailableMsg = before.find((m) => m.role === 'staff' && NOT_AVAILABLE_RX.test(m.text));
  if (!notAvailableMsg) return null;
  const notAvailableIndex = messages.findIndex((m) => m.id === notAvailableMsg.id);
  // The substitute itself must have been mentioned AFTER the "not available" message — otherwise
  // there is nothing to call a substitution.
  // >= (not >): the staff message often states both facts at once ("X مش موجود بس فيه Y"), so the
  // substitute mention's messageIndex equals notAvailableIndex, not strictly later.
  const substituteMention = mentions.find(
    (m) => m.identityKey === selectedIdentityKey && m.messageIndex >= notAvailableIndex && m.messageIndex < referenceIndex
  );
  if (!substituteMention) return null;
  const originalMention = mentions
    .filter((m) => m.messageIndex < notAvailableIndex && m.identityKey !== selectedIdentityKey)
    .sort((a, b) => b.messageIndex - a.messageIndex)[0];
  return originalMention ? { originalProductMentionId: originalMention.mentionId } : null;
}

/**
 * Resolves ONE reference mention found in `messages[referenceIndex]`. `messages` and `mentions`
 * MUST already be scoped to a single ConversationCase (see instruction #15) — this function adds a
 * defensive filter (mentions not present in `messages` are dropped) so a caller mistake can never
 * silently cross a case boundary; see the regression test for exactly this scenario.
 */
export function resolveReferenceV2(
  messages: NormalizedConversationMessageV32[],
  referenceIndex: number,
  mentions: ProductMentionV2[],
  rawText: string,
  referenceType: ReferenceType
): ReferenceMentionV2 {
  const messageIds = new Set(messages.map((m) => m.id));
  const scopedMentions = mentions.filter((m) => messageIds.has(m.sourceMessageId));

  const candidates = computeActiveProductCandidates(messages, scopedMentions, referenceIndex);
  const referenceId = `ref:${messages[referenceIndex].id}`;

  const base: Omit<
    ReferenceMentionV2,
    'resolutionStatus' | 'selectedAntecedentId' | 'confidence' | 'confidenceFactors' | 'ambiguityReasons' | 'referenceDistance' | 'substitutionContext'
  > = {
    referenceId,
    rawText,
    referenceType,
    sourceMessageId: messages[referenceIndex].id,
    candidateAntecedentIds: candidates.map((c) => c.identityKey),
  };

  if (candidates.length === 0) {
    return {
      ...base,
      resolutionStatus: 'unresolved',
      selectedAntecedentId: null,
      confidence: 0,
      confidenceFactors: [],
      ambiguityReasons: ['no_active_product_candidate'],
      referenceDistance: null,
      substitutionContext: null,
    };
  }

  const mentionsByIdentity = new Map<string, ProductMentionV2[]>();
  scopedMentions.forEach((m) => {
    const bucket = mentionsByIdentity.get(m.identityKey);
    if (bucket) bucket.push(m);
    else mentionsByIdentity.set(m.identityKey, [m]);
  });

  const scored = scoreCandidates(candidates, referenceIndex, rawText, mentionsByIdentity).sort((a, b) => b.score - a.score);
  const top = scored[0];
  const second = scored[1];
  const margin = second ? top.score - second.score : top.score;

  if (margin >= RESOLVED_MARGIN_THRESHOLD && top.score >= RESOLVED_FLOOR) {
    const substitutionContext = findSubstitutionContext(messages, scopedMentions, referenceIndex, top.candidate.identityKey);
    return {
      ...base,
      resolutionStatus: 'resolved',
      selectedAntecedentId: top.candidate.identityKey,
      confidence: top.score,
      confidenceFactors: top.factors,
      ambiguityReasons: [],
      referenceDistance: referenceIndex - top.candidate.lastMessageIndex,
      substitutionContext,
    };
  }

  if (candidates.length === 1) {
    return {
      ...base,
      resolutionStatus: 'unresolved',
      selectedAntecedentId: null,
      confidence: top.score,
      confidenceFactors: top.factors,
      ambiguityReasons: ['sole_candidate_below_confidence_floor'],
      referenceDistance: null,
      substitutionContext: null,
    };
  }

  return {
    ...base,
    resolutionStatus: 'ambiguous',
    selectedAntecedentId: null,
    confidence: top.score,
    confidenceFactors: top.factors,
    ambiguityReasons: ['multiple_candidates_no_clear_margin', `competing_candidate_count_${candidates.length}`],
    referenceDistance: null,
    substitutionContext: null,
  };
}

/** Convenience: scans every meaningful message in a scoped case and resolves each reference found. */
export function extractReferenceMentionsV2(
  messages: NormalizedConversationMessageV32[],
  mentions: ProductMentionV2[]
): ReferenceMentionV2[] {
  const results: ReferenceMentionV2[] = [];
  messages.forEach((message, index) => {
    if (!message.isMeaningful) return;
    const found = detectReferenceMentions(message);
    found.forEach(({ rawText, referenceType }) => {
      results.push(resolveReferenceV2(messages, index, mentions, rawText, referenceType));
    });
  });
  return results;
}
