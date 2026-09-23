// Phase I.B.1 — first real benchmark: OLD (naive exact-name matching) vs pharmacyProductResolverV2.
//
// TEMPORARY, investigation-grade benchmark (kept as a permanent regression check since it's cheap
// and catches real drift, but its fixture data is explicitly a SNAPSHOT, not a growing corpus —
// see the I.B.1 report's own honesty note about benchmark size). Every phrase below is copied
// verbatim from real فرع شكري WhatsApp conversations (whatsapp_review_sources, branch = 'فرع
// شكري'); every ground-truth product_code was independently confirmed against the live `products`
// catalog (10,767 rows) via targeted SQL search during the I.B.1 audit — never invented. Rows in
// MINI_CATALOG are the real catalog rows those searches returned (name/product_code copied
// verbatim), not synthetic data.
import { describe, it, expect } from 'vitest';
import { buildCanonicalProduct, countNormalizedNames, type RawProductRow } from '../canonicalProduct';
import { normalizePharmacyText, normalizeBaseText } from '../pharmacyNormalization';
import { buildPharmacyProductIndex, resolveProductMention } from '../pharmacyProductResolverV2';

const CATALOG_ROWS: RawProductRow[] = [
  { id: '80140', name: 'AIG Esomeprazole 40 mg 28 cap', product_code: '80140', normalized_name: 'aig esomeprazole 40 mg 28 cap', category: null, price: 0, source: 'catalog_import' },
  { id: '72418', name: 'Limitless Chromax Cut 30 Sachets', product_code: '72418', normalized_name: 'limitless chromax cut 30 sachets', category: null, price: 0, source: 'catalog_import' },
  { id: '80245', name: 'koji san lightining soap 135g', product_code: '80245', normalized_name: 'koji san lightining soap 135g', category: null, price: 0, source: 'catalog_import' },
  { id: '13256', name: 'COLCHICINE 0.5GM 100TAB', product_code: '13256', normalized_name: 'colchicine 0.5gm 100tab', category: null, price: 0, source: 'catalog_import' },
  { id: '55341', name: 'COLCHICINE 1 GM 20 TAB IMPORTED', product_code: '55341', normalized_name: 'colchicine 1 gm 20 tab imported', category: null, price: 0, source: 'catalog_import' },
  { id: '83058', name: 'colchicine 1mg 30 tab frensh', product_code: '83058', normalized_name: 'colchicine 1mg 30 tab frensh', category: null, price: 0, source: 'catalog_import' },
  { id: '68089', name: 'Colchicine Opocalcium 1mg 20 tabs', product_code: '68089', normalized_name: 'colchicine opocalcium 1mg 20 tabs', category: null, price: 0, source: 'catalog_import' },
  { id: '68114', name: 'Flexilax 30 tabs', product_code: '68114', normalized_name: 'flexilax 30 tabs', category: null, price: 0, source: 'catalog_import' },
  { id: '57980', name: 'MINOXIDIL FORTE 5 % TOPICAL GEL', product_code: '57980', normalized_name: 'minoxidil forte 5 % topical gel', category: null, price: 0, source: 'catalog_import' },
  { id: '73888', name: 'Minoxidil MUP 5% 150 ml', product_code: '73888', normalized_name: 'minoxidil mup 5% 150 ml', category: null, price: 0, source: 'catalog_import' },
  { id: '14277', name: 'VICHY NORMADERM cleanser 200 ML', product_code: '14277', normalized_name: 'vichy normaderm cleanser 200 ml', category: null, price: 0, source: 'catalog_import' },
  { id: '73046', name: 'bloomville 30 tab', product_code: '73046', normalized_name: 'bloomville 30 tab', category: null, price: 0, source: 'catalog_import' },
  { id: '79759', name: 'centrum women 30 tab', product_code: '79759', normalized_name: 'centrum women 30 tab', category: null, price: 0, source: 'catalog_import' },
  { id: '79850', name: 'CENTRUM WOMEN 100 TAB', product_code: '79850', normalized_name: 'centrum women 100 tab', category: null, price: 0, source: 'catalog_import' },
  { id: '68580', name: 'folic acid 5 mg 30 tab', product_code: '68580', normalized_name: 'folic acid 5 mg 30 tab', category: null, price: 0, source: 'catalog_import' },
  { id: '11923', name: 'FOLIC ACID 500MCG TAB', product_code: '11923', normalized_name: 'folic acid 500mcg tab', category: null, price: 0, source: 'catalog_import' },
  { id: '68352', name: 'Neurovit 30 tab', product_code: '68352', normalized_name: 'neurovit 30 tab', category: null, price: 0, source: 'catalog_import' },
  { id: '68491', name: 'Neurovit 6 amp', product_code: '68491', normalized_name: 'neurovit 6 amp', category: null, price: 0, source: 'catalog_import' },
  { id: '60921', name: 'doliprane 1000 MG 15 TAB', product_code: '60921', normalized_name: 'doliprane 1000 mg 15 tab', category: null, price: 0, source: 'catalog_import' },
  { id: '79362', name: 'doliprane 1000 mg 20 tab', product_code: '79362', normalized_name: 'doliprane 1000 mg 20 tab', category: null, price: 0, source: 'catalog_import' },
  { id: '56424', name: 'DEVAROL S 1 AMP', product_code: '56424', normalized_name: 'devarol s 1 amp', category: null, price: 0, source: 'catalog_import' },
  { id: '69565', name: 'MARNYS OMEGA 3 125 ML', product_code: '69565', normalized_name: 'marnys omega 3 125 ml', category: null, price: 0, source: 'catalog_import' },
  { id: '57038', name: 'ORLY 120 mg 30 CAP', product_code: '57038', normalized_name: 'orly 120 mg 30 cap', category: null, price: 0, source: 'catalog_import' },
  { id: '75705', name: 'orly 60mg 30capsul', product_code: '75705', normalized_name: 'orly 60mg 30capsul', category: null, price: 0, source: 'catalog_import' },
  { id: '74562', name: 'Derma Roller 0.5 mm ZGTS', product_code: '74562', normalized_name: 'derma roller 0.5 mm zgts', category: null, price: 0, source: 'catalog_import' },
  { id: '68914', name: 'DERMA ROLLER 0.75MM ZGTS', product_code: '68914', normalized_name: 'derma roller 0.75mm zgts', category: null, price: 0, source: 'catalog_import' },
  { id: '68962', name: 'DERMA ROLLER 1 MM ZGTS', product_code: '68962', normalized_name: 'derma roller 1 mm zgts', category: null, price: 0, source: 'catalog_import' },
  { id: '74580', name: 'Derma Roller 1.5 mm ZGTS', product_code: '74580', normalized_name: 'derma roller 1.5 mm zgts', category: null, price: 0, source: 'catalog_import' },
  { id: '68697', name: 'Corega Cream 20 Gm', product_code: '68697', normalized_name: 'corega cream 20 gm', category: null, price: 0, source: 'catalog_import' },
  { id: '64439', name: 'corega denture fixative cream 40gm', product_code: '64439', normalized_name: 'corega denture fixative cream 40gm', category: null, price: 0, source: 'catalog_import' },
  { id: '80209', name: 'COREGA ULTRA MINT CREAM 40 ML', product_code: '80209', normalized_name: 'corega ultra mint cream 40 ml', category: null, price: 0, source: 'catalog_import' },
];

