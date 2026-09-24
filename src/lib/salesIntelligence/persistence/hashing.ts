// Sales Intelligence Phase H.1B — deterministic persistence hashing.
//
// Four separate, narrower-than-each-other hashes (design doc H.0.2/§26 note on matching), each
// covering exactly the inputs its own idempotency check needs — never a single "hash everything"
// blob. Every hash goes through `canonicalize()` first so object key ordering never changes a hash,
// and callers are responsible for pre-sorting any array whose ORDER is not semantically meaningful
// (e.g. a set of candidate invoice ids) before it reaches these functions — canonicalize() itself
// only normalizes object key order, never array order, because array order IS meaningful for some
// inputs (e.g. basket items reflect the order they were added) and this module has no way to know
// which case it's looking at.
//
// Hashing itself follows the existing precedent in whatsappReviewPersistenceV4.ts
// (hashWhatsAppSession): Web Crypto's async `crypto.subtle.digest('SHA-256', ...)` when available
// (both the browser bundle and modern Node have it), with the same deterministic non-cryptographic
// fallback so this module never throws in an environment without it. The fallback is NOT a security
// boundary — these hashes are idempotency keys, not authentication tokens, so a fallback that is
// merely deterministic (not collision-resistant like SHA-256) is an acceptable, documented tradeoff
// for the rare environment lacking Web Crypto.

/**
 * Deterministically reorders object keys (recursively) so `JSON.stringify` output no longer
 * depends on the order properties were set in. Arrays are walked (so nested objects inside them are
 * still canonicalized) but their own element ORDER is preserved as given — see this module's header
 * comment for why that's the caller's responsibility, not this function's.
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = canonicalize(source[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function fallbackDeterministicHash(input: string): string {
  // Same non-cryptographic FNV/xorshift-style mix already used by hashWhatsAppSession's own
  // fallback in whatsappReviewPersistenceV4.ts — kept intentionally identical so this codebase has
  // exactly one "no Web Crypto" fallback algorithm, not two subtly different ones.
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `fallback-${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}`;
}

export async function sha256Hex(input: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
    const bytes = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }
  return fallbackDeterministicHash(input);
}

async function hashCanonical(value: unknown): Promise<string> {
  return sha256Hex(canonicalJsonStringify(value));
}

/**
 * Normalizes line endings only (CRLF/CR -> LF) and trims leading/trailing blank lines from the
 * whole raw export blob. Deliberately does NOT collapse or trim whitespace WITHIN a line/message —
 * that is semantically meaningful content the WhatsApp export parser reads, never touched here.
 * This exists purely to satisfy H.1B instruction #4's "whitespace-only representation differences
 * where semantically irrelevant" requirement for the one whitespace variation that's genuinely
 * irrelevant: how the export file itself was saved/copied (line-ending style, incidental leading/
 * trailing blank lines), not the conversation content.
 */
export function normalizeRawExportTextForHashing(rawWhatsAppExportText: string): string {
  return rawWhatsAppExportText.replace(/\r\n?/g, '\n').replace(/^\n+/, '').replace(/\n+$/, '');
}

export interface SemanticSourceHashInput {
  rawWhatsAppExportText: string;
  /** Persisted source timeline anchor. It changes the absolute meaning of time-only/local WhatsApp timestamps. */
  trustedConversationStartedAt?: string | null;
  /** Design doc H.0.2: future-proofing only, see versions.ts's own comment — pass ENGINE_VERSIONS-adjacent BRANCH_IDENTITY_MAPPING_VERSION. */
  branchIdentityMappingVersion: string;
}

/**
 * The immutable semantic input to ONE case_analyses row (design doc H.0.2, persistence/types.ts's
 * own `semanticSourceHash` doc comment). Deliberately excludes: protocol_policy_effective_at,
 * resolved customer_id/phone (those feed attributionInputHash instead), and invoice
 * candidate/item data. Two different cases split from the SAME raw conversation text legitimately
 * share this hash — case_id is what scopes idempotency (see analysisWriter.ts), not this hash
 * alone, so that sharing is harmless: it only means "a raw-text edit invalidates every case derived
 * from this conversation at once," which is the correct behavior for `raw_conversation_changed` in
 * REPROCESSING_MATRIX (persistence/types.ts).
 */
