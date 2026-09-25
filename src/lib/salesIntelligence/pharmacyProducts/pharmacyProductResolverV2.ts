// Phase I.B.1 — pharmacyProductResolverV2.
//
// Resolves a raw phrase (as typed/said by a customer or staff member in a WhatsApp conversation)
// against the real CanonicalProduct catalog, via an explicit, ordered match-basis hierarchy. Built
// BESIDE the existing B-G Sales Intelligence engines (caseBasketEngine.ts's productId currently
// always resolves to null — see the I.B.1 audit) — nothing here replaces those engines yet; see
// instruction #18 (Phase I.B.1 kickoff) for why.
//
// Hard rule, enforced in code below, not just in comments: a fuzzy-only match (basis 7) can NEVER
// reach 'proven' confidence — see FUZZY_MAX_CONFIDENCE_LEVEL.
import {
  normalizePharmacyText,
  type DosageForm,
  type ExtractedStrength,
  type NormalizedPharmacyText,
} from './pharmacyNormalization';
import type { CanonicalProduct } from './canonicalProduct';

export type ProductMatchBasis =
  | 'exact_code'
  | 'exact_barcode'
  | 'exact_canonical_name'
  | 'approved_alias'
  | 'cross_script_equivalent'
  | 'dominant_name_token_match'
  | 'strength_form_token_match'
  | 'cautious_fuzzy'
  | 'unresolved';

export type ConfidenceLevel = 'proven' | 'strongly_inferred' | 'weakly_inferred' | 'unknown';

/** The only confidence a basis-7 (cautious_fuzzy) match may ever report — see module comment. */
const FUZZY_MAX_CONFIDENCE_LEVEL: ConfidenceLevel = 'weakly_inferred';

export interface ProductResolutionCandidate {
  product: CanonicalProduct;
  basis: ProductMatchBasis;
  confidence: ConfidenceLevel;
  score: number; // 0-1, informational — confidenceLevel is the field callers should branch on
  reasons: string[];
}

export interface ProductResolutionResult {
  phrase: string;
  normalized: NormalizedPharmacyText;
  candidates: ProductResolutionCandidate[];
  /** Non-null only when exactly one candidate is safe to treat as the answer — see isSafeSelection(). */
  selected: ProductResolutionCandidate | null;
  ambiguous: boolean;
  reasons: string[];
}

export interface ConversationProductContext {
  /** Product ids already confirmed in this case's basket — used only as a tie-breaker signal (I.B.1: recorded, not yet weighted; see I.B.2 scope). */
  basketProductIds?: string[];
  branchNameRaw?: string | null;
}

export interface ResolveProductMentionOptions {
  /** Restrict resolution to this subset (e.g. from an upstream invoice-line candidate set) instead of the full catalog. */
  knownCandidateProductIds?: string[];
  context?: ConversationProductContext;
  /** Approved alias text -> productId. Only 'approved' ProductAliasCandidate rows may ever populate this (see productAliasCandidate.ts). */
  approvedAliases?: ReadonlyMap<string, string>;
  /**
   * Small, explicit, DOCUMENTED-AS-INCOMPLETE seed table for cross-script equivalence (Arabic
   * transliteration -> the Latin token it corresponds to in the catalog). This is NOT a general
   * transliteration engine — see CROSS_SCRIPT_SEED's own comment. Callers may extend it; the
   * default export ships the seed discovered during the I.B.1 real-conversation audit.
   */
  crossScriptSeed?: ReadonlyMap<string, string>;
}

export interface PharmacyProductIndex {
  catalog: CanonicalProduct[];
  byCode: Map<string, CanonicalProduct>;
  byNormalizedName: Map<string, CanonicalProduct[]>;
}

export function buildPharmacyProductIndex(catalog: CanonicalProduct[]): PharmacyProductIndex {
  const byCode = new Map<string, CanonicalProduct>();
  const byNormalizedName = new Map<string, CanonicalProduct[]>();
  for (const product of catalog) {
    byCode.set(product.productCode.trim().toLowerCase(), product);
    for (const normalizedName of product.normalizedNames) {
      const bucket = byNormalizedName.get(normalizedName);
      if (bucket) bucket.push(product);
      else byNormalizedName.set(normalizedName, [product]);
    }
  }
  return { catalog, byCode, byNormalizedName };
}

