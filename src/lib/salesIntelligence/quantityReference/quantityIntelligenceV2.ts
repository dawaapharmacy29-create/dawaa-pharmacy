// Phase I.B.2 — Quantity Intelligence V2.
//
// BASELINE AUDIT (whatsappSemanticSignalsV32.ts's QUANTITY_RX/REFERENCE_QUANTITY_RX and
// caseBasketEngine.ts's MODIFICATION_QTY_CHANGE_RX, read in full before writing anything here):
//   - QUANTITY_RX only matches NUMBER-THEN-UNIT with a fixed 5-word Arabic number vocabulary
//     (واحد..خمسة) and no Arabic-Indic digit support, no dual forms (علبتين/شريطين/...), and no
//     UNIT-THEN-NUMBER or product-then-number word order at all.
//   - Nothing anywhere in the current pipeline distinguishes a strength ("Zurcal 40") or a pack's
//     own contents ("شريط 10 أقراص") from an order quantity — because nothing before I.B.1 even
//     modeled strength, and caseBasketEngine's own QUANTITY_UNIT_ITEM_RX/MODIFICATION_QTY_CHANGE_RX
//     would treat ANY number-plus-unit as an order line, unconditionally. This is 100% LATENT
//     today (the old code can't yet see "Zurcal 40" as a product+strength pair at all — see the
//     I.B.1 report) but would become a real bug the moment product resolution is wired into basket
//     building, which is exactly why semanticRole is this phase's central contract.
//   - "هات 2" / "هات ٢" (bare number, no unit) is invisible to every existing regex.
//   - MODIFICATION_QTY_CHANGE_RX only understands the two-number "خليهم 3 بدل 2" phrasing; a bare
//     "خليهم 3" (no "بدل"), "زود واحدة", or "شيل واحدة" are not recognized as quantity events at
//     all — "زود واحدة" is even mis-classified as an "add a NEW item named واحده" by
//     caseBasketEngine's own fallback branch (see classifyCustomerModification 'add' path).
//
// HARD RULE enforced below, not just documented: no bare number may be assigned 'order_quantity'
// unless it is preceded by an explicit order verb/reference OR is genuinely the only defensible
// reading — see classifyNumberOccurrence()'s final `unknown` fallback. This directly answers
// instruction #6's "No number may become order quantity unless its semantic role is defensible."
import type { NormalizedConversationMessageV32 } from '../../whatsappConversationUnderstandingV32';
import { convertArabicDigits } from '../pharmacyProducts/pharmacyNormalization';
import { resolveProductMention } from '../pharmacyProducts/pharmacyProductResolverV2';
import type { PharmacyProductIndex, ResolveProductMentionOptions } from '../pharmacyProducts/pharmacyProductResolverV2';
import { computeActiveProductCandidates } from './productMentionTracker';
import type { ProductMentionV2, ReferenceMentionV2 } from './quantityReferenceTypes';
import type { BasketLinkingSafety, QuantityCorrectionKind, QuantityMentionV2, QuantitySemanticRole } from './quantityReferenceTypes';

// ---------------------------------------------------------------------------
// Arabic quantity morphology (instruction #3) — ones words plus dual (-ين) forms. Extended a
// little past the spec's explicit 1-5 list (6-10) since the extra entries are free once the table
// exists; still documented as a closed, curated list, never a stemmer.
// ---------------------------------------------------------------------------

const ONES_WORDS: Record<string, number> = {
  'واحد': 1, 'واحده': 1, 'واحدة': 1,
  'اتنين': 2, 'اثنين': 2,
  'تلات': 3, 'تلاته': 3, 'تلاتة': 3, 'ثلاثة': 3, 'ثلاثه': 3,
  'اربع': 4, 'اربعة': 4, 'اربعه': 4, 'أربعة': 4, 'أربعه': 4,
  'خمس': 5, 'خمسة': 5, 'خمسه': 5,
  'ست': 6, 'سته': 6, 'ستة': 6,
  'سبع': 7, 'سبعة': 7, 'سبعه': 7,
  'تمن': 8, 'تمانية': 8, 'تمانيه': 8, 'ثمانية': 8,
  'تسع': 9, 'تسعة': 9, 'تسعه': 9,
  'عشر': 10, 'عشرة': 10, 'عشره': 10,
};

/**
 * dual (-ين) surface form -> the base unit word it implies, count always 2.
 * I.B.2.1 instruction #9 fix: امبول/فيال are MASCULINE nouns not ending in ة, so their real Arabic
 * dual is stem+ين (امبولين/فيالين) — confirmed against a real Dawaa message ("فيها امبولين هتاخد
 * كل اسبوعين امبول"). I.B.2's original table used "امبولتين", the -تين pattern that only applies
 * to feminine ة-nouns (علبة->علبتين, عبوة->عبوتين) — a genuine morphology bug, not a style choice.
 * The incorrect -تين forms are kept alongside as a lenient fallback (harmless if a customer types
 * them anyway) rather than removed, since colloquial typing is not always grammatically strict.
 */
