// Phase I.B.3.1 instruction #20 — performance measurement. Uses a SYNTHETIC catalog sized to match
// the real `products` table (10,767 rows, confirmed via SQL against the live Supabase project,
// 2026-09-23) — synthetic names are fine here since this measures INDEX/RESOLUTION SHAPE
// (map-based lookups vs the cautious_fuzzy linear scan), never correctness. Logs timings for the
// I.B.3.1 report rather than asserting tight thresholds that would flake on shared CI hardware; the
// loose upper bounds below exist only to catch a genuine pathological-complexity regression (e.g.
// someone reintroducing an O(N×catalog) span brute force), not to enforce a specific latency SLA.
import { describe, expect, it } from 'vitest';
import { buildCanonicalProduct, countNormalizedNames, type RawProductRow } from '../../pharmacyProducts/canonicalProduct';
import { buildPharmacyProductIndex, resolveProductMention } from '../../pharmacyProducts/pharmacyProductResolverV2';
import { normalizePharmacyText } from '../../pharmacyProducts/pharmacyNormalization';
import { buildProductMentions } from '../../quantityReference/productMentionTracker';
import { buildConversationEntityGraphV2 } from '../conversationEntityGraphV2';
import { messagesFrom } from './testUtils';

const CATALOG_SIZE = 10767;

function buildSyntheticCatalogRows(size: number): RawProductRow[] {
  const brands = ['Antinal', 'Zurcal', 'Flexilax', 'Centrum', 'Neurovit', 'Folic', 'Corega', 'Vichy', 'Isis', 'Cipro'];
  const forms = ['tab', 'cap', 'syrup', 'cream', 'amp', 'susp'];
  const rows: RawProductRow[] = [];
  for (let i = 0; i < size; i++) {
    const brand = brands[i % brands.length];
    const form = forms[i % forms.length];
    const strength = 10 + (i % 12) * 10;
    const name = `${brand} ${strength}mg ${form} #${i}`;
    rows.push({
      id: `synthetic-${i}`,
      name,
      product_code: `${100000 + i}`,
      normalized_name: name.toLowerCase(),
      category: null,
      price: String(50 + (i % 500)),
      source: 'catalog_import',
    });
  }
  return rows;
}

describe('I.B.3.1 — performance (instruction #20)', () => {
  it('catalog index build time stays practical at real catalog size (10,767 rows)', () => {
    const rows = buildSyntheticCatalogRows(CATALOG_SIZE);
    const t0 = performance.now();
    const counts = countNormalizedNames(rows);
    const catalog = rows.map((r) => buildCanonicalProduct(r, counts, normalizePharmacyText));
    const index = buildPharmacyProductIndex(catalog);
    const buildMs = performance.now() - t0;

    // eslint-disable-next-line no-console
    console.log(`[I.B.3.1 performance] catalog index build (${CATALOG_SIZE} rows): ${buildMs.toFixed(1)}ms`);
    expect(index.catalog).toHaveLength(CATALOG_SIZE);
    expect(buildMs).toBeLessThan(5000); // loose sanity bound, not an SLA
  });

  it('per-message product resolution stays practical at real catalog size (batch of 100 phrases)', () => {
    const rows = buildSyntheticCatalogRows(CATALOG_SIZE);
    const counts = countNormalizedNames(rows);
    const catalog = rows.map((r) => buildCanonicalProduct(r, counts, normalizePharmacyText));
    const index = buildPharmacyProductIndex(catalog);

    const phrases = ['Antinal 200mg tab', 'زوركال 40', 'unknown gibberish xyz', 'Centrum 90mg cap #500', 'فليكسيلاكس', 'Corega 120mg cream #12'];
    const batch = Array.from({ length: 100 }, (_, i) => phrases[i % phrases.length]);

    const t0 = performance.now();
    batch.forEach((phrase) => resolveProductMention(phrase, index));
    const totalMs = performance.now() - t0;
    const perCallMs = totalMs / batch.length;

    // eslint-disable-next-line no-console
    console.log(`[I.B.3.1 performance] resolveProductMention: ${totalMs.toFixed(1)}ms for ${batch.length} calls (${perCallMs.toFixed(2)}ms/call) at ${CATALOG_SIZE} rows`);
    expect(perCallMs).toBeLessThan(50); // loose sanity bound — catches a real O(N²)-class regression, not a latency SLA
  });

  it('per-case graph build time stays practical for a typical multi-message conversation', () => {
    const rows = buildSyntheticCatalogRows(CATALOG_SIZE);
    const counts = countNormalizedNames(rows);
    const catalog = rows.map((r) => buildCanonicalProduct(r, counts, normalizePharmacyText));
    const index = buildPharmacyProductIndex(catalog);

    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: موجود
[9/15/26, 9:02:00 AM] Customer: هات 2
[9/15/26, 9:03:00 AM] Customer: وعايز زوركال كمان
[9/15/26, 9:04:00 AM] You: موجود
[9/15/26, 9:05:00 AM] Customer: العلبة بكام
[9/15/26, 9:06:00 AM] You: 100 جنيه
[9/15/26, 9:07:00 AM] Customer: تمام ابعتهم`;
    const messages = messagesFrom(raw);

    const tMentions0 = performance.now();
    buildProductMentions(messages, { productIndex: index });
    const mentionsMs = performance.now() - tMentions0;

    const tGraph0 = performance.now();
    buildConversationEntityGraphV2('perf-case', messages, { productIndex: index });
    const graphMs = performance.now() - tGraph0;

    // eslint-disable-next-line no-console
    console.log(`[I.B.3.1 performance] buildProductMentions: ${mentionsMs.toFixed(1)}ms; full graph build: ${graphMs.toFixed(1)}ms (8-message case, ${CATALOG_SIZE}-row catalog)`);
    expect(graphMs).toBeLessThan(2000); // loose sanity bound
  });
});
