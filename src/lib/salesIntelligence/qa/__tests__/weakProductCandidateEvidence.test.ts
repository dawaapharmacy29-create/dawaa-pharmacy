import { describe, expect, it } from 'vitest';
import { buildCanonicalProduct, countNormalizedNames } from '../../pharmacyProducts/canonicalProduct';
import { normalizePharmacyText } from '../../pharmacyProducts/pharmacyNormalization';
import { buildPharmacyProductIndex, resolveProductMention } from '../../pharmacyProducts/pharmacyProductResolverV2';
import { runSalesIntelligencePipeline } from '../../salesIntelligencePipeline';
import { mapCaseAnalysisRowContent } from '../../persistence/mappers';

function index(names: string[]) {
  const rows = names.map((name, i) => ({ id: `p${i}`, product_code: `C${i}`, name, normalized_name: name.toLowerCase(), category: null, price: 1, source: 'synthetic' }));
  const counts = countNormalizedNames(rows);
  return buildPharmacyProductIndex(rows.map(r => buildCanonicalProduct(r, counts, normalizePharmacyText)));
}
describe('preserved weak catalog evidence in canonical snapshots', () => {
  it.each([
    ['فيمو جيسال', 'Femogesal 21 tabs'],
    ['ماركال', 'MARCAL TAB'],
    ['كروماكس', 'CHROMAX 60 CAP'],
    ['سبازموبيرالجين', 'spasmopyralgin 30tab'],
    ['توسيستوب اقراص', 'tussistop tab'],
    ['لزقة ميلاكريست بتاع النوم', 'melacryst 3 mg'],
    ['لبن لاكتو مرحلة ٢', 'LACTO 2 MILK'],
    ['الترمومتر الرقمي', 'ترمومتر ديجيتال'],
  ])('%s stays reviewable without becoming a proven SKU', (phrase, name) => {
    const productIndex = index([name]);
    const resolution = resolveProductMention(phrase, productIndex);
    expect(resolution.selected?.confidence).toBe('weakly_inferred');
    const result = runSalesIntelligencePipeline({
      conversationId: 'source', productIndex,
      rawWhatsAppExportText: `[11/13/26, 3:00:00 AM] Customer: محتاج ${phrase}\n[11/13/26, 3:01:00 AM] You: حضرتك تأمر بـ:\n1 علبة ${phrase}\nإجمالي الحساب 100 جنيه\nهل الطلب كده كامل؟\n[11/13/26, 3:02:00 AM] Customer: ايوه تمام`,
      resolveInvoiceCandidates: () => [],
    });
    const products = result.caseAnalyses.flatMap(a => a.caseIntelligence.products);
    const product = products.find(p => p.productId === 'p0');
    expect(product).toBeTruthy();
    expect(product!.productCode).toBe('C0');
    expect(product!.invoiceLine).toBeNull();
    const snapshots = result.caseAnalyses.map(mapCaseAnalysisRowContent);
    expect(JSON.stringify(snapshots)).toContain('weakly_inferred');
  });
  it('regular/plus and multiple catalog SKUs remain candidates, never an alias approval', () => {
    const r = resolveProductMention('ماركال', index(['MARCAL TAB', 'MARCAL PLUS TAB']));
    expect(r.selected).toBeNull();
    expect(r.ambiguous).toBe(true);
    expect(r.candidates).toHaveLength(2);
  });
  it('exact code keeps the established proof path', () => {
    expect(resolveProductMention('C0', index(['MARCAL TAB'])).selected?.confidence).toBe('proven');
  });
  it('omitted media and an unnamed product create no catalog evidence', () => {
    expect(resolveProductMention('ودا <image omitted>', index(['MARCAL TAB'])).candidates).toEqual([]);
  });
});
