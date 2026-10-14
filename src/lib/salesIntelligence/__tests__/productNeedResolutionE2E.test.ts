// Sales Intelligence End-to-End regression — Product/Need resolution (Phase B of the 2026-10-06
// manual regression run). Every scenario goes through the real top-level orchestration function,
// runSalesIntelligencePipeline, never a resolver-only unit test, so these exercise the actual
// CustomerNeedModel/basket path a reviewer would see.
//
// Catalog rows below are the REAL live `products` table rows for GAST-REG (pulled read-only from
// production, project jkjqeqkshllustwlzzbf, 2026-10-06) plus two Zurcal rows added only for the
// negative multi-product test (NEG2) — not invented GAST-REG data.
import { describe, expect, it } from 'vitest';
import { buildCanonicalProduct, countNormalizedNames, type RawProductRow } from '../pharmacyProducts/canonicalProduct';
import { normalizePharmacyText } from '../pharmacyProducts/pharmacyNormalization';
import { buildPharmacyProductIndex } from '../pharmacyProducts/pharmacyProductResolverV2';
import { runSalesIntelligencePipeline, type SalesIntelligencePipelineInput } from '../salesIntelligencePipeline';

const GAST_REG_50MG_3AMP_ID = '65ccef56-825a-4c31-93c8-a3bdaffd0488';
const GAST_REG_50MG_3AMP_CODE = '40049';
const PEDICORT_PRODUCT_ID = '60bf9629-2e60-479f-a811-972da45ae836';
const PEDICORT_PRODUCT_CODE = '67929';

const CATALOG_ROWS: RawProductRow[] = [
  { id: '6fb1480c-936b-452b-9c42-8d364782e2af', name: 'GAST-REG 100MG 30 TAB', product_code: '58009', normalized_name: 'gast reg 100mg 30 tab', category: null, price: 72, source: 'catalog_import' },
  { id: '0b7a430f-7023-4d79-846f-128ea4c1fec2', name: 'GAST-REG 200 MG 20 TAB', product_code: '21304', normalized_name: 'gast reg 200 mg 20 tab', category: null, price: 14.4, source: 'catalog_import' },
  { id: '48b9373a-5a06-4fba-8fc8-de159e21894b', name: 'GAST-REG 200 MG 30 TAB', product_code: '57353', normalized_name: 'gast reg 200 mg 30 tab', category: null, price: 84, source: 'catalog_import' },
  { id: GAST_REG_50MG_3AMP_ID, name: 'GAST-REG 50MG 3AMP', product_code: GAST_REG_50MG_3AMP_CODE, normalized_name: 'gast reg 50mg 3amp', category: null, price: 33, source: 'catalog_import' },
  { id: '334d0058-8daf-4dbd-ab1a-83cb8d1966af', name: 'GAST-REG SYRUP', product_code: '4620', normalized_name: 'gast reg syrup', category: null, price: 33, source: 'catalog_import' },
  { id: 'p-zurcal-tab', name: 'Zurcal 20 mg 14 tablets', product_code: '67186', normalized_name: 'zurcal 20mg 14 tablets', category: null, price: 100, source: 'catalog_import' },
  { id: 'p-zurcal-amp', name: 'Zurcal 40mg 3 AMP', product_code: '77001', normalized_name: 'zurcal 40mg 3 amp', category: null, price: 120, source: 'catalog_import' },
];

function catalogFrom(rows: RawProductRow[]) {
  const counts = countNormalizedNames(rows);
  return rows.map((row) => buildCanonicalProduct(row, counts, normalizePharmacyText));
}
const INDEX = buildPharmacyProductIndex(catalogFrom(CATALOG_ROWS));
const PEDICORT_INDEX = buildPharmacyProductIndex(catalogFrom([
  {
    id: PEDICORT_PRODUCT_ID,
    name: 'PEDICORT FORTE SYRUP 100 ML',
    product_code: PEDICORT_PRODUCT_CODE,
    normalized_name: 'pedicort forte syrup 100 ml',
    category: null,
    price: 180,
    source: 'catalog_import',
  },
  {
    id: 'p-cortiforte-syrup',
    name: 'CORTIFORTE SYRUP 100 ML',
    product_code: 'SYN-CORTIFORTE',
    normalized_name: 'cortiforte syrup 100 ml',
    category: null,
    price: null,
    source: 'synthetic_local_smoke',
  },
]));