/**
 * Seed cross-script equivalence table discovered by manually cross-referencing real customer
 * phrasing (from the H.1C/I.B.1 conversation audit) against the real product catalog. Deliberately
 * small and explicit — growing this table is exactly what the alias-candidate approval workflow
 * (productAliasCandidate.ts) is for; this seed exists so the resolver has SOMETHING to work with on
 * day one, not as a claim of general Arabic->English transliteration.
 */
export const CROSS_SCRIPT_SEED: ReadonlyMap<string, string> = new Map([
  ['زوركال', 'zurcal'],
  ['انتينال', 'antinal'],
  ['بامبرز', 'pampers'],
  ['كوريغا', 'corega'],
  ['كوريجا', 'corega'],
  ['كولشيسين', 'colchicine'],
  ['كولشيسن', 'colchicine'],
  ['فليكسيلاكس', 'flexilax'],
  ['فليكس ليكس', 'flexilax'],
  ['فليكس لايكس', 'flexilax'],
  ['جاست ريج', 'gast reg'],
  ['جاست ريج امبول', 'gast reg'],
  ['سولو فريش', 'solofresh'],
  ['سولوفريش', 'solofresh'],
  ['كوجي سان', 'koji san'],
  ['مينوكسديل', 'minoxidil'],
  ['المينوكسديل', 'minoxidil'],
  ['فيتشي', 'vichy'],
  ['سنترم', 'centrum'],
  ['السنترم', 'centrum'],
  ['فوليك', 'folic'],
  ['نيروفيت', 'neurovit'],
  ['نيورفيت', 'neurovit'],
  ['دوليبران', 'doliprane'],
  ['دليبران', 'doliprane'],
  ['ديفارول', 'devarol'],
  ['مارنيز', 'marnys'],
  ['اورلي', 'orly'],
  ['أورلي', 'orly'],
  ['حياة', 'hayah'],
  ['حياه', 'hayah'],
  ['ديرما رول', 'derma roller'],
  ['الديرما رول', 'derma roller'],
]);

function confidenceForBasis(basis: ProductMatchBasis): ConfidenceLevel {
  switch (basis) {
    case 'exact_code':
    case 'exact_barcode':
      return 'proven';
    case 'exact_canonical_name':
      return 'strongly_inferred';
    case 'approved_alias':
      return 'strongly_inferred'; // gated on human approval already having happened — see productAliasCandidate.ts
    case 'dominant_name_token_match':
      return 'strongly_inferred';
    case 'cross_script_equivalent':
      return 'weakly_inferred'; // seed table is unvetted heuristic, not a proven identity link
    case 'strength_form_token_match':
      return 'weakly_inferred';
    case 'cautious_fuzzy':
      return FUZZY_MAX_CONFIDENCE_LEVEL;
    case 'unresolved':
      return 'unknown';
  }
}

/**
 * A candidate is "safe" to auto-select when it's the SOLE candidate found (whatever its confidence
 * — a lone weak match is still the system's one honest answer, correctly labeled weak) OR when
 * it's uniquely the highest-confidence one among several (no tie at the top). Ties at the top
 * confidence level are never auto-selected — that is exactly what `ambiguous` is for. Confidence
 * level is a separate, honest signal from selection: a selected candidate can still be
 * weakly_inferred, but a fuzzy-only one is capped there by confidenceForBasis and can never claim
 * more certainty than it has.
 */
function isSafeSelection(candidates: ProductResolutionCandidate[]): ProductResolutionCandidate | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const topLevel = candidates[0].confidence;
  const tiedAtTop = candidates.filter((c) => c.confidence === topLevel);
  return tiedAtTop.length === 1 ? candidates[0] : null;
}

function strengthsCompatible(a: ExtractedStrength[], b: ExtractedStrength[]): boolean {
  if (a.length === 0 || b.length === 0) return true; // insufficient info on one side -> never used to REJECT, only to prefer
  return a.some((sa) => b.some((sb) => sa.unit === sb.unit && Math.abs(sa.value - sb.value) < 0.001));
}