const counts = countNormalizedNames(CATALOG_ROWS);
const CATALOG = CATALOG_ROWS.map((row) => buildCanonicalProduct(row, counts, normalizePharmacyText));
const INDEX = buildPharmacyProductIndex(CATALOG);

type GroundTruth = { code: string } | { ambiguousAmong: string[] } | { notInCatalog: true };

interface BenchmarkCase {
  phrase: string;
  sourceNote: string;
  groundTruth: GroundTruth;
}

// Every phrase below is verbatim (or a minimally-trimmed single mention) from a real فرع شكري
// conversation in whatsapp_review_sources. See the I.B.1 report for the conversation ids.
const BENCHMARK: BenchmarkCase[] = [
  { phrase: 'limitless chromax', sourceNote: 'اكياس اسمه limitless chromax', groundTruth: { code: '72418' } },
  { phrase: 'الليميت ليس كروماكس', sourceNote: 'نفس المنتج بالعربي', groundTruth: { code: '72418' } },
  { phrase: 'كوجي سان', sourceNote: 'صابونه كوجي سان موجوده', groundTruth: { code: '80245' } },
  { phrase: 'الكولشيسن الفرنسي', sourceNote: 'قدرنا نوصل للكولشيسن الفرنسي', groundTruth: { code: '83058' } },
  { phrase: 'كولشيسين مستورد', sourceNote: 'كولشيسين مستورد بردو نوع', groundTruth: { ambiguousAmong: ['13256', '55341', '83058', '68089'] } },
  { phrase: 'فليكسيلاكس', sourceNote: 'محتاج شريط فليكس لايكس', groundTruth: { code: '68114' } },
  { phrase: 'فليكس لايكس', sourceNote: 'محتاج شريط فليكس لايكس', groundTruth: { code: '68114' } },
  { phrase: 'ActivatedBlackseed', sourceNote: 'ActivatedBlackseed ده موجود', groundTruth: { notInCatalog: true } },
  { phrase: 'كومتركس', sourceNote: 'موجود كيرلكس الا هو بتاع البرد ده — حضرتك تقصد كومتركس؟', groundTruth: { notInCatalog: true } },
  { phrase: 'المينوكسديل', sourceNote: 'ميكونش فيه مينكسديل', groundTruth: { ambiguousAmong: ['57980', '73888'] } },
  { phrase: 'غسول فيتشي 400 مللي', sourceNote: 'غسول فيتشي ممتاز — 400 مللي ب 1200 جنيه (catalog only has a 200 ML size)', groundTruth: { notInCatalog: true } },
  { phrase: 'Mobinorm', sourceNote: 'حضرتك تقصد (Mobinorm) كريم مساج', groundTruth: { notInCatalog: true } },
  { phrase: 'bloomville', sourceNote: 'bloomville — انهي فيتامين كويس جدا', groundTruth: { code: '73046' } },
  { phrase: 'سنترم ومان 30 قرص', sourceNote: 'السنترم ومان ال 30 قرص 330', groundTruth: { code: '79759' } },
  { phrase: 'السنترم ال 100 قرص', sourceNote: 'اه حضرتك السنترم ال 100 قرص', groundTruth: { code: '79850' } },
  { phrase: 'الفوليك', sourceNote: 'الفوليك 24', groundTruth: { ambiguousAmong: ['68580', '11923'] } },
  { phrase: 'نيورفيت حبوب', sourceNote: 'نيورفيت 102 — نيورفيت حبوب', groundTruth: { code: '68352' } },
  { phrase: 'شريط دوليبران', sourceNote: 'شريط دوليبران ومرهم فاكتو مظبوط؟', groundTruth: { ambiguousAmong: ['60921', '79362'] } },
  { phrase: 'ديفارول', sourceNote: 'حقنه ديفارول ب 34', groundTruth: { code: '56424' } },
  { phrase: 'مارنيز اوميجا', sourceNote: 'ممكن ناخد حاجه زي مارنيز اوميجا', groundTruth: { code: '69565' } },
  { phrase: 'اقراص اورلي', sourceNote: 'ممكن تبدا باقراص اورلي', groundTruth: { ambiguousAmong: ['57038', '75705'] } },
  { phrase: 'الديرما رول', sourceNote: 'الديرما رول يفندم ب٢٥٠ — مقاس كام؟', groundTruth: { ambiguousAmong: ['74562', '68914', '68962', '74580'] } },
  { phrase: 'كريم كوريغا', sourceNote: 'كريم كوريغا متاح — صغيره ولا كبيره الحجم', groundTruth: { ambiguousAmong: ['68697', '64439', '80209'] } },
];

