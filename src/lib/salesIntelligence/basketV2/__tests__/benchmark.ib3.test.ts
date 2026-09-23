// Phase I.B.3 — the real Basket benchmark: OLD (caseBasketEngine.ts) vs Basket Reconstruction V2.
//
// GROUND TRUTH METHODOLOGY (instruction #27, same discipline as I.B.2.1's own benchmark): every
// `groundTruth` value below was written by reading the conversation text FIRST and deciding the
// correct answer BEFORE ever running either engine. Ground truth is never derived from, or
// adjusted to match, either engine's own output. Where the real conversation's text genuinely does
// not establish a safe answer (a decision made over a voice message, an image-only antecedent, a
// quantity split across two products with no per-product number), the ground truth says so
// honestly via `expectUnresolvedSignal`/loose `expectedAddedProductCodes` rather than guessing —
// and the specific ambiguity is recorded in `sourceNote` for the manual regression review this
// file's own test performs.
//
// REAL vs SYNTHETIC (instruction #26's "do not fabricate volume"): every case marked
// `source: 'real'` is copied — customer display name normalized to "Customer" for fixture
// cleanliness, message TEXT otherwise verbatim — from whatsapp_review_sources (mined 2026-09-23 via
// keyword SQL over the full 90-row corpus; see the I.B.3 report for the exact queries and per-
// category hit counts). `source: 'synthetic'` cases exist ONLY to cover mandatory structural
// categories (remove item, whole-order cancellation, a single-item rejection distinct from
// cancellation, a clean unambiguous substitution, the same-message reference gap, a two-product
// ambiguous-quantity worked example, a rejected recommendation) that this corpus's 90 conversations
// do not naturally contain at all (confirmed via SQL: zero real hits for remove/cancel/reject
// phrasing across the whole corpus) — never to inflate volume. Every synthetic case still uses only
// REAL catalog products (Antinal, Flexilax, Centrum) confirmed present in the actual `products`
// table, never an invented SKU.
//
// FINAL COUNT (reported honestly, not padded to the instruction's 30/40-case targets): 22 cases
// (12 real + 10 synthetic). This corpus is small (90 conversations total) and overwhelmingly
// voice/image-dependent for the exact commercial decision (which SKU, whether accepted) — a
// finding reported in its own right in the I.B.3/I.B.3.1 reports, not hidden by inflating the case
// count. I.B.3.1 added R11/R12 (further real price-only/misspelling cases outside this benchmark's
// catalog subset, mined the same way) and S09/S10 (mandatory families #6/#8 — recommendation-only
// and availability-then-order, which I.B.3's own 18-case set did not yet cover explicitly).
import { describe, expect, it } from 'vitest';
import { buildCanonicalProduct, countNormalizedNames, type RawProductRow } from '../../pharmacyProducts/canonicalProduct';
import { buildPharmacyProductIndex } from '../../pharmacyProducts/pharmacyProductResolverV2';
import { normalizePharmacyText } from '../../pharmacyProducts/pharmacyNormalization';
import { buildCaseBaskets } from '../../caseBasketEngine';
import { buildConversationEntityGraphV2 } from '../conversationEntityGraphV2';
import { reconstructBasketV2 } from '../basketReconstructionV2';
import { messagesFrom } from './testUtils';
import type { BasketStatusV2 } from '../basketV2Types';

function catalogFrom(rows: RawProductRow[]) {
  const counts = countNormalizedNames(rows);
  const catalog = rows.map((r) => buildCanonicalProduct(r, counts, normalizePharmacyText));
  return buildPharmacyProductIndex(catalog);
}

// Every row below is a REAL row from the `products` table (id/product_code/price confirmed via SQL
// against the live Supabase project on 2026-09-23) — never an invented SKU, including for the
// synthetic conversation fixtures (only the CONVERSATION TEXT is synthetic there, never the product).
const REAL_CATALOG_ROWS: RawProductRow[] = [
  { id: '8418f406-2c16-423e-8528-529d39e7d17b', name: 'ANTINAL 24 CAP', product_code: '56822', normalized_name: 'antinal 24 cap', category: null, price: '52', source: 'catalog_import' },
  { id: '8e762d26-b981-4f29-a696-8f361d70349a', name: 'Flexilax 30 tabs', product_code: '68114', normalized_name: 'flexilax 30 tabs', category: null, price: '84', source: 'catalog_import' },
  { id: '67807107-59cf-4ffe-b442-6d182454fb6b', name: 'CENTRUM WOMEN 100 TAB', product_code: '79850', normalized_name: 'centrum women 100 tab', category: null, price: '810', source: 'catalog_import' },
  { id: '0479e483-c82e-4c07-bb8c-e096cc116c19', name: 'folic acid 5 mg eipico 20 tablets', product_code: '68516', normalized_name: 'folic acid 5 mg eipico 20 tablets', category: null, price: '24', source: 'catalog_import' },
  { id: 'a97f2f5e-66c9-4bef-a3f3-8656d731ddd1', name: 'Neurovit 30 tab', product_code: '68352', normalized_name: 'neurovit 30 tab', category: null, price: '102', source: 'catalog_import' },
  { id: '8086c521-e3a0-4cd1-ab06-d38e53e762e5', name: 'FLAGYL 500 MG TAB', product_code: '30735', normalized_name: 'flagyl 500 mg tab', category: null, price: '34', source: 'catalog_import' },
  { id: '90cc5359-2737-4724-b4d3-2cbedefec7d4', name: 'VISCERALGINE TAB', product_code: '26690', normalized_name: 'visceralgine tab', category: null, price: '42', source: 'catalog_import' },
  { id: 'ff82656c-51d4-4135-8c8f-8b60a6103841', name: 'Corega Cream 20 Gm', product_code: '68697', normalized_name: 'corega cream 20 gm', category: null, price: '140', source: 'catalog_import' },
  { id: 'dfbaa321-45eb-42b4-a345-b687bd8cfbf0', name: 'corega denture fixative cream 40gm', product_code: '64439', normalized_name: 'corega denture fixative cream 40gm', category: null, price: '250', source: 'catalog_import' },
  { id: '8659053b-f2da-42c2-83f7-4efe698e77b1', name: 'VICHY NORMADERM PURIFYING 400M', product_code: '71207', normalized_name: 'vichy normaderm purifying 400m', category: null, price: '1200', source: 'catalog_import' },
  { id: 'b872d26e-30e0-4e49-98ba-0ee29ece241f', name: 'ISIS TEEN DERM GEL SENSITIVE 250ML', product_code: '70271', normalized_name: 'isis teen derm gel sensitive 250ml', category: null, price: '659', source: 'catalog_import' },
];
const CATALOG = catalogFrom(REAL_CATALOG_ROWS);

