// Phase I.B.2 — Quantity Intelligence V2 + Reference Resolution V2: shared contracts.
//
// Built BESIDE whatsappSemanticSignalsV32.ts's extractQuantitySignals()/resolveReference() and
// caseBasketEngine.ts (per instruction #24) — neither is modified or replaced by this phase. See
// the module header of quantityIntelligenceV2.ts / referenceResolverV2.ts for the baseline audit
// that motivated every field below.
//
// FACT / INFERENCE discipline (same rule as the rest of this engine suite, see salesIntelligence/
// types.ts's own header): a mention's `rawText` is a fact; every other field is an interpretation
// layered on top, and every interpretation carries the rule(s) that produced it plus, where the
// interpretation could be wrong, named ambiguity reasons — never a silent guess.

// ---------------------------------------------------------------------------
// Product mentions — the lightweight, shared prerequisite both engines below consume as input
// (the I.B.2 spec assumes "ProductMention candidates" already exist; I.B.1 scoped only to
// resolving an already-isolated phrase, never to finding phrases inside a live conversation, so
// this phase builds that missing layer too — see productMentionTracker.ts).
// ---------------------------------------------------------------------------

export type ProductMentionRole = 'customer_request' | 'staff_offer' | 'staff_availability' | 'other';

/**
 * I.B.3.1 instruction #5 — explicit semantic validity for a ProductMention candidate. Only
 * `canonical_resolved` and `unresolved_but_product_like` may ever seed an active-product candidate
 * (see productMentionTracker.ts's computeActiveProductCandidates, which filters on this field) —
 * `non_product` must never enter product discourse (this is the earliest-layer fix for the
 * "phantom active candidate" bug: a customer availability QUESTION about something already under
 * discussion, e.g. "موجود عندكم الغسول ده", was previously indistinguishable from a fresh product
 * name). `ambiguous` mirrors ProductResolutionResult.ambiguous — a real, catalog-plausible mention
 * whose exact identity could not be safely narrowed to one product.
 */
export type MentionValidity = 'canonical_resolved' | 'unresolved_but_product_like' | 'non_product' | 'ambiguous';

export interface ProductMentionV2 {
  mentionId: string;
  sourceMessageId: string;
  /** The text span taken to be the product name/reference — a fact, never normalized away. */
  rawText: string;
  role: ProductMentionRole;
  /** Set only when a PharmacyProductIndex was supplied and resolution found a safe candidate — see resolveProductMention(). Never invented when resolution is ambiguous/unresolved. */
  resolvedProductId: string | null;
  /** The identity bucket this mention belongs to for active-candidate tracking: resolvedProductId when available, else a normalized-text key. Never used as a claim of catalog identity by itself. Instruction #17 (I.B.2.1): when a PharmacyProductIndex is supplied, two mentions worded differently (e.g. "انتينال" / "Antinal") that resolve to the SAME product_code naturally share this key already — no separate merge step needed. */
  identityKey: string;
  messageIndex: number;
  timestamp: string;
  /** I.B.2.1 instruction #7 — set only when this mention was one member of an explicit, single-message "X أو Y" enumerated list (e.g. staff "ممكن زوركال أو نيكسيوم"). Lets referenceResolverV2 safely resolve "التاني"/"الأول" to a specific list position ONLY when the list structure is this unambiguous — never inferred across separate messages. */
  enumerationGroupId?: string;
  enumerationIndex?: number;
  /** I.B.3.1 instruction #5 — see MentionValidity's own doc comment. Defaults conceptually to
   * 'unresolved_but_product_like' for any mention built before this field existed (every producer
   * in productMentionTracker.ts now sets it explicitly). */
  validity: MentionValidity;
  /** I.B.3.1 instruction #13/#14 — character offsets of this mention's own `rawText` within its
   * immediate parent text (the message's own request/offer text before filler-word stripping for a
   * single, unsegmented mention; the pre-segmentation candidate text for one piece of a
   * multi-product message), preserved so a later phase can reason about same-message
   * ordering/overlap without re-deriving span positions from scratch. Null when `rawText` could not
   * be located as a literal substring there (never fabricated). */
  sourceOffsetStart: number | null;
  sourceOffsetEnd: number | null;
}

// ---------------------------------------------------------------------------
// Quantity Intelligence V2
// ---------------------------------------------------------------------------

/**
 * CRITICAL distinction (see instruction #2's worked examples — "Zurcal 40" is a strength, not an
 * order quantity; "شريط 10 أقراص" describes the pack's own contents, not what the customer is
 * asking for). No extraction rule in quantityIntelligenceV2.ts may assign 'order_quantity' to a
 * number unless that number's role is positively defensible — see NEVER_DEFAULT_TO_ORDER_QUANTITY
 * in that file.
 */
