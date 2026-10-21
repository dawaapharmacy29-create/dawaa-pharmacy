import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runSalesIntelligencePipeline } from '../salesIntelligencePipeline';
import { buildCanonicalProduct, countNormalizedNames } from '../pharmacyProducts/canonicalProduct';
import { buildPharmacyProductIndex } from '../pharmacyProducts/pharmacyProductResolverV2';
import { normalizePharmacyText } from '../pharmacyProducts/pharmacyNormalization';
import { CANONICAL_COMPLAINT_PROJECTION_VERSION } from '../persistence/canonicalComplaintProjector';
import { isRequestCandidate } from '@/lib/whatsappSemanticSignalsV32';
import {
  CANONICAL_COMPLAINT_CREATOR,
  legacyComplaintReviewReason,
} from '../operations/proposalApprovalReadiness';

// V39 acceptance on the Heba → Shibl → nursing export shape. Wording is copied from the real
// review case; the customer name, code, product ids and invoice ids are synthetic.

const C = 'عميل تجريبي 90001';
const EXPORT = [
  '[9/27/26, 10:54:07 AM] You: صباح الخير يا أستاذ 🌷\nمع حضرتك هبه من خدمة عملاء صيدليات دواء.💙\n\nحابين نطمن على والد حضرتك بعد خدمة التمريض وأخذ المحلول',
  `[9/27/26, 1:14:23 PM] ${C}: اهلا وسهلا بحضرتك الحمدلله الوالد اتحسن كتير جدا وخدمه التمريض ممتازة شكرا على متابعتكم واهتمامكم`,
  '[9/27/26, 1:15:33 PM] You: الحمدلله، فرحتنا جدًا إن الوالد اتحسن',
  `[9/27/26, 1:16:11 PM] ${C}: ربنا يسعدكم ويبارك فيكم جميعا 🤲`,
  `[9/28/26, 12:56:27 AM] ${C}: السلام عليكم`,
  '[9/28/26, 12:58:50 AM] You: أهلًا وسهلًا بحضرتك✨\nمع حضرتك د شبل\nخدمة التوصيل متاحة على مدار ٢٤ ساعة 🚗',
  '[9/28/26, 12:59:36 AM] You: اهلا بحضرتك اقدر اساعد حضرتك ازاي',
  `[9/28/26, 12:59:49 AM] ${C}: [Forwarded] <image omitted>`,
  `[9/28/26, 1:00:23 AM] ${C}: <voice message omitted>`,
  `[9/28/26, 1:01:04 AM] ${C}: خليهم علبتين كولونا`,
  '[9/28/26, 1:02:11 AM] You: يعني حضرتك محتاج تكرر المحلول وعلبتين كولونا وعلبة جاسترو بيوتيك',
  '[9/28/26, 1:02:17 AM] You: تركيز 550 صح؟',
  `[9/28/26, 1:02:18 AM] ${C}: مطبووط`,
  '[9/28/26, 1:02:24 AM] You: الجاستروبيوتيك',
  '[9/28/26, 1:02:37 AM] You: عنيا حاضر',
  `[9/28/26, 1:03:03 AM] ${C}: العنوان برج تجريبي الدور ٣`,
  '[9/28/26, 1:28:43 AM] You: تم الارسال \nنتشرف ب خدمة حضرتك ٢٤ ساعه 🌸🌸',
  `[9/28/26, 2:17:35 AM] ${C}: لو سمحت ي دكتور ممكن تبعت حد مالتمريض لأن الكانيولا اللي ركبناها امبارح اتحركت م مكانها والمحلول بيسرب`,
  '[9/28/26, 2:20:27 AM] You: عنيا حالا هبعته لحضرتك',
  `[9/28/26, 2:20:44 AM] ${C}: تمام شكرا لحضرتك ي دكتور`,
  '[9/28/26, 2:29:10 AM] You: انا كلمت الممرض وقالي ان معاه اوردرين تمريض هيخلصهم وييجي لحضرتك على طول',
  `[9/28/26, 2:29:26 AM] ${C}: تمام يا دكتور شكرا ليك`,
  `[9/28/26, 3:39:59 AM] ${C}: دكتورنا معلش شوفه تاني كده`,
  '[9/28/26, 3:41:26 AM] You: بيقولي عشر دقايق او ربع ساعه وييجي لحضرتك',
  `[9/28/26, 3:41:49 AM] ${C}: تمام شكرا ليك يا دكتور`,
  '[9/28/26, 3:42:54 AM] You: واسفين لحضرتك عالتاخير',
  '[9/28/26, 4:08:40 AM] You: تم الارسال \nنتشرف ب خدمة حضرتك ٢٤ ساعه 🌸🌸',
].join('\n');

