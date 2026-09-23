// Phase I.B.4 — canonical Ground Truth dataset V1 for the Basket/Conversation Intelligence benchmark.
//
// IMPORTANT:
// - Labels were written from human reading of the conversation BEFORE engine output.
// - Engine output must never mutate this file at runtime.
// - Real vs synthetic provenance is preserved per case.
// - Update labels only via reviewed source change + dataset version bump in benchmarkV2.ts.
import type { RawProductRow } from '../pharmacyProducts/canonicalProduct';
import type { SalesIntelligenceGroundTruthCase } from './benchmarkV2';

export const REAL_CATALOG_ROWS_V1: RawProductRow[] = [
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

export const BASKET_GROUND_TRUTH_CASES_V1: SalesIntelligenceGroundTruthCase[] = [
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
    id: 'R13',
    source: 'real',
    category: 'misspelled_product_then_quantity_clarification',
    sourceNote: 'Real Dawaa conversation a58a9b7d... — customer types the misspelling "فليكس ليكس", later staff states "شريط فليكسيلاكس", and the customer explicitly settles on a strip. The same conversation contains media/another unknown cold product, so Ground Truth asserts only the safely visible Flexilax SKU and intentionally leaves the rest unresolved.',
    raw: `[4/25/26, 1:34:45 PM] Customer: في نوع برشام
[4/25/26, 1:34:50 PM] Customer: فليكس ليكس
[4/25/26, 1:34:57 PM] Customer: تقريبا
[4/25/26, 1:35:22 PM] Customer: هعوز شريط
[4/25/26, 1:35:23 PM] Customer: وموجود كيرلكس
[4/25/26, 1:35:53 PM] You: حضرتك تقصد كومتركس ؟
[4/25/26, 1:36:01 PM] Customer: لا
[4/25/26, 1:36:08 PM] Customer: هبعتلك صورته
[4/25/26, 1:40:24 PM] Customer: كليرست
[4/25/26, 1:41:53 PM] You: موجود يا فندم ان شاء الله
[4/25/26, 1:42:24 PM] You: شريط ولا علبة حضرتك
[4/25/26, 1:45:56 PM] Customer: هخد شريط
[4/25/26, 1:46:46 PM] You: شريط فليكسيلاكس وعلبة كليريست والجل
[4/25/26, 1:48:03 PM] Customer: كليريست شريط
[4/25/26, 1:48:26 PM] Customer: تمام
[4/25/26, 1:50:31 PM] You: تم الارسال`,
    groundTruth: {
      expectedAddedProductCodes: ['68114'],
      expectedNeverAddedProductCodes: [],
      expectedQuantities: { '68114': null },
      expectedStatus: null,
      expectUnresolvedSignal: true,
    },
  },
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
    sourceNote: 'Phase I.B.4 calibration case — "عايز انتينال وهات منه اتنين" in ONE message. Reference resolution uses raw-message offsets and Quantity Intelligence now consumes only the resulting SAFE same-message reference edge, so quantity 2 is part of Ground Truth.',
    raw: `[9/15/26, 9:00:00 AM] Customer: عايز انتينال وهات منه اتنين`,
    groundTruth: { expectedAddedProductCodes: ['56822'], expectedNeverAddedProductCodes: [], expectedQuantities: { '56822': 2 }, expectedStatus: null, expectUnresolvedSignal: false },
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