const DUAL_UNIT_WORDS: Record<string, string> = {
  'علبتين': 'علبة',
  'شريطين': 'شريط',
  'عبوتين': 'عبوة',
  'كيسين': 'كيس',
  'زجاجتين': 'زجاجة',
  'امبولين': 'امبول',
  'أمبولين': 'أمبول',
  'امبولتين': 'امبول', // lenient fallback — see comment above
  'أمبولتين': 'أمبول',
  'فيالين': 'فيال',
  'قرصين': 'قرص',
  'كبسولتين': 'كبسولة',
  'حبتين': 'حبة',
};

type UnitKind = 'retail_pack' | 'dose_unit' | 'strength_unit';

interface UnitInfo {
  kind: UnitKind;
  normalizedUnit: string;
}

const RETAIL_UNIT_WORDS: Record<string, string> = {
  'علبة': 'box', 'علبه': 'box', 'علب': 'box', 'box': 'box', 'boxes': 'box',
  'شريط': 'strip', 'شرايط': 'strip', 'شرائط': 'strip', 'strip': 'strip', 'strips': 'strip',
  'عبوة': 'bottle', 'عبوه': 'bottle', 'عبوات': 'bottle',
  'زجاجة': 'bottle', 'زجاجه': 'bottle', 'bottle': 'bottle', 'bottles': 'bottle',
  'امبول': 'ampoule', 'أمبول': 'ampoule', 'امبولات': 'ampoule', 'ampoule': 'ampoule', 'ampoules': 'ampoule',
  'فيال': 'vial', 'vial': 'vial', 'vials': 'vial',
  'كيس': 'sachet', 'اكياس': 'sachet', 'أكياس': 'sachet', 'sachet': 'sachet', 'sachets': 'sachet',
};

const DOSE_UNIT_WORDS: Record<string, string> = {
  'قرص': 'tablet', 'اقراص': 'tablet', 'أقراص': 'tablet', 'tab': 'tablet', 'tabs': 'tablet', 'tablet': 'tablet', 'tablets': 'tablet',
  'كبسول': 'capsule', 'كبسوله': 'capsule', 'كبسولة': 'capsule', 'كبسولات': 'capsule', 'cap': 'capsule', 'caps': 'capsule', 'capsule': 'capsule', 'capsules': 'capsule',
  'حبة': 'pill', 'حبه': 'pill', 'حبوب': 'pill', 'حبايه': 'pill', 'حبايات': 'pill', 'pill': 'pill', 'pills': 'pill',
};

const STRENGTH_UNIT_WORDS: Record<string, string> = {
  'mg': 'mg', 'مجم': 'mg', 'مج': 'mg', 'ملغ': 'mg', 'ملجم': 'mg',
  'ml': 'ml', 'مل': 'ml', 'سم': 'ml',
  'gm': 'gm', 'g': 'gm', 'جم': 'gm', 'جرام': 'gm', 'جرا': 'gm',
  'mcg': 'mcg', 'ميكروجرام': 'mcg', 'مكجم': 'mcg',
  'iu': 'iu', 'وحدة': 'iu', 'وحده': 'iu',
};

/** Strips a leading Arabic definite article ("العبوه" -> "عبوه") so unit-word lookups match real phrasing like "العبوه 60 كبسوله". Safe against a closed, specific dictionary — a false strip just fails the lookup, never a false match. */
function stripDefiniteArticle(word: string): string {
  return word.startsWith('ال') && word.length > 3 ? word.slice(2) : word;
}

const RETAIL_UNIT_WINDOW_RX = new RegExp(Object.keys(RETAIL_UNIT_WORDS).join('|'), 'i');

/** Instruction #4's "شريط 10 أقراص" pattern in the wild is rarely a strict two-word sequence
 * ("الشريط بيكون 4 حبايات" puts a verb between the retail word and the count) — a retail unit word
 * ANYWHERE earlier in the same message is a real signal the number describes a PACK's own
 * contents, not just when it is the single immediately-preceding token. */
function retailUnitPrecedesWithinWindow(text: string, start: number, windowChars = 40): boolean {
  const window = text.slice(Math.max(0, start - windowChars), start);
  return RETAIL_UNIT_WINDOW_RX.test(window);
}

function lookupUnit(word: string | null): UnitInfo | null {
  if (!word) return null;
  const w = stripDefiniteArticle(word.trim().toLowerCase());
  if (STRENGTH_UNIT_WORDS[w]) return { kind: 'strength_unit', normalizedUnit: STRENGTH_UNIT_WORDS[w] };
  if (RETAIL_UNIT_WORDS[w]) return { kind: 'retail_pack', normalizedUnit: RETAIL_UNIT_WORDS[w] };
  if (DOSE_UNIT_WORDS[w]) return { kind: 'dose_unit', normalizedUnit: DOSE_UNIT_WORDS[w] };
  return null;
}

