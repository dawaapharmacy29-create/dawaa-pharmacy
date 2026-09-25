// Sales Intelligence Phase D — Sale Attribution Engine.
//
// CORE RULE (non-negotiable): the AI never proves a sale happened. An invoice/order proves a
// commercial transaction happened; this engine only proves or ESTIMATES whether a specific real
// invoice belongs to a specific ConversationCase. A case can be `commercial_confirmation_complete`
// (Phase C) and still have SaleAttribution = unknown if no reliable commercial record exists —
// WhatsApp language alone never becomes "sold" here (that classification is a later phase's job).
//
// Pure functions only — no Supabase calls. Callers pass in already-fetched invoice rows (the
// live `sales_invoices` schema has no generated TS type in this repo — every consumer treats rows
// as `Record<string, unknown>`, so this module follows the same `InvoiceLike` convention already
// used by src/lib/invoices/invoiceCore.ts, and reuses that file's own amount/branch/date helpers
// rather than re-deriving them) and an `InvoiceItemEvidenceProvider` for line-item evidence
// (sales_invoice_items_v21 has 0 rows as of the Phase D schema investigation — the provider
// abstraction lets product/quantity evidence stay honestly 'unavailable' rather than faked from
// the header total).
import {
  getInvoiceAmount,
  getInvoiceBranch,
  parseInvoiceDateTime,
  type InvoiceLike,
} from '../invoices/invoiceCore';
import { normalizeBranchName } from '../branch';
import { isValidEgyptianCustomerMobile, normalizeEgyptianCustomerPhone } from '../customers/customerIdentity';
import type {
  AmountMatchKind,
  AnnouncedTotal,
  AttributionEvidenceItem,
  BranchMatchKind,
  CommercialConfirmationAssessment,
  ConfidenceAssessment,
  ConfidenceLevel,
  EvidenceRef,
  IdentityConflictStatus,
  ProductEvidenceAvailability,
  SaleAttributionAssessment,
  SaleAttributionCandidate,
  StaffCompatibility,
  TimeMatchStrength,
} from './types';

// ---------------------------------------------------------------------------
// Centralized, documented, inspectable thresholds — never magic numbers inline. Adjust only after
// reviewing real data (see the Phase D real-data shadow validation), not by guessing.
// ---------------------------------------------------------------------------

/** Time-distance bands (minutes), per the Phase D spec's own starting bands. */
export const TIME_MATCH_BANDS = {
  veryStrongMaxMinutes: 30,
  strongMaxMinutes: 120,
  moderateMaxMinutes: 360,
  /** "same day" ceiling — beyond this, next-day+ is `very_weak` unless direct evidence exists. */
  weakMaxMinutes: 1440,
  /** An invoice meaningfully PRE-DATING the case's own end is chronologically backwards — flagged, not silently averaged in. Small negative values are tolerated as clock-skew noise. */
  temporalInversionGraceMinutes: 10,
} as const;

/**
 * Amount-match tolerance: exact when the difference is 0; near_match when the difference is
 * within whichever is LARGER of a flat 20 EGP or 2% of the expected amount (covers delivery
 * fees/rounding/small discounts — see the Phase D spec's own "announced 1000, invoice 995"
 * example, a 0.5% difference, comfortably inside this tolerance). Anything beyond that is
 * `different` — Phase D never calls a difference an "error", only a matching classification.
 */
export const AMOUNT_MATCH_TOLERANCE = {
  absoluteEgp: 20,
  relativeFraction: 0.02,
} as const;

/** Auditable, additive scoring factors — see scoreCandidate(). Sum is clamped to [0, 1]. */
export const ATTRIBUTION_FACTOR_WEIGHTS = {
  customerIdMatch: 0.3,
  phoneMatch: 0.2,
  branchExactCanonical: 0.1,
  branchAlias: 0.07,
  timeVeryStrong: 0.15,
  timeStrong: 0.1,
  timeModerate: 0.05,
  timeWeak: 0.02,
  announcedTotalExact: 0.15,
  announcedTotalNear: 0.1,
  basketValueExact: 0.08,
  basketValueNear: 0.05,
  staffSame: 0.05,
  staffCompatible: 0.02,
  legacyMatch: 0.08,
  productMatch: 0.05,
} as const;

export const ATTRIBUTION_LEVEL_THRESHOLDS = {
  stronglyInferredMinScore: 0.55,
  weaklyInferredMinScore: 0.2,
} as const;

/** Two candidates within this score margin, at the SAME level, are too close to call automatically. */
export const AMBIGUITY_SCORE_MARGIN = 0.05;

// Mirrors branch.ts's own private canonical labels (not exported there) — used only to classify
// WHICH kind of branch match this is (a recognized canonical branch vs. a generic text match),
// never to re-derive the normalization itself (normalizeBranchName is reused for that).
const CANONICAL_BRANCH_LABELS = new Set(['فرع شكري', 'فرع الشامي']);
const UNKNOWN_BRANCH_LABEL = normalizeBranchName('');

// ---------------------------------------------------------------------------
// Product/quantity evidence provider abstraction — see the module header comment.
// ---------------------------------------------------------------------------

export interface InvoiceItemRecordForAttribution {
  productNameRaw: string;
  /** products.id resolved during invoice-line import. This is the canonical product identity. */
  productId?: string | null;
  /** Pharmacy/business product code — useful audit evidence, but not interchangeable with products.id. */
  productCode?: string | null;
  quantity: number | null;
  unitName?: string | null;
  expiryRaw?: string | null;
  returnedQuantity?: number | null;
  unitPrice?: number | null;
  itemDiscountAmount?: number | null;
  itemDiscountPercent?: number | null;
  grossLineAmount?: number | null;
  netLineAmount?: number | null;
  lineTotal: number | null;
}

