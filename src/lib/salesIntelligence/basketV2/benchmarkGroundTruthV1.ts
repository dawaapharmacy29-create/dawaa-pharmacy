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
  { id: '42e2b052-2885-4cd3-804c-310860d51a89', name: 'bloomville 30 tab', product_code: '73046', normalized_name: 'bloomville 30 tab', category: null, price: '275', source: 'catalog_import' },
  { id: '265f1158-4c01-4a9e-af62-1ed5f764dca8', name: 'Solofresh eye drops', product_code: '66682', normalized_name: 'solofresh eye drops', category: null, price: '67', source: 'catalog_import' },
  { id: '1fc42fd9-d597-4965-8549-02f705672a81', name: 'HYFRESH DROPS', product_code: '28532', normalized_name: 'hyfresh drops', category: null, price: '75', source: 'catalog_import' },
  { id: '0d790180-87f6-4b4f-ad21-38003b7aaee9', name: 'DERMACTIVE SWEAT CONTROL REFRESHING ROLL ON 60ML', product_code: '77480', normalized_name: 'dermactive sweat control refreshing roll on 60ml', category: null, price: '170', source: 'catalog_import' },
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
    id: 'R14',
    source: 'real',
    category: 'direct_misspelled_single_item_order',
    sourceNote: 'Real Dawaa conversation 2524fc3e... — customer directly asks for "شريط فليكس ليكس تقريبا", staff confirms availability and says it will be sent immediately. Ground Truth maps this to the real Flexilax SKU (code 68114); the quantity is one strip semantically, but the current Quantity V2 policy does not globally promote implicit-one from all unit phrases, so exact quantity remains unlabeled here rather than forcing the engine.',
    raw: `[9/2/26, 9:00:39 AM] Customer: السلام عليكم
[9/2/26, 9:01:22 AM] Customer: محتاج شريط فليكس ليكس تقريبا
[9/2/26, 9:03:24 AM] You: وعليكم السلام ورحمه الله وبركاته
[9/2/26, 9:15:06 AM] Customer: موجود
[9/2/26, 9:15:47 AM] You: موةجود
[9/2/26, 9:15:54 AM] You: موجود
[9/2/26, 9:16:06 AM] You: هبعته لحضرتك حالا
[9/2/26, 9:16:12 AM] Customer: تمام
[9/2/26, 9:25:46 AM] You: تم الارسال`,
    groundTruth: {
      expectedAddedProductCodes: ['68114'],
      expectedNeverAddedProductCodes: [],
      expectedQuantities: { '68114': null },
      expectedStatus: null,
      expectUnresolvedSignal: false,
    },
  },
  {
    id: 'R15',
    source: 'real',
    category: 'staff_recommendation_then_customer_acceptance',
    sourceNote: 'Real Dawaa conversation 269d5c5d... — staff explicitly recommends Bloomville, customer says "ماشي تمام" then "هحتاج معاه" before another image-based item; later asks where the order is and delivery is in progress. Ground Truth safely asserts Bloomville only; the image item stays outside the canonical product set rather than being guessed.',
    raw: `[7/8/26, 8:22:36 AM] Customer: انهي فيتامين كويس جدا
[7/8/26, 8:24:54 AM] You: bloomville
[7/8/26, 8:26:42 AM] You: ده كويس جدا
[7/8/26, 8:27:19 AM] You: العلبه 275ج
[7/8/26, 8:30:12 AM] Customer: ماشي تمام
[7/8/26, 8:30:20 AM] Customer: هحتاج معاه
[7/8/26, 8:30:35 AM] Customer: <image omitted>
[7/8/26, 8:35:29 AM] You: تحت امر حضرتك
[7/8/26, 8:35:45 AM] You: حضرتك تؤمرني بحاجه تانيه
[7/8/26, 9:28:16 AM] Customer: هتبعت الاوردر
[7/8/26, 9:28:25 AM] Customer: ولا ايه الدنيا
[7/8/26, 9:28:38 AM] Customer: لسه واصل اهو
[7/8/26, 9:29:34 AM] You: معلش يفندم بنعتذر لحضرتك ع التاخير`,
    groundTruth: {
      expectedAddedProductCodes: ['73046'],
      expectedNeverAddedProductCodes: [],
      expectedQuantities: { '73046': null },
      expectedStatus: null,
      expectUnresolvedSignal: true,
    },
  },
  {
    id: 'R16',
    source: 'real',
    category: 'hard_multi_item_direct_order_with_media_gap',
    sourceNote: 'Real Dawaa conversation e9e231ad... — customer explicitly orders Solo Fresh and Hyfresh drops, plus Sweetal/Qutabex context with image/voice details. Ground Truth asserts only the two text-explicit catalog SKUs and requires unresolved/review for the media-dependent remainder; nothing else is guessed.',
    raw: `[9/14/26, 5:21:40 PM] Customer: لو سمحت عاوزة قطرة سولو فريش
[9/14/26, 5:21:44 PM] Customer: وقطرة هاى فريش
[9/14/26, 5:21:51 PM] Customer: وعلبة سويتال شبه دى
[9/14/26, 5:22:01 PM] Customer: <image omitted>
[9/14/26, 5:22:10 PM] Customer: وشريط كيوتابكس
[9/14/26, 5:22:21 PM] You: تركيز ايه ي فندم؟
[9/14/26, 5:23:38 PM] Customer: <voice message omitted>
[9/14/26, 5:23:56 PM] Customer: 25
[9/14/26, 5:29:52 PM] You: تمام عنيا
[9/14/26, 5:30:23 PM] Customer: تمام ياريت بس تبعت الاوردر بسرعة
[9/14/26, 5:30:40 PM] You: حالا ي فندم
[9/14/26, 5:31:27 PM] You: جاري الارسال`,
    groundTruth: {
      expectedAddedProductCodes: ['66682', '28532'],
      expectedNeverAddedProductCodes: [],
      expectedQuantities: { '66682': null, '28532': null },
      expectedStatus: null,
      expectUnresolvedSignal: true,
    },
  },
  {
    id: 'R17',
    source: 'real',
    category: 'recommendation_price_acceptance_direct_order',
    sourceNote: 'Real Dawaa conversation f09471e8... — staff recommends Derma Active, states price 170, customer says "ماشي تمام" then explicitly "ابعته", and staff confirms fulfillment. The 170 EGP catalog row uniquely supports DERMACTIVE SWEAT CONTROL REFRESHING ROLL ON 60ML (code 77480); no image-only SKU is invented.',
    raw: `[9/12/26, 9:04:35 AM] You: فكرني حضرتك اخر مرة كنت واخد ايه
[9/12/26, 9:07:01 AM] You: اقولك على ال انا بستخدمه حاليا وجميل جدا
[9/12/26, 9:07:06 AM] You: ديرما اكتيف
[9/12/26, 9:07:49 AM] You: <image omitted>
[9/12/26, 9:07:51 AM] Customer: سعره كام
[9/12/26, 9:08:04 AM] Customer: ماشي تمام
[9/12/26, 9:08:07 AM] You: ب170ج
[9/12/26, 9:08:25 AM] Customer: ابعته
[9/12/26, 9:08:46 AM] You: عنيا حاضر
[9/12/26, 9:16:17 AM] You: تم الارسال`,
    groundTruth: {
      expectedAddedProductCodes: ['77480'],
      expectedNeverAddedProductCodes: [],
      expectedQuantities: { '77480': null },
      expectedStatus: null,
      expectUnresolvedSignal: false,
    },
  },
  {
    id: 'R18',
    source: 'real',
    category: 'direct_misspelled_product_with_explicit_strip_order',
    sourceNote: 'Real Dawaa conversation bf93b5f0... — customer explicitly asks for "شريط فليكس لايكس", later staff asks whether to send it now, customer accepts, and final clarification sends the injection plus that strip. Ground Truth safely asserts Flexilax SKU 68114; other recommended products are not added because the customer explicitly declines adding them at that moment.',
    raw: `[7/15/26, 12:49:53 PM] Customer: محتاج شريط فليكس لايكس
[7/15/26, 12:50:14 PM] Customer: هو ايه فايده فيتامين سي
[7/15/26, 1:01:12 PM] You: ابعت لحضرتك الشريط دلوقت ؟
[7/15/26, 1:02:02 PM] Customer: ماشي تمام
[7/15/26, 1:03:48 PM] You: ولو زودنا مالتي فيتامين زي السنتريم هيكون كويس جدا
[7/15/26, 1:37:32 PM] You: ابعت لحضرتك الاوردر دلوقت ؟
[7/15/26, 1:39:35 PM] Customer: ماشي تمام
[7/15/26, 1:40:21 PM] Customer: هبقا ابعتهم تحويل وابعتهولي
[7/15/26, 1:43:19 PM] You: تمام ازود مع الاوردر
[7/15/26, 1:44:19 PM] Customer: لا لما ابعت حسابه
[7/15/26, 1:45:13 PM] You: يعني ابعت الحقنه والشريط فقط دلوفت ؟
[7/15/26, 1:45:21 PM] Customer: اه تمام
[7/15/26, 1:45:38 PM] You: تم الارسال`,
    groundTruth: {
      expectedAddedProductCodes: ['68114'],
      expectedNeverAddedProductCodes: [],
      expectedQuantities: { '68114': null },
      expectedStatus: null,
      expectUnresolvedSignal: true,
    },
  },
  {
    id: 'R19',
    source: 'real',
    category: 'hard_media_only_wrong_item_correction',
    sourceNote: 'Real Dawaa conversation fd505a4d... — customer says the received treatment is wrong and identifies both requested and received products only through images/voice ("ده الا محتاجه", "ده الا جالي", "محتاج نفس دي"). Text never reveals a canonical SKU. Ground Truth therefore requires review/unresolved and asserts NO product identity; guessing here would be a safety failure.',
    raw: `[7/31/26, 7:57:24 AM] Customer: كنت واخد علاج وطلع غلط
[7/31/26, 7:57:35 AM] Customer: <image omitted>
[7/31/26, 7:57:45 AM] Customer: <image omitted>
[7/31/26, 7:57:45 AM] Customer: ده الا محتاجه
[7/31/26, 7:59:55 AM] Customer: <image omitted>
[7/31/26, 7:59:58 AM] Customer: ده الا جالي
[7/31/26, 8:00:49 AM] You: مش هو نفس ال حضرتك طالبه
[7/31/26, 8:01:15 AM] Customer: <voice message omitted>
[7/31/26, 8:01:33 AM] Customer: محتاج نفس دي
[7/31/26, 8:08:37 AM] You: هو تقريبا يا فندم غيروا شكل العلبة
[7/31/26, 8:10:44 AM] Customer: <voice message omitted>
[7/31/26, 8:10:49 AM] Customer: دي
[7/31/26, 8:10:56 AM] Customer: نفس الا معايا`,
    groundTruth: {
      expectedAddedProductCodes: [],
      expectedNeverAddedProductCodes: [],
      expectedQuantities: {},
      expectedStatus: null,
      expectUnresolvedSignal: true,
    },
  },
  {
    id: 'R20',
    source: 'real',
    category: 'hard_media_only_exact_product_request',
    sourceNote: 'Real Dawaa conversation 44999fee... — customer repeatedly requests exactly the product shown in forwarded images ("محتاج نفس العلبه دي", "نفسي دي بظبط"), rejects an incorrect interpretation, and staff later sources it. Product identity is absent from text, so Ground Truth intentionally remains unresolved rather than inferring a SKU from context.',
    raw: `[8/19/26, 8:37:51 PM] Customer: <image omitted>
[8/19/26, 8:38:08 PM] Customer: محتاج نفس العلبه دي
[8/19/26, 8:38:30 PM] Customer: متاحه
[8/19/26, 8:39:10 PM] Customer: سعرها كام
[8/19/26, 8:39:47 PM] You: نفسها ي فندم
[8/19/26, 8:41:17 PM] Customer: مش دي
[8/19/26, 8:44:25 PM] Customer: <image omitted>
[8/19/26, 8:44:42 PM] Customer: نفسي دي بظبط
[8/19/26, 9:10:00 PM] You: بتاكد لحضرتك ي فندم
[8/19/26, 9:26:36 PM] You: وفرته لحضرتك ي فندم
[8/19/26, 9:27:06 PM] You: <image omitted>
[8/19/26, 9:29:46 PM] You: استاذن حضرتك الصبح ي فندم حضرتك تبعتلنا رسالة للتاكيد`,
    groundTruth: {
      expectedAddedProductCodes: [],
      expectedNeverAddedProductCodes: [],
      expectedQuantities: {},
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