export async function computeSemanticSourceHash(input: SemanticSourceHashInput): Promise<string> {
  return hashCanonical({
    rawWhatsAppExportText: normalizeRawExportTextForHashing(input.rawWhatsAppExportText),
    trustedConversationStartedAt: input.trustedConversationStartedAt ?? null,
    branchIdentityMappingVersion: input.branchIdentityMappingVersion,
  });
}

export interface AttributionInputHashInput {
  customerId: string | null;
  customerPhone: string | null;
  /** The candidate invoice id SET actually used — order-independent, caller need not pre-sort (sorted here). */
  candidateInvoiceIds: string[];
  branchNameRaw: string | null;
  /** Current basket product identity used by attribution product evidence. */
  activeBasketItems?: Array<{ productNameRaw: string; productId?: string | null; quantity: number | null }>;
  /** Deterministic snapshot of line-item evidence for all candidate invoices. */
  invoiceItemEvidenceSnapshot?: unknown;
}

/**
 * Attribution's own narrower input hash (design doc H.0.2): resolved customer identity, the
 * candidate invoice id set actually used, and branch mapping — NOT raw conversation text (that's
 * semanticSourceHash's job) and NOT policy date (irrelevant to attribution).
 */
export async function computeAttributionInputHash(input: AttributionInputHashInput): Promise<string> {
  return hashCanonical({
    customerId: input.customerId,
    customerPhone: input.customerPhone,
    candidateInvoiceIds: [...input.candidateInvoiceIds].sort(),
    branchNameRaw: input.branchNameRaw,
    activeBasketItems: input.activeBasketItems ?? [],
    invoiceItemEvidenceSnapshot: input.invoiceItemEvidenceSnapshot ?? null,
  });
}

export interface PolicyInputHashInput {
  protocolApplicability: string;
  caseEndedAt: string | null;
  policyConfigId: string;
}

/** Deterministic hash of (analysis.protocolApplicability + caseEndedAt + policyConfigId) — persistence/types.ts's own documented definition, unchanged since H.0.2. */
export async function computePolicyInputHash(input: PolicyInputHashInput): Promise<string> {
  return hashCanonical({
    protocolApplicability: input.protocolApplicability,
    caseEndedAt: input.caseEndedAt,
    policyConfigId: input.policyConfigId,
  });
}

export interface MatchingInputHashItem {
  productNameRaw: string;
  quantity: number | null;
}

export interface MatchingInputHashInput {
  basketId: string | null;
  basketVersion: number | null;
  /** The active basket's own items at match time — order-independent (sorted here by productNameRaw). */
  activeItems: MatchingInputHashItem[];
  selectedInvoiceId: string | null;
  selectedInvoiceNumber: string | null;
  matchingEngineVersion: string;
  /** Deterministic snapshot of the selected invoice's line-item evidence. */
  invoiceItemEvidenceSnapshot?: unknown;
}

/**
 * Matching's own narrower input hash (design doc H.0.2/§25): the active basket state actually
 * evaluated + the selected invoice identity + matchingEngineVersion. Documented simplification: this
 * hashes invoice IDENTITY (id/number), not a snapshot of the invoice row's own header fields —
 * `sales_invoices` rows are effectively immutable once created in the live schema (no update path
 * exists in this codebase), so a change to the invoice's own stored amount without its id/number
 * changing is not a real scenario this hash needs to detect. If that ever stops holding, this hash
 * must be widened to include the invoice header amount explicitly.
 */
export async function computeMatchingInputHash(input: MatchingInputHashInput): Promise<string> {
  return hashCanonical({
    basketId: input.basketId,
    basketVersion: input.basketVersion,
    activeItems: [...input.activeItems]
      .map((item) => ({ productNameRaw: item.productNameRaw, quantity: item.quantity }))
      .sort((a, b) => a.productNameRaw.localeCompare(b.productNameRaw)),
    selectedInvoiceId: input.selectedInvoiceId,
    selectedInvoiceNumber: input.selectedInvoiceNumber,
    matchingEngineVersion: input.matchingEngineVersion,
    invoiceItemEvidenceSnapshot: input.invoiceItemEvidenceSnapshot ?? null,
  });
}