function baseInput(overrides: Partial<SalesIntelligencePipelineInput> = {}): SalesIntelligencePipelineInput {
  return {
    conversationId: 'manual-e2e-product-need',
    rawWhatsAppExportText: '',
    resolveInvoiceCandidates: () => [],
    productIndex: INDEX,
    ...overrides,
  };
}

describe('Product/Need resolution E2E — A1: exact composite product request', () => {
  it('"جاست ريج أمبول" alone resolves to GAST-REG 50MG 3AMP / 40049, not unresolved', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: جاست ريج أمبول\n[9/15/26, 9:01:00 AM] You: تمام يا فندم`;
    const result = runSalesIntelligencePipeline(baseInput({ rawWhatsAppExportText: raw }));
    expect(result.caseAnalyses).toHaveLength(1);
    const { customerNeed } = result.caseAnalyses[0];
    expect(customerNeed.products).toHaveLength(1);
    const [product] = customerNeed.products;
    expect(product.productId).toBe(GAST_REG_50MG_3AMP_ID);
    expect(['proven', 'strongly_inferred']).toContain(product.confidence.level);
  });
});

describe('Product/Need resolution E2E — A2: split-message qualifier stitching', () => {
  it('"محتاج جاست ريج" then "امبول ضرررروي" stay one need, no fake "امبول" need, resolves to GAST-REG 50MG 3AMP', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: محتاج جاست ريج\n[9/15/26, 9:00:30 AM] Customer: امبول ضرررروي\n[9/15/26, 9:01:00 AM] You: تمام يا فندم هحضرلك الامبول`;
    const result = runSalesIntelligencePipeline(baseInput({ rawWhatsAppExportText: raw }));
    expect(result.caseAnalyses).toHaveLength(1); // single case — no fake split
    const { customerNeed } = result.caseAnalyses[0];
    expect(customerNeed.products).toHaveLength(1); // no independent "امبول" need
    const [product] = customerNeed.products;
    expect(product.productId).toBe(GAST_REG_50MG_3AMP_ID);
    expect(['proven', 'strongly_inferred']).toContain(product.confidence.level);
    // evidence must span BOTH messages, not just the first
    expect(product.evidenceMessageIds.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Product/Need resolution E2E — A3: ambiguous request stays unresolved', () => {
  it('"محتاج جاست ريج" with no qualifier never auto-picks a variant', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: محتاج جاست ريج\n[9/15/26, 9:01:00 AM] You: تمام يا فندم`;
    const result = runSalesIntelligencePipeline(baseInput({ rawWhatsAppExportText: raw }));
    expect(result.caseAnalyses).toHaveLength(1);
    const { customerNeed } = result.caseAnalyses[0];
    expect(customerNeed.products).toHaveLength(1);
    expect(customerNeed.products[0].productId).toBeNull();
  });
});

describe('Product/Need resolution E2E — regression safety negatives', () => {
  it('NEG1: a qualifier separated by an unrelated staff message must NOT stitch (not immediately adjacent)', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: محتاج جاست ريج\n[9/15/26, 9:00:30 AM] You: هو العلبة ولا الشريط؟\n[9/15/26, 9:05:00 AM] Customer: امبول`;
    const result = runSalesIntelligencePipeline(baseInput({ rawWhatsAppExportText: raw }));
    const { customerNeed } = result.caseAnalyses[0];
    expect(customerNeed.products).toHaveLength(1);
    expect(customerNeed.products[0].productId).toBeNull();
  });

  it('NEG2: two distinct unresolved products — a later qualifier must not be guessed onto either one', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: محتاج جاست ريج و زوركال\n[9/15/26, 9:00:30 AM] Customer: امبول\n[9/15/26, 9:01:00 AM] You: تمام يا فندم`;
    const result = runSalesIntelligencePipeline(baseInput({ rawWhatsAppExportText: raw }));
    const { customerNeed } = result.caseAnalyses[0];
    expect(customerNeed.products).toHaveLength(2);
    for (const product of customerNeed.products) {
      expect(product.productId).toBeNull();
    }
  });

  it('NEG3: a bare product name with no catalog/strong match still produces no basket item (no broadened heuristic)', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: حاجة غريبة مش في الكتالوج\n[9/15/26, 9:01:00 AM] You: تمام يا فندم`;
    const result = runSalesIntelligencePipeline(baseInput({ rawWhatsAppExportText: raw }));
    const { customerNeed } = result.caseAnalyses[0];
    expect(customerNeed.products).toHaveLength(0);
  });
});