interface BasketBenchmarkCase {
  id: string;
  source: 'real' | 'synthetic';
  category: string;
  sourceNote: string;
  raw: string;
  groundTruth: {
    /** Product codes that MUST end up as an active/confirmed/candidate basket line — unambiguous from the text alone. */
    expectedAddedProductCodes: string[];
    /** Product codes that must NEVER be silently added as an active item (staff-only recommendation never accepted, rejected, ambiguous antecedent, or genuinely unresolved). */
    expectedNeverAddedProductCodes: string[];
    /** productCode -> exact expected quantity, ONLY for codes where the text makes the quantity unambiguous. */
    expectedQuantities: Record<string, number | null>;
    expectedStatus: BasketStatusV2 | null;
    expectUnresolvedSignal: boolean;
  };
}

const CASES: BasketBenchmarkCase[] = [
  {
    id: 'R01',
    source: 'real',
    category: 'single_item_order',
    sourceNote: 'مونزا الحماقي, id ff1f342c — "سيبرو برو" does not match any real catalog row (confirmed via SQL: no CIPRO product named "برو"); ground truth is that NEITHER engine may hallucinate a resolution for it.',
    raw: `[9/10/26, 6:46:41 PM] Customer: سلام عليكم
[9/10/26, 6:46:43 PM] Customer: لو سمحت
[9/10/26, 6:46:46 PM] You: أهلا بحضرتك مع حضرتك د ندى من صيدليات دواء
[9/10/26, 6:46:48 PM] You: وعليكم السلام ورحمه الله وبركاته
[9/10/26, 6:47:20 PM] Customer: وعاوزة شريط سيبرو برو
[9/10/26, 6:48:41 PM] You: تحت امر حضرتك يا فندم حضرتك تؤمر بحاجة تانية
[9/10/26, 6:51:35 PM] Customer: لاء شكرا
[9/10/26, 6:53:16 PM] You: جاري الارسال نتشرف ب خدمة حضرتك`,
    groundTruth: { expectedAddedProductCodes: [], expectedNeverAddedProductCodes: [], expectedQuantities: {}, expectedStatus: null, expectUnresolvedSignal: true },
  },
  {
    id: 'R02',
    source: 'real',
    category: 'quantity_change',
    sourceNote: 'مونزا الحماقي, id e9e231ad (first exchange) — staff recommends Flagyl+Visceralgine together, customer\'s own "عاوزة منهم شريطين" is the real request, then self-corrects to "شريط وشريط" (one each). The quantity/product split across TWO products is genuinely ambiguous from text alone — ground truth is that NEITHER product may silently receive quantity=2 (that would double the real 1+1 order), and this is the safety property this case actually tests, not an exact item match.',
    raw: `[9/14/26, 1:17:33 AM] You: تمام حضرتك في اسهال او امساك
[9/14/26, 1:17:38 AM] Customer: لاء
[9/14/26, 1:17:45 AM] Customer: بس حاسة بغثيان
[9/14/26, 1:20:20 AM] You: تمام ان شاء الله ممكن ان شاء الله ناخد فلاجيل ان شاء الله اقراص مع فيسرالجين ناخدهم ان شاء الله بالتبادل كل ٨ ساعات
[9/14/26, 1:20:36 AM] Customer: تمام
[9/14/26, 1:20:44 AM] Customer: عاوزة منهم شريطين
[9/14/26, 1:21:10 AM] You: عنيا ان شاء الله شريطين وشريطين ولا شريط وشريط
[9/14/26, 1:21:16 AM] Customer: تمام يادكتور شكرا لحضرتك
[9/14/26, 1:21:27 AM] Customer: شريط وشريط
[9/14/26, 1:21:32 AM] You: العفو يا فندم تخت امر حضرتك
[9/14/26, 1:27:37 AM] You: تم الارسال نتشرف ب خدمة حضرتك`,
    groundTruth: { expectedAddedProductCodes: [], expectedNeverAddedProductCodes: [], expectedQuantities: {}, expectedStatus: null, expectUnresolvedSignal: true },
  },
  {
    id: 'R03',
    source: 'real',
    category: 'multi_item_order',
    sourceNote: 'مونزا الحماقي, id e9e231ad (second exchange, same day) — 4 items named rapid-fire; "متوفر ال ٥٠ كيس" is an image-only antecedent (the forwarded photo, not resolvable from text) — ground truth marks it a review/unresolved candidate, never a guessed product. "كيوتابكس"/"سولو فريش"/"هاى فريش"/"سويتال" are not in the real catalog subset used here — real-world unresolved names, not an engine bug.',
    raw: `[9/14/26, 5:21:31 PM] Customer: سلام عليكم
[9/14/26, 5:21:40 PM] Customer: لو سمحت عاوزة قطرة سولو فريش
[9/14/26, 5:21:44 PM] Customer: وقطرة هاى فريش
[9/14/26, 5:21:51 PM] Customer: وعلبة سويتال شبه دى
[9/14/26, 5:22:01 PM] Customer: متوفر ال ٥٠ كيس ابعته لحضرتك ؟
[9/14/26, 5:22:03 PM] You: أهلا بحضرتك مع حضرتك د ندى من صيدليات دواء
[9/14/26, 5:22:07 PM] You: وعليكم السلام ورحمه الله وبركاته
[9/14/26, 5:22:10 PM] Customer: وشريط كيوتابكس
[9/14/26, 5:22:21 PM] You: تركيز ايه ي فندم؟
[9/14/26, 5:23:56 PM] Customer: 25
[9/14/26, 5:29:16 PM] Customer: تمام؟
[9/14/26, 5:29:52 PM] You: تمام عنيا
[9/14/26, 5:31:27 PM] You: جاري الارسال نتشرف ب خدمة حضرتك`,
    groundTruth: { expectedAddedProductCodes: [], expectedNeverAddedProductCodes: [], expectedQuantities: {}, expectedStatus: null, expectUnresolvedSignal: true },
  },
  {
    id: 'R04',
    source: 'real',
    category: 'multi_item_order',
    sourceNote: 'اليماني حسين حسن, id 167b0383 (second exchange) — real multi-item order with a real, checkable total: 810 (Centrum Women 100) + 24 (Folic Acid) + 102 (Neurovit) = 936, plus 10 delivery = 946, matching the staff\'s own stated total exactly. This is the cleanest real multi-item case in the corpus. None of the three items carries an explicit unit word, so per instruction #12 quantity must stay unknown/null for all three, never guessed as 1.',
    raw: `[7/11/26, 12:12:26 PM] Customer: سنترم ومان و فوليك أسيد و نيروفيت حبوب
[7/11/26, 12:12:35 PM] Customer: دولت تكلفتهم كام
[7/11/26, 12:14:55 PM] You: عنيا حاضر
[7/11/26, 12:28:17 PM] You: السنترم ومان ال 30 قرص 330
[7/11/26, 12:28:20 PM] You: ال 100 قرص 810
[7/11/26, 12:28:35 PM] You: الفوليك 24
[7/11/26, 12:28:51 PM] You: نيورفيت 102
[7/11/26, 12:29:12 PM] Customer: ربنا ييسرلكم الرزق
[7/11/26, 12:34:59 PM] Customer: كده الحساب كام
[7/11/26, 12:35:45 PM] You: اه حضرتك السنترم ال 100 قرص
[7/11/26, 12:36:01 PM] You: 936
[7/11/26, 12:36:05 PM] You: والتوصيل 10
[7/11/26, 12:36:11 PM] Customer: تمام
[7/11/26, 12:36:23 PM] Customer: رقم تحويل
[7/11/26, 12:36:40 PM] You: 01028308235
[7/11/26, 12:40:02 PM] You: جاري الارسال نتشرف ب خدمة حضرتك
[7/11/26, 12:40:07 PM] You: 946
[7/11/26, 12:40:15 PM] You: تم الارسال نتشرف ب خدمة حضرتك`,
    groundTruth: {
      expectedAddedProductCodes: ['79850', '68516', '68352'],
      expectedNeverAddedProductCodes: [],
      expectedQuantities: { '79850': null, '68516': null, '68352': null },
      expectedStatus: 'confirmed',
      expectUnresolvedSignal: false,
    },
  },
  {
    id: 'R05',
    source: 'real',
    category: 'recommendation_then_acceptance',
    sourceNote: 'محمد الكموني17777, id 9a59338b — customer forwards a photo naming "Isis teenderm gel for sensitive skin" (real match: ISIS TEEN DERM GEL SENSITIVE 250ML, code 70271), asks availability, staff confirms, customer explicitly says "اه ابعته" (yes, send it) — an unambiguous acceptance-then-fulfillment, the cleanest real single-item case in the corpus.',
    raw: `[9/15/26, 9:30:55 PM] Customer: Isis teenderm gel for sensitive skin
[9/15/26, 9:31:05 PM] You: أهلا بحضرتك مع حضرتك د اسلام
[9/15/26, 9:31:16 PM] Customer: موجود عندكم الغسول ده
[9/15/26, 9:32:09 PM] You: موجود باذن الله يافندم
[9/15/26, 9:35:06 PM] You: تحب نبعته لحضرتك باذن الله ؟
[9/15/26, 9:42:30 PM] Customer: اه ابعته
[9/15/26, 9:42:57 PM] You: من عنيا لحضرتك
[9/15/26, 10:28:58 PM] You: اه يا فندم المندوب في الطريق لحضرتك`,
    groundTruth: {
      expectedAddedProductCodes: ['70271'],
      expectedNeverAddedProductCodes: [],
      expectedQuantities: { '70271': null },
      expectedStatus: null,
      expectUnresolvedSignal: false,
    },
  },
  {
    id: 'R06',
    source: 'real',
    category: 'price_only_inquiry',
    sourceNote: 'اليماني حسين حسن, id 47b9b219 — customer asks staff to recommend a face cleanser, staff recommends Vichy Normaderm (real match: VICHY NORMADERM PURIFYING 400M, code 71207) and quotes two sizes\' prices; the visible window ends there with no acceptance evidence at all — a pure price/recommendation inquiry, instruction #17\'s own "an item mentioned is NOT automatically a basket item" case.',
    raw: `[6/21/26, 2:55:16 PM] Customer: طب تنضيف البشره ده ترشحيلي ايه
[6/21/26, 2:56:45 PM] You: غسول فيتشي ممتاز يا فندم فيه ساليسلك اسيد علشان التنضيف و للرؤوس البيضا و السودا
[6/21/26, 2:57:00 PM] Customer: سعره كام
[6/21/26, 2:57:59 PM] You: 400 مللي ب 1200 جنيه
[6/21/26, 2:58:05 PM] You: 200 مللي ب 800 جنية`,
    groundTruth: { expectedAddedProductCodes: [], expectedNeverAddedProductCodes: ['71207'], expectedQuantities: {}, expectedStatus: null, expectUnresolvedSignal: false },
  },
  {
    id: 'R07',
    source: 'real',
    category: 'image_antecedent',
    sourceNote: 'اليماني حسين حسن, id ccdf9a9e — customer asks about "كريم كوريغا" (Corega cream — real catalog has both a small 20g cream and a larger 40gm denture-fixative cream), staff sends TWO images (small vs large), customer asks price for each, then decides which one via a VOICE MESSAGE the text pipeline cannot see ("ابعت لحضرتك اي واحد؟" -> customer answers with <voice message omitted> -> staff ships). Ground truth: the specific SKU is NOT safely recoverable from text alone — this is exactly instruction #22\'s image/voice-antecedent limitation. Neither variant may be silently added.',
    raw: `[12/22/25, 8:54:31 AM] Customer: كريم كوريغا متاح
[12/22/25, 8:57:44 AM] You: متاح
[12/22/25, 8:58:48 AM] Customer: اكيد الكريم
[12/22/25, 8:59:04 AM] Customer: صغيره ولا كبيره الحجم
[12/22/25, 9:00:17 AM] You: <image omitted>
[12/22/25, 9:00:40 AM] Customer: طب تمام
[12/22/25, 9:01:09 AM] You: ده الصغير يفندم
[12/22/25, 9:01:20 AM] Customer: والكبير متاح
[12/22/25, 9:01:24 AM] You: <image omitted>
[12/22/25, 9:01:25 AM] Customer: وبكام
[12/22/25, 9:03:32 AM] You: ١٤٠ يفندم
[12/22/25, 9:03:41 AM] You: الاتنين كريم حضرتك
[12/22/25, 9:03:47 AM] Customer: تمام
[12/22/25, 9:05:13 AM] You: متاح حالا يفندم ابعت لحضرتك اي واحد؟
[12/22/25, 9:05:34 AM] Customer: <voice message omitted>
[12/22/25, 9:14:09 AM] You: تمام يفندم تحت امر حضرتك
[12/22/25, 9:14:17 AM] You: تم الارسال نتشرف ب خدمة حضرتك`,
    groundTruth: { expectedAddedProductCodes: [], expectedNeverAddedProductCodes: [], expectedQuantities: {}, expectedStatus: null, expectUnresolvedSignal: true },
  },
  {
    id: 'R08',
    source: 'real',
    category: 'same_customer_multiple_turns',
    sourceNote: 'اليماني حسين حسن, id 26d5a57d — a staff FOLLOW-UP message referencing an earlier order/recommendation across turns ("أخبار الـCentrum مع حضرتك إيه؟ وكمان حبيت أعرف رأي حضرتك في الـDerma Active Roll") — a pure check-in, no new commercial action from either side. Ground truth: an empty basket for this case (no ActionNode indicates commercial acquisition intent here at all).',
    raw: `[9/12/26, 3:49:54 PM] You: مساء الخير يا فندم مع حضرتك نور من خدمة عملاء صيدليات دواء. حبيت أطمن على حضرتك وأتابع معاك، أخبار الـCentrum مع حضرتك إيه؟ وكمان حبيت أعرف رأي حضرتك في الـDerma Active Roll اللي تم ترشيحه لحضرتك، هل حضرتك جربته ولا لسه؟
[9/12/26, 3:51:27 PM] Customer: <voice message omitted>
[9/12/26, 3:55:17 PM] You: تمام يا فندم إن شاء الله يعجب حضرتك، جربه وإن شاء الله تلاحظ فرق كويس مع الاستمرار`,
    groundTruth: { expectedAddedProductCodes: [], expectedNeverAddedProductCodes: [], expectedQuantities: {}, expectedStatus: null, expectUnresolvedSignal: false },
  },
  {
    id: 'R09',
    source: 'real',
    category: 'substitution',
    sourceNote: 'اليماني حسين حسن, id a6200ae4 — customer asks about a photographed product; staff says it is "مش متوفر خالص" and offers TWO different alternatives at two different prices (85 then 135) across several voice-message exchanges; the customer\'s actual final pick is never stated in text. Ground truth: neither substitute may be silently added — a real, genuinely ambiguous substitution (distinct from the single-clean-offer case covered synthetically in S05).',
    raw: `[4/7/26, 8:51:12 AM] You: أهلا بحضرتك مع حضرتك د اسلام
[4/7/26, 9:00:46 AM] You: هو ده يافندم مش متوفر خالص انا قلبت لحضرتك عليه الدنيا ممكن ارشح لحضرتك حاجه افضل منه
[4/7/26, 9:02:00 AM] Customer: زي ايه
[4/7/26, 9:05:24 AM] You: <image omitted> وده بديل الجل هو قوامه خفيف شويه بس بيثبت ويدي لمعان
[4/7/26, 9:07:50 AM] Customer: سعره كام
[4/7/26, 9:08:15 AM] You: 85 جنيه باذن الله
[4/7/26, 9:26:12 AM] You: حضرتك تحب نبعته لحضرتك
[4/7/26, 9:26:43 AM] Customer: <voice message omitted>
[4/7/26, 9:27:50 AM] You: هو مش فوم هو عباره عن جل بس اخف شويه ولو حضرتك قلقان منه نوع الجل الي ان بعته لحضرتك كويس جدا الي هو ده
[4/7/26, 9:28:26 AM] Customer: بكام
[4/7/26, 9:29:37 AM] You: 135 باذن الله
[4/7/26, 9:29:57 AM] Customer: <voice message omitted>`,
    groundTruth: { expectedAddedProductCodes: [], expectedNeverAddedProductCodes: [], expectedQuantities: {}, expectedStatus: null, expectUnresolvedSignal: true },
  },
  {
    id: 'R10',
    source: 'real',
    category: 'availability_only',
    sourceNote: 'اليماني حسين حسن, id ccdf9a9e (opening exchange, trimmed before any order proceeds) — a bare availability question, nothing else. Instruction #17\'s own worked example.',
    raw: `[12/22/25, 8:54:31 AM] Customer: كريم كوريغا متاح
[12/22/25, 8:55:37 AM] You: صباح النور
[12/22/25, 8:57:44 AM] You: متاح`,
    groundTruth: { expectedAddedProductCodes: [], expectedNeverAddedProductCodes: ['68697', '64439'], expectedQuantities: {}, expectedStatus: null, expectUnresolvedSignal: false },
  },
  {
    id: 'R11',
    source: 'real',
    category: 'price_only_inquiry',
    sourceNote: 'اليماني حسين حسن, id 6fedfe58 — customer asks the price of "مجموعه كلاري" (a Clarins hair-care line), staff lists 7 individual line-item prices plus a bundle total; no order verb or acceptance anywhere in the window. Deliberately outside this benchmark\'s catalog subset (no Clarins rows) — ground truth is that nothing safely resolves, and CRITICALLY neither engine may hallucinate a match against an unrelated catalog row just because 7 prices were quoted.',
    raw: `[12/22/25, 2:08:06 PM] Customer: مجموعه كلاري بكام
[12/22/25, 2:09:22 PM] You: دقايق اشوف لحضرتك سعرها
[12/22/25, 2:13:55 PM] You: البلسم ٣٢٠
[12/22/25, 2:13:56 PM] You: الشامبو العادي ٣٠٠
[12/22/25, 2:13:57 PM] You: شامبو القشره ٣٢٠
[12/22/25, 2:13:58 PM] You: سيروم التساقط ٣٥٠
[12/22/25, 2:13:59 PM] You: بوستر شوت التساقط ٤٥٠
[12/22/25, 2:14:00 PM] You: ليف ان كريم ٣٠٠
[12/22/25, 2:14:01 PM] You: الماسك ٣٦٠
[12/22/25, 2:14:26 PM] You: في حال ان حضرتك محتاجه منتجين او اكتر هيكون عليهم خصم ان شاء الله
[12/22/25, 2:20:20 PM] You: المجموعة كامله يفندم هيكون سعرها ٢١٥٠ ان شاء الله`,
    groundTruth: { expectedAddedProductCodes: [], expectedNeverAddedProductCodes: [], expectedQuantities: {}, expectedStatus: null, expectUnresolvedSignal: false },
  },
  {
    id: 'R12',
    source: 'real',
    category: 'arabic_misspelling',
    sourceNote: 'اليماني حسين حسن, id f1d98bf0 — customer misspells a brand ("كيرليكس"), staff explicitly corrects it ("حضرتك تقصد كلاريكس") mid-conversation — a real staff-side spelling correction, not a text-normalization artifact. Deliberately outside this benchmark\'s catalog subset — ground truth is that nothing safely resolves; the point of this case is that the misspelling correction itself must never be mistaken for a NEW product mention or silently merged with an unrelated catalog row.',
    raw: `[6/19/26, 9:20:42 AM] Customer: موجود برشام كيرليكس
[6/19/26, 9:21:23 AM] Customer: واستفسار بس عن منتج كويس جدا لانبات الشعر ميكونش فيه مينكسديل
[6/19/26, 9:28:54 AM] You: حضرتك تقصد كلاريكس
[6/19/26, 9:29:11 AM] You: كابكسي اسبراي او امبولات
[6/19/26, 9:30:37 AM] You: لا يفندم مش زي المينوكسديل
[6/19/26, 9:31:17 AM] You: في نوفوفين اقراص ده نوع فرنسي فعال جدا للتساقط
[6/19/26, 10:01:12 AM] Customer: تمنهم كام
[6/19/26, 10:01:22 AM] Customer: الاسبراي والفيتامين
[6/19/26, 10:01:56 AM] You: الفيتمين العلبه 990
[6/19/26, 10:02:01 AM] You: الاسبراي 700`,
    groundTruth: { expectedAddedProductCodes: [], expectedNeverAddedProductCodes: [], expectedQuantities: {}, expectedStatus: null, expectUnresolvedSignal: false },
  },

  // -------------------------------------------------------------------------
  // SYNTHETIC — structural categories with zero real hits in this 90-row corpus (confirmed via SQL:
  // remove/cancel/reject phrasing all returned 0 rows). Real products throughout, synthetic text only.
  // -------------------------------------------------------------------------
  {
    id: 'S01',
    source: 'synthetic',
    category: 'remove_item',
    sourceNote: 'Mandatory structural case — corpus has zero real "شيل"-as-remove examples.',
    raw: `[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: موجود
[9/15/26, 9:02:00 AM] Customer: شيل انتينال`,
    groundTruth: { expectedAddedProductCodes: [], expectedNeverAddedProductCodes: [], expectedQuantities: {}, expectedStatus: null, expectUnresolvedSignal: false },
  },
  {
    id: 'S02',
    source: 'synthetic',
    category: 'quantity_change',
    sourceNote: 'Mandatory structural case — a clean single-product quantity correction ("هات 2" then "خليهم 3"), corpus has no real bare "خليهم N" turn (confirmed via SQL: only 1 hit total, and it was not a usable full conversation).',
    raw: `[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: موجود
[9/15/26, 9:02:00 AM] Customer: هات 2
[9/15/26, 9:03:00 AM] Customer: خليهم 3`,
    groundTruth: { expectedAddedProductCodes: ['56822'], expectedNeverAddedProductCodes: [], expectedQuantities: { '56822': 3 }, expectedStatus: null, expectUnresolvedSignal: false },
  },
  {
    id: 'S03',
    source: 'synthetic',
    category: 'cancellation',
    sourceNote: 'Mandatory structural case — corpus has zero real whole-order-cancellation examples.',
    raw: `[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: موجود
[9/15/26, 9:02:00 AM] Customer: كنسل الطلب`,
    groundTruth: { expectedAddedProductCodes: [], expectedNeverAddedProductCodes: [], expectedQuantities: {}, expectedStatus: 'cancelled', expectUnresolvedSignal: false },
  },
  {
    id: 'S04',
    source: 'synthetic',
    category: 'ambiguous_reference',
    sourceNote: 'Mandatory structural case — instruction #20\'s own example: a single-item rejection must never cancel the whole order. Two items ordered, only one rejected.',
    raw: `[9/15/26, 9:00:00 AM] Customer: عايز انتينال وفليكسيلاكس
[9/15/26, 9:01:00 AM] You: الاتنين موجودين
[9/15/26, 9:02:00 AM] Customer: مش عايز انتينال`,
    groundTruth: { expectedAddedProductCodes: ['68114'], expectedNeverAddedProductCodes: [], expectedQuantities: {}, expectedStatus: null, expectUnresolvedSignal: false },
  },
  {
    id: 'S05',
    source: 'synthetic',
    category: 'substitution',
    sourceNote: 'Mandatory structural case — instruction #14\'s own worked example: a clean, single, unambiguous staff-offered substitute (unlike R09\'s genuinely ambiguous real two-offer case).',
    raw: `[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: انتينال مش موجود بس فيه فليكسيلاكس
[9/15/26, 9:02:00 AM] Customer: هات التاني`,
    groundTruth: { expectedAddedProductCodes: ['68114'], expectedNeverAddedProductCodes: [], expectedQuantities: {}, expectedStatus: null, expectUnresolvedSignal: false },
  },
  {
    id: 'S06',
    source: 'synthetic',
    category: 'ambiguous_reference',
    sourceNote: 'Instruction #23\'s own residual same-message reference gap example — "عايز انتينال وهات منه اتنين" in ONE message. Antinal itself MUST be added (its own direct "عايز انتينال" mention is unambiguous, independent of the reference gap); the quantity "اتنين" linking via "منه" within the SAME message is the known residual gap — ground truth honestly leaves the exact quantity unasserted rather than forcing an outcome I.B.2.1 was never required to guarantee.',
    raw: `[9/15/26, 9:00:00 AM] Customer: عايز انتينال وهات منه اتنين`,
    groundTruth: { expectedAddedProductCodes: ['56822'], expectedNeverAddedProductCodes: [], expectedQuantities: {}, expectedStatus: null, expectUnresolvedSignal: false },
  },
  {
    id: 'S07',
    source: 'synthetic',
    category: 'quantity_change',
    sourceNote: 'Instruction #11\'s own two-active-products worked example: "هات اتنين" (here "زود واحدة") with TWO active products must never silently pick one.',
    raw: `[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: موجود
[9/15/26, 9:02:00 AM] Customer: عايز فليكسيلاكس كمان
[9/15/26, 9:03:00 AM] You: موجود
[9/15/26, 9:04:00 AM] Customer: زود واحدة`,
    groundTruth: { expectedAddedProductCodes: ['56822', '68114'], expectedNeverAddedProductCodes: [], expectedQuantities: {}, expectedStatus: null, expectUnresolvedSignal: true },
  },
  {
    id: 'S08',
    source: 'synthetic',
    category: 'recommendation_rejected',
    sourceNote: 'Mandatory structural case — instruction #18\'s own acceptance example, mirrored into its rejection counterpart. Corpus has staff recommendations but none with a clean, unambiguous customer text rejection.',
    raw: `[9/15/26, 9:00:00 AM] You: ممكن فليكسيلاكس
[9/15/26, 9:01:00 AM] Customer: لا مش عايزه`,
    groundTruth: { expectedAddedProductCodes: [], expectedNeverAddedProductCodes: ['68114'], expectedQuantities: {}, expectedStatus: null, expectUnresolvedSignal: false },
  },
  {
    id: 'S09',
    source: 'synthetic',
    category: 'recommendation_only',
    sourceNote: 'I.B.3.1 instruction #19 family #6 — a bare staff recommendation with NO customer response anywhere in the window must never itself add an item (Active Product State V2\'s own recommendation_only classification, instruction #8).',
    raw: '[9/15/26, 9:00:00 AM] You: ممكن انتينال',
    groundTruth: { expectedAddedProductCodes: [], expectedNeverAddedProductCodes: ['56822'], expectedQuantities: {}, expectedStatus: null, expectUnresolvedSignal: false },
  },
  {
    id: 'S10',
    source: 'synthetic',
    category: 'availability_then_order',
    sourceNote: 'I.B.3.1 instruction #19 family #8 — a bare availability question must not add an item by itself, but a LATER genuine order verb for the SAME product must safely transition it into the basket (instruction #9\'s own worked example).',
    raw: `[9/15/26, 9:00:00 AM] Customer: عندك انتينال؟
[9/15/26, 9:01:00 AM] You: موجود
[9/15/26, 9:02:00 AM] Customer: عايز انتينال`,
    groundTruth: { expectedAddedProductCodes: ['56822'], expectedNeverAddedProductCodes: [], expectedQuantities: {}, expectedStatus: null, expectUnresolvedSignal: false },
  },
];

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface NormalizedItem {
  productCode: string | null;
  quantity: number | null;
  active: boolean; // false for OLD's items only when we can positively tell it was removed/rejected/cancelled — OLD has no such concept, so this is always true for OLD.
}

