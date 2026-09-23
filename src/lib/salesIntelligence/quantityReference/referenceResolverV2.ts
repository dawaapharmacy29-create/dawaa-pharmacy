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
import type {
  BasketLinkingSafety,
  ProductMentionV2,
  ReferenceCandidateScore,
  ReferenceMentionV2,
  ReferenceSubstitutionContext,
  ReferenceType,
} from './quantityReferenceTypes';
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

// I.B.2.1 fix: "التاني"/"الأول" preceded by a non-product noun ("الفرع التاني", "المندوب التاني")
// is talking about a BRANCH or a DELIVERY PERSON, never a product — a real Dawaa example
// ("هجيب مندوب من الفرع التاني") was wrongly detected as a product ordinal reference.
const NON_PRODUCT_ORDINAL_CONTEXT_RX = /(?:الفرع|المندوب|الموظف)\s*$/;

export function detectReferenceMentions(
  message: NormalizedConversationMessageV32
): Array<{ rawText: string; referenceType: ReferenceType; sourceOffsetStart: number; sourceOffsetEnd: number }> {
  const found: Array<{ rawText: string; referenceType: ReferenceType; sourceOffsetStart: number; sourceOffsetEnd: number }> = [];
  for (const [rx, type] of REFERENCE_VOCAB) {
    const match = message.text.match(rx);
    if (match && match.index !== undefined) {
      if (type === 'ordinal' && NON_PRODUCT_ORDINAL_CONTEXT_RX.test(message.text.slice(0, match.index))) continue;
      found.push({ rawText: match[0], referenceType: type, sourceOffsetStart: match.index, sourceOffsetEnd: match.index + match[0].length });
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

// Unchanged from I.B.2's own tuned values — `resolutionStatus` stays the system's honest best read
// (still used for QA/audit/reporting), and this bar already correctly separates the CRITICAL
// ambiguous worked example (instruction #10) from a genuinely reinforced, unambiguous antecedent.
// I.B.2.1 instruction #4's "precision first for Basket eligibility" mandate is implemented as a
// SEPARATE, stricter gate below (SAFE_MARGIN_THRESHOLD/SAFE_CONFIDENCE_FLOOR feeding
// computeReferenceSafety()) rather than by blunting `resolved` itself — instruction #18 explicitly
// asked for a safe/review/unsafe eligibility contract for exactly this reason, and blindly raising
// this threshold would have degraded genuinely resolvable cases (see the I.B.2.1 report's own
// before/after) without making Basket-linking safety any more measurable than the dedicated gate
// below already does.
const RESOLVED_MARGIN_THRESHOLD = 0.2;
const RESOLVED_FLOOR = 0.2;
// I.B.2.1 instruction #4/#18 — the REAL precision-first bar: only a resolution clearing THIS much
// stricter margin/confidence may ever be marked `safe` for automatic Basket V2 consumption. Most
// `resolved` outputs will land in `review`, not `safe` — see computeReferenceSafety().
const SAFE_MARGIN_THRESHOLD = 0.4;
const SAFE_CONFIDENCE_FLOOR = 0.45;

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

/**
 * I.B.2.1 instruction #7 — "Ordinal resolution may safely prefer the second enumerated option ONLY
 * when the ordered option list is structurally clear. Otherwise ambiguous." Structural clarity
 * means: every currently active candidate's mentions trace back to exactly ONE single-message
 * enumeration group (e.g. staff "ممكن زوركال أو نيكسيوم" in one message), and that group has a
 * member at the requested ordinal position. If candidates come from different messages, or more
 * than one enumeration group is in play, or there is no group at all, this returns null and the
 * caller falls through to normal scored resolution (which will most likely land on `ambiguous`).
 */
function resolveOrdinalFromEnumeration(
  rawText: string,
  candidates: ActiveProductCandidate[],
  mentionsByIdentity: Map<string, ProductMentionV2[]>
): { identityKey: string; groupId: string } | null {
  const text = rawText.trim();
  let targetIndex: number | null = null;
  if (/^(?:التاني[ةه]?)$/.test(text)) targetIndex = 1;
  else if (/^(?:الأول|الاول)$/.test(text)) targetIndex = 0;
  if (targetIndex === null) return null;

  const groupIds = new Set<string>();
  for (const candidate of candidates) {
    for (const mention of mentionsByIdentity.get(candidate.identityKey) ?? []) {
      if (mention.enumerationGroupId) groupIds.add(mention.enumerationGroupId);
    }
  }
  if (groupIds.size !== 1) return null;
  const [groupId] = groupIds;

  for (const candidate of candidates) {
    const match = (mentionsByIdentity.get(candidate.identityKey) ?? []).find(
      (m) => m.enumerationGroupId === groupId && m.enumerationIndex === targetIndex
    );
    if (match) return { identityKey: candidate.identityKey, groupId };
  }
  return null;
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
 * I.B.2.1 instruction #18 — see BasketLinkingSafety's own doc comment in quantityReferenceTypes.ts.
 * `safe` requires clearing a STRICTER bar than plain `resolved` (SAFE_MARGIN_THRESHOLD/
 * SAFE_CONFIDENCE_FLOOR, both above RESOLVED_MARGIN_THRESHOLD/RESOLVED_FLOOR) — a resolution that
 * only just cleared the resolve bar is real but still `review`-grade, never auto-consumed.
 */
function computeReferenceSafety(mention: Pick<ReferenceMentionV2, 'resolutionStatus' | 'confidence' | 'scoreMargin'>): BasketLinkingSafety {
  if (mention.resolutionStatus !== 'resolved') return 'unsafe';
  if (mention.confidence >= SAFE_CONFIDENCE_FLOOR && (mention.scoreMargin ?? 0) >= SAFE_MARGIN_THRESHOLD) return 'safe';
  return 'review';
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
  referenceType: ReferenceType,
  referenceOffsetStart: number | null = null,
  referenceOffsetEnd: number | null = null
): ReferenceMentionV2 {
  const messageIds = new Set(messages.map((m) => m.id));
  // I.B.2.1 instruction #15 — directionality: only mentions strictly BEFORE the reference message
  // may ever be candidates. computeActiveProductCandidates already filters by messageIndex, but a
  // mention sharing this message's own id (e.g. a same-message product name preceding the pronoun)
  // is legitimate; one from a LATER message never is — enforced structurally since `mentions` here
  // is filtered to `messageIds` (this case's own messages) and candidate computation itself only
  // ever looks at `messageIndex < referenceIndex` (see productMentionTracker.ts).
  const scopedMentions = mentions.filter((m) => messageIds.has(m.sourceMessageId));

  const priorCandidates = computeActiveProductCandidates(messages, scopedMentions, referenceIndex);
  const referenceId = `ref:${messages[referenceIndex].id}`;

  // Phase I.B.4 — same-message reference resolution. Product mentions and reference mentions use
  // ORIGINAL message.text character offsets so ordering is structural, not inferred from normalized
  // strings. Only canonical-resolved product spans ending BEFORE the reference may participate.
  const sameMessagePreceding = referenceOffsetStart == null
    ? []
    : scopedMentions.filter((m) =>
        m.sourceMessageId === messages[referenceIndex].id &&
        m.validity === 'canonical_resolved' &&
        m.role !== 'staff_availability' &&
        m.resolvedProductId != null &&
        m.sourceOffsetStart != null &&
        m.sourceOffsetEnd != null &&
        m.sourceOffsetEnd <= referenceOffsetStart
      );

  const sameByIdentity = new Map<string, ProductMentionV2[]>();
  for (const mention of sameMessagePreceding) {
    const bucket = sameByIdentity.get(mention.identityKey);
    if (bucket) bucket.push(mention);
    else sameByIdentity.set(mention.identityKey, [mention]);
  }
  const sameMessageCandidates: ActiveProductCandidate[] = Array.from(sameByIdentity.entries()).map(([identityKey, bucket]) => {
    const ordered = bucket.slice().sort((a, b) => (a.sourceOffsetStart ?? 0) - (b.sourceOffsetStart ?? 0));
    const last = ordered[ordered.length - 1];
    return {
      identityKey,
      mentionIds: ordered.map((m) => m.mentionId),
      lastMentionId: last.mentionId,
      lastMessageIndex: referenceIndex,
      lastMentionWasStaffOffer: last.role === 'staff_offer',
    };
  });

  // Explicit same-message antecedents define the local discourse window. Multiple local identities
  // are intentionally ambiguous; future mentions are excluded by the offset gate above.
  const candidates = sameMessageCandidates.length > 0 ? sameMessageCandidates : priorCandidates;

  const mentionsByIdentity = new Map<string, ProductMentionV2[]>();
  scopedMentions.forEach((m) => {
    const bucket = mentionsByIdentity.get(m.identityKey);
    if (bucket) bucket.push(m);
    else mentionsByIdentity.set(m.identityKey, [m]);
  });

  function build(
    fields: Pick<
      ReferenceMentionV2,
      'resolutionStatus' | 'selectedAntecedentId' | 'confidence' | 'confidenceFactors' | 'ambiguityReasons' | 'referenceDistance' | 'substitutionContext' | 'scoreMargin'
    >,
    candidateScores: ReferenceCandidateScore[]
  ): ReferenceMentionV2 {
    return {
      referenceId,
      rawText,
      referenceType,
      sourceMessageId: messages[referenceIndex].id,
      sourceOffsetStart: referenceOffsetStart,
      sourceOffsetEnd: referenceOffsetEnd,
      candidateAntecedentIds: candidates.map((c) => c.identityKey),
      candidateScores,
      ...fields,
      safeForBasketLinking: computeReferenceSafety(fields),
    };
  }

  // Structural same-message path. Exactly one canonical product before the reference is strong
  // local evidence. Two or more are ambiguous — never "nearest mention wins" inside a message.
  if (sameMessageCandidates.length === 1) {
    const winner = sameMessageCandidates[0];
    const candidateScores: ReferenceCandidateScore[] = [{
      identityKey: winner.identityKey,
      score: 0.95,
      factors: ['same_message_preceding_canonical_product', 'structural_offset_ordering'],
    }];
    return build(
      {
        resolutionStatus: 'resolved',
        selectedAntecedentId: winner.identityKey,
        confidence: 0.95,
        confidenceFactors: ['same_message_preceding_canonical_product', 'structural_offset_ordering'],
        ambiguityReasons: [],
        referenceDistance: 0,
        substitutionContext: null,
        scoreMargin: 0.95,
      },
      candidateScores
    );
  }

  if (sameMessageCandidates.length > 1) {
    const candidateScores: ReferenceCandidateScore[] = sameMessageCandidates.map((c) => ({
      identityKey: c.identityKey,
      score: 0.5,
      factors: ['same_message_preceding_canonical_product', 'competing_same_message_candidate'],
    }));
    return build(
      {
        resolutionStatus: 'ambiguous',
        selectedAntecedentId: null,
        confidence: 0.5,
        confidenceFactors: ['multiple_same_message_preceding_products'],
        ambiguityReasons: ['multiple_same_message_preceding_products', `competing_candidate_count_${sameMessageCandidates.length}`],
        referenceDistance: null,
        substitutionContext: null,
        scoreMargin: 0,
      },
      candidateScores
    );
  }

  if (candidates.length === 0) {
    return build(
      {
        resolutionStatus: 'unresolved',
        selectedAntecedentId: null,
        confidence: 0,
        confidenceFactors: [],
        ambiguityReasons: ['no_active_product_candidate'],
        referenceDistance: null,
        substitutionContext: null,
        scoreMargin: null,
      },
      []
    );
  }

  // I.B.2.1 instruction #7 — structural enumeration override, checked BEFORE generic scoring, but
  // only for ordinal references ("التاني"/"الأول"). Never applied to any other reference type.
  if (referenceType === 'ordinal') {
    const enumerationMatch = resolveOrdinalFromEnumeration(rawText, candidates, mentionsByIdentity);
    if (enumerationMatch) {
      const substitutionContext = findSubstitutionContext(messages, scopedMentions, referenceIndex, enumerationMatch.identityKey);
      const winner = candidates.find((c) => c.identityKey === enumerationMatch.identityKey)!;
      const candidateScores: ReferenceCandidateScore[] = candidates.map((c) => ({
        identityKey: c.identityKey,
        score: c.identityKey === enumerationMatch.identityKey ? 0.9 : 0,
        factors: c.identityKey === enumerationMatch.identityKey ? ['structural_enumeration_match'] : ['not_in_matched_enumeration_position'],
      }));
      return build(
        {
          resolutionStatus: 'resolved',
          selectedAntecedentId: enumerationMatch.identityKey,
          confidence: 0.9,
          confidenceFactors: ['structural_enumeration_match', `enumeration_group_${enumerationMatch.groupId}`],
          ambiguityReasons: [],
          referenceDistance: referenceIndex - winner.lastMessageIndex,
          substitutionContext,
          scoreMargin: 0.9,
        },
        candidateScores
      );
    }
    // No structural evidence found — instruction #7: "Otherwise ambiguous." Falls through to the
    // normal scored path below, which (with >=2 competing candidates and no special-cased margin)
    // will land on `ambiguous` rather than guessing an ordinal position.
  }

  const scored = scoreCandidates(candidates, referenceIndex, rawText, mentionsByIdentity).sort((a, b) => b.score - a.score);
  const candidateScores: ReferenceCandidateScore[] = scored.map((s) => ({ identityKey: s.candidate.identityKey, score: s.score, factors: s.factors }));
  const top = scored[0];
  const second = scored[1];
  const margin = second ? top.score - second.score : top.score;

  if (margin >= RESOLVED_MARGIN_THRESHOLD && top.score >= RESOLVED_FLOOR) {
    const substitutionContext = findSubstitutionContext(messages, scopedMentions, referenceIndex, top.candidate.identityKey);
    return build(
      {
        resolutionStatus: 'resolved',
        selectedAntecedentId: top.candidate.identityKey,
        confidence: top.score,
        confidenceFactors: top.factors,
        ambiguityReasons: [],
        referenceDistance: referenceIndex - top.candidate.lastMessageIndex,
        substitutionContext,
        scoreMargin: margin,
      },
      candidateScores
    );
  }

  if (candidates.length === 1) {
    return build(
      {
        resolutionStatus: 'unresolved',
        selectedAntecedentId: null,
        confidence: top.score,
        confidenceFactors: top.factors,
        ambiguityReasons: ['sole_candidate_below_confidence_floor'],
        referenceDistance: null,
        substitutionContext: null,
        scoreMargin: margin,
      },
      candidateScores
    );
  }

  return build(
    {
      resolutionStatus: 'ambiguous',
      selectedAntecedentId: null,
      confidence: top.score,
      confidenceFactors: top.factors,
      ambiguityReasons: ['multiple_candidates_no_clear_margin', `competing_candidate_count_${candidates.length}`],
      referenceDistance: null,
      substitutionContext: null,
      scoreMargin: margin,
    },
    candidateScores
  );
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
    found.forEach(({ rawText, referenceType, sourceOffsetStart, sourceOffsetEnd }) => {
      results.push(resolveReferenceV2(messages, index, mentions, rawText, referenceType, sourceOffsetStart, sourceOffsetEnd));
    });
  });
  return results;
}