export interface InvoiceItemEvidenceProvider {
  getItemsForInvoice(invoiceId: string, invoiceNumber: string | null): InvoiceItemRecordForAttribution[] | 'unavailable';
}

/** The honest default — sales_invoice_items_v21 has 0 rows as of the Phase D investigation. */
export const unavailableInvoiceItemEvidenceProvider: InvoiceItemEvidenceProvider = {
  getItemsForInvoice: () => 'unavailable',
};

// ---------------------------------------------------------------------------
// Case-side input contract — everything this engine needs about the case, ALREADY resolved by
// earlier phases. This engine does not re-derive customer/branch/basket facts; it only compares.
// ---------------------------------------------------------------------------

export interface CaseAttributionContext {
  caseId: string;
  /** customers.id, already resolved by an earlier phase — never invented here. */
  customerId: string | null;
  customerPhone: string | null;
  /** Free-text branch label as recorded on the case — compared via normalizeBranchName, same as invoices. */
  branchNameRaw: string | null;
  /** Start/end of this exact segmented case. Invoice timing is compared against the INTERVAL, not just its end. */
  caseStartedAt?: string | null;
  caseEndedAt: string | null;
  commercialConfirmation: CommercialConfirmationAssessment;
  /** The CURRENT (latest) basket version's own AnnouncedTotal only — NEVER a superseded version's total. */
  activeAnnouncedTotal: AnnouncedTotal | null;
  /** Sum of the current basket's item line totals, when computable; null when unit prices aren't populated (the common case today) — never guessed. */
  activeBasketValue: number | null;
  /** Product identity from the CURRENT basket version only. productId is canonical products.id when resolved. */
  activeBasketItems: Array<{ productNameRaw: string; productId?: string | null; quantity: number | null }>;
  /** Known contributing staff ids for this case (Phase B StaffContribution.staffId) — conservative, may be empty. */
  knownStaffIds: string[];
  /** From the Phase B legacy V17 adapter's own matched-invoice fields — evidence only, never trusted as canonical. */
  legacyMatchedInvoiceId: string | null;
  legacyMatchedInvoiceNumber: string | null;
  /** An explicit, ALREADY-TRUSTED system link if one exists upstream (e.g. whatsapp_review_sources.matched_invoice_id) — the only path to `proven`. Never guessed or inferred by this engine. */
  trustedInvoiceId: string | null;
  trustedInvoiceNumber: string | null;
}

// ---------------------------------------------------------------------------
// Raw invoice-row accessors not already covered by invoiceCore.ts's own helpers.
// ---------------------------------------------------------------------------

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function firstValue(row: InvoiceLike, keys: string[]): unknown {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && cleanText(value) !== '') return value;
  }
  return null;
}

/**
 * `sales_invoices.id` (text, not uuid, per the Phase A/D schema investigation) — deliberately NOT
 * invoiceCore's own getInvoiceId(), which prioritizes the human-readable invoice_number for
 * display purposes. Attribution needs the actual system row id for exact directInvoiceLink
 * matching; invoice_number is tracked separately below.
 */
function getInvoiceRowId(row: InvoiceLike): string {
  return cleanText(firstValue(row, ['id', 'invoice_number', 'invoice_no']));
}

function getInvoiceRowNumber(row: InvoiceLike): string | null {
  return cleanText(firstValue(row, ['invoice_number', 'invoice_no'])) || null;
}

function getInvoiceCustomerId(row: InvoiceLike): string | null {
  return cleanText(firstValue(row, ['customer_id'])) || null;
}

function getInvoiceCustomerPhone(row: InvoiceLike): string | null {
  return cleanText(firstValue(row, ['customer_phone', 'phone', 'whatsapp_phone'])) || null;
}

function getInvoiceStaffId(row: InvoiceLike): string | null {
  return cleanText(firstValue(row, ['staff_id'])) || null;
}

function isDraftLikeZeroInvoice(row: InvoiceLike): boolean {
  const amount = getInvoiceAmount(row);
  const closeValue = firstValue(row, ['close_datetime', 'close_time']);
  return amount != null && amount <= 0 && !closeValue;
}

/**
 * Canonical timestamp for attribution: `invoice_datetime`/`close_datetime` carry real
 * time-of-day; `sale_date`/`invoice_date`/`date` are day-only (always identical to each other on
 * write per the schema investigation) and never sufficient for minute-level distance — using them
 * is flagged as `precise: false` so classifyTime() can cap the resulting band conservatively.
 */
function getInvoiceDateTimeForAttribution(row: InvoiceLike): { iso: string | null; precise: boolean } {
  const preciseRaw = firstValue(row, ['invoice_datetime', 'close_datetime']);
  if (preciseRaw) {
    const iso = parseInvoiceDateTime(preciseRaw);
    if (iso) return { iso, precise: true };
  }
  const dayRaw = firstValue(row, ['sale_date', 'invoice_date', 'date']);
  if (dayRaw) {
    const iso = parseInvoiceDateTime(dayRaw);
    if (iso) return { iso, precise: false };
  }
  return { iso: null, precise: false };
}

