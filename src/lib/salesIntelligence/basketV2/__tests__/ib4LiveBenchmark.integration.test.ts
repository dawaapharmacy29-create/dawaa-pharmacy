import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { buildCanonicalProduct, countNormalizedNames, type RawProductRow } from '../../pharmacyProducts/canonicalProduct';
import { normalizePharmacyText } from '../../pharmacyProducts/pharmacyNormalization';
import { buildPharmacyProductIndex } from '../../pharmacyProducts/pharmacyProductResolverV2';
import { runIb4EvaluationV2 } from '../ib4EvaluationV2';

/**
 * Phase I.B.4 — supervised LIVE benchmark against the real public.products catalog.
 *
 * Disabled by default so the normal test suite remains hermetic.
 *
 * PowerShell:
 *   $env:RUN_IB4_LIVE_BENCHMARK='1'
 *   $env:SUPABASE_SERVICE_ROLE_KEY='<service-role-key>'
 *   npm run benchmark:ib4
 *
 * Required because public.products currently has RLS enabled with no anon/auth read policy.
 * This benchmark is READ-ONLY: it selects products and never writes any table.
 */
const RUN_LIVE = process.env.RUN_IB4_LIVE_BENCHMARK === '1';
const liveDescribe = RUN_LIVE ? describe : describe.skip;

async function fetchFullCatalog(): Promise<RawProductRow[]> {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('I.B.4 live benchmark requires SUPABASE_URL/VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }

  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const pageSize = 1000;
  const rows: RawProductRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from('products')
      .select('id,product_code,name,normalized_name,category,price,source')
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as RawProductRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

liveDescribe('Phase I.B.4 — LIVE full-catalog evaluation', () => {
  it('runs the canonical benchmark against the complete real product catalog and prints the readiness report', async () => {
    const rows = await fetchFullCatalog();
    // The catalog audit established 10,767 rows. Keep a loose lower bound so normal catalog growth
    // is allowed while a catastrophic partial read cannot masquerade as a valid benchmark.
    expect(rows.length).toBeGreaterThan(10_000);

    const counts = countNormalizedNames(rows);
    const catalog = rows.map((row) => buildCanonicalProduct(row, counts, normalizePharmacyText));
    const index = buildPharmacyProductIndex(catalog);

    const report = runIb4EvaluationV2(index);

    // Machine-readable output is intentionally printed for supervised capture/artifact creation.
    console.log('\n=== I.B.4 LIVE EVALUATION SUMMARY ===\n' + report.summary);
    console.log('\n=== I.B.4 LIVE SAFETY CRITICAL ERRORS ===\n' + JSON.stringify(report.safetyCriticalErrors, null, 2));
    console.log('\n=== I.B.4 LIVE READINESS ===\n' + JSON.stringify(report.readiness, null, 2));
    console.log('\n=== I.B.4 LIVE BASKET METRICS ===\n' + JSON.stringify(report.basket.metrics, null, 2));
    console.log('\n=== I.B.4 LIVE CLOSURE METRICS ===\n' + JSON.stringify(report.closure, null, 2));

    // The live benchmark itself is the acceptance gate: safety-critical errors are never hidden.
    expect(report.basket.metrics.falseAddedProductToBasket.v2).toBe(0);
    expect(report.basket.metrics.wrongQuantityAppliedToCorrectProduct).toBe(0);
    expect(report.basket.metrics.safeEdgeAudit.verifiedIncorrect).toBe(0);
    expect(report.basket.metrics.regressions).toBe(0);
    expect(report.closure.shadowBinary.fp).toBe(0);
    expect(report.basket.metrics.humanReviewQuality.missedReview).toBe(0);
  }, 120_000);
});
