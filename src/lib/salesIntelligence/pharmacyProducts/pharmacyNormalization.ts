// Phase I.B.1 — Pharmacy Semantic Intelligence: normalization layer.
//
// Pure, deterministic text normalization for pharmacy product matching. Never normalizes away a
// medically meaningful difference (strength, dosage form, pack size are extracted and kept
// alongside the normalized text, never merged into it silently) — see the design note in
// docs/PHARMACY_SEMANTIC_INTELLIGENCE.md §4-5 for why this matters (Zurcal 20 vs Zurcal 40 must
// never become the same normalized key).
//
// Scope, honestly stated: this is a lightweight, rule-based normalizer, not a full Arabic NLP
// stemmer or a transliteration engine. It handles letter-variant unification, digit conversion,
// punctuation/whitespace, and unit-token normalization — it does NOT attempt phonetic
// Arabic<->English transliteration (e.g. mapping "زوركال" to "Zurcal" algorithmically). That
// cross-script gap is real (see the I.B.1 database audit report) and is intentionally left to the
// alias-candidate system (productAliasCandidate.ts) to close case-by-case with human approval,
// never guessed here.

export type DosageForm =
  | 'tablet'
  | 'capsule'
  | 'syrup'
  | 'suspension'
  | 'cream'
  | 'gel'
  | 'ointment'
  | 'lotion'
  | 'drops'
  | 'spray'
  | 'ampoule'
  | 'vial'
  | 'syringe'
  | 'sachet'
  | 'soap'
  | 'shampoo'
  | 'suppository'
  | 'unknown';

export interface ExtractedStrength {
  value: number;
  unit: 'mg' | 'ml' | 'gm' | 'mcg' | 'iu';
}

export interface ExtractedPackSize {
  count: number;
  unitWord: string;
}

export interface NormalizedPharmacyText {
  /** Lowercased, letter-unified, digit-unified, punctuation-collapsed text. The matching key. */
  normalized: string;
  /** The original input, untouched. */
  raw: string;
  /** All strength mentions found (a name can carry more than one, e.g. combo products). */
  strengths: ExtractedStrength[];
  /** All detected dosage-form keywords, English and Arabic. */
  dosageForms: DosageForm[];
  /** Pack-size counts found (e.g. "30 tab", "٣ علب"), kept separate from strength. */
  packSizes: ExtractedPackSize[];
}

const ARABIC_INDIC_DIGITS: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

const ARABIC_LETTER_VARIANTS: Array<[RegExp, string]> = [
  [/[إأآا]/g, 'ا'],
  [/ى/g, 'ي'],
  [/ة/g, 'ه'],
  [/ؤ/g, 'و'],
  [/ئ/g, 'ي'],
  [/[ً-ْٰـ]/g, ''], // tashkeel + tatweel
];

function convertArabicDigits(text: string): string {
  return text.replace(/[٠-٩]/g, (d) => ARABIC_INDIC_DIGITS[d] ?? d);
}