const ORDER_VERB_OR_PRONOUN_RX = /(?:هات[ي]?|عايز[ةه]?|عاوز[ةه]?|محتاج[ةه]?|ضيف[ي]?|ابعت(?:لي|يلي)?|منه|منها)$/i;
const LATIN_BRAND_TOKEN_RX = /^[A-Za-z][A-Za-z\-]{2,}$/;

// I.B.2.1 instruction #13 — a number near any of these markers is talking about MONEY, never a
// quantity to order. Checked before any unit-based classification so it can never be shadowed by
// an accidental unit-word match nearby.
const PRICE_CONTEXT_RX = /جنيه|جنيها|ج\.?م\.?|بكام|كام|السعر|سعر|الحساب|حساب|الاجمالي|الإجمالي|المجموع/i;

function priceContextNearby(text: string, start: number, end: number, windowChars = 12): boolean {
  const before = text.slice(Math.max(0, start - windowChars), start);
  const after = text.slice(end, end + windowChars);
  return PRICE_CONTEXT_RX.test(before) || PRICE_CONTEXT_RX.test(after);
}

// I.B.2.1 instruction #12 — a strength number followed by an administration instruction ("5 مل
// بعد الأكل") describes a DOSE (how much to take), not the strength label the catalog quotes it by.
const DOSE_ADMINISTRATION_MARKER_RX =
  /بعد\s*(?:الأكل|الاكل|الفطار|الغدا|العشا)|قبل\s*(?:الأكل|الاكل|النوم)|علي?\s*الريق/i;

function doseAdministrationMarkerFollows(text: string, end: number, windowChars = 30): boolean {
  return DOSE_ADMINISTRATION_MARKER_RX.test(text.slice(end, end + windowChars));
}

function precedingPhrase(text: string, start: number, maxChars = 40): string {
  return text.slice(Math.max(0, start - maxChars), start).trim();
}

// A number/number-word occurrence and its immediate lexical context.
interface NumberOccurrence {
  rawText: string;
  numericValue: number;
  start: number;
  end: number;
  isDual: boolean;
  dualBaseUnit: string | null;
}

const NUMBER_TOKEN_RX = new RegExp(
  `([0-9]+(?:\\.[0-9]+)?)|(${Object.keys(DUAL_UNIT_WORDS).join('|')})|(${Object.keys(ONES_WORDS)
    .sort((a, b) => b.length - a.length)
    .join('|')})`,
  'gi'
);

function findNumberOccurrences(text: string): NumberOccurrence[] {
  const occurrences: NumberOccurrence[] = [];
  let match: RegExpExecArray | null;
  NUMBER_TOKEN_RX.lastIndex = 0;
  while ((match = NUMBER_TOKEN_RX.exec(text)) !== null) {
    if (match[1] !== undefined) {
      occurrences.push({ rawText: match[0], numericValue: Number(match[1]), start: match.index, end: match.index + match[0].length, isDual: false, dualBaseUnit: null });
    } else if (match[2] !== undefined) {
      occurrences.push({
        rawText: match[0],
        numericValue: 2,
        start: match.index,
        end: match.index + match[0].length,
        isDual: true,
        dualBaseUnit: DUAL_UNIT_WORDS[match[2]] ?? null,
      });
    } else if (match[3] !== undefined) {
      occurrences.push({ rawText: match[0], numericValue: ONES_WORDS[match[3]], start: match.index, end: match.index + match[0].length, isDual: false, dualBaseUnit: null });
    }
  }
  return occurrences;
}

function wordAfter(text: string, end: number): string | null {
  const slice = text.slice(end, end + 20);
  const m = slice.match(/^\s*([^\s.,،؟?!]+)/);
  return m ? m[1] : null;
}

function wordBefore(text: string, start: number): string | null {
  const slice = text.slice(Math.max(0, start - 20), start);
  const m = slice.match(/([^\s.,،؟?!]+)\s*$/);
  return m ? m[1] : null;
}

