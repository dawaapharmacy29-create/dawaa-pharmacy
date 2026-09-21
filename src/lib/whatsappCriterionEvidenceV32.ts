// V32 Phase B — shared Criterion Evidence Contract infrastructure.
// Every per-criterion V32 engine implements CriterionEvidenceContractV32 against this
// shape. Nothing here scores a conversation by itself; each criterion module owns its
// own rule-based scoreBands. Additive only — no existing engine imports this file.
import type { ConversationInteractionV32, ConversationUnderstandingV32 } from './whatsappConversationUnderstandingV32';

export type EvidenceStatus =
  | 'proven'
  | 'partially_proven'
  | 'missing'
  | 'contradicted'
  | 'not_applicable'
  | 'unknown';

export type EvidenceSource = 'conversation' | 'order' | 'invoice' | 'customer_profile' | 'system_metadata';

/** A minimal, optional trusted external context. Nothing here is fetched by V32 itself in this phase — tests/callers supply it. */
export interface TrustedOrderContextV32 {
  deliveryMethod?: 'delivery' | 'pickup' | null;
  item?: string | null;
  quantity?: string | null;
  phone?: string | null;
  address?: string | null;
  area?: string | null;
  price?: number | null;
  deliveryFee?: number | null;
  paymentMethod?: string | null;
  deliveryTiming?: string | null;
}

export interface CriterionEvaluationInputV32 {
  understanding: ConversationUnderstandingV32;
  /** Restrict evaluation to one segmented interaction; omit to evaluate the whole conversation. */
  interaction?: ConversationInteractionV32 | null;
  order?: TrustedOrderContextV32 | null;
}

/** A single objective statement grounded in evidence. `fact` must never contain judgment language. */
export interface CriterionFindingV32 {
  key: string;
  status: EvidenceStatus;
  fact: string;
  /** Explicitly separated from `fact` — the reviewer can see which parts are read (fact) vs. concluded (interpretation). */
  interpretation: string | null;
  source: EvidenceSource;
  evidenceMessageIds: string[];
}

export interface ConfidenceFactorsV32 {
  evidenceCompleteness: number; // 0-1: how much of the required evidence set was found at all (proven/missing/contradicted vs unknown)
  evidenceClarity: number; // 0-1: how unambiguous the found evidence is
  contradictions: number; // 0-1, 1 = no contradictions found
  sourceReliability: number; // 0-1: order/invoice evidence scores higher than a conversation-text regex match
}

export interface CriterionEvidenceResultV32 {
  criterionKey: string;
  version: string;
  maxPoints: number;
  applicable: boolean;
  applicabilityReason: string;
  findings: CriterionFindingV32[];
  positiveEvidenceMessageIds: string[];
  negativeEvidenceMessageIds: string[];
  contradictionMessageIds: string[];
  scoreBand: string | null;
  pointsEarned: number | null;
  scoreReasoning: string;
  confidence: number;
  confidenceFactors: ConfidenceFactorsV32;
  needsHumanReview: boolean;
  humanReviewReasons: string[];
}

export interface CriterionEvidenceContractV32 {
  criterionKey: string;
  version: string;
  maxPoints: number;
  evaluate(input: CriterionEvaluationInputV32): CriterionEvidenceResultV32;
}

export function computeConfidenceV32(factors: ConfidenceFactorsV32): number {
  const weighted =
    factors.evidenceCompleteness * 0.35 +
    factors.evidenceClarity * 0.25 +
    factors.contradictions * 0.2 +
    factors.sourceReliability * 0.2;
  return Math.round(Math.max(0, Math.min(1, weighted)) * 100) / 100;
}

/** Convenience for building a not-applicable result without repeating the boilerplate in every criterion module. */
export function notApplicableResultV32(
  criterionKey: string,
  version: string,
  maxPoints: number,
  reason: string
): CriterionEvidenceResultV32 {
  return {
    criterionKey,
    version,
    maxPoints,
    applicable: false,
    applicabilityReason: reason,
    findings: [],
    positiveEvidenceMessageIds: [],
    negativeEvidenceMessageIds: [],
    contradictionMessageIds: [],
    scoreBand: null,
    pointsEarned: null,
    scoreReasoning: reason,
    confidence: 1,
    confidenceFactors: { evidenceCompleteness: 1, evidenceClarity: 1, contradictions: 1, sourceReliability: 1 },
    needsHumanReview: false,
    humanReviewReasons: [],
  };
}

/** Messages in scope for a criterion evaluation: the given interaction if provided, else the whole conversation. */
export function messagesInScopeV32(input: CriterionEvaluationInputV32) {
  if (input.interaction) {
    const ids = new Set(input.interaction.messageIds);
    return input.understanding.messages.filter((m) => ids.has(m.id));
  }
  return input.understanding.messages;
}