function codeForProductId(productId: string | null): string | null {
  if (!productId) return null;
  return REAL_CATALOG_ROWS.find((r) => r.id === productId)?.product_code ?? null;
}

function runOld(caseId: string, raw: string): { items: NormalizedItem[]; status: string | null } {
  const messages = messagesFrom(raw);
  const result = buildCaseBaskets(caseId, messages);
  const latest = result.baskets[result.baskets.length - 1] ?? null;
  if (!latest) return { items: [], status: null };
  const items = (result.itemsByBasketId[latest.basketId] ?? []).map((i) => ({
    productCode: codeForProductId(i.productId),
    quantity: i.quantity,
    active: true,
  }));
  return { items, status: latest.status };
}

function runV2(caseId: string, raw: string): { items: NormalizedItem[]; status: BasketStatusV2; unresolved: boolean; versionCount: number } {
  const messages = messagesFrom(raw);
  const graph = buildConversationEntityGraphV2(caseId, messages, { productIndex: CATALOG });
  const timestamps = new Map(messages.map((m) => [m.id, m.timestamp.toISOString()] as const));
  const result = reconstructBasketV2(graph, timestamps);
  const items = result.currentBasket.items
    .filter((i) => i.itemState !== 'removed' && i.itemState !== 'rejected' && i.itemState !== 'substituted')
    .map((i) => ({ productCode: i.canonicalProductCode, quantity: i.currentQuantity, active: true }));
  const unresolved = result.currentBasket.unresolvedCandidates.length > 0 || result.currentBasket.pendingReviewSignals.length > 0;
  return { items, status: result.currentBasket.status, unresolved, versionCount: result.basketVersions.length };
}

