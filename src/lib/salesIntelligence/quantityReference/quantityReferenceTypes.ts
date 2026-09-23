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

export interface ProductMentionV2 {
  mentionId: string;
  sourceMessageId: string;
  /** The text span taken to be the product name/reference — a fact, never normalized away. */
  rawText: string;
  role: ProductMentionRole;
  /** Set only when a PharmacyProductIndex was supplied and resolution found a safe candidate — see resolveProductMention(). Never invented when resolution is ambiguous/unresolved. */
  resolvedProductId: string | null;
  /** The identity bucket this mention belongs to for active-candidate tracking: resolvedProductId when available, else a normalized-text key. Never used as a claim of catalog identity by itself. */
  identityKey: string;
  messageIndex: number;
  timestamp: string;
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

export interface ReferenceMentionV2 {
  referenceId: string;
  rawText: string;
  referenceType: ReferenceType;
  sourceMessageId: string;
  /** Every distinct active-product identity considered, even when unresolved/ambiguous — for auditability, never trimmed to just the winner. */
  candidateAntecedentIds: string[];
  selectedAntecedentId: string | null;
  confidence: number;
  confidenceFactors: string[];
  resolutionStatus: ReferenceResolutionStatus;
  ambiguityReasons: string[];
  /** Messages between the antecedent and this reference — see instruction #16. Null when unresolved. */
  referenceDistance: number | null;
  substitutionContext: ReferenceSubstitutionContext | null;
}