/** Instructions #4/#6 — classifies ONE number occurrence's semantic role from its lexical context only (no cross-message state here; see extractQuantityMentionsV2 for cross-message linking/correction targeting). */
function classifyNumberOccurrence(
  occurrence: NumberOccurrence,
  fullText: string,
  productIndex?: PharmacyProductIndex,
  resolveOptions?: ResolveProductMentionOptions
): { role: QuantitySemanticRole; unit: string | null; normalizedUnit: string | null; confidence: number; confidenceFactors: string[]; ruleIds: string[]; ambiguityReasons: string[] } {
  // I.B.2.1 instruction #14 — a number that IS a known catalog product_code must never be read as
  // a quantity at all, regardless of any other pattern nearby. Checked first, highest priority.
  if (productIndex?.byCode.has(String(occurrence.numericValue))) {
    return {
      role: 'unknown',
      unit: null,
      normalizedUnit: null,
      confidence: 0.3,
      confidenceFactors: ['numeric_matches_known_product_code'],
      ruleIds: ['quantity.protection.product_code_excluded'],
      ambiguityReasons: ['numeric_product_code_excluded'],
    };
  }

  // I.B.2.1 instruction #13 — price protection, checked before any unit-based rule so a coincidental
  // adjacent unit word can never override it.
  if (priceContextNearby(fullText, occurrence.start, occurrence.end)) {
    return {
      role: 'unknown',
      unit: null,
      normalizedUnit: null,
      confidence: 0.3,
      confidenceFactors: ['price_context_nearby'],
      ruleIds: ['quantity.protection.price_context_excluded'],
      ambiguityReasons: ['price_context_excluded'],
    };
  }

  if (occurrence.isDual && occurrence.dualBaseUnit) {
    const info = lookupUnit(occurrence.dualBaseUnit);
    if (info?.kind === 'retail_pack') {
      return {
        role: 'order_quantity',
        unit: occurrence.dualBaseUnit,
        normalizedUnit: info.normalizedUnit,
        confidence: 0.85,
        confidenceFactors: ['explicit_dual_unit_form'],
        ruleIds: ['quantity.order.dual_form_retail'],
        ambiguityReasons: [],
      };
    }
    if (info?.kind === 'dose_unit') {
      return {
        role: 'order_quantity',
        unit: occurrence.dualBaseUnit,
        normalizedUnit: info.normalizedUnit,
        confidence: 0.7,
        confidenceFactors: ['explicit_dual_unit_form', 'dose_unit_not_retail_pack'],
        ruleIds: ['quantity.order.dual_form_dose'],
        ambiguityReasons: ['dose_unit_retail_pack_ambiguous'],
      };
    }
  }

  const after = wordAfter(fullText, occurrence.end);
  const before = wordBefore(fullText, occurrence.start);
  const afterUnit = lookupUnit(after);
  const beforeUnit = lookupUnit(before);

  if (afterUnit?.kind === 'strength_unit') {
    // I.B.2.1 instruction #12 — "5 مل بعد الأكل" is a DOSE instruction, not the SKU's strength label.
    if (doseAdministrationMarkerFollows(fullText, occurrence.end)) {
      return {
        role: 'dose',
        unit: after,
        normalizedUnit: afterUnit.normalizedUnit,
        confidence: 0.75,
        confidenceFactors: ['explicit_unit', 'administration_instruction_follows'],
        ruleIds: ['quantity.dose.unit_with_administration_marker'],
        ambiguityReasons: [],
      };
    }
    return {
      role: 'strength',
      unit: after,
      normalizedUnit: afterUnit.normalizedUnit,
      confidence: 0.9,
      confidenceFactors: ['explicit_strength_unit'],
      ruleIds: ['quantity.strength.explicit_unit'],
      ambiguityReasons: [],
    };
  }

  // I.B.2.1 instruction #11 — catalog-assisted pack-size disambiguation. A bare number matching a
  // KNOWN packSize.count for a product plausibly named just before it is strong, independent
  // evidence the number describes the catalog's own pack size — checked before the weaker generic
  // dose/retail-unit heuristics below, since real catalog data beats a regex guess.
  if (productIndex) {
    const phrase = precedingPhrase(fullText, occurrence.start);
    if (phrase.length >= 3) {
      const resolution = resolveProductMention(phrase, productIndex, resolveOptions);
      const packSizeMatch = resolution.candidates.some((c) => c.product.packSizes.some((p) => p.count === occurrence.numericValue));
      if (packSizeMatch) {
        return {
          role: 'pack_size',
          unit: after,
          normalizedUnit: afterUnit?.normalizedUnit ?? null,
          confidence: 0.85,
          confidenceFactors: ['catalog_confirmed_pack_size'],
          ruleIds: ['quantity.pack_size.catalog_confirmed'],
          ambiguityReasons: [],
        };
      }
    }
  }

  if (afterUnit?.kind === 'dose_unit' && (beforeUnit?.kind === 'retail_pack' || retailUnitPrecedesWithinWindow(fullText, occurrence.start))) {
    return {
      role: 'pack_size',
      unit: after,
      normalizedUnit: afterUnit.normalizedUnit,
      confidence: 0.85,
      confidenceFactors: ['retail_unit_precedes', 'dose_unit_follows'],
      ruleIds: ['quantity.pack_size.retail_unit_then_dose_count'],
      ambiguityReasons: [],
    };
  }

  if (afterUnit?.kind === 'retail_pack') {
    return {
      role: 'order_quantity',
      unit: after,
      normalizedUnit: afterUnit.normalizedUnit,
      confidence: 0.85,
      confidenceFactors: ['explicit_retail_unit'],
      ruleIds: ['quantity.order.number_then_retail_unit'],
      ambiguityReasons: [],
    };
  }

  if (afterUnit?.kind === 'dose_unit') {
    return {
      role: 'order_quantity',
      unit: after,
      normalizedUnit: afterUnit.normalizedUnit,
      confidence: 0.6,
      confidenceFactors: ['explicit_dose_unit', 'no_retail_pack_context'],
      ruleIds: ['quantity.order.number_then_dose_unit'],
      ambiguityReasons: ['dose_unit_retail_pack_ambiguous'],
    };
  }

  if (before && ORDER_VERB_OR_PRONOUN_RX.test(before)) {
    return {
      role: 'order_quantity',
      unit: null,
      normalizedUnit: null,
      confidence: 0.6,
      confidenceFactors: ['preceded_by_order_verb_or_reference'],
      ruleIds: ['quantity.order.bare_number_after_order_context'],
      ambiguityReasons: ['no_explicit_unit'],
    };
  }

  const brandToken = before && LATIN_BRAND_TOKEN_RX.test(before) ? before : after && LATIN_BRAND_TOKEN_RX.test(after) ? after : null;
  if (brandToken) {
    if (productIndex) {
      // Probe with the brand token PLUS the number itself (e.g. "Zurcal 40") rather than the bare
      // brand alone — resolveProductMention's strength/bare-number gating (see
      // pharmacyProductResolverV2.ts stage 6) only activates once the phrase itself carries a
      // numeric signal; a bare brand name alone never clears its fuzzy-match threshold.
      const resolution = resolveProductMention(`${brandToken} ${occurrence.rawText}`, productIndex, resolveOptions);
      // Check every candidate, not just `selected` — a bare brand name legitimately matches
      // several SKUs differing only by strength (e.g. Zurcal 20 vs 40), so resolution itself may
      // be ambiguous even though the NUMBER'S ROLE (strength, not order quantity) is still clear.
      const strengthMatch = resolution.candidates.some((c) => c.product.strengths.some((s) => s.value === occurrence.numericValue));
      if (strengthMatch) {
        return {
          role: 'strength',
          unit: null,
          normalizedUnit: null,
          confidence: 0.9,
          confidenceFactors: ['bare_number_adjacent_brand', 'catalog_confirmed_strength'],
          ruleIds: ['quantity.strength.brand_number_catalog_confirmed'],
          ambiguityReasons: [],
        };
      }
    }
    return {
      role: 'unknown',
      unit: null,
      normalizedUnit: null,
      confidence: 0.35,
      confidenceFactors: ['bare_number_adjacent_brand_unverified'],
      ruleIds: ['quantity.unknown.bare_number_adjacent_brand_unverified'],
      ambiguityReasons: ['brand_strength_not_catalog_confirmed'],
    };
  }

  return {
    role: 'unknown',
    unit: null,
    normalizedUnit: null,
    confidence: 0.3,
    confidenceFactors: ['no_defensible_context'],
    ruleIds: ['quantity.unknown.bare_number_no_context'],
    ambiguityReasons: ['bare_number_no_context'],
  };
}