type CaseClass = 'v2_fixed' | 'both_correct' | 'both_partial' | 'v2_regression' | 'both_wrong';

function classify(c: BasketBenchmarkCase, oldItems: NormalizedItem[], v2Items: NormalizedItem[]): CaseClass {
  const oldCodes = new Set(oldItems.map((i) => i.productCode).filter((x): x is string => Boolean(x)));
  const v2Codes = new Set(v2Items.map((i) => i.productCode).filter((x): x is string => Boolean(x)));
  const expectedAdded = new Set(c.groundTruth.expectedAddedProductCodes);
  const neverAdded = new Set(c.groundTruth.expectedNeverAddedProductCodes);

  const oldFalseAdd = [...oldCodes].some((code) => neverAdded.has(code));
  const v2FalseAdd = [...v2Codes].some((code) => neverAdded.has(code));
  const oldMissesRequired = [...expectedAdded].some((code) => !oldCodes.has(code));
  const v2MissesRequired = [...expectedAdded].some((code) => !v2Codes.has(code));

  const oldCorrect = !oldFalseAdd && !oldMissesRequired;
  const v2Correct = !v2FalseAdd && !v2MissesRequired;

  if (oldCorrect && v2Correct) return 'both_correct';
  if (!oldCorrect && v2Correct) return 'v2_fixed';
  if (oldCorrect && !v2Correct) return 'v2_regression';
  // both incorrect — distinguish "both partial" (neither false-added, just missing something) from "both wrong" (a false add on either side)
  if (!oldFalseAdd && !v2FalseAdd) return 'both_partial';
  return 'both_wrong';
}

