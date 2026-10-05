// Phase I.B.1 — pharmacyProductResolverV2.
//
// Resolves a raw phrase against the real CanonicalProduct catalog using an explicit ordered
// hierarchy. Fuzzy-only evidence is always capped at weak inference.
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
  | 'cross_script_composite'
  | 'dominant_name_token_match'
  | 'strength_form_token_match'
  | 'cautious_fuzzy'
  | 'unresolved';

export type ConfidenceLevel = 'proven' | 'strongly_inferred' | 'weakly_inferred' | 'unknown';

const FUZZY_MAX_CONFIDENCE_LEVEL: ConfidenceLevel = 'weakly_inferred';

export interface ProductResolutionCandidate {
  product: CanonicalProduct;
  basis: ProductMatchBasis;
  confidence: ConfidenceLevel;
  score: number;
  reasons: string[];
}

export interface ProductResolutionResult {
  phrase: string;
  normalized: NormalizedPharmacyText;
  candidates: ProductResolutionCandidate[];
  selected: ProductResolutionCandidate | null;
  ambiguous: boolean;
  reasons: string[];
}

export interface ConversationProductContext {
  basketProductIds?: string[];
  branchNameRaw?: string | null;
}

export interface ResolveProductMentionOptions {
  knownCandidateProductIds?: string[];
  context?: ConversationProductContext;
  approvedAliases?: ReadonlyMap<string, string>;
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

/** Explicit and deliberately incomplete Arabic↔Latin evidence discovered from real pharmacy data. */
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
  ['لبن هيرو بيبي', 'hero baby milk'],
  ['هيرو بيبي', 'hero baby'],
  ['نيوتروني دفنس', 'nutradefense'],
  ['نيوترا دفنس', 'nutradefense'],
  ['كولونا', 'colona'],
  ['جاسترو بيوتيك', 'gastrobiotic'],
  ['جاستروبيوتك', 'gastrobiotic'],
]);

function confidenceForBasis(basis: ProductMatchBasis): ConfidenceLevel {
  switch (basis) {
    case 'exact_code':
    case 'exact_barcode':
      return 'proven';
    case 'exact_canonical_name':
    case 'approved_alias':
    case 'cross_script_composite':
    case 'dominant_name_token_match':
      return 'strongly_inferred';
    case 'cross_script_equivalent':
    case 'strength_form_token_match':
      return 'weakly_inferred';
    case 'cautious_fuzzy':
      return FUZZY_MAX_CONFIDENCE_LEVEL;
    case 'unresolved':
      return 'unknown';
  }
}

function isSafeSelection(candidates: ProductResolutionCandidate[]): ProductResolutionCandidate | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const topLevel = candidates[0].confidence;
  const tiedAtTop = candidates.filter((candidate) => candidate.confidence === topLevel);
  return tiedAtTop.length === 1 ? candidates[0] : null;
}

function strengthsCompatible(a: ExtractedStrength[], b: ExtractedStrength[]): boolean {
  if (a.length === 0 || b.length === 0) return true;
  return a.some((sa) => b.some((sb) => sa.unit === sb.unit && Math.abs(sa.value - sb.value) < 0.001));
}

function dosageFormsCompatible(a: DosageForm[], b: DosageForm[]): boolean {
  if (a.length === 0 || b.length === 0) return true;
  return a.some((form) => b.includes(form));
}

function extractBareNumbers(normalized: string): number[] {
  const numbers: number[] = [];
  const rx = /[0-9]+(?:\.[0-9]+)?/g;
  let match: RegExpExecArray | null;
  while ((match = rx.exec(normalized)) !== null) numbers.push(Number(match[0]));
  return numbers;
}

function productNumericTokens(product: CanonicalProduct): number[] {
  return [...product.strengths.map((strength) => strength.value), ...product.packSizes.map((pack) => pack.count)];
}

function productNameBareNumbers(product: CanonicalProduct): number[] {
  return Array.from(new Set(product.normalizedNames.flatMap((name) => extractBareNumbers(name))));
}

