// Phase I.B.3 — Conversation Entity Graph + Basket Reconstruction V2: shared contracts.
//
// ARCHITECTURE RULE (instruction #1): two SEPARATE layers, never one monolithic parser.
//   A. ConversationEntityGraphV2 (conversationEntityGraphV2.ts) — semantic FACTS and relationships
//      only. It never decides what the basket IS, only what was SAID and how confidently.
//   B. BasketReconstructionV2 (basketReconstructionV2.ts) — consumes the graph's nodes/edges to
//      produce an event-sourced basket. It never re-parses conversation text itself.
//
// REUSE RULE (explicit instruction): this phase consumes pharmacyProductResolverV2.ts,
// quantityIntelligenceV2.ts, referenceResolverV2.ts, and the safeForBasketLinking contract from
// I.B.2/I.B.2.1 AS-IS — nothing here re-derives product/quantity/reference resolution logic. Only
// two genuinely new capabilities are introduced (both scoped narrowly, documented in their own
// files): price intelligence (priceIntelligenceV1.ts) and action/intent classification
// (actionIntentClassifierV2.ts) — neither existed before this phase.
import type { BasketLinkingSafety } from '../quantityReference/quantityReferenceTypes';
import type { ActiveProductStateV2 } from './activeProductStateV2';

export type { BasketLinkingSafety };

// ---------------------------------------------------------------------------
// Graph nodes
// ---------------------------------------------------------------------------

export type ProductResolutionStatus = 'resolved' | 'ambiguous' | 'unresolved';

export interface ProductMentionNode {
  id: string;
  sourceMessageId: string;
  rawText: string;
  /** products.id when ProductResolverV2 safely selected exactly one candidate — never invented otherwise. */
  canonicalProductId: string | null;
  canonicalProductCode: string | null;
  canonicalName: string | null;
  resolutionStatus: ProductResolutionStatus;
  confidence: number;
  evidence: EvidenceRef[];
  /** Every distinct raw wording that resolved to this SAME identity (instruction #9) — a real ProductMentionV2 per wording, never collapsed into just the representative `rawText` above. */
  rawTexts: string[];
}

export interface QuantityNode {
  id: string;
  sourceMessageId: string;
  value: number;
  unit: string | null;
  semanticRole: string; // QuantitySemanticRole, kept as string to avoid a hard type-only import cycle
  /** 'replace' | 'increment' | 'decrement' | null — carried through so basketReconstructionV2.ts can find the exact correction value for an action without re-deriving it. */
  correctionKind: string | null;
  safeForBasketLinking: BasketLinkingSafety;
  confidence: number;
  evidence: EvidenceRef[];
}

export type PriceRole =
  | 'item_unit_price'
  | 'item_line_total'
  | 'order_total'
  | 'delivery_fee'
  | 'discount'
  | 'cashback'
  | 'unknown_price';

export interface PriceNode {
  id: string;
  sourceMessageId: string;
  value: number;
  currency: 'EGP';
  priceRole: PriceRole;
  confidence: number;
  evidence: EvidenceRef[];
}

export interface ReferenceNode {
  id: string;
  sourceMessageId: string;
  rawText: string;
  antecedentKind: 'product' | 'media' | 'unknown';
  candidateAntecedents: string[];
  selectedAntecedent: string | null;
  safeForBasketLinking: BasketLinkingSafety;
  confidence: number;
  evidence: EvidenceRef[];
}

export type ActionType =
  | 'request_product'
  | 'add'
  | 'remove'
  | 'set_quantity'
  | 'increment_quantity'
  | 'decrement_quantity'
  | 'substitute'
  | 'ask_price'
  | 'ask_availability'
  | 'confirm'
  | 'reject'
  | 'send_order'
  | 'cancel_order';

export interface ActionNode {
  id: string;
  sourceMessageId: string;
  actionType: ActionType;
  rawText: string;
  confidence: number;
  ruleIds: string[];
  evidence: EvidenceRef[];
}

export type IntentType =
  | 'purchase_intent'
  | 'availability_only'
  | 'recommendation_request'
  | 'information_only'
  | 'rejection'
  | 'fulfillment_intent';

export interface IntentNode {
  id: string;
  sourceMessageId: string;
  intentType: IntentType;
  confidence: number;
  evidence: EvidenceRef[];
}

