import { describe, it, expect } from 'vitest';
import {
  buildCanonicalProduct,
  countNormalizedNames,
  type RawProductRow,
} from '../../pharmacyProducts/canonicalProduct';
import { normalizePharmacyText } from '../../pharmacyProducts/pharmacyNormalization';
import {
  buildPharmacyProductIndex,
  resolveProductMention,
} from '../../pharmacyProducts/pharmacyProductResolverV2';
import { runSalesIntelligencePipeline } from '../../salesIntelligencePipeline';
import { mapCaseAnalysisRowContent } from '../../persistence/mappers';
import { fetchQaCaseDetail } from '../queries';
import { readPersistedProductTruth, productDisplayStateLabel } from '../persistedProductTruth';
import { createInMemorySupabase } from './inMemorySupabase.testkit';

const names = [
  'ALPHA 100 mg 20 tablets',
  'ALPHA 100 mg 30 tablets',
  'ALPHA 200 mg 20 tablets',
  'ALPHA drops 10 ml',
  'ALPHA syrup 100 ml',
  'ALPHA cream 20 gm',
  'ALPHA ointment 20 gm',
  'HYFRESH EYE DROPS 10 ML',
  'BETA 1% drops 10 ml',
  'BETA 2% drops 10 ml',
];
const rows: RawProductRow[] = names.map((name, i) => ({
  id: `p-${i}`,
  product_code: i === 7 ? '28532' : `CODE${i}`,
  name,
  normalized_name: name.toLowerCase(),
  category: null,
  price: 10,
  source: 'synthetic',
}));
const counts = countNormalizedNames(rows);
const catalog = rows.map((r) => buildCanonicalProduct(r, counts, normalizePharmacyText));
const index = buildPharmacyProductIndex(catalog);

describe('canonical identity discriminators (shared resolver)', () => {
  it.each(names.map((name, i) => [name, `p-${i}`]))('keeps %s distinct', (phrase, id) => {
    expect(resolveProductMention(phrase, index).selected?.product.productId).toBe(id);
  });
  it('exact product code resolves to the catalog id', () => {
    expect(resolveProductMention('28532', index).selected?.product.productId).toBe('p-7');
  });
  it.each(['هاي فريش', 'هاى فريش', 'Hyfresh', 'Hy Fresh', 'وقطرة هاى فريش'])(
    'uses the canonical seed for %s',
    (phrase) => {
      expect(resolveProductMention(phrase, index).selected?.product.productCode).toBe('28532');
    }
  );
  it('same brand without pack or strength fails closed', () => {
    const r = resolveProductMention('ALPHA', index);
    expect(r.selected).toBeNull();
    expect(r.candidates).toEqual([]);
  });
  it('equal canonical names fail closed as an ambiguous tie', () => {
    const duplicate = { ...catalog[0], productId: 'duplicate', productCode: 'duplicate' };
    const result = resolveProductMention(
      names[0],
      buildPharmacyProductIndex([...catalog, duplicate])
    );
    expect(result.ambiguous).toBe(true);
    expect(result.selected).toBeNull();
  });
  it.each([
    ['ALPHA 100 mg 30 tablets', 'p-0'],
    ['ALPHA 200 mg 20 tablets', 'p-0'],
    ['ALPHA drops 10 ml', 'p-4'],
    ['ALPHA cream 20 gm', 'p-6'],
    ['BETA 1% drops 10 ml', 'p-9'],
  ])(
    'approved aliases cannot override explicit pack/strength/form/concentration: %s',
    (phrase, wrongId) => {
      const result = resolveProductMention(phrase, index, {
        approvedAliases: new Map([[phrase.toLowerCase(), wrongId]]),
      });
      expect(result.candidates.some((c) => c.product.productId === wrongId)).toBe(false);
    }
  );
  it('a second Hyfresh presentation stays ambiguous', () => {
    const alternative = {
      ...catalog[7],
      productId: 'hyfresh-other',
      productCode: 'other',
      canonicalName: 'HYFRESH EYE DROPS 20 ML',
      normalizedNames: ['hyfresh eye drops 20 ml'],
    };
    expect(
      resolveProductMention('هاي فريش', buildPharmacyProductIndex([...catalog, alternative]))
        .selected
    ).toBeNull();
  });
});