function bareNumbersCompatible(phraseNumbers: number[], product: CanonicalProduct): boolean {
  if (phraseNumbers.length === 0) return true;
  const productNumbers = productNumericTokens(product);
  if (productNumbers.length === 0) return true;
  return phraseNumbers.some((number) => productNumbers.includes(number));
}

function tokenOverlapScore(a: string, b: string): number {
  const tokensA = new Set(a.split(' ').filter((token) => token.length > 1));
  const tokensB = new Set(b.split(' ').filter((token) => token.length > 1));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let overlap = 0;
  for (const token of tokensA) if (tokensB.has(token)) overlap += 1;
  return overlap / Math.max(tokensA.size, tokensB.size);
}

const NAME_MATCH_STOPWORDS = new Set([
  'a', 'an', 'the', 'for', 'of', 'with', 'to', 'by', 'and', 'forwarded',
  'من', 'في', 'مع', 'على', 'الي', 'الى', 'بديل', 'غسول', 'الغسول',
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
  const phraseTokens = expandJoinedPhraseTokens(meaningfulNameTokens(phraseNormalized), productTokens);
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
    if (existing && confidenceRank(existing.confidence) >= confidenceRank(confidenceForBasis(basis))) {
      existing.reasons.push(reason);
      return;
    }
    candidateMap.set(product.productId, {
      product,
      basis,
      confidence: confidenceForBasis(basis),
      score,
      reasons: [reason],
    });
  }

  const codeMatch = index.byCode.get(normalized.raw.trim().toLowerCase());
  if (codeMatch) addCandidate(codeMatch, 'exact_code', 1, `المدخل يطابق كود المنتج ${codeMatch.productCode} تمامًا`);

  const nameMatches = index.byNormalizedName.get(normalized.normalized) ?? [];
  for (const product of nameMatches) {
    addCandidate(product, 'exact_canonical_name', 1, `الاسم المُطبَّع "${normalized.normalized}" يطابق اسم المنتج تمامًا`);
  }

  const aliasProductId = options.approvedAliases?.get(normalized.raw.trim().toLowerCase());
  if (aliasProductId) {
    const product = index.catalog.find((candidate) => candidate.productId === aliasProductId);
    if (product) addCandidate(product, 'approved_alias', 0.9, 'مرادف معتمد يشير إلى هذا المنتج');
  }

  const phraseBareNumbers = extractBareNumbers(normalized.normalized);
  const seed = options.crossScriptSeed ?? CROSS_SCRIPT_SEED;
  const crossScriptCluesByProduct = new Map<string, Set<string>>();

  for (const [arabicKey, latinToken] of seed) {
    if (!normalized.normalized.includes(arabicKey) && !normalized.raw.includes(arabicKey)) continue;
    const latinNormalized = normalizePharmacyText(latinToken).normalized;
    for (const [candidateNormalizedName, products] of index.byNormalizedName) {
      if (!candidateNormalizedName.includes(latinNormalized)) continue;
      for (const product of products) {
        if (!strengthsCompatible(normalized.strengths, product.strengths)) continue;
        if (!dosageFormsCompatible(normalized.dosageForms, product.dosageForms)) continue;
        if (!bareNumbersCompatible(phraseBareNumbers, product)) continue;
        const clues = crossScriptCluesByProduct.get(product.productId) ?? new Set<string>();
        clues.add(arabicKey);
        crossScriptCluesByProduct.set(product.productId, clues);
        addCandidate(
          product,
          'cross_script_equivalent',
          0.6,
          `"${arabicKey}" مرتبط في جدول المرادفات اللغوية بـ "${latinToken}"`
        );
      }
    }
  }

  // A cross-script brand clue becomes strong only when the customer also supplies an explicit
  // dosage form and exactly one cross-script candidate has that form explicitly in the catalog.
  // Products with a missing dosage form do NOT participate in this promotion. This safely resolves
  // cases such as "جاست ريج امبول" while keeping bare "جاست ريج" weak/ambiguous.
  const explicitPhraseForms = normalized.dosageForms.filter((form) => form !== 'unknown');
  if (explicitPhraseForms.length > 0) {
    const formDiscriminated = Array.from(crossScriptCluesByProduct.entries())
      .map(([productId, clues]) => {
        const product = index.catalog.find((candidate) => candidate.productId === productId);
        if (!product || product.dosageForms.length === 0) return null;
        const matchingForms = explicitPhraseForms.filter((form) => product.dosageForms.includes(form));
        return matchingForms.length > 0 ? { product, clues, matchingForms } : null;
      })
      .filter((value): value is { product: CanonicalProduct; clues: Set<string>; matchingForms: DosageForm[] } => Boolean(value));

    if (formDiscriminated.length === 1) {
      const { product, clues, matchingForms } = formDiscriminated[0];
      addCandidate(
        product,
        'cross_script_composite',
        0.86,
        `دليل اسم عربي/إنجليزي (${Array.from(clues).join(' + ')}) مع شكل صيدلاني صريح وفريد (${matchingForms.join(', ')})`
      );
    }
  }

  // A second safe composite route: >=2 explicit cross-script clues plus a numeric discriminator
  // that occurs literally in the canonical product name (e.g. Hero Baby + Nutradefense + stage 3).
  if (phraseBareNumbers.length > 0) {
    for (const [productId, clues] of crossScriptCluesByProduct) {
      if (clues.size < 2) continue;
      const product = index.catalog.find((candidate) => candidate.productId === productId);
      if (!product) continue;
      const canonicalBareNumbers = productNameBareNumbers(product);
      const matchingNumbers = phraseBareNumbers.filter((value) => canonicalBareNumbers.includes(value));
      if (matchingNumbers.length === 0) continue;
      addCandidate(
        product,
        'cross_script_composite',
        0.88,
        `أدلة لغوية مستقلة (${Array.from(clues).join(' + ')}) مع رقم مطابق للاسم القياسي (${matchingNumbers.join(', ')})`
      );
    }
  }

  for (const product of index.catalog) {
    if (!allowed(product)) continue;
    if (!strengthsCompatible(normalized.strengths, product.strengths)) continue;
    if (!dosageFormsCompatible(normalized.dosageForms, product.dosageForms)) continue;
    if (!bareNumbersCompatible(phraseBareNumbers, product)) continue;
    const score = Math.max(0, ...product.normalizedNames.map((name) => dominantNameTokenScore(normalized.normalized, name)));
    if (score >= 0.75) {
      addCandidate(
        product,
        'dominant_name_token_match',
        score,
        `تغطية قوية لاسم المنتج (${(score * 100).toFixed(0)}%) مع توافق الشكل/القوة/الأرقام`
      );
    }
  }

  if (normalized.strengths.length > 0 || normalized.dosageForms.length > 0 || phraseBareNumbers.length > 0) {
    const phraseTokens = normalized.normalized.split(' ').filter((token) => token.length > 2 && !/^[0-9.]+$/.test(token));
    for (const product of index.catalog) {
      if (!allowed(product) || candidateMap.has(product.productId)) continue;
      const sharesToken = product.normalizedNames.some((name) => phraseTokens.some((token) => name.includes(token)));
      if (!sharesToken) continue;
      if (!strengthsCompatible(normalized.strengths, product.strengths)) continue;
      if (!dosageFormsCompatible(normalized.dosageForms, product.dosageForms)) continue;
      if (!bareNumbersCompatible(phraseBareNumbers, product)) continue;
      addCandidate(product, 'strength_form_token_match', 0.5, 'تطابق في القوة/الشكل الصيدلاني/الرقم مع رمز مشترك في الاسم');
    }
  }

  if (candidateMap.size === 0) {
    for (const product of index.catalog) {
      if (!allowed(product)) continue;
      if (!strengthsCompatible(normalized.strengths, product.strengths)) continue;
      if (!dosageFormsCompatible(normalized.dosageForms, product.dosageForms)) continue;
      if (!bareNumbersCompatible(phraseBareNumbers, product)) continue;
      const bestOverlap = Math.max(0, ...product.normalizedNames.map((name) => tokenOverlapScore(normalized.normalized, name)));
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
