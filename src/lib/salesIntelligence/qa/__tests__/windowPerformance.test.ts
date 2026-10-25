import { it, expect, vi } from 'vitest';
import { fixtureTables } from './selectedCaseFixtures.testkit';
import { createInMemorySupabase } from './inMemorySupabase.testkit';
import { fetchQaCaseDetail } from '../queries';
import * as pipeline from '../../salesIntelligencePipeline';
import * as resolver from '../../pharmacyProducts/pharmacyProductResolverV2';

it('measures the selected-case loader on a deterministic 10,767-row catalog', async () => {
  let tables = fixtureTables();
  // Eight distinct product lines, image reference, competing invoice claim, production catalog.
  const names = [
    'PANADOL EXTRA 24 tablets',
    'HYFRESH DROPS 10 ML',
    'ANTINAL 24 CAP',
    'VITAMIN C 30 tablets',
    'ALPHA CREAM 20 GM',
    'BETA SYRUP 100 ML',
    'ZURCAL 40 MG 28 TAB',
    'SOLOFRESH DROPS 10 ML',
  ];
  tables.whatsapp_review_sources[0].raw_text =
    names.map((name, i) => `24/09/2026, 9:0${i} AM - كريم: محتاج ${name}`).join('\n') +
    '\n24/09/2026, 9:08 AM - كريم: ودا <image omitted>';
  names.forEach((name, i) =>
    tables.products.push({
      id: `benchmark-${i}`,
      product_code: `BM${i}`,
      name,
      normalized_name: name.toLowerCase(),
      price: 10,
    })
  );
  tables.sales_intelligence_current_attributions[0].competing_case_ids = ['case-other'];
  const selectedId = pipeline.deriveCasesOnly({
    conversationId: 'conv-1',
    rawWhatsAppExportText: tables.whatsapp_review_sources[0].raw_text,
  }).cases[0].caseId;
  tables = JSON.parse(JSON.stringify(tables).replaceAll('"case-A"', JSON.stringify(selectedId)));
  const run = vi.spyOn(pipeline, 'runSalesIntelligencePipeline');
  run.mockClear();
  const client = createInMemorySupabase({
    ...tables,
    products: [
      ...tables.products,
      ...Array.from({ length: 10767 - tables.products.length }, (_, i) => ({
        id: `filler-${i}`,
        product_code: `F${i}`,
        name: `CATALOG FILLER ${i}`,
        normalized_name: `catalog filler ${i}`,
        price: 1,
      })),
    ],
  });
  let fuzzy = 0;
  let ilikeFilters = 0;
  let productResolutionMs = 0;
  const originalResolve = resolver.resolveProductMention;
  const resolution = vi.spyOn(resolver, 'resolveProductMention').mockImplementation((...args) => {
    const start = performance.now();
    try {
      return originalResolve(...args);
    } finally {
      productResolutionMs += performance.now() - start;
    }
  });
  const from = client.from.bind(client);
  client.from = (table: string) => {
    const q = from(table);
    const ilike = q.ilike;
    let counted = false;
    q.ilike = (...args: unknown[]) => {
      if (table === 'products') {
        ilikeFilters++;
        if (!counted) fuzzy++;
        counted = true;
      }
      return ilike(...args);
    };
    return q;
  };
  const start = performance.now();
  const bundle = await fetchQaCaseDetail(client, selectedId);
  const ms = performance.now() - start;
  console.log(
    'WINDOW_METRICS',
    JSON.stringify({
      total: client.reads.length,
      pipelineRuns: run.mock.calls.length,
      products: client.reads.filter((x) => x === 'products').length,
      fuzzy,
      ilikeFilters,
      resolutionCalls: resolution.mock.calls.length,
      productResolutionMs,
      ms,
    })
  );
  expect(bundle?.persisted.analysisRow.case_id).toBe(selectedId);
  expect(fuzzy).toBe(0);
  expect(run).not.toHaveBeenCalled();
  expect(client.reads.filter((x) => x === 'products').length).toBeLessThanOrEqual(2);
  expect(resolution).not.toHaveBeenCalled();
  run.mockRestore();
  resolution.mockRestore();
});