function unifyArabicLetters(text: string): string {
  let result = text;
  for (const [pattern, replacement] of ARABIC_LETTER_VARIANTS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/** Unit-token synonyms -> canonical unit, English and Arabic. Order matters (longest-first is not needed since word-boundary anchored). */
const UNIT_SYNONYMS: Record<string, ExtractedStrength['unit']> = {
  mg: 'mg', 'مجم': 'mg', 'مج': 'mg', 'ملغ': 'mg', 'ملجم': 'mg',
  ml: 'ml', 'مل': 'ml', 'سم': 'ml',
  gm: 'gm', g: 'gm', 'جم': 'gm', 'جرام': 'gm', 'جرا': 'gm',
  mcg: 'mcg', 'ميكروجرام': 'mcg', 'مكجم': 'mcg',
  iu: 'iu', 'وحده': 'iu', 'وحدة': 'iu',
};

const PACK_UNIT_WORDS = [
  'tab', 'tabs', 'tablet', 'tablets', 'cap', 'caps', 'capsule', 'capsules',
  'pcs', 'piece', 'pieces', 'sachet', 'sachets', 'amp', 'amps', 'ampoule', 'ampoules',
  'قرص', 'اقراص', 'أقراص', 'كبسوله', 'كبسولة', 'كبسول', 'كبسولات', 'كيس', 'اكياس', 'أكياس',
  'علبه', 'علبة', 'علب', 'شريط', 'شرايط', 'امبول', 'أمبول', 'امبولات',
];

const DOSAGE_FORM_KEYWORDS: Array<[RegExp, DosageForm]> = [
  [/\b(tab|tabs|tablet|tablets)\b|قرص|اقراص|أقراص|برشام|حبوب|حبه|حبوه/g, 'tablet'],
  [/\b(cap|caps|capsule|capsules)\b|كبسول|كبسوله|كبسولة|كبسولات/g, 'capsule'],
  [/\b(syrup)\b|شراب/g, 'syrup'],
  [/\b(susp|suspension)\b/g, 'suspension'],
  [/\b(cream)\b|كريم/g, 'cream'],
  [/\b(gel)\b|جل/g, 'gel'],
  [/\b(oint|ointment)\b|مرهم/g, 'ointment'],
  [/\b(lotion)\b|لوشن/g, 'lotion'],
  [/\b(drop|drops)\b|نقط|قطره|قطرة/g, 'drops'],
  [/\b(spray)\b|بخاخ|سبراي/g, 'spray'],
  [/\b(amp|amps|ampoule|ampoules)\b|امبول|أمبول/g, 'ampoule'],
  [/\b(vial)\b/g, 'vial'],
  [/\b(syringe|syringes)\b|سرنج|سرنجه|سرنجة/g, 'syringe'],
  [/\b(sachet|sachets)\b|كيس|اكياس|أكياس/g, 'sachet'],
  [/\b(soap)\b|صابون|صابونه/g, 'soap'],
  [/\b(shampoo)\b|شامبو/g, 'shampoo'],
  [/\b(suppository|suppositories)\b|لبوس/g, 'suppository'],
];

/** Collapses letter/digit/punctuation variants only — never touches numbers or unit words. */
export function normalizeBaseText(text: string): string {
  let result = text;
  result = convertArabicDigits(result);
  result = unifyArabicLetters(result);
  result = result.toLowerCase();
  // Collapse punctuation (dots, dashes, slashes, commas, parentheses) to a single space, but keep
  // digits and letters (Arabic + Latin) intact — a slash inside a strength like "20/10 mg" is
  // deliberately treated as a separator here since the two numbers are handled as separate
  // strength tokens by extractStrengths.
  result = result.replace(/[.,;:_\-\/\\()<>\[\]{}!؟?"'`~*#+=|]/g, ' ');
  // Insert a boundary between a letter (either script) and an immediately adjacent digit, so
  // "زوركال٢٠" (no space in the source) and "زوركال 20" normalize to the same text — customers
  // routinely type strength glued to the name with no separator.
  result = result.replace(/([a-zA-Zء-ي])([0-9])/g, '$1 $2').replace(/([0-9])([a-zA-Zء-ي])/g, '$1 $2');
  result = result.replace(/\s+/g, ' ').trim();
  return result;
}

// Right-boundary lookahead that works across BOTH scripts (JS's \b only recognizes [A-Za-z0-9_] as
// "word" characters, so it silently misbehaves right after an Arabic letter) — asserts the match
// isn't immediately followed by another Latin or Arabic letter, i.e. it isn't a substring of a
// longer word.
const SCRIPT_AWARE_RIGHT_BOUNDARY = '(?![a-zA-Zء-ي])';

export function extractStrengths(normalized: string): ExtractedStrength[] {
  const strengths: ExtractedStrength[] = [];
  const unitAlternation = Object.keys(UNIT_SYNONYMS).sort((a, b) => b.length - a.length).join('|');
  const rx = new RegExp(`([0-9]+(?:\\.[0-9]+)?)\\s*(${unitAlternation})${SCRIPT_AWARE_RIGHT_BOUNDARY}`, 'g');
  let match: RegExpExecArray | null;
  while ((match = rx.exec(normalized)) !== null) {
    const unit = UNIT_SYNONYMS[match[2]];
    if (unit) strengths.push({ value: Number(match[1]), unit });
  }
  return strengths;
}

export function extractPackSizes(normalized: string): ExtractedPackSize[] {
  const packs: ExtractedPackSize[] = [];
  const wordAlternation = PACK_UNIT_WORDS.slice().sort((a, b) => b.length - a.length).join('|');
  const rx = new RegExp(`([0-9]+)\\s*(${wordAlternation})${SCRIPT_AWARE_RIGHT_BOUNDARY}`, 'g');
  let match: RegExpExecArray | null;
  while ((match = rx.exec(normalized)) !== null) {
    packs.push({ count: Number(match[1]), unitWord: match[2] });
  }
  return packs;
}

export function extractDosageForms(normalized: string): DosageForm[] {
  const forms = new Set<DosageForm>();
  for (const [pattern, form] of DOSAGE_FORM_KEYWORDS) {
    pattern.lastIndex = 0;
    if (pattern.test(normalized)) forms.add(form);
  }
  return Array.from(forms);
}

/** The single entry point every caller (resolver, benchmark, catalog import) should use. */
export function normalizePharmacyText(raw: string): NormalizedPharmacyText {
  const normalized = normalizeBaseText(raw);
  return {
    normalized,
    raw,
    strengths: extractStrengths(normalized),
    dosageForms: extractDosageForms(normalized),
    packSizes: extractPackSizes(normalized),
  };
}