// I.B.2.1 instruction #12 fix: the leading count ("3 مرات") was previously ignored entirely —
// numericValue silently fell back to the fixed 1/2 implied by مرة/مرتين, so "3 مرات في اليوم" was
// reported as frequency=1, dropping the real number.
const FREQUENCY_RX = /(?:([0-9]+)\s*)?(مرت?ين|مرة|مره|مرات)\s*(?:في|كل)?\s*(اليوم|يوم|الاسبوع|اسبوع)?/i;
const DURATION_RX = /لمدة\s*([0-9]+|واحد[ةه]?|اتنين|تلات[ةه]?|أربع[ةه]?|اربع[ةه]?|خمس[ةه]?)\s*(يوم|أيام|ايام|اسبوع|أسبوع|اسابيع|أسابيع|شهر|شهور)/i;

// I.B.2.1 fix: all three require a real LEFT word boundary (start-of-string or preceded by
// whitespace) — without it, "ازود لحضرتك حاجة معاه؟" (a real Dawaa STAFF question, "should I add
// something for you?") matched INCREMENT_RX as a substring ("زود" inside "ازود"), which combined
// with the missing role gate below would have wrongly treated a staff QUESTION as a confirmed
// customer correction. `\b` cannot be used here — it never matches next to Arabic script.
const CORRECTION_REPLACE_RX = /(?:^|(?<=\s))(?:لا\s*)?خلي(?:ه|هم|ها)?\s*(?:يبقو[او]|يبقى)?\s*([0-9]+|واحد[ةه]?|اتنين|تلات[ةه]?|أربع[ةه]?|اربع[ةه]?|خمس[ةه]?)(?!\s*بدل)/i;
const INCREMENT_RX = /(?:^|(?<=\s))زود(?:ي)?\s*(واحد[ةه]?|اتنين|[0-9]+)?/i;
const DECREMENT_RX = /(?:^|(?<=\s))شيل(?:ي)?\s*(واحد[ةه]?|اتنين|[0-9]+)?/i;

// I.B.2.1 instruction #10 — implicit quantity=1 is inferred ONLY for this narrow, benchmarked
// shape (customer order verb immediately followed by a BARE retail-unit noun, no number at all
// anywhere in the message) and NEVER for an availability/price question about the same words
// ("هو الشريط بكام؟", "الدواء موجود شريط؟"). Kept deliberately narrow per the instruction's own
// caution — see computeQuantitySafety() below, which never lets this rule's output reach `safe`.
// No trailing \b: JS's \b never matches next to Arabic script (see the same documented pitfall in
// pharmacyNormalization.ts/whatsappSemanticSignalsV32.ts) — "شريط\b" would silently never match.
const IMPLICIT_ONE_ORDER_RX = /(?:هات[ي]?|عايز[ةه]?|عاوز[ةه]?|محتاج[ةه]?)\s+(علبة|علبه|علب|شريط|عبوة|عبوه|زجاجة|زجاجه|امبول|أمبول|فيال|كيس)/i;
const INTERROGATIVE_RX = /[؟?]|بكام|كام(?![ء-ي])|هل(?![ء-ي])/i;