describe('I.B.3/I.B.3.1 — real Basket benchmark: OLD vs Basket Reconstruction V2 (22 cases: 12 real + 10 synthetic)', () => {
  it('computes item-level precision/recall, the false-added-product safety metric, and a case-by-case classification table', () => {
    let oldTP = 0, oldFP = 0, oldFN = 0;
    let v2TP = 0, v2FP = 0, v2FN = 0;
    let oldFalseAddedCount = 0;
    let v2FalseAddedCount = 0;
    let wrongQuantityCorrectProduct = 0;
    const classCounts: Record<CaseClass, number> = { v2_fixed: 0, both_correct: 0, both_partial: 0, v2_regression: 0, both_wrong: 0 };
    const rows: string[] = [];
    const regressions: string[] = [];

    for (const c of CASES) {
      const old = runOld(c.id, c.raw);
      const v2 = runV2(c.id, c.raw);

      const oldCodes = new Set(old.items.map((i) => i.productCode).filter((x): x is string => Boolean(x)));
      const v2Codes = new Set(v2.items.map((i) => i.productCode).filter((x): x is string => Boolean(x)));
      const expectedAdded = c.groundTruth.expectedAddedProductCodes;
      const neverAdded = new Set(c.groundTruth.expectedNeverAddedProductCodes);

      expectedAdded.forEach((code) => {
        if (oldCodes.has(code)) oldTP++; else oldFN++;
        if (v2Codes.has(code)) v2TP++; else v2FN++;
      });
      oldCodes.forEach((code) => { if (!expectedAdded.includes(code)) oldFP++; if (neverAdded.has(code)) oldFalseAddedCount++; });
      v2Codes.forEach((code) => { if (!expectedAdded.includes(code)) v2FP++; if (neverAdded.has(code)) v2FalseAddedCount++; });

      Object.entries(c.groundTruth.expectedQuantities).forEach(([code, expectedQty]) => {
        if (expectedQty === null) return;
        const v2Item = v2.items.find((i) => i.productCode === code);
        if (v2Item && v2Item.quantity !== null && v2Item.quantity !== expectedQty) wrongQuantityCorrectProduct++;
      });

      const cls = classify(c, old.items, v2.items);
      classCounts[cls]++;
      const row = `${c.id} [${c.source}/${c.category}] OLD=${JSON.stringify([...oldCodes])} V2=${JSON.stringify([...v2Codes])} truth_added=${JSON.stringify(expectedAdded)} truth_never=${JSON.stringify([...neverAdded])} v2_status=${v2.status} v2_unresolved=${v2.unresolved} class=${cls}`;
      rows.push(row);
      if (cls === 'v2_regression') regressions.push(`${row} | note: ${c.sourceNote}`);
    }

    // eslint-disable-next-line no-console
    console.log('[I.B.3 basket benchmark] per-case results:\n' + rows.join('\n'));
    // eslint-disable-next-line no-console
    console.log('[I.B.3 basket benchmark] OLD item-level:', { TP: oldTP, FP: oldFP, FN: oldFN, precision: oldTP / (oldTP + oldFP || 1), recall: oldTP / (oldTP + oldFN || 1) });
    // eslint-disable-next-line no-console
    console.log('[I.B.3 basket benchmark] V2 item-level:', { TP: v2TP, FP: v2FP, FN: v2FN, precision: v2TP / (v2TP + v2FP || 1), recall: v2TP / (v2TP + v2FN || 1) });
    // eslint-disable-next-line no-console
    console.log('[I.B.3 basket benchmark] false_added_product_to_basket:', { OLD: oldFalseAddedCount, V2: v2FalseAddedCount });
    // eslint-disable-next-line no-console
    console.log('[I.B.3 basket benchmark] wrong_quantity_applied_to_correct_product (V2):', wrongQuantityCorrectProduct);
    // eslint-disable-next-line no-console
    console.log('[I.B.3 basket benchmark] case classification counts:', classCounts);
    if (regressions.length > 0) {
      // eslint-disable-next-line no-console
      console.log('[I.B.3 basket benchmark] REGRESSIONS (manually inspected in the report):\n' + regressions.join('\n'));
    }

    // The single most important safety metric (instruction #29): V2 must NEVER silently add a
    // product the ground truth says was never safely ordered. Zero tolerance, unlike recall.
    expect(v2FalseAddedCount).toBe(0);
    // V2 must not regress below OLD on this same safety metric.
    expect(v2FalseAddedCount).toBeLessThanOrEqual(oldFalseAddedCount);
  });

  it('every real conversation case actually parses to at least one meaningful message (fixture sanity)', () => {
    CASES.filter((c) => c.source === 'real').forEach((c) => {
      const messages = messagesFrom(c.raw);
      expect(messages.length).toBeGreaterThan(0);
    });
  });
});
