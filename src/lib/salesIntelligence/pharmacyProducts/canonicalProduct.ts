// Phase I.B.1 — Pharmacy Semantic Intelligence: CanonicalProduct entity model.
//
// Derived from the real, live `public.products` table (10,767 rows at audit time — see the I.B.1
// database audit report for the full data-quality findings this model is built to be honest
// about). No field here is invented: every optional field reflects a column that genuinely does
// not exist in the source schema today (barcode, strength, dosage form, pack size, manufacturer,
// category are ALL absent as structured columns — see the audit). Where a fact is missing, it
// stays `null`/empty, never guessed.
import type { DosageForm, ExtractedPackSize, ExtractedStrength } from './pharmacyNormalization';

/**
 * Data-quality flags computed once per catalog row, at load time — never guessed per-query. These
 * exist so a resolver (or a human reviewer) can see WHY a match basis returned what it did,
 * without re-deriving catalog quality signals on every lookup.
 */
export interface CanonicalProductQualityFlags {
  /** True when this row's normalizedName collides with >=1 other row's (see audit: 11 known pairs). */
  hasNormalizedNameCollision: boolean;
  /** True when no strength could be extracted from the name (54.8% of the real catalog, per audit). */
  missingStrength: boolean;
  /** True when no dosage-form keyword could be extracted from the name. */
  missingDosageForm: boolean;
  /** True when the name contains no digit at all (no strength AND no pack size signal). */
  missingAnyQuantitySignal: boolean;
}

export interface CanonicalProduct {
  /** products.id (uuid) — surrogate PK. */
  productId: string;
  /** products.product_code — CONFIRMED 100% unique across the live catalog (10,767/10,767 distinct). The safe, strong identity key. */
  productCode: string;
  /** Not a real column today (audit finding: no barcode field exists anywhere in the schema). Always null until a real source exists — never fabricated from product_code. */
  barcode: string | null;
  /** products.name, verbatim — the catalog's own canonical spelling, whatever script it happens to be in (94.7% of the live catalog is Latin-script brand names; only 5.3% pure Arabic — see audit). */
  canonicalName: string;
  /**
   * Best-effort script split of canonicalName — NOT independent data, since the source table has
   * no separate Arabic/English columns. Populated only when the WHOLE name is confidently
   * single-script; left null for mixed-script names (151 rows, per audit) rather than guessing
   * which part is which.
   */
  arabicName: string | null;
  englishName: string | null;
  /** All normalized string forms this product can be matched against (see normalizedNamesFor()). */
  normalizedNames: string[];
  /** Structured facts PARSED from canonicalName via pharmacyNormalization.ts — never a real column (none exists). Empty array/null means "not detectable from the name", not "confirmed absent". */
  strengths: ExtractedStrength[];
  dosageForms: DosageForm[];
  packSizes: ExtractedPackSize[];
  /** products.category — always null in the live catalog today (100% missing, per audit). Kept as a field for when/if it's ever populated. */
  category: string | null;
  /** Not a real column today. Always null. */
  manufacturer: string | null;
  /** products.price — present for every row in the live catalog (0 missing), but NOT treated as an identity signal by the resolver, only informational. */
  price: number | null;
  /** products.source — single value today ("catalog_import"). Kept for provenance, not used in matching. */
  sourceTable: string;
  qualityFlags: CanonicalProductQualityFlags;
}

export interface RawProductRow {
  id: string;
  name: string;
  product_code: string;
  normalized_name: string;
  category: string | null;
  price: string | number | null;
  source: string;
}

const ARABIC_CHAR_RX = /[ء-ي]/;
const LATIN_CHAR_RX = /[A-Za-z]/;

function splitScriptName(name: string): { arabicName: string | null; englishName: string | null } {
  const hasArabic = ARABIC_CHAR_RX.test(name);
  const hasLatin = LATIN_CHAR_RX.test(name);
  if (hasArabic && !hasLatin) return { arabicName: name, englishName: null };
  if (hasLatin && !hasArabic) return { arabicName: null, englishName: name };
  return { arabicName: null, englishName: null }; // mixed-script — never guess which part is which
}

/**
 * Builds a CanonicalProduct from one raw `products` row plus the full row set (needed only to
 * compute the normalized-name-collision flag honestly, rather than assuming uniqueness).
 */
export function buildCanonicalProduct(
  row: RawProductRow,
  normalizedNameCounts: ReadonlyMap<string, number>,
  normalizeFn: (text: string) => { normalized: string; strengths: ExtractedStrength[]; dosageForms: DosageForm[]; packSizes: ExtractedPackSize[] }
): CanonicalProduct {
  const { arabicName, englishName } = splitScriptName(row.name);
  const normalizedFromName = normalizeFn(row.name);
  const normalizedFromColumn = normalizeFn(row.normalized_name);
  const normalizedNames = Array.from(new Set([normalizedFromName.normalized, normalizedFromColumn.normalized].filter(Boolean)));
  const price = row.price === null ? null : Number(row.price);

  const collisionCount = normalizedNameCounts.get(normalizedFromColumn.normalized) ?? 1;

  return {
    productId: row.id,
    productCode: row.product_code,
    barcode: null,
    canonicalName: row.name,
    arabicName,
    englishName,
    normalizedNames,
    strengths: normalizedFromName.strengths,
    dosageForms: normalizedFromName.dosageForms,
    packSizes: normalizedFromName.packSizes,
    category: row.category,
    manufacturer: null,
    price: price !== null && Number.isFinite(price) ? price : null,
    sourceTable: row.source,
    qualityFlags: {
      hasNormalizedNameCollision: collisionCount > 1,
      missingStrength: normalizedFromName.strengths.length === 0,
      missingDosageForm: normalizedFromName.dosageForms.length === 0,
      missingAnyQuantitySignal: !/[0-9]/.test(normalizedFromName.normalized),
    },
  };
}

/** Pure helper — counts how many rows share each normalized_name, for buildCanonicalProduct's collision flag. */
export function countNormalizedNames(rows: RawProductRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = row.normalized_name.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