function detectImplicitOne(text: string): { unit: string; normalizedUnit: string; start: number; end: number } | null {
  if (INTERROGATIVE_RX.test(text)) return null;
  const match = text.match(IMPLICIT_ONE_ORDER_RX);
  if (!match || match.index === undefined) return null;
  const info = lookupUnit(match[1]);
  if (info?.kind !== 'retail_pack') return null;
  const unitOffset = match[0].lastIndexOf(match[1]);
  const start = match.index + Math.max(0, unitOffset);
  return { unit: match[1], normalizedUnit: info.normalizedUnit, start, end: start + match[1].length };
}

function parseCorrectionNumber(token: string | undefined): number {
  if (!token) return 1;
  if (/^[0-9]+$/.test(token)) return Number(token);
  return ONES_WORDS[token] ?? 1;
}

export interface QuantityExtractionOptions {
  productIndex?: PharmacyProductIndex;
  resolveOptions?: ResolveProductMentionOptions;
  /**
   * I.B.2.1 fix: a زود/شيل/خليهم-style correction is only ever a real customer instruction — a
   * STAFF message using the same words is asking a question ("ازود لحضرتك حاجة معاه؟"), never
   * confirming a quantity change. Corrections are skipped entirely when this is anything but
   * 'customer'; left undefined (the default for direct, message-less calls in tests) still allows
   * them, since a bare phrase with no known speaker is assumed customer-authored.
   */
  role?: NormalizedConversationMessageV32['role'];
}