describe('Product/Need/Attribution E2E — canonical cross-script basket propagation', () => {
  it('carries the seeded Pedicort identity through the active basket and attribution without guessing quantity', () => {
    const raw = `[9/27/26, 6:46:00 PM] Customer: عايزه بيدو كورت فورت شراب للكبار
[9/27/26, 6:47:00 PM] You: تحت أمر حضرتك`;
    const result = runSalesIntelligencePipeline(baseInput({
      conversationId: 'pedicort-canonical-basket',
      rawWhatsAppExportText: raw,
      customerIdHint: 'customer-pedicort',
      productIndex: PEDICORT_INDEX,
      resolveInvoiceCandidates: (context) => [
        {
          id: 'invoice-74947',
          invoice_number: '74947',
          customer_id: 'customer-pedicort',
          invoice_datetime: context.caseEndedAt,
          net_amount: 180,
        },
        {
          id: 'invoice-74956',
          invoice_number: '74956',
          customer_id: 'customer-pedicort',
          invoice_datetime: context.caseEndedAt,
          net_amount: 155,
        },
      ],
      itemEvidenceProvider: {
        getItemsForInvoice: (invoiceId) => invoiceId === 'invoice-74947'
          ? [{
              productNameRaw: 'PEDICORT FORTE SYRUP 100 ML',
              productId: PEDICORT_PRODUCT_ID,
              productCode: PEDICORT_PRODUCT_CODE,
              quantity: 1,
              lineTotal: 180,
            }]
          : [{
              productNameRaw: 'CERELAC WHEAT WITHOUT MILK 400 GM',
              productId: 'p-cerelac',
              productCode: '56832',
              quantity: 1,
              lineTotal: 155,
            }],
      },
    }));

    expect(result.caseAnalyses).toHaveLength(1);
    const analysis = result.caseAnalyses[0];
    const [needProduct] = analysis.customerNeed.products;
    expect(needProduct).toMatchObject({
      productId: PEDICORT_PRODUCT_ID,
      productCode: PEDICORT_PRODUCT_CODE,
      canonicalName: 'PEDICORT FORTE SYRUP 100 ML',
      requestedQuantity: null,
      finalQuantity: null,
      confidence: { level: 'weakly_inferred' },
    });

    const activeItems = analysis.activeBasket
      ? analysis.itemsByBasketId[analysis.activeBasket.basketId] ?? []
      : [];
    expect(activeItems).toHaveLength(1);
    expect(activeItems[0]).toMatchObject({
      productId: PEDICORT_PRODUCT_ID,
      productCode: PEDICORT_PRODUCT_CODE,
      canonicalName: 'PEDICORT FORTE SYRUP 100 ML',
      quantity: null,
      resolutionStatus: 'partially_proven',
      confidence: { level: 'weakly_inferred' },
    });

    expect(analysis.attribution.selectedInvoiceNumber).toBe('74947');
    expect(analysis.attribution.selectedCandidate?.productMatch).toBe('available_match');
    expect(analysis.attribution.selectedCandidate?.quantityMatch).toBe('available_match');
    expect(analysis.attribution.alternativeCandidates.find((candidate) => candidate.invoiceNumber === '74956')?.productMatch)
      .toBe('available_mismatch');
    expect(analysis.salesOutcome.saleProofState).not.toBe('proven');
    expect(analysis.salesOutcome.outcome).not.toBe('sale_proven');
  });

  it('leaves an unresolved named request without invented canonical product identity', () => {
    const raw = `[9/27/26, 6:46:00 PM] Customer: عايزه دواء غير مسجل
[9/27/26, 6:47:00 PM] You: تحت أمر حضرتك`;
    const result = runSalesIntelligencePipeline(baseInput({
      conversationId: 'unresolved-canonical-basket',
      rawWhatsAppExportText: raw,
      productIndex: PEDICORT_INDEX,
    }));

    const analysis = result.caseAnalyses[0];
    expect(analysis.customerNeed.products).toHaveLength(1);
    expect(analysis.customerNeed.products[0].productId).toBeNull();
    expect(analysis.customerNeed.products[0].productCode).toBeNull();
    expect(analysis.customerNeed.products[0].canonicalName).toBeNull();
    const activeItems = analysis.activeBasket
      ? analysis.itemsByBasketId[analysis.activeBasket.basketId] ?? []
      : [];
    expect(activeItems).toHaveLength(1);
    expect(activeItems[0].productId).toBeNull();
    expect(activeItems[0].productCode).toBeUndefined();
    expect(activeItems[0].canonicalName).toBeUndefined();
  });
});