export interface EvidenceRef {
  sourceMessageId: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Graph edges — instruction #3: every edge preserves source message ids, rule ids, confidence,
// safety. "No invisible inference" — an edge is only ever created when a concrete upstream fact
// (a QuantityMentionV2 link, a ReferenceMentionV2 resolution, an ActionNode's own target) exists;
// this file never adds an edge on a guess.
// ---------------------------------------------------------------------------

export type GraphEdgeType =
  | 'quantity_applies_to_product'
  | 'price_applies_to_product'
  | 'reference_points_to_product'
  | 'action_targets_product'
  | 'substitutes_product'
  | 'confirms_product'
  | 'rejects_product'
  | 'modifies_quantity_of'
  | 'derived_from_message';

export interface GraphEdge {
  edgeId: string;
  type: GraphEdgeType;
  fromNodeId: string;
  /** For `derived_from_message`, this is the message id itself (a node id everywhere else). */
  toNodeId: string;
  sourceMessageIds: string[];
  ruleIds: string[];
  confidence: number;
  safety: BasketLinkingSafety;
}

export interface ConversationEntityGraphV2 {
  caseId: string;
  productMentions: ProductMentionNode[];
  quantities: QuantityNode[];
  prices: PriceNode[];
  references: ReferenceNode[];
  actions: ActionNode[];
  intents: IntentNode[];
  edges: GraphEdge[];
  /** I.B.3.1 instructions #6/#7 — end-of-conversation Active Product State V2 snapshot: which
   * identities ended in which commercial discourse state (recommendation_only/availability_only/
   * requested/confirmed/rejected), with decay factors exposed for QA. Informational only — never
   * consulted by basketReconstructionV2.ts to decide a mutation (instruction #4's "no invisible
   * inference" still applies; Basket safety is driven entirely by edge `safety`, unchanged). */
  activeProductStates: ActiveProductStateV2[];
}

// ---------------------------------------------------------------------------
// Basket V2 — event-sourced, immutable-history model (instructions #5/#6/#7)
// ---------------------------------------------------------------------------

export type BasketEventType =
  | 'ITEM_ADDED'
  | 'ITEM_REMOVED'
  | 'QUANTITY_SET'
  | 'QUANTITY_INCREMENTED'
  | 'QUANTITY_DECREMENTED'
  | 'PRODUCT_SUBSTITUTED'
  | 'PRICE_ATTACHED'
  | 'ITEM_CONFIRMED'
  | 'ITEM_REJECTED'
  | 'BASKET_CONFIRMED'
  | 'BASKET_CANCELLED'
  | 'REVIEW_SIGNAL';

export interface BasketEventV2 {
  eventId: string;
  type: BasketEventType;
  /** Chronological order among this case's events — mirrors message order, never wall-clock time alone. */
  sequence: number;
  sourceMessageId: string;
  /** products.id — null for a REVIEW_SIGNAL/BASKET_CANCELLED event with no single safely-identified target. */
  targetProductId: string | null;
  previousState: unknown;
  nextState: unknown;
  confidence: number;
  /** The single gate this file actually branches on — see instruction #4. `safe` is the only value that may accompany a state-mutating event; every other event on a `review`/`unsafe` edge is a REVIEW_SIGNAL that changes nothing. */
  safeForBasketMutation: BasketLinkingSafety;
  ruleIds: string[];
  note: string;
}

export type ItemResolutionStatusV2 = 'proven' | 'partially_proven' | 'unknown';
export type ItemStateV2 = 'candidate' | 'active' | 'confirmed' | 'rejected' | 'removed' | 'substituted';
export type QuantityStatusV2 = 'known' | 'unknown';

export interface BasketItemV2 {
  itemId: string;
  canonicalProductId: string;
  canonicalProductCode: string | null;
  canonicalName: string | null;
  /** Every raw phrase that contributed to this item — never collapsed away, per instruction #5's "raw text only as evidence" principle. */
  rawMentions: string[];
  currentQuantity: number | null;
  quantityUnit: string | null;
  quantityStatus: QuantityStatusV2;
  unitPrice: number | null;
  lineTotal: number | null;
  itemState: ItemStateV2;
  resolutionStatus: ItemResolutionStatusV2;
  evidenceHistory: EvidenceRef[];
  unresolvedFlags: string[];
  /** Set only when this item exists BECAUSE a substitution replaced an earlier request — instruction #14: the original request is preserved, never erased. */
  substitutedFromProductId: string | null;
}

/** instruction #8 — an ambiguous/unresolved product mention that never became a real BasketItemV2. */
export interface UnresolvedItemCandidateV2 {
  sourceMessageId: string;
  rawText: string;
  reason: string;
}

export type BasketStatusV2 = 'draft' | 'awaiting_confirmation' | 'confirmed' | 'superseded' | 'cancelled';

/** instruction #24 — never one arbitrary score; every dimension stays inspectable. */
export interface BasketConfidenceV2 {
  productIdentityConfidence: number;
  quantityConfidence: number;
  mutationConfidence: number;
  completeness: number;
  ambiguityCount: number;
}

/** instruction #25. */
export type BasketCompletenessV2 = 'exact' | 'partial' | 'ambiguous' | 'insufficient';

export interface PendingReviewSignalV2 {
  sourceMessageId: string;
  reason: string;
  rawText: string;
  relatedProductId: string | null;
}

export interface CaseBasketV2 {
  caseId: string;
  basketId: string;
  version: number;
  status: BasketStatusV2;
  items: BasketItemV2[];
  unresolvedCandidates: UnresolvedItemCandidateV2[];
  createdAt: string;
  supersededAt: string | null;
  sourceMessageIds: string[];
  pendingReviewSignals: PendingReviewSignalV2[];
  confidence: BasketConfidenceV2;
  completeness: BasketCompletenessV2;
  /** Known order-level total, distinct from any single item's price — instruction #15/#16. Never derived as sum(qty*price) when any item's price role is ambiguous. */
  announcedOrderTotal: { value: number; evidenceComplete: boolean } | null;
}

export interface BasketReconstructionResultV2 {
  caseId: string;
  events: BasketEventV2[];
  /** Every version ever produced, oldest first — history is NEVER mutated once pushed (instruction #7). */
  basketVersions: CaseBasketV2[];
  currentBasket: CaseBasketV2;
}