/** Pure, single-message extraction — no cross-message linking (see extractQuantityMentionsV2 for that). Exported for direct unit testing of the role classifier. */
export function extractQuantityCandidatesFromText(
  rawMessageText: string,
  options: QuantityExtractionOptions = {}
): Array<Omit<QuantityMentionV2, 'mentionId' | 'sourceMessageId' | 'linkedProductMentionId' | 'correctionOfMentionId' | 'safeForBasketLinking'>> {
  const text = convertArabicDigits(rawMessageText);
  const results: Array<Omit<QuantityMentionV2, 'mentionId' | 'sourceMessageId' | 'linkedProductMentionId' | 'correctionOfMentionId' | 'safeForBasketLinking'>> = [];
  const consumed: Array<[number, number]> = [];

  const isConsumed = (start: number, end: number) => consumed.some(([s, e]) => start < e && end > s);

  // Corrections first — they claim their own number and must not also be double-counted by the
  // generic scanner below. Only ever attempted for a customer message (or an unknown speaker, for
  // direct/bare-string calls) — see QuantityExtractionOptions.role's own doc comment.
  const allowCorrections = options.role === undefined || options.role === 'customer';
  const replaceMatch = allowCorrections ? text.match(CORRECTION_REPLACE_RX) : null;
  if (replaceMatch && replaceMatch.index !== undefined) {
    const numToken = replaceMatch[1];
    results.push({
      rawText: replaceMatch[0].trim(),
      numericValue: parseCorrectionNumber(numToken),
      unit: null,
      normalizedUnit: null,
      semanticRole: 'order_quantity',
      confidence: 0.7,
      confidenceFactors: ['explicit_correction_phrase'],
      ruleIds: ['quantity.correction.replace'],
      ambiguityReasons: [],
      correctionKind: 'replace' as QuantityCorrectionKind,
      sourceOffsetStart: replaceMatch.index,
      sourceOffsetEnd: replaceMatch.index + replaceMatch[0].length,
    });
    consumed.push([replaceMatch.index, replaceMatch.index + replaceMatch[0].length]);
  }
  const incMatch = allowCorrections ? text.match(INCREMENT_RX) : null;
  if (incMatch && incMatch.index !== undefined && !isConsumed(incMatch.index, incMatch.index + incMatch[0].length)) {
    results.push({
      rawText: incMatch[0].trim(),
      numericValue: parseCorrectionNumber(incMatch[1]),
      unit: null,
      normalizedUnit: null,
      semanticRole: 'order_quantity',
      confidence: 0.65,
      confidenceFactors: ['explicit_increment_phrase'],
      ruleIds: ['quantity.correction.increment'],
      ambiguityReasons: [],
      correctionKind: 'increment' as QuantityCorrectionKind,
      sourceOffsetStart: incMatch.index,
      sourceOffsetEnd: incMatch.index + incMatch[0].length,
    });
    consumed.push([incMatch.index, incMatch.index + incMatch[0].length]);
  }
  const decMatch = allowCorrections ? text.match(DECREMENT_RX) : null;
  if (decMatch && decMatch.index !== undefined && !isConsumed(decMatch.index, decMatch.index + decMatch[0].length)) {
    results.push({
      rawText: decMatch[0].trim(),
      numericValue: parseCorrectionNumber(decMatch[1]),
      unit: null,
      normalizedUnit: null,
      semanticRole: 'order_quantity',
      confidence: 0.65,
      confidenceFactors: ['explicit_decrement_phrase'],
      ruleIds: ['quantity.correction.decrement'],
      ambiguityReasons: [],
      correctionKind: 'decrement' as QuantityCorrectionKind,
      sourceOffsetStart: decMatch.index,
      sourceOffsetEnd: decMatch.index + decMatch[0].length,
    });
    consumed.push([decMatch.index, decMatch.index + decMatch[0].length]);
  }

  const freqMatch = text.match(FREQUENCY_RX);
  if (freqMatch && freqMatch.index !== undefined) {
    results.push({
      rawText: freqMatch[0].trim(),
      numericValue: freqMatch[1] ? Number(freqMatch[1]) : freqMatch[2].includes('ين') ? 2 : 1,
      unit: freqMatch[2],
      normalizedUnit: 'times_per_period',
      semanticRole: 'frequency',
      confidence: 0.6,
      confidenceFactors: ['explicit_frequency_phrase'],
      ruleIds: ['quantity.frequency.explicit_phrase'],
      ambiguityReasons: [],
      correctionKind: null,
      sourceOffsetStart: freqMatch.index,
      sourceOffsetEnd: freqMatch.index + freqMatch[0].length,
    });
    consumed.push([freqMatch.index, freqMatch.index + freqMatch[0].length]);
  }
  const durMatch = text.match(DURATION_RX);
  if (durMatch && durMatch.index !== undefined) {
    results.push({
      rawText: durMatch[0].trim(),
      numericValue: /^[0-9]+$/.test(durMatch[1]) ? Number(durMatch[1]) : ONES_WORDS[durMatch[1]] ?? 1,
      unit: durMatch[2],
      normalizedUnit: 'duration_period',
      semanticRole: 'duration',
      confidence: 0.6,
      confidenceFactors: ['explicit_duration_phrase'],
      ruleIds: ['quantity.duration.explicit_phrase'],
      ambiguityReasons: [],
      correctionKind: null,
      sourceOffsetStart: durMatch.index,
      sourceOffsetEnd: durMatch.index + durMatch[0].length,
    });
    consumed.push([durMatch.index, durMatch.index + durMatch[0].length]);
  }

  for (const occurrence of findNumberOccurrences(text)) {
    if (isConsumed(occurrence.start, occurrence.end)) continue;
    const classified = classifyNumberOccurrence(occurrence, text, options.productIndex, options.resolveOptions);
    results.push({
      rawText: occurrence.rawText,
      numericValue: occurrence.numericValue,
      unit: classified.unit,
      normalizedUnit: classified.normalizedUnit,
      semanticRole: classified.role,
      confidence: classified.confidence,
      confidenceFactors: classified.confidenceFactors,
      ruleIds: classified.ruleIds,
      ambiguityReasons: classified.ambiguityReasons,
      correctionKind: null,
      sourceOffsetStart: occurrence.start,
      sourceOffsetEnd: occurrence.end,
    });
  }

  // I.B.2.1 instruction #10 — only ever attempted when NO number was found anywhere in the
  // message at all; a message that already states an explicit number never needs (or gets) an
  // inferred one.
  if (results.length === 0) {
    const implicit = detectImplicitOne(text);
    if (implicit) {
      results.push({
        rawText: implicit.unit,
        numericValue: 1,
        unit: implicit.unit,
        normalizedUnit: implicit.normalizedUnit,
        semanticRole: 'order_quantity',
        confidence: 0.5,
        confidenceFactors: ['implicit_one_from_order_verb_plus_bare_retail_unit'],
        ruleIds: ['quantity.order.implicit_one_bare_retail_unit'],
        ambiguityReasons: ['implicit_quantity_inferred_not_stated'],
        correctionKind: null,
        sourceOffsetStart: implicit.start,
        sourceOffsetEnd: implicit.end,
      });
    }
  }

  return results;
}

/**
 * I.B.2.1 instruction #18 — see BasketLinkingSafety's own doc comment. `safe` requires the role to
 * be a real order_quantity, a confirmed link to exactly one product, decent confidence, AND no
 * open ambiguity reason at all (an inferred-not-stated implicit quantity always carries
 * 'implicit_quantity_inferred_not_stated', which alone caps it at `review` — see instruction #10's
 * own caution that this rule's safety has not been demonstrated strongly enough for `safe`).
 */
function computeQuantitySafety(mention: Pick<QuantityMentionV2, 'semanticRole' | 'linkedProductMentionId' | 'confidence' | 'ambiguityReasons'>): BasketLinkingSafety {
  if (mention.semanticRole !== 'order_quantity') return 'unsafe';
  if (!mention.linkedProductMentionId) return 'unsafe';
  if (mention.ambiguityReasons.length > 0) return 'review';
  if (mention.confidence >= 0.8) return 'safe';
  return 'review';
}