/** Reused by Phase E's basketInvoiceMatchingEngine.ts — one product-key normalization, never duplicated. */
export function normalizeProductNameForMatch(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------------------
// Per-dimension classifiers — each one independently inspectable, matching the Phase D spec's
// "hard vs soft evidence" separation. None of these alone determines the final level.
// ---------------------------------------------------------------------------

function classifyIdentity(
  ctx: CaseAttributionContext,
  row: InvoiceLike
): { customerIdMatch: boolean; phoneMatch: boolean; identityConflict: IdentityConflictStatus } {
  const invoiceCustomerId = getInvoiceCustomerId(row);
  const customerIdMatch = Boolean(ctx.customerId && invoiceCustomerId && ctx.customerId === invoiceCustomerId);

  const casePhone = ctx.customerPhone ? normalizeEgyptianCustomerPhone(ctx.customerPhone) : '';
  const invoicePhone = getInvoiceCustomerPhone(row);
  const invoicePhoneNormalized = invoicePhone ? normalizeEgyptianCustomerPhone(invoicePhone) : '';
  const phoneMatch = Boolean(
    casePhone &&
      invoicePhoneNormalized &&
      isValidEgyptianCustomerMobile(casePhone) &&
      casePhone === invoicePhoneNormalized
  );

  // A phone match with two DIFFERENT canonical customer ids is a real conflict — see Phase D §5:
  // "If identity conflicts... Set needsHumanReview = true. Do not guess."
  let identityConflict: IdentityConflictStatus = 'none';
  if (phoneMatch && ctx.customerId && invoiceCustomerId && ctx.customerId !== invoiceCustomerId) {
    identityConflict = 'phone_vs_customer_id_conflict';
  }

  return { customerIdMatch, phoneMatch, identityConflict };
}

function classifyBranch(ctx: CaseAttributionContext, row: InvoiceLike): BranchMatchKind {
  const caseNormalized = ctx.branchNameRaw ? normalizeBranchName(ctx.branchNameRaw) : null;
  const invoiceRawText = cleanText(firstValue(row, ['branch_name', 'branch']));
  const invoiceNormalized = invoiceRawText ? normalizeBranchName(invoiceRawText) : null;

  if (
    !caseNormalized ||
    !invoiceNormalized ||
    caseNormalized === UNKNOWN_BRANCH_LABEL ||
    invoiceNormalized === UNKNOWN_BRANCH_LABEL
  ) {
    return 'unknown';
  }
  if (caseNormalized !== invoiceNormalized) return 'mismatch';
  return CANONICAL_BRANCH_LABELS.has(caseNormalized) ? 'exact_canonical' : 'normalized_alias_match';
}

function classifyTime(
  ctx: CaseAttributionContext,
  row: InvoiceLike
): { timeDistanceMinutes: number | null; timeMatchStrength: TimeMatchStrength; temporalInversion: boolean } {
  const { iso: invoiceIso, precise } = getInvoiceDateTimeForAttribution(row);
  if (!invoiceIso) return { timeDistanceMinutes: null, timeMatchStrength: 'unknown', temporalInversion: false };

  const invoiceMs = new Date(invoiceIso).getTime();
  const startMs = ctx.caseStartedAt ? new Date(ctx.caseStartedAt).getTime() : NaN;
  const endMsRaw = ctx.caseEndedAt ? new Date(ctx.caseEndedAt).getTime() : NaN;
  const hasStart = Number.isFinite(startMs);
  const hasEnd = Number.isFinite(endMsRaw);
  if (!Number.isFinite(invoiceMs) || (!hasStart && !hasEnd)) {
    return { timeDistanceMinutes: null, timeMatchStrength: 'unknown', temporalInversion: false };
  }

  // Compare to the CASE INTERVAL. An invoice created while the conversation is still ongoing is
  // chronologically valid and has distance 0. A real inversion exists only when the invoice
  // predates the case START beyond the small clock-skew grace period.
  const effectiveStartMs = hasStart ? startMs : endMsRaw;
  const effectiveEndMs = hasEnd ? Math.max(endMsRaw, effectiveStartMs) : effectiveStartMs;
  let diffMinutes: number;
  if (invoiceMs < effectiveStartMs) diffMinutes = (invoiceMs - effectiveStartMs) / 60000;
  else if (invoiceMs <= effectiveEndMs) diffMinutes = 0;
  else diffMinutes = (invoiceMs - effectiveEndMs) / 60000;

  const absMinutes = Math.abs(diffMinutes);
  const temporalInversion = diffMinutes < -TIME_MATCH_BANDS.temporalInversionGraceMinutes;

  let strength: TimeMatchStrength;
  if (temporalInversion) {
    strength = 'very_weak';
  } else if (!precise) {
    strength = absMinutes <= TIME_MATCH_BANDS.weakMaxMinutes ? 'weak' : 'very_weak';
  } else if (absMinutes <= TIME_MATCH_BANDS.veryStrongMaxMinutes) {
    strength = 'very_strong';
  } else if (absMinutes <= TIME_MATCH_BANDS.strongMaxMinutes) {
    strength = 'strong';
  } else if (absMinutes <= TIME_MATCH_BANDS.moderateMaxMinutes) {
    strength = 'moderate';
  } else if (absMinutes <= TIME_MATCH_BANDS.weakMaxMinutes) {
    strength = 'weak';
  } else {
    strength = 'very_weak';
  }

  return { timeDistanceMinutes: Math.round(diffMinutes), timeMatchStrength: strength, temporalInversion };
}

function classifyAmountMatch(expected: number | null, actual: number | null): AmountMatchKind {
  if (expected == null || actual == null) return 'not_available';
  const diff = Math.abs(expected - actual);
  if (diff === 0) return 'exact';
  const tolerance = Math.max(AMOUNT_MATCH_TOLERANCE.absoluteEgp, expected * AMOUNT_MATCH_TOLERANCE.relativeFraction);
  return diff <= tolerance ? 'near_match' : 'different';
}

/**
 * A different staff member must never auto-disqualify a candidate (Phase D §12: one doctor may
 * advise, another may close/invoice). `compatible` is reported only when the case itself already
 * shows more than one contributing staff member — a genuinely multi-staff case where a third
 * closer is plausible — never as a way to paper over a clean single-staff mismatch.
 */
function classifyStaff(ctx: CaseAttributionContext, row: InvoiceLike): StaffCompatibility {
  const invoiceStaffId = getInvoiceStaffId(row);
  if (!invoiceStaffId || ctx.knownStaffIds.length === 0) return 'unknown';
  if (ctx.knownStaffIds.includes(invoiceStaffId)) return 'same';
  return ctx.knownStaffIds.length > 1 ? 'compatible' : 'different';
}

function classifyProductEvidence(
  ctx: CaseAttributionContext,
  row: InvoiceLike,
  provider: InvoiceItemEvidenceProvider
): { productMatch: ProductEvidenceAvailability; quantityMatch: ProductEvidenceAvailability } {
  const items = provider.getItemsForInvoice(getInvoiceRowId(row), getInvoiceRowNumber(row));
  if (items === 'unavailable' || ctx.activeBasketItems.length === 0) {
    return { productMatch: 'unavailable', quantityMatch: 'unavailable' };
  }

  const sellableItems = items.filter(
    (item) => item.quantity != null && Number(item.quantity) > 0
  );
  const invoiceByProductId = new Map(
    sellableItems.filter((i) => i.productId).map((i) => [String(i.productId), i])
  );
  const invoiceByName = new Map(
    sellableItems.map((i) => [normalizeProductNameForMatch(i.productNameRaw), i])
  );

  const matchedPairs = ctx.activeBasketItems
    .map((basketItem) => {
      const canonical = basketItem.productId ? invoiceByProductId.get(String(basketItem.productId)) : null;
      const byName = canonical ?? invoiceByName.get(normalizeProductNameForMatch(basketItem.productNameRaw));
      return byName ? { basketItem, invoiceItem: byName } : null;
    })
    .filter(Boolean) as Array<{
      basketItem: { productNameRaw: string; productId?: string | null; quantity: number | null };
      invoiceItem: InvoiceItemRecordForAttribution;
    }>;

  const productMatch: ProductEvidenceAvailability =
    matchedPairs.length > 0 ? 'available_match' : 'available_mismatch';

  let quantityMatch: ProductEvidenceAvailability = 'unavailable';
  if (matchedPairs.length > 0) {
    const allQuantitiesAgree = matchedPairs.every(({ basketItem, invoiceItem }) =>
      basketItem.quantity == null ||
      invoiceItem.quantity == null ||
      basketItem.quantity === invoiceItem.quantity
    );
    quantityMatch = allQuantitiesAgree ? 'available_match' : 'available_mismatch';
  }

  return { productMatch, quantityMatch };
}

function classifyLegacyMatch(ctx: CaseAttributionContext, row: InvoiceLike): boolean {
  const invoiceId = getInvoiceRowId(row);
  const invoiceNumber = getInvoiceRowNumber(row);
  if (ctx.legacyMatchedInvoiceId && ctx.legacyMatchedInvoiceId === invoiceId) return true;
  if (ctx.legacyMatchedInvoiceNumber && invoiceNumber && ctx.legacyMatchedInvoiceNumber === invoiceNumber) return true;
  return false;
}

function classifyDirectLinks(ctx: CaseAttributionContext, row: InvoiceLike): { directOrderLink: boolean; directInvoiceLink: boolean } {
  const invoiceId = getInvoiceRowId(row);
  const invoiceNumber = getInvoiceRowNumber(row);
  const directInvoiceLink = Boolean(
    (ctx.trustedInvoiceId && ctx.trustedInvoiceId === invoiceId) ||
      (ctx.trustedInvoiceNumber && invoiceNumber && ctx.trustedInvoiceNumber === invoiceNumber)
  );
  // No `orders` table exists in the live schema (see the Phase D schema investigation) — kept as
  // a real field for forward compatibility, never fabricated.
  return { directOrderLink: false, directInvoiceLink };
}

// ---------------------------------------------------------------------------
// Scoring — additive, documented factors. Disqualifiers cap the level rather than silently
// zeroing the candidate out, so a human reviewer can see exactly why.
// ---------------------------------------------------------------------------

interface ScoreInput {
  customerIdMatch: boolean;
  phoneMatch: boolean;
  identityConflict: IdentityConflictStatus;
  branchMatch: BranchMatchKind;
  timeMatchStrength: TimeMatchStrength;
  temporalInversion: boolean;
  announcedTotalMatch: AmountMatchKind;
  basketValueMatch: AmountMatchKind;
  staffMatch: StaffCompatibility;
  legacyEvidenceMatch: boolean;
  productMatch: ProductEvidenceAvailability;
}

function scoreCandidate(input: ScoreInput): { score: number; disqualifiers: string[]; factors: string[] } {
  const W = ATTRIBUTION_FACTOR_WEIGHTS;
  let score = 0;
  const factors: string[] = [];
  const disqualifiers: string[] = [];

  if (input.customerIdMatch) {
    score += W.customerIdMatch;
    factors.push('customer_id_match');
  }
  if (input.phoneMatch) {
    score += W.phoneMatch;
    factors.push('phone_match');
  }

  if (input.branchMatch === 'exact_canonical') {
    score += W.branchExactCanonical;
    factors.push('branch_exact_canonical');
  } else if (input.branchMatch === 'normalized_alias_match') {
    score += W.branchAlias;
    factors.push('branch_alias_match');
  } else if (input.branchMatch === 'mismatch') {
    disqualifiers.push('branch_mismatch');
  }

  if (input.timeMatchStrength === 'very_strong') {
    score += W.timeVeryStrong;
    factors.push('time_very_strong');
  } else if (input.timeMatchStrength === 'strong') {
    score += W.timeStrong;
    factors.push('time_strong');
  } else if (input.timeMatchStrength === 'moderate') {
    score += W.timeModerate;
    factors.push('time_moderate');
  } else if (input.timeMatchStrength === 'weak') {
    score += W.timeWeak;
    factors.push('time_weak');
  }
  if (input.temporalInversion) disqualifiers.push('temporal_inversion_invoice_predates_case');

  if (input.announcedTotalMatch === 'exact') {
    score += W.announcedTotalExact;
    factors.push('announced_total_exact');
  } else if (input.announcedTotalMatch === 'near_match') {
    score += W.announcedTotalNear;
    factors.push('announced_total_near');
  } else if (input.announcedTotalMatch === 'different') {
    disqualifiers.push('announced_total_different');
  }

  if (input.basketValueMatch === 'exact') {
    score += W.basketValueExact;
    factors.push('basket_value_exact');
  } else if (input.basketValueMatch === 'near_match') {
    score += W.basketValueNear;
    factors.push('basket_value_near');
  }

  if (input.staffMatch === 'same') {
    score += W.staffSame;
    factors.push('staff_same');
  } else if (input.staffMatch === 'compatible') {
    score += W.staffCompatible;
    factors.push('staff_compatible');
  }

  if (input.legacyEvidenceMatch) {
    score += W.legacyMatch;
    factors.push('legacy_v17_match');
  }

  if (input.productMatch === 'available_match') {
    score += W.productMatch;
    factors.push('product_match');
  } else if (input.productMatch === 'available_mismatch') {
    disqualifiers.push('product_mismatch');
  }

  if (input.identityConflict !== 'none') disqualifiers.push('identity_conflict');

  return { score: Math.min(1, Math.max(0, score)), disqualifiers, factors };
}

function deriveLevel(score: number, disqualifiers: string[], hasIdentitySignal: boolean): ConfidenceLevel {
  // An identity conflict must never resolve upward on its own — a human decides, per Phase D §5.
  if (disqualifiers.includes('identity_conflict')) return 'weakly_inferred';
  if (
    score >= ATTRIBUTION_LEVEL_THRESHOLDS.stronglyInferredMinScore &&
    hasIdentitySignal &&
    disqualifiers.length === 0
  ) {
    return 'strongly_inferred';
  }
  if (score >= ATTRIBUTION_LEVEL_THRESHOLDS.weaklyInferredMinScore) return 'weakly_inferred';
  return 'unknown';
}

function buildEvidenceItems(input: {
  identity: { customerIdMatch: boolean; phoneMatch: boolean; identityConflict: IdentityConflictStatus };
  branchMatch: BranchMatchKind;
  time: { timeDistanceMinutes: number | null; timeMatchStrength: TimeMatchStrength; temporalInversion: boolean };
  announcedTotalMatch: AmountMatchKind;
  basketValueMatch: AmountMatchKind;
  staffMatch: StaffCompatibility;
  productMatch: ProductEvidenceAvailability;
  quantityMatch: ProductEvidenceAvailability;
  legacyEvidenceMatch: boolean;
  directOrderLink: boolean;
  directInvoiceLink: boolean;
  invoiceAmount: number;
}): AttributionEvidenceItem[] {
  const W = ATTRIBUTION_FACTOR_WEIGHTS;
  const items: AttributionEvidenceItem[] = [
    {
      kind: 'same_customer_id',
      matched: input.identity.customerIdMatch,
      detail: input.identity.customerIdMatch
        ? 'تطابق تام لمعرف العميل الأساسي (customer_id).'
        : 'لا يوجد تطابق لمعرف العميل الأساسي.',
      weight: input.identity.customerIdMatch ? W.customerIdMatch : 0,
    },
    {
      kind: 'same_phone',
      matched: input.identity.phoneMatch,
      detail: input.identity.phoneMatch
        ? 'تطابق تام لرقم الهاتف بعد التطبيع المصري.'
        : 'لا يوجد تطابق لرقم الهاتف.',
      weight: input.identity.phoneMatch ? W.phoneMatch : 0,
    },
    {
      kind: 'same_branch',
      matched: input.branchMatch === 'exact_canonical' || input.branchMatch === 'normalized_alias_match',
      detail: `تصنيف مطابقة الفرع: ${input.branchMatch}.`,
      weight:
        input.branchMatch === 'exact_canonical'
          ? W.branchExactCanonical
          : input.branchMatch === 'normalized_alias_match'
            ? W.branchAlias
            : 0,
    },
    {
      kind: 'time_proximity',
      matched: input.time.timeMatchStrength !== 'unknown' && input.time.timeMatchStrength !== 'very_weak',
      detail: `الفارق الزمني بين نهاية المحادثة والفاتورة: ${input.time.timeDistanceMinutes ?? 'غير معروف'} دقيقة (${input.time.timeMatchStrength}).`,
      weight:
        input.time.timeMatchStrength === 'very_strong'
          ? W.timeVeryStrong
          : input.time.timeMatchStrength === 'strong'
            ? W.timeStrong
            : input.time.timeMatchStrength === 'moderate'
              ? W.timeModerate
              : input.time.timeMatchStrength === 'weak'
                ? W.timeWeak
                : 0,
    },
    {
      kind: 'announced_total_match',
      matched: input.announcedTotalMatch === 'exact' || input.announcedTotalMatch === 'near_match',
      detail: `مطابقة الإجمالي المعلن مقابل قيمة الفاتورة (${input.invoiceAmount} جنيه): ${input.announcedTotalMatch}.`,
      weight:
        input.announcedTotalMatch === 'exact'
          ? W.announcedTotalExact
          : input.announcedTotalMatch === 'near_match'
            ? W.announcedTotalNear
            : 0,
    },
    {
      kind: 'basket_value_match',
      matched: input.basketValueMatch === 'exact' || input.basketValueMatch === 'near_match',
      detail: `مطابقة قيمة السلة المحسوبة: ${input.basketValueMatch}.`,
      weight:
        input.basketValueMatch === 'exact'
          ? W.basketValueExact
          : input.basketValueMatch === 'near_match'
            ? W.basketValueNear
            : 0,
    },
    {
      kind: input.staffMatch === 'same' ? 'same_staff' : 'compatible_staff',
      matched: input.staffMatch === 'same' || input.staffMatch === 'compatible',
      detail: `توافق الموظف: ${input.staffMatch}.`,
      weight: input.staffMatch === 'same' ? W.staffSame : input.staffMatch === 'compatible' ? W.staffCompatible : 0,
    },
    {
      kind: 'product_match',
      matched: input.productMatch === 'available_match',
      detail: `أدلة المنتج على مستوى البند: ${input.productMatch}.`,
      weight: input.productMatch === 'available_match' ? W.productMatch : 0,
    },
    {
      kind: 'quantity_match',
      matched: input.quantityMatch === 'available_match',
      detail: `أدلة الكمية على مستوى البند: ${input.quantityMatch}.`,
      weight: 0,
    },
  ];

  if (input.identity.identityConflict !== 'none') {
    items.push({
      kind: 'identity_conflict',
      matched: true,
      detail: 'الهاتف متطابق لكن معرف العميل في الفاتورة يشير إلى عميل مختلف — يتطلب مراجعة بشرية، لا تخمين.',
      weight: 0,
    });
  }
  if (input.branchMatch === 'mismatch') {
    items.push({
      kind: 'branch_mismatch',
      matched: true,
      detail: 'فرع الفاتورة يختلف عن فرع المحادثة المعروف.',
      weight: 0,
    });
  }
  if (input.time.temporalInversion) {
    items.push({
      kind: 'temporal_inversion',
      matched: true,
      detail: 'تاريخ/وقت الفاتورة يسبق نهاية المحادثة زمنيًا — إشارة غير طبيعية تستحق المراجعة.',
      weight: 0,
    });
  }
  if (input.legacyEvidenceMatch) {
    items.push({
      kind: 'legacy_v17_match',
      matched: true,
      detail: 'يدعمه دليل V17 (رقم/معرف فاتورة مطابق من whatsapp_sales_opportunities_v17) — دليل مساعد فقط، غير كافٍ وحده.',
      weight: W.legacyMatch,
    });
  }
  if (input.directInvoiceLink) {
    items.push({
      kind: 'direct_invoice_id',
      matched: true,
      detail: 'رابط فاتورة موثوق ومخزَّن مسبقًا على مستوى النظام (وليس تخمينًا إحصائيًا).',
      weight: 1,
    });
  }
  if (input.directOrderLink) {
    items.push({ kind: 'direct_order_id', matched: true, detail: 'رابط طلب موثوق.', weight: 1 });
  }

  return items;
}

function summarizeEvidenceRef(invoiceId: string, matchedFactors: string[]): EvidenceRef {
  return {
    sourceTable: 'sales_invoices',
    sourceId: invoiceId,
    description:
      matchedFactors.length > 0
        ? `عوامل التطابق المتحققة: ${matchedFactors.join(', ')}.`
        : 'لا توجد عوامل تطابق متحققة لهذه الفاتورة المرشحة.',
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Builds one invoice's full candidacy against a case — the unit every ranking decision is made from. */
export function buildAttributionCandidate(
  ctx: CaseAttributionContext,
  row: InvoiceLike,
  itemEvidenceProvider: InvoiceItemEvidenceProvider = unavailableInvoiceItemEvidenceProvider
): SaleAttributionCandidate {
  const invoiceId = getInvoiceRowId(row);
  const invoiceNumber = getInvoiceRowNumber(row);

  const identity = classifyIdentity(ctx, row);
  const branchMatch = classifyBranch(ctx, row);
  const time = classifyTime(ctx, row);
  const invoiceAmount = getInvoiceAmount(row);
  const announcedTotalMatch = classifyAmountMatch(ctx.activeAnnouncedTotal?.amount ?? null, invoiceAmount);
  const basketValueMatch = classifyAmountMatch(ctx.activeBasketValue, invoiceAmount);
  const staffMatch = classifyStaff(ctx, row);
  const { productMatch, quantityMatch } = classifyProductEvidence(ctx, row, itemEvidenceProvider);
  const legacyEvidenceMatch = classifyLegacyMatch(ctx, row);
  const { directOrderLink, directInvoiceLink } = classifyDirectLinks(ctx, row);

  const { score, disqualifiers, factors } = scoreCandidate({
    customerIdMatch: identity.customerIdMatch,
    phoneMatch: identity.phoneMatch,
    identityConflict: identity.identityConflict,
    branchMatch,
    timeMatchStrength: time.timeMatchStrength,
    temporalInversion: time.temporalInversion,
    announcedTotalMatch,
    basketValueMatch,
    staffMatch,
    legacyEvidenceMatch,
    productMatch,
  });

  if (isDraftLikeZeroInvoice(row)) {
    disqualifiers.push('draft_zero_invoice');
  }

  const hasIdentitySignal = identity.customerIdMatch || identity.phoneMatch;
  // A trusted direct link always wins outright — hard evidence, never a statistical estimate
  // (Phase D §4/§13: "Do NOT call statistical matching proven").
  const level: ConfidenceLevel = directInvoiceLink ? 'proven' : deriveLevel(score, disqualifiers, hasIdentitySignal);

  const ruleIds = [`attribution.level.${level}`, ...factors.map((f) => `attribution.factor.${f}`)];
  const evidence = buildEvidenceItems({
    identity,
    branchMatch,
    time,
    announcedTotalMatch,
    basketValueMatch,
    staffMatch,
    productMatch,
    quantityMatch,
    legacyEvidenceMatch,
    directOrderLink,
    directInvoiceLink,
    invoiceAmount,
  });

  const confidenceAssessment: ConfidenceAssessment = {
    level,
    score: directInvoiceLink ? 1 : score,
    ruleIds,
    evidence: [summarizeEvidenceRef(invoiceId, factors)],
  };

  return {
    caseId: ctx.caseId,
    invoiceId,
    invoiceNumber,
    customerIdMatch: identity.customerIdMatch,
    phoneMatch: identity.phoneMatch,
    identityConflict: identity.identityConflict,
    branchMatch,
    timeDistanceMinutes: time.timeDistanceMinutes,
    timeMatchStrength: time.timeMatchStrength,
    staffMatch,
    announcedTotalMatch,
    basketValueMatch,
    productMatch,
    quantityMatch,
    legacyEvidenceMatch,
    directOrderLink,
    directInvoiceLink,
    evidence,
    ruleIds,
    confidenceAssessment,
    disqualifiers,
  };
}

/**
 * Ranks every candidate invoice for a case and derives the case-level attribution outcome. Never
 * auto-picks the closest-in-time candidate over stronger identity/total/product evidence (Phase D
 * §14) — ranks by the full scored confidence, and refuses to finalize when the top two are too
 * close (§14) or another case has independently claimed the same invoice (§15).
 */
export function deriveSaleAttributionAssessment(
  ctx: CaseAttributionContext,
  invoiceRows: InvoiceLike[],
  itemEvidenceProvider: InvoiceItemEvidenceProvider = unavailableInvoiceItemEvidenceProvider,
  competingSelections: Array<{ caseId: string; invoiceId: string }> = []
): SaleAttributionAssessment {
  const commercialConfirmationState = ctx.commercialConfirmation.currentState;
  const candidates = invoiceRows.map((row) => buildAttributionCandidate(ctx, row, itemEvidenceProvider));
  candidates.sort((a, b) => b.confidenceAssessment.score - a.confidenceAssessment.score);

  if (candidates.length === 0) {
    return {
      caseId: ctx.caseId,
      commercialConfirmationState,
      candidateCount: 0,
      selectedInvoiceId: null,
      selectedInvoiceNumber: null,
      selectedCandidate: null,
      alternativeCandidates: [],
      attributionLevel: 'unknown',
      confidence: { level: 'unknown', score: 0, ruleIds: ['attribution.assessment.no_candidates'], evidence: [] },
      primaryEvidence: [],
      contradictions: [],
      needsHumanReview: false,
      humanReviewReasons: [],
      isOfficialForStaffEvaluation: false,
      legacyEvidenceUsed: false,
      ruleIds: ['attribution.assessment.no_candidates'],
      hasAttributedInvoice: false,
      competingCaseIds: [],
    };
  }

  const legacyEvidenceUsed = candidates.some((c) => c.legacyEvidenceMatch);
  const directLinked = candidates.find((c) => c.directInvoiceLink) ?? null;

  const hasIndependentTransactionalCorroboration = (candidate: SaleAttributionCandidate): boolean =>
    candidate.announcedTotalMatch === 'exact' ||
    candidate.announcedTotalMatch === 'near_match' ||
    candidate.basketValueMatch === 'exact' ||
    candidate.basketValueMatch === 'near_match' ||
    candidate.productMatch === 'available_match' ||
    candidate.quantityMatch === 'available_match' ||
    candidate.staffMatch === 'same';

  const isStatisticallySelectable = (candidate: SaleAttributionCandidate): boolean => {
    if (candidate.disqualifiers.includes('temporal_inversion_invoice_predates_case')) return false;
    if (candidate.disqualifiers.includes('draft_zero_invoice')) return false;
    if (candidate.timeMatchStrength === 'very_strong' || candidate.timeMatchStrength === 'strong' || candidate.timeMatchStrength === 'moderate') {
      return true;
    }
    // A weak/very-weak temporal relation stays alternative-only. Identity/branch/legacy
    // similarity may support review, but cannot make the invoice the selected transaction without
    // an independent transactional signal (amount/item/quantity/staff evidence).
    return hasIndependentTransactionalCorroboration(candidate);
  };

  // Direct trusted links stay visible even when contradictory (audit + human review). Statistical
  // candidates must be chronologically plausible enough, or carry independent transactional
  // corroboration, before the UI is allowed to call one "selected".
  const selectableCandidates = directLinked
    ? [directLinked, ...candidates.filter((c) => c !== directLinked && isStatisticallySelectable(c))]
    : candidates.filter(isStatisticallySelectable);

  if (selectableCandidates.length === 0) {
    const rejectedTop = candidates[0];
    const temporalInversion = rejectedTop?.disqualifiers.includes('temporal_inversion_invoice_predates_case') ?? false;
    const draftZero = rejectedTop?.disqualifiers.includes('draft_zero_invoice') ?? false;
    const reason = temporalInversion
      ? 'invoice_predates_case_start'
      : draftZero
        ? 'draft_zero_invoice_not_transaction_truth'
        : 'statistical_invoice_lacks_transactional_corroboration';
    const ruleId = temporalInversion
      ? 'attribution.assessment.no_temporally_valid_candidates'
      : draftZero
        ? 'attribution.assessment.draft_zero_invoice_rejected'
        : 'attribution.assessment.no_selectable_transaction_link';
    return {
      caseId: ctx.caseId,
      commercialConfirmationState,
      candidateCount: candidates.length,
      selectedInvoiceId: null,
      selectedInvoiceNumber: null,
      selectedCandidate: null,
      alternativeCandidates: candidates,
      attributionLevel: 'unknown',
      confidence: {
        level: 'unknown',
        score: 0,
        ruleIds: [ruleId],
        evidence: rejectedTop?.confidenceAssessment.evidence ?? [],
      },
      primaryEvidence: rejectedTop?.evidence ?? [],
      contradictions: temporalInversion ? ['temporal_inversion'] : [],
      needsHumanReview: true,
      humanReviewReasons: [reason],
      isOfficialForStaffEvaluation: false,
      legacyEvidenceUsed,
      ruleIds: [ruleId],
      hasAttributedInvoice: false,
      competingCaseIds: [],
    };
  }

  const top = directLinked ?? selectableCandidates[0];
  const second = selectableCandidates.find((c) => c !== top) ?? null;

  const contradictions: string[] = [];
  const humanReviewReasons: string[] = [];

  if (top.identityConflict !== 'none') {
    contradictions.push('identity_conflict');
    humanReviewReasons.push('customer_identity_conflict');
  }
  if (top.disqualifiers.includes('temporal_inversion_invoice_predates_case')) {
    contradictions.push('temporal_inversion');
    humanReviewReasons.push('invoice_predates_case_start');
  }

  let ambiguous = false;
  if (
    !directLinked &&
    second &&
    second.confidenceAssessment.level === top.confidenceAssessment.level &&
    Math.abs(top.confidenceAssessment.score - second.confidenceAssessment.score) <= AMBIGUITY_SCORE_MARGIN
  ) {
    ambiguous = true;
    contradictions.push('ambiguous_multiple_candidates');
    humanReviewReasons.push('ambiguous_multiple_candidates');
  }

  const competingCaseIds = Array.from(
    new Set(
      competingSelections
        .filter((s) => s.invoiceId === top.invoiceId && s.caseId !== ctx.caseId)
        .map((s) => s.caseId)
    )
  );
  if (competingCaseIds.length > 0) {
    contradictions.push('competing_case_attribution');
    humanReviewReasons.push('competing_case_attribution');
  }

  let attributionLevel: ConfidenceLevel = top.confidenceAssessment.level;
  if (ambiguous && attributionLevel === 'strongly_inferred') attributionLevel = 'weakly_inferred';

  // Identity proves WHO the invoice belongs to; it does not, by itself, prove WHICH conversation
  // generated it. A statistical invoice can only become official staff-evaluation evidence when
  // the temporal link is genuinely close, or a separate transactional signal corroborates the
  // conversation->invoice link. Legacy V17 is deliberately NOT counted as independent
  // corroboration because it is another historical matcher, not transaction truth.
  const topHasIndependentTransactionalCorroboration = hasIndependentTransactionalCorroboration(top);

  const statisticalOfficialTimingOk =
    top.timeMatchStrength === 'very_strong' ||
    top.timeMatchStrength === 'strong' ||
    (top.timeMatchStrength === 'moderate' && topHasIndependentTransactionalCorroboration);

  const isOfficialForStaffEvaluation =
    (attributionLevel === 'proven' &&
      contradictions.length === 0 &&
      top.disqualifiers.length === 0) ||
    (attributionLevel === 'strongly_inferred' &&
      !ambiguous &&
      contradictions.length === 0 &&
      top.identityConflict === 'none' &&
      competingCaseIds.length === 0 &&
      top.disqualifiers.length === 0 &&
      statisticalOfficialTimingOk);

  if (
    attributionLevel === 'strongly_inferred' &&
    !directLinked &&
    !statisticalOfficialTimingOk &&
    !humanReviewReasons.includes('statistical_invoice_lacks_transactional_corroboration')
  ) {
    humanReviewReasons.push('statistical_invoice_lacks_transactional_corroboration');
  }

  // A genuinely zero-signal top candidate (score 0, level 'unknown') isn't worth flagging — there
  // is simply nothing to review. A strong statistical score that fails the official transaction-
  // link gate ALSO needs review; it must not silently look equivalent to a staff-safe attribution.
  const needsHumanReview =
    humanReviewReasons.length > 0 || (attributionLevel === 'unknown' && top.confidenceAssessment.score > 0);
  if (needsHumanReview && !humanReviewReasons.includes('insufficient_evidence') && attributionLevel === 'unknown') {
    humanReviewReasons.push('insufficient_evidence');
  }

  return {
    caseId: ctx.caseId,
    commercialConfirmationState,
    candidateCount: candidates.length,
    selectedInvoiceId: top.invoiceId,
    selectedInvoiceNumber: top.invoiceNumber,
    selectedCandidate: top,
    alternativeCandidates: candidates.filter((c) => c !== top),
    attributionLevel,
    confidence: {
      level: attributionLevel,
      score: top.confidenceAssessment.score,
      ruleIds: top.ruleIds,
      evidence: top.confidenceAssessment.evidence,
    },
    primaryEvidence: top.evidence,
    contradictions,
    needsHumanReview,
    humanReviewReasons,
    isOfficialForStaffEvaluation,
    legacyEvidenceUsed,
    ruleIds: [...top.ruleIds, ...(ambiguous ? ['attribution.assessment.ambiguous'] : [])],
    hasAttributedInvoice: attributionLevel === 'proven' || attributionLevel === 'strongly_inferred',
    competingCaseIds,
  };
}
