import { describe, expect, it } from 'vitest';
import { runSalesIntelligencePipeline } from '../salesIntelligencePipeline';
import { buildCanonicalProduct, countNormalizedNames } from '../pharmacyProducts/canonicalProduct';
import { buildPharmacyProductIndex, resolveProductMention } from '../pharmacyProducts/pharmacyProductResolverV2';
import { normalizePharmacyText } from '../pharmacyProducts/pharmacyNormalization';
import { isAcceptanceOnly, isRequestCandidate } from '@/lib/whatsappSemanticSignalsV32';
import type { NormalizedConversationMessageV32 } from '@/lib/whatsappConversationUnderstandingV32';

// V38 regressions from the 2026-10 real-conversation review. Phrasing is copied from real chats;
// customer names, codes and product ids are synthetic.

const catalogRows = [
  ['s-colona-30', 'COLONA 30 TAB', '91001'],
  ['s-colona-40', 'colona 40 tab', '91002'],
  ['s-gastro-200', 'GASTROBIOTIC 200 MG 20 TAB', '91003'],
  ['s-gastro-550', 'GASTROBIOTIC 550 MG 20 TAB', '91004'],
  ['s-pedi-forte', 'pedicort forte syrup 100 ml', '91005'],
  ['s-pedi-5', 'PEDICORT SYRUP 5 MG /5ML', '91006'],
  ['s-pedi-5-old', 'PEDICORT SYRUP 5 MG /5ML old', '91007'],
].map(([id, name, product_code]) => ({ id, name, product_code, normalized_name: name.toLowerCase(), category: null, price: null, source: 'synthetic' }));
const counts = countNormalizedNames(catalogRows);
const productIndex = buildPharmacyProductIndex(catalogRows.map((row) => buildCanonicalProduct(row, counts, normalizePharmacyText)));

function analyze(raw: string) {
  return runSalesIntelligencePipeline({
    conversationId: 'v38-real-phrasing',
    rawWhatsAppExportText: raw,
    resolveInvoiceCandidates: () => [],
    customerIdHint: 'customer-v38',
    customerIdentityStatus: 'resolved',
    branchNameRawHint: 'فرع شكري',
    productIndex,
  }).caseAnalyses;
}

const customer = (text: string) => ({ role: 'customer', isMeaningful: true, text } as NormalizedConversationMessageV32);

describe('V38 real phrasing regressions', () => {
  it('a strength the doctor proposed and the customer affirmed qualifies only the item the catalog proves', () => {
    const cases = analyze([
      '[9/28/26, 12:59:36 AM] You: اهلا بحضرتك اقدر اساعد حضرتك ازاي',
      '[9/28/26, 1:01:04 AM] عميل تجريبي: خليهم علبتين كولونا',
      '[9/28/26, 1:02:11 AM] You: يعني حضرتك محتاج تكرر المحلول وعلبتين كولونا وعلبة جاسترو بيوتيك',
      '[9/28/26, 1:02:17 AM] You: تركيز 550 صح؟',
      '[9/28/26, 1:02:18 AM] عميل تجريبي: مطبووط',
      '[9/28/26, 1:02:24 AM] You: الجاستروبيوتيك',
      '[9/28/26, 1:02:30 AM] You: عنيا حاضر',
    ].join('\n'));
    const products = cases.flatMap((c) => c.customerNeed.products);
    const gastro = products.filter((p) => p.productNameRaw.includes('جاسترو'));
    expect(gastro).toHaveLength(1);
    expect(gastro[0].productCode).toBe('91004');
    // Colona exists as 30 and 40 tablets; nothing in the chat chooses one, so it stays unresolved.
    const colona = products.filter((p) => p.productNameRaw.includes('كولونا'));
    expect(colona).toHaveLength(1);
    expect(colona[0].productCode).toBeNull();
    expect(colona[0].finalQuantity).toBe(2);
  });

  it('a satisfaction answer and a closing blessing are not customer requests', () => {
    expect(isRequestCandidate(customer('اهلا وسهلا بحضرتك الحمدلله الوالد اتحسن كتير جدا وخدمه التمريض ممتازة شكرا على متابعتكم واهتمامكم'))).toBe(false);
    expect(isRequestCandidate(customer('ربنا يسعدكم ويبارك فيكم جميعا 🤲'))).toBe(false);
    // Complaint or request wording keeps the message a request.
    expect(isRequestCandidate(customer('الحمدلله شكرا على متابعتكم بس الدوا مجاش لسه'))).toBe(true);
    expect(isRequestCandidate(customer('الحمدلله شكرا على متابعتكم وابعتلي علبة كمان'))).toBe(true);

    const cases = analyze([
      '[9/27/26, 10:54:07 AM] You: حابين نطمن على والد حضرتك بعد خدمة التمريض وأخذ المحلول',
      '[9/27/26, 1:14:23 PM] عميل تجريبي: اهلا وسهلا بحضرتك الحمدلله الوالد اتحسن كتير جدا وخدمه التمريض ممتازة شكرا على متابعتكم واهتمامكم',
      '[9/27/26, 1:15:33 PM] You: الحمدلله، فرحتنا جدًا إن الوالد اتحسن',
      '[9/27/26, 1:16:11 PM] عميل تجريبي: ربنا يسعدكم ويبارك فيكم جميعا 🤲',
    ].join('\n'));
    expect(cases.every((c) => c.conversationCase.caseType === 'information_only')).toBe(true);
    expect(cases.flatMap((c) => c.followUp.opportunities)).toEqual([]);
  });

  it('the spoken FORTE variant narrows one seeded brand; the plain brand stays ambiguous', () => {
    const forte = resolveProductMention('عايزه بيدو كورت فورت شراب للكبار', productIndex);
    expect(forte.selected?.product.productCode).toBe('91005');
    // The variant word, not the dosage form, narrowed it: confidence stays weak.
    expect(forte.selected?.basis).toBe('cross_script_equivalent');
    expect(resolveProductMention('بيدو كورت شراب', productIndex).selected).toBeNull();
  });

  it('"اه إنشاء الله" answers the doctor even after a 34-minute gap: no customer-silence follow-up', () => {
    expect(isAcceptanceOnly('اه إنشاء الله')).toBe(true);
    expect(isAcceptanceOnly('اه انشالله')).toBe(true);
    const cases = analyze([
      '[9/13/26, 3:06:40 AM] عميل تجريبي: محتاجه واحد من دا',
      '[9/13/26, 3:09:19 AM] You: من عنيا لحضرتك',
      '[9/13/26, 3:15:16 AM] You: هبعت لحضرتك دونوبرازول فوار باذن الله هنحتاج منه علبه ؟',
      '[9/13/26, 3:49:08 AM] عميل تجريبي: اه إنشاء الله',
      '[9/13/26, 3:49:21 AM] You: تحت امر حضرتك يا فندم',
    ].join('\n'));
    expect(cases).toHaveLength(1);
    expect(cases[0].followUp.opportunities.filter((o) => o.reason === 'customer_no_response')).toEqual([]);
    // "واحد من دا" is an explicit count for the pictured item; its identity stays unknown.
    const pictured = cases[0].customerNeed.products.find((p) => p.productNameRaw.includes('من دا'));
    expect(pictured?.requestedQuantity).toBe(1);
    expect(pictured?.productCode).toBeNull();
  });
});