/**
 * Phase I.B.4 — use an already-resolved SAME-MESSAGE reference as an independent target resolver
 * for an order quantity. This does not re-run reference logic and never lowers its safety gate:
 * only a reference marked `safe`, pointing to exactly one selected antecedent, whose literal span
 * ends before this quantity begins may supply the target. If multiple safe references disagree,
 * no target is chosen. This is the missing bridge for phrases such as
 * "عايز انتينال وهات منه اتنين".
 */
function targetFromSafeSameMessageReference(
  sourceMessageId: string,
  quantityOffsetStart: number | null | undefined,
  references: ReferenceMentionV2[]
): string | null {
  if (quantityOffsetStart == null) return null;
  const eligible = references.filter((r) =>
    r.sourceMessageId === sourceMessageId &&
    r.safeForBasketLinking === 'safe' &&
    r.resolutionStatus === 'resolved' &&
    r.selectedAntecedentId != null &&
    r.sourceOffsetEnd != null &&
    r.sourceOffsetEnd <= quantityOffsetStart
  );
  const targets = Array.from(new Set(eligible.map((r) => r.selectedAntecedentId!)));
  return targets.length === 1 ? targets[0] : null;
}

/**
 * Case-scoped orchestrator: extracts every message's candidates, then does cross-message linking
 * (instruction #12/#5) — a correction/increment/decrement or a unit-less order_quantity is only
 * ever linked to a product when EXACTLY ONE product is active at that point; otherwise it stays
 * unlinked with an explicit ambiguity reason, never guessed (instruction #11).
 */
export function extractQuantityMentionsV2(
  messages: NormalizedConversationMessageV32[],
  productMentions: ProductMentionV2[],
  options: QuantityExtractionOptions = {},
  referenceMentions: ReferenceMentionV2[] = []
): QuantityMentionV2[] {
  const mentions: QuantityMentionV2[] = [];
  let priorOrderQuantityMentionId: string | null = null;
  let seq = 0;

  messages.forEach((message, messageIndex) => {
    if (!message.isMeaningful) return;
    const candidates = extractQuantityCandidatesFromText(message.text, { ...options, role: message.role });
    if (candidates.length === 0) return;

    const activeCandidates = computeActiveProductCandidates(messages, productMentions, messageIndex);
    const soleActiveProductId = activeCandidates.length === 1 ? activeCandidates[0].identityKey : null;

    candidates.forEach((candidate) => {
      const mentionId = `qm:${message.id}:${seq++}`;
      let linkedProductMentionId: string | null = null;
      let correctionOfMentionId: string | null = null;
      const ambiguityReasons = [...candidate.ambiguityReasons];

      if (candidate.semanticRole === 'order_quantity') {
        const sameMessageReferenceTarget = targetFromSafeSameMessageReference(
          message.id,
          candidate.sourceOffsetStart,
          referenceMentions
        );
        if (sameMessageReferenceTarget) {
          linkedProductMentionId = sameMessageReferenceTarget;
          ambiguityReasons.splice(0, ambiguityReasons.length, ...ambiguityReasons.filter((r) => r !== 'multiple_active_products_target_ambiguous'));
        } else if (soleActiveProductId) {
          linkedProductMentionId = soleActiveProductId;
        } else if (activeCandidates.length > 1) {
          ambiguityReasons.push('multiple_active_products_target_ambiguous');
        }
      }

      if (candidate.correctionKind) {
        if (linkedProductMentionId) {
          correctionOfMentionId = priorOrderQuantityMentionId;
        } else if (soleActiveProductId) {
          correctionOfMentionId = priorOrderQuantityMentionId;
          linkedProductMentionId = soleActiveProductId;
        } else {
          ambiguityReasons.push('multiple_active_products_no_safe_target');
        }
      }

      const mention: QuantityMentionV2 = {
        mentionId,
        rawText: candidate.rawText,
        numericValue: candidate.numericValue,
        unit: candidate.unit,
        normalizedUnit: candidate.normalizedUnit,
        semanticRole: candidate.semanticRole,
        linkedProductMentionId,
        sourceMessageId: message.id,
        sourceOffsetStart: candidate.sourceOffsetStart ?? null,
        sourceOffsetEnd: candidate.sourceOffsetEnd ?? null,
        confidence: candidate.confidence,
        confidenceFactors: candidate.confidenceFactors,
        ruleIds: candidate.ruleIds,
        ambiguityReasons,
        correctionKind: candidate.correctionKind,
        correctionOfMentionId,
        safeForBasketLinking: computeQuantitySafety({ semanticRole: candidate.semanticRole, linkedProductMentionId, confidence: candidate.confidence, ambiguityReasons }),
      };
      mentions.push(mention);
      if (mention.semanticRole === 'order_quantity' && linkedProductMentionId) {
        priorOrderQuantityMentionId = mentionId;
      }
    });
  });

  return mentions;
}