describe('conversation → canonical pipeline → persistence mapper → selected loader → display state', () => {
  it.each([
    'CODE0',
    'ALPHA 100 mg 20 tablets',
    'alpha 200 mg 20 TABLETS',
    'هاي فريش',
    'Hy Fresh',
    'ALPHA',
    'منتج مجهول تماما',
    'ودا <image omitted>',
    'صورة لدواء <image omitted>',
    '<voice omitted>',
  ])('%s never gains a different window identity', async (phrase) => {
    const raw = `[9/24/26, 9:00:00 AM] Customer: محتاج ${phrase}\n[9/24/26, 9:01:00 AM] You: حضرتك تأمر بـ:\n1 علبة ${phrase}\nإجمالي الحساب 100 جنيه\nهل الطلب كده كامل؟\n[9/24/26, 9:02:00 AM] Customer: ايوه تمام`;
    const output = runSalesIntelligencePipeline({
      conversationId: 'source',
      rawWhatsAppExportText: raw,
      productIndex: index,
      resolveInvoiceCandidates: () => [],
    });
    expect(output.caseAnalyses.length).toBeGreaterThan(0);
    const analysis = output.caseAnalyses[0];
    const persisted = mapCaseAnalysisRowContent(analysis);
    const row = {
      case_id: analysis.caseId,
      analysis_id: 'analysis',
      evidence_snapshot: persisted.evidenceSnapshot,
    };
    const client = createInMemorySupabase({
      sales_intelligence_cases: [{ case_id: analysis.caseId }],
      sales_intelligence_current_case_analyses: [row],
    });
    const bundle = await fetchQaCaseDetail(client, analysis.caseId);
    const window = bundle!.catalogProductMatches;
    if (!phrase.includes('omitted')) expect(window.length).toBeGreaterThan(0);
    expect(window.map((p) => p.productId)).toEqual(
      analysis.caseIntelligence.need.products.map((p) => p.productId)
    );
    for (const product of window) {
      expect(productDisplayStateLabel(product.state)).toBeTruthy();
      if (!product.productId) expect(product.state).not.toBe('CANONICAL_MATCH');
    }
    expect(client.reads).not.toContain('products');
    expect(bundle!.quotedBasketV2Items.map((p) => p.quantity)).toEqual(
      analysis.caseIntelligence.basket.activeItems.filter((p) => p.productId).map((p) => p.quantity)
    );
  });
  it('a snapshot from another case, missing snapshot, and unknown version stay explicit', () => {
    for (const view of [
      null,
      { version: 'case-intelligence-v3', caseId: 'B' },
      { version: 'future', caseId: 'A' },
    ]) {
      const truth = readPersistedProductTruth('A', {
        case_id: 'A',
        evidence_snapshot: { caseIntelligence: view },
      });
      expect(truth.products).toEqual([]);
      expect(truth.warning).toBeTruthy();
    }
  });
  it('null identity cannot be repaired by a competing basket identity', () => {
    const truth = readPersistedProductTruth('A', {
      case_id: 'A',
      evidence_snapshot: {
        caseIntelligence: {
          version: 'case-intelligence-v3',
          caseId: 'A',
          need: {
            products: [
              {
                key: 'unknown',
                productNameRaw: 'ودا',
                productId: null,
                confidence: { level: 'unknown', ruleIds: [] },
                evidenceMessageIds: ['image'],
              },
            ],
          },
          basket: { activeItems: [{ productId: 'invented', productNameRaw: 'ALPHA' }] },
          interaction: { messageIds: ['image'] },
        },
      },
    });
    expect(truth.products[0].productId).toBeNull();
    expect(truth.products[0].state).toBe('HUMAN_REVIEW');
  });
});