const catalogRows = [
  ['p-colona-30', 'COLONA 30 TAB', '91001'],
  ['p-colona-40', 'colona 40 tab', '91002'],
  ['p-gastro-200', 'GASTROBIOTIC 200 MG 20 TAB', '91003'],
  ['p-gastro-550', 'GASTROBIOTIC 550 MG 20 TAB', '91004'],
  ['p-ringer', 'RINGER SOLUTION INJECTION 500 ML.', '91005'],
].map(([id, name, product_code]) => ({ id, name, product_code, normalized_name: name.toLowerCase(), category: null, price: null, source: 'synthetic' }));
const counts = countNormalizedNames(catalogRows);
const productIndex = buildPharmacyProductIndex(catalogRows.map((row) => buildCanonicalProduct(row, counts, normalizePharmacyText)));

const INVOICE = {
  id: 'inv-synthetic-1', invoice_number: '90938', invoice_no: '90938',
  invoice_datetime: '2026-09-27T22:06:00+00:00', invoice_date: '2026-09-27T22:06:00+00:00',
  branch: 'فرع شكري', branch_name: 'فرع شكري', invoice_type: 'توصيل منزلى', net_total: 849, total_amount: 849,
  customer_code: '90001', customer_id: null, customer_name: 'د عميل تجريبي', seller_name: 'د محمد شبل', staff_name: 'د محمد شبل',
  line_items_count: 4,
};
const ITEMS = [
  { productNameRaw: 'colona 40 tab', productCode: '91002', productId: 'p-colona-40', quantity: 2 },
  { productNameRaw: 'GASTROBIOTIC 550 MG 20 TAB', productCode: '91004', productId: 'p-gastro-550', quantity: 1 },
  { productNameRaw: 'RINGER SOLUTION INJECTION 500 ML.', productCode: '91005', productId: 'p-ringer', quantity: 1 },
  { productNameRaw: 'توصيل منزلي', productCode: '79693', quantity: 1 },
];

function analyze() {
  return runSalesIntelligencePipeline({
    conversationId: 'ibrahim-shape',
    rawWhatsAppExportText: EXPORT,
    customerIdHint: null,
    customerIdentityStatus: 'unresolved',
    customerCodeHint: '90001',
    branchNameRawHint: 'المخزن',
    knownStaffIds: [],
    productIndex,
    resolveInvoiceCandidates: () => [INVOICE],
    itemEvidenceProvider: { getItemsForInvoice: (id: string) => (id === INVOICE.id ? ITEMS : 'unavailable') },
  } as any).caseAnalyses;
}