function dosageFormsCompatible(a: DosageForm[], b: DosageForm[]): boolean {
  if (a.length === 0 || b.length === 0) return true;
  return a.some((fa) => b.includes(fa));
}

/** All bare numbers in a normalized string, regardless of whether a unit followed them — this is what lets "Zurcal 20" (no unit typed) still discriminate from "Zurcal 40" (see strengthNumbersCompatible). */
function extractBareNumbers(normalized: string): number[] {
  const numbers: number[] = [];
  const rx = /[0-9]+(?:\.[0-9]+)?/g;
  let match: RegExpExecArray | null;
  while ((match = rx.exec(normalized)) !== null) numbers.push(Number(match[0]));
  return numbers;
}

function productNumericTokens(product: CanonicalProduct): number[] {
  return [...product.strengths.map((s) => s.value), ...product.packSizes.map((p) => p.count)];
}

/**
 * Gate used wherever a phrase carries a bare number with no explicit unit (the "Zurcal 20" case).
 * If the phrase has no numbers, this never rejects. If the phrase has numbers but the candidate has
 * no comparable numeric facts at all, this never rejects either (insufficient catalog info, not a
 * contradiction). It only rejects when BOTH sides have numbers and none of them match — this is
 * exactly what stops "20" from ever matching a "40" SKU.
 */
function bareNumbersCompatible(phraseNumbers: number[], product: CanonicalProduct): boolean {
  if (phraseNumbers.length === 0) return true;
  const productNumbers = productNumericTokens(product);
  if (productNumbers.length === 0) return true;
  return phraseNumbers.some((n) => productNumbers.includes(n));
}

/** Very small, dependency-free token-overlap score for the cautious-fuzzy basis — never edit-distance-based magic, fully inspectable. */
function tokenOverlapScore(a: string, b: string): number {
  const tokensA = new Set(a.split(' ').filter((t) => t.length > 1));
  const tokensB = new Set(b.split(' ').filter((t) => t.length > 1));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let overlap = 0;
  for (const token of tokensA) if (tokensB.has(token)) overlap += 1;
  return overlap / Math.max(tokensA.size, tokensB.size);
}

const NAME_MATCH_STOPWORDS = new Set([
  'a', 'an', 'the', 'for', 'of', 'with', 'to', 'by', 'and',
  'من', 'في', 'مع', 'على', 'الي', 'الى',
]);

const NAME_QUANTITY_TOKENS = new Set([
  'mg', 'ml', 'gm', 'g', 'mcg', 'iu',
  'tab', 'tabs', 'tablet', 'tablets',
  'cap', 'caps', 'capsule', 'capsules',
  'pcs', 'piece', 'pieces',
]);

function meaningfulNameTokens(normalized: string): string[] {
  return normalized
    .split(' ')
    .map((token) => token.trim())
    .filter((token) =>
      token.length > 1 &&
      !/^[0-9]+(?:\.[0-9]+)?$/.test(token) &&
      !NAME_MATCH_STOPWORDS.has(token) &&
      !NAME_QUANTITY_TOKENS.has(token)
    );
}

function expandJoinedPhraseTokens(phraseTokens: string[], productTokens: string[]): string[] {
  const productSet = new Set(productTokens);
  const expanded: string[] = [];

  for (const token of phraseTokens) {
    if (productSet.has(token)) {
      expanded.push(token);
      continue;
    }

    let split: [string, string] | null = null;
    for (let i = 0; i < productTokens.length - 1; i += 1) {
      const left = productTokens[i];
      const right = productTokens[i + 1];
      if (left.length < 3 || right.length < 3) continue;
      if (left + right === token) {
        split = [left, right];
        break;
      }
    }

    if (split) expanded.push(...split);
    else expanded.push(token);
  }

  return expanded;
}