/** OLD baseline: naive exact-normalized-text equality only — representative of what the app does
 * TODAY (caseBasketEngine.ts's productId is always null; the legacy V17 tables show 0/584 and
 * 0/94 product_name rows ever linked to a catalog code — see the I.B.1 audit). */
function oldNaiveResolve(phrase: string, catalog: typeof CATALOG): string | null {
  const normalized = normalizeBaseText(phrase);
  const hit = catalog.find((p) => p.normalizedNames.includes(normalized));
  return hit ? hit.productCode : null;
}

function isCorrect(resultCode: string | null, truth: GroundTruth): boolean {
  if ('code' in truth) return resultCode === truth.code;
  if ('ambiguousAmong' in truth) return resultCode === null || truth.ambiguousAmong.includes(resultCode);
  return resultCode === null; // notInCatalog
}

describe('Phase I.B.1 benchmark — OLD vs V2 product resolution', () => {
  it('runs every benchmark case through both resolvers and reports the comparison table', () => {
    const rows = BENCHMARK.map((bc) => {
      const oldCode = oldNaiveResolve(bc.phrase, CATALOG);
      const v2Result = resolveProductMention(bc.phrase, INDEX);
      const v2Code = v2Result.selected?.product.productCode ?? null;
      const oldOk = isCorrect(oldCode, bc.groundTruth);
      const v2Ok = isCorrect(v2Code, bc.groundTruth);
      let classification: 'both_correct' | 'v2_fixed' | 'both_wrong' | 'v2_regression';
      if (oldOk && v2Ok) classification = 'both_correct';
      else if (!oldOk && v2Ok) classification = 'v2_fixed';
      else if (oldOk && !v2Ok) classification = 'v2_regression';
      else classification = 'both_wrong';
      return { phrase: bc.phrase, groundTruth: bc.groundTruth, oldCode, v2Code, v2Basis: v2Result.selected?.basis ?? (v2Result.ambiguous ? 'ambiguous' : 'unresolved'), oldOk, v2Ok, classification };
    });

    const summarize = (key: 'oldOk' | 'v2Ok') => ({
      correct: rows.filter((r) => r[key]).length,
      total: rows.length,
    });
    const oldSummary = summarize('oldOk');
    const v2Summary = summarize('v2Ok');
    const byClass = rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.classification] = (acc[r.classification] ?? 0) + 1;
      return acc;
    }, {});

    // eslint-disable-next-line no-console
    console.log('=== I.B.1 BENCHMARK: OLD vs V2 ===');
    for (const r of rows) {
      // eslint-disable-next-line no-console
      console.log(
        `${r.classification.padEnd(14)} | phrase="${r.phrase}" | OLD=${r.oldCode ?? 'null'}(${r.oldOk ? 'OK' : 'WRONG'}) | V2=${r.v2Code ?? 'null'}[${r.v2Basis}](${r.v2Ok ? 'OK' : 'WRONG'})`
      );
    }
    // eslint-disable-next-line no-console
    console.log(`OLD accuracy: ${oldSummary.correct}/${oldSummary.total}`);
    // eslint-disable-next-line no-console
    console.log(`V2 accuracy: ${v2Summary.correct}/${v2Summary.total}`);
    // eslint-disable-next-line no-console
    console.log('By classification:', JSON.stringify(byClass));

    // Hard assertions — these are the actual regression-guarding checks, not just log output.
    expect(v2Summary.correct).toBeGreaterThanOrEqual(oldSummary.correct);
    expect(byClass['v2_regression'] ?? 0).toBe(0); // V2 must never resolve a case OLD got right and V2 gets wrong
    expect(rows.length).toBe(BENCHMARK.length);
  });
});