export type QuantitySemanticRole =
  | 'order_quantity'
  | 'pack_size'
  | 'strength'
  | 'dose'
  | 'frequency'
  | 'duration'
  | 'unknown';

export type QuantityCorrectionKind = 'replace' | 'increment' | 'decrement';

/**
 * I.B.2.1 instruction #18 — the explicit eligibility contract Basket V2 (I.B.3) must read rather
 * than re-deriving its own judgment call from raw confidence numbers. Defined HERE, once, so I.B.3
 * never has to infer it: `safe` may be consumed automatically; `review` was detected but a human
 * should confirm before it mutates a Basket; `unsafe` must NEVER automatically mutate a Basket.
 * Precision-first (per I.B.2.1's own objective): the bar for `safe` is deliberately high, and nothing
 * in this phase widens it merely to raise a recall number — see computeQuantitySafety()/
 * computeReferenceSafety() for the exact, documented rules.
 */
export type BasketLinkingSafety = 'safe' | 'review' | 'unsafe';

export interface QuantityMentionV2 {
  mentionId: string;
  rawText: string;
  numericValue: number;
  /** The unit word exactly as typed/said (e.g. "علبتين", "شريط", "مجم") — a fact, never canonicalized away. */
  unit: string | null;
  /** Canonical unit token (e.g. 'box', 'strip', 'tablet', 'mg') — an interpretation of `unit`, kept separate. */
  normalizedUnit: string | null;
  semanticRole: QuantitySemanticRole;
  linkedProductMentionId: string | null;
  sourceMessageId: string;
  confidence: number;
  /** Named, inspectable factors behind `confidence` — see instruction #22. Never a free-floating number alone. */
  confidenceFactors: string[];
  ruleIds: string[];
  ambiguityReasons: string[];
  /** Set only for a زود/شيل/خليهم-style correction of an EARLIER quantity — see instruction #5. */
  correctionKind: QuantityCorrectionKind | null;
  /** The prior QuantityMentionV2 this one supersedes, when correctionKind is set and a safe, unambiguous target was found. */
  correctionOfMentionId: string | null;
  /** I.B.2.1 instruction #18 — see BasketLinkingSafety's own doc comment. Computed by computeQuantitySafety() in quantityIntelligenceV2.ts; I.B.3 reads this, never re-derives it. */
  safeForBasketLinking: BasketLinkingSafety;
}

// ---------------------------------------------------------------------------
// Reference Resolution V2
// ---------------------------------------------------------------------------

export type ReferenceType =
  | 'pronoun'
  | 'demonstrative'
  | 'ordinal'
  | 'repetition'
  | 'relative_reference'
  | 'previous_item_reference';

export type ReferenceResolutionStatus = 'resolved' | 'ambiguous' | 'unresolved';

/**
 * Populated only when the reference follows a detected staff "not available, but here's X"
 * substitution pattern shortly before it (see findSubstitutionContext() in referenceResolverV2.ts).
 * The original request is a FACT that must never be erased once a substitute is offered/resolved
 * — see instruction #14.
 */
export interface ReferenceSubstitutionContext {
  originalProductMentionId: string;
}

/** I.B.2.1 instruction #6 — one candidate's full scored evidence, not just its identity. Exposed so a human (or a future Basket auditor) can see WHY a candidate won or lost, never just the final answer. */
export interface ReferenceCandidateScore {
  identityKey: string;
  score: number;
  factors: string[];
}

export interface ReferenceMentionV2 {
  referenceId: string;
  rawText: string;
  referenceType: ReferenceType;
  sourceMessageId: string;
  /** Every distinct active-product identity considered, even when unresolved/ambiguous — for auditability, never trimmed to just the winner. */
  candidateAntecedentIds: string[];
  /** I.B.2.1 instruction #6 — full scored breakdown for every candidate in candidateAntecedentIds, sorted highest-score-first. */
  candidateScores: ReferenceCandidateScore[];
  /** I.B.2.1 instruction #6 — the winning score minus the runner-up's (or the sole candidate's own score). Null when there were zero candidates. This is the exact number RESOLVED_MARGIN_THRESHOLD in referenceResolverV2.ts is compared against. */
  scoreMargin: number | null;
  selectedAntecedentId: string | null;
  confidence: number;
  confidenceFactors: string[];
  resolutionStatus: ReferenceResolutionStatus;
  ambiguityReasons: string[];
  /** Messages between the antecedent and this reference — see instruction #16. Null when unresolved. */
  referenceDistance: number | null;
  substitutionContext: ReferenceSubstitutionContext | null;
  /** I.B.2.1 instruction #18 — see BasketLinkingSafety's own doc comment. Computed by computeReferenceSafety() in referenceResolverV2.ts. */
  safeForBasketLinking: BasketLinkingSafety;
}