function dominantNameTokenScore(phraseNormalized: string, productNormalized: string): number {
  const productTokens = meaningfulNameTokens(productNormalized);
  if (productTokens.length < 3) return 0;

  const phraseTokens = expandJoinedPhraseTokens(
    meaningfulNameTokens(phraseNormalized),
    productTokens
  );
  if (phraseTokens.length < 3) return 0;

  const productSet = new Set(productTokens);
  const phraseUnique = Array.from(new Set(phraseTokens));
  const productUnique = Array.from(new Set(productTokens));
  const matched = phraseUnique.filter((token) => productSet.has(token)).length;

  if (matched < 3) return 0;

  const phraseCoverage = matched / phraseUnique.length;
  const productCoverage = matched / productUnique.length;

  if (phraseCoverage < 0.75 || productCoverage < 0.8) return 0;
  return Math.min(phraseCoverage, productCoverage);
}

export function resolveProductMention(
  phrase: string,
  index: PharmacyProductIndex,
  options: ResolveProductMentionOptions = {}
): ProductResolutionResult {
  const normalized = normalizePharmacyText(phrase);
  const reasons: string[] = [];
  const candidateMap = new Map<string, ProductResolutionCandidate>();

  const restrictTo = options.knownCandidateProductIds ? new Set(options.knownCandidateProductIds) : null;
  const allowed = (product: CanonicalProduct) => !restrictTo || restrictTo.has(product.productId);

  function addCandidate(product: CanonicalProduct, basis: ProductMatchBasis, score: number, reason: string) {
    if (!allowed(product)) return;
    const existing = candidateMap.get(product.productId);
    // Keep the HIGHEST-confidence basis found for this product — never downgrade a stronger match.
    if (existing && confidenceRank(existing.confidence) >= confidenceRank(confidenceForBasis(basis))) {
      existing.reasons.push(reason);
      return;
    }
    candidateMap.set(product.productId, { product, basis, confidence: confidenceForBasis(basis), score, reasons: [reason] });
  }

  // 1. Exact product code
  const codeMatch = index.byCode.get(normalized.raw.trim().toLowerCase());
  if (codeMatch) addCandidate(codeMatch, 'exact_code', 1, `المدخل يطابق كود المنتج ${codeMatch.productCode} تمامًا`);

  // 2. Exact barcode — structurally supported, always a no-op today (audit: no barcode data exists).
  // (No barcode index to check against — CanonicalProduct.barcode is always null at this catalog snapshot.)

  // 3. Exact canonical normalized name
  const nameMatches = index.byNormalizedName.get(normalized.normalized) ?? [];
  for (const product of nameMatches) {
    addCandidate(product, 'exact_canonical_name', 1, `الاسم المُطبَّع "${normalized.normalized}" يطابق اسم المنتج تمامًا`);
  }

  // 4. Approved alias
  const aliasProductId = options.approvedAliases?.get(normalized.raw.trim().toLowerCase());
  if (aliasProductId) {
    const product = index.catalog.find((p) => p.productId === aliasProductId);
    if (product) addCandidate(product, 'approved_alias', 0.9, `مرادف معتمد يشير إلى هذا المنتج`);
  }

  const phraseBareNumbers = extractBareNumbers(normalized.normalized);

  // 5. Arabic/English cross-script equivalent (seed table) — narrowed by strength/form/bare-number
  // compatibility whenever the phrase carries that signal, so "انتينال كبسول" prefers the capsule
  // SKU over the suspension one instead of treating both brand hits as equally valid.
  const seed = options.crossScriptSeed ?? CROSS_SCRIPT_SEED;
  for (const [arabicKey, latinToken] of seed) {
    if (normalized.normalized.includes(arabicKey) || normalized.raw.includes(arabicKey)) {
      const latinNormalized = normalizePharmacyText(latinToken).normalized;
      for (const [candidateNormalizedName, products] of index.byNormalizedName) {
        if (candidateNormalizedName.includes(latinNormalized)) {
          for (const product of products) {
            if (!strengthsCompatible(normalized.strengths, product.strengths)) continue;
            if (!dosageFormsCompatible(normalized.dosageForms, product.dosageForms)) continue;
            if (!bareNumbersCompatible(phraseBareNumbers, product)) continue;
            addCandidate(product, 'cross_script_equivalent', 0.6, `"${arabicKey}" مرتبط في جدول المرادفات اللغوية بـ "${latinToken}"`);
          }
        }
      }
    }
  }

  // 6. Dominant-name token match. Strong but intentionally strict:
  // >=3 meaningful name tokens, >=75% phrase coverage and >=80% catalog-name coverage.
  // Joined customer spellings such as "teenderm" may expand to adjacent catalog tokens
  // "teen derm". Strength/form/bare-number contradictions remain hard rejections.
  for (const product of index.catalog) {
    if (!allowed(product)) continue;
    if (!strengthsCompatible(normalized.strengths, product.strengths)) continue;
    if (!dosageFormsCompatible(normalized.dosageForms, product.dosageForms)) continue;
    if (!bareNumbersCompatible(phraseBareNumbers, product)) continue;

    const score = Math.max(
      0,
      ...product.normalizedNames.map((name) => dominantNameTokenScore(normalized.normalized, name))
    );
    if (score >= 0.75) {
      addCandidate(
        product,
        'dominant_name_token_match',
        score,
        `تغطية قوية لاسم المنتج (${(score * 100).toFixed(0)}%) مع توافق الشكل/القوة/الأرقام`
      );
    }
  }

  // 7. Strength/form/bare-number-aware token match — fires whenever the phrase carries ANY
  // quantity signal (a unit-bearing strength, a dosage form, or even just a bare number like the
  // "20" in "Zurcal 20"), matched against catalog entries that share a token AND are compatible.
  if (normalized.strengths.length > 0 || normalized.dosageForms.length > 0 || phraseBareNumbers.length > 0) {
    const phraseTokens = normalized.normalized.split(' ').filter((t) => t.length > 2 && !/^[0-9.]+$/.test(t));
    for (const product of index.catalog) {
      if (!allowed(product)) continue;
      if (candidateMap.has(product.productId)) continue; // already found via a stronger basis
      const sharesToken = product.normalizedNames.some((n) => phraseTokens.some((t) => n.includes(t)));
      if (!sharesToken) continue;
      if (!strengthsCompatible(normalized.strengths, product.strengths)) continue;
      if (!dosageFormsCompatible(normalized.dosageForms, product.dosageForms)) continue;
      if (!bareNumbersCompatible(phraseBareNumbers, product)) continue;
      addCandidate(product, 'strength_form_token_match', 0.5, 'تطابق في القوة/الشكل الصيدلاني/الرقم مع رمز مشترك في الاسم');
    }
  }

  // 8. Cautious fuzzy — token overlap only, still gated by strength/form/bare-number compatibility
  // so "Zurcal 20" can never fuzzy-match "Zurcal 40". NEVER reaches above weakly_inferred (enforced
  // by confidenceForBasis, not just by this stage's own score).
  if (candidateMap.size === 0) {
    for (const product of index.catalog) {
      if (!allowed(product)) continue;
      if (!strengthsCompatible(normalized.strengths, product.strengths)) continue;
      if (!dosageFormsCompatible(normalized.dosageForms, product.dosageForms)) continue;
      if (!bareNumbersCompatible(phraseBareNumbers, product)) continue;
      const bestOverlap = Math.max(0, ...product.normalizedNames.map((n) => tokenOverlapScore(normalized.normalized, n)));
      if (bestOverlap >= 0.4) {
        addCandidate(product, 'cautious_fuzzy', bestOverlap, `تداخل جزئي في الكلمات (نسبة ${(bestOverlap * 100).toFixed(0)}%)`);
      }
    }
  }

  const candidates = Array.from(candidateMap.values()).sort(
    (a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence) || b.score - a.score
  );

  if (candidates.length === 0) reasons.push('unresolved: لا يوجد أي مرشح من أي مستوى في التسلسل الهرمي');
  const selected = isSafeSelection(candidates);
  const ambiguous = candidates.length > 1 && !selected;
  if (ambiguous) reasons.push(`ambiguous: ${candidates.length} مرشحين بدون ترجيح آمن`);

  return { phrase, normalized, candidates, selected, ambiguous, reasons };
}

function confidenceRank(level: ConfidenceLevel): number {
  switch (level) {
    case 'proven': return 3;
    case 'strongly_inferred': return 2;
    case 'weakly_inferred': return 1;
    case 'unknown': return 0;
  }
}