describe('V39 acceptance — customer service, drug order and nursing in one export', () => {
  const cases = analyze();
  const startsAt = (iso: string) => cases.filter((c) => new Date(c.conversationCase.startedAt).getTime() >= new Date(iso).getTime());
  const morning = cases.filter((c) => new Date(c.conversationCase.startedAt).getTime() < new Date('2026-09-27T21:00:00Z').getTime());
  const order = cases.filter((c) => c.customerNeed.products.length > 0);

  it('the welfare check and the thank-you reply are information only with no follow-up', () => {
    expect(morning.length).toBeGreaterThan(0);
    expect(morning.every((c) => c.conversationCase.caseType === 'information_only')).toBe(true);
    expect(morning.flatMap((c) => c.followUp.opportunities)).toEqual([]);
  });

  it('the order keeps explicit quantities and only catalogue-proven identities', () => {
    expect(order).toHaveLength(1);
    const products = order[0].customerNeed.products;
    const colona = products.filter((p) => p.productNameRaw.includes('كولونا'));
    const gastro = products.filter((p) => p.productNameRaw.includes('جاسترو'));
    expect(colona).toHaveLength(1);
    expect(gastro).toHaveLength(1);
    // The customer wrote "علبتين كولونا": quantity 2 is stated; 30 vs 40 tablets is not.
    expect(colona[0].requestedQuantity).toBe(2);
    expect(colona[0].finalQuantity).toBe(2);
    expect(colona[0].productCode).toBeNull();
    // 550 came from the doctor's question and the customer's "مطبووط".
    expect(gastro[0].productCode).toBe('91004');
    expect(gastro[0].finalQuantity).toBe(1);
  });

  it('an unresolved customer never turns the matching invoice into proof, revenue or credit', () => {
    for (const c of cases) {
      expect(c.salesOutcome.isSaleCountable).toBe(false);
      expect(c.salesOutcome.saleProofState).not.toBe('proven');
      expect(c.attribution.isOfficialForStaffEvaluation).toBe(false);
    }
    // The invoice is offered to one case at most — never counted twice.
    const selecting = cases.filter((c) => c.attribution.selectedInvoiceNumber === '90938');
    expect(selecting.length).toBeLessThanOrEqual(1);
  });

  it('the nursing request and its chase are not drug sales and create no sales follow-up', () => {
    const nursing = startsAt('2026-09-27T23:00:00Z');
    expect(nursing.length).toBeGreaterThan(0);
    for (const c of nursing) {
      expect(c.customerNeed.products).toEqual([]);
      expect(c.salesOutcome.isSaleCountable).toBe(false);
      expect(c.attribution.selectedInvoiceNumber ?? null).toBeNull();
    }
  });

  it('no media content is invented: image and voice add no product', () => {
    const names = cases.flatMap((c) => c.customerNeed.products.map((p) => p.productNameRaw));
    expect(names.every((name) => /كولونا|جاسترو/.test(name))).toBe(true);
  });
});

describe('courtesy-only replies are closings, not requests', () => {
  const customer = (text: string) => ({ role: 'customer', isMeaningful: true, text } as any);
  it('treats thank-you-only wording as closing and keeps any real content a request', () => {
    expect(isRequestCandidate(customer('تمام شكرا لحضرتك ي دكتور'))).toBe(false);
    expect(isRequestCandidate(customer('تمام يا دكتور شكرا ليك'))).toBe(false);
    expect(isRequestCandidate(customer('تسلم ي دكتور'))).toBe(false);
    expect(isRequestCandidate(customer('تمام شكرا عايز علبة كمان'))).toBe(true);
    expect(isRequestCandidate(customer('شكرا بس الدوا مجاش'))).toBe(true);
    expect(isRequestCandidate(customer('دكتورنا معلش شوفه تاني كده'))).toBe(true);
  });
});

describe('legacy complaint follow-up review guard', () => {
  it('uses the canonical projector identity', () => {
    expect(CANONICAL_COMPLAINT_CREATOR).toBe(CANONICAL_COMPLAINT_PROJECTION_VERSION);
  });

  it('blocks an earlier-engine complaint follow-up and leaves canonical or withdrawn ones alone', () => {
    const legacy = { actionType: 'complaint_followup', status: 'ready', createdBy: null };
    expect(legacyComplaintReviewReason(legacy)).toMatch(/محرك سابق/);
    expect(legacyComplaintReviewReason({ ...legacy, createdBy: CANONICAL_COMPLAINT_CREATOR })).toBeNull();
    expect(legacyComplaintReviewReason({ ...legacy, status: 'dismissed' })).toBeNull();
    expect(legacyComplaintReviewReason({ ...legacy, actionType: 'customer_request' })).toBeNull();
  });
});

describe('complaint delivery context', () => {
  it('never links a delivery invoice by customer code and nearest time', () => {
    const source = readFileSync('src/lib/salesIntelligence/refresh/canonicalRefreshService.ts', 'utf8');
    expect(source).not.toMatch(/customer_time_match/);
    expect(source).not.toMatch(/readInvoiceRecordsByCustomerWindow/);
  });
});
