// Phase I.B.4 — canonical Ground Truth V1 for Historical Commercial Closure calibration.
//
// Labels are independent of engine output. Real/synthetic provenance stays explicit.
// Any label change requires reviewed source change; do not silently rewrite labels from predictions.
import type { ClosureGroundTruthCaseV2 } from './closureBenchmarkV2';

/** Closure Ground Truth is versioned independently from Basket Ground Truth. */
export const CLOSURE_GROUND_TRUTH_VERSION_V1 = 'dawaa-closure-ground-truth-v1.1';

export const CLOSURE_GROUND_TRUTH_CASES_V1: ClosureGroundTruthCaseV2[] = [
  {
    id: 'C01-real-advisory-politeness',
    source: 'real',
    sourceNote: 'Real Dawaa conversation 6472fb41...: staff says "من عنيا" while still reviewing/recommending; no accepted product/order is visible in text.',
    raw: `[5/9/26, 11:27:38 PM] Customer: انا كنت واخد نوع شيكولاته للجنس
[5/9/26, 11:28:21 PM] Customer: فأفضل حاجه ايه تظبط الرغبه
[5/9/26, 11:31:49 PM] You: من عنيا لحضرتك طبعا
[5/9/26, 11:32:04 PM] You: هراجع افضل نوع عندنا والبلغك بيه والسعر كمان`,
    expectedLevel: 'not_closed',
  },
  {
    id: 'C02-real-accepted-fulfillment',
    source: 'real',
    sourceNote: 'Real Dawaa conversation 9a59338b...: named product, explicit "اه ابعته", then staff fulfillment intent and delivery follow-up.',
    raw: `[9/15/26, 9:30:55 PM] Customer: Isis teenderm gel for sensitive skin
[9/15/26, 9:31:16 PM] Customer: موجود عندكم الغسول ده
[9/15/26, 9:32:09 PM] You: موجود باذن الله يافندم
[9/15/26, 9:35:06 PM] You: تحب نبعته لحضرتك باذن الله ؟
[9/15/26, 9:42:30 PM] Customer: اه ابعته
[9/15/26, 9:42:57 PM] You: من عنيا لحضرتك مسافه الطريق ويكون عند حضرتك
[9/15/26, 10:28:58 PM] You: اه يا فندم المندوب في الطريق لحضرتك`,
    expectedLevel: 'strongly_inferred',
  },
  {
    id: 'C03-real-price-only',
    source: 'real',
    sourceNote: 'Real Dawaa price/recommendation-only pattern with no customer acceptance.',
    raw: `[6/21/26, 2:55:16 PM] Customer: طب تنضيف البشره ده ترشحيلي ايه
[6/21/26, 2:56:45 PM] You: غسول فيتشي ممتاز يا فندم
[6/21/26, 2:57:00 PM] Customer: سعره كام
[6/21/26, 2:57:59 PM] You: 400 مللي ب 1200 جنيه`,
    expectedLevel: 'not_closed',
  },
  {
    id: 'C06-real-dermactive-direct-order',
    source: 'real',
    sourceNote: 'Real Dawaa conversation f09471e8...: staff recommends Derma Active, customer explicitly says "ابعته", staff acknowledges and later says "تم الارسال".',
    raw: `[9/12/26, 9:07:06 AM] You: ديرما اكتيف
[9/12/26, 9:07:51 AM] Customer: سعره كام
[9/12/26, 9:08:04 AM] Customer: ماشي تمام
[9/12/26, 9:08:07 AM] You: ب170ج
[9/12/26, 9:08:25 AM] Customer: ابعته
[9/12/26, 9:08:46 AM] You: عنيا حاضر
[9/12/26, 9:16:17 AM] You: تم الارسال`,
    expectedLevel: 'strongly_inferred',
  },
  {
    id: 'C07-real-flexilax-order',
    source: 'real',
    sourceNote: 'Real Dawaa conversation bf93b5f0...: customer asks for a Flexilax strip, later explicitly confirms the injection+strip should be sent, and staff says "تم الارسال".',
    raw: `[7/15/26, 12:49:53 PM] Customer: محتاج شريط فليكس لايكس
[7/15/26, 1:01:12 PM] You: ابعت لحضرتك الشريط دلوقت ؟
[7/15/26, 1:02:02 PM] Customer: ماشي تمام
[7/15/26, 1:45:13 PM] You: يعني ابعت الحقنه والشريط فقط دلوفت ؟
[7/15/26, 1:45:21 PM] Customer: اه تمام
[7/15/26, 1:45:38 PM] You: تم الارسال`,
    expectedLevel: 'strongly_inferred',
  },
  {
    id: 'C08-real-media-product-explicit-acceptance',
    source: 'real',
    sourceNote: 'Real Dawaa conversation 619b9056...: product identity is image-mediated, but commercial acceptance itself is explicit ("حضرتك تحب ابعته ؟" → "ياااااريت" → "عنيا حاضر"). Closure can be strong even while SKU identity stays unresolved.',
    raw: `[8/1/26, 11:07:03 AM] You: <image omitted>
[8/1/26, 11:07:26 AM] You: ده الشكل اللي حضرتك طلبته
[8/1/26, 11:09:22 AM] You: حضرتك تحب ابعته ؟
[8/1/26, 11:09:33 AM] Customer: ياااااريت
[8/1/26, 11:09:40 AM] Customer: بكام
[8/1/26, 11:09:46 AM] You: عنيا حاضر ان شاء الله حالا
[8/1/26, 11:10:03 AM] You: ب 400
[8/1/26, 11:10:12 AM] Customer: تمام`,
    expectedLevel: 'strongly_inferred',
  },
  {
    id: 'C09-real-multi-item-paid-order',
    source: 'real',
    sourceNote: 'Real Dawaa conversation 167b0383...: three named items, explicit total, customer requests transfer number, staff gives it and confirms dispatch. This is a high-evidence organic closure.',
    raw: `[7/11/26, 12:12:26 PM] Customer: سنترم ومان و فوليك أسيد و نيروفيت حبوب
[7/11/26, 12:34:59 PM] Customer: كده الحساب كام
[7/11/26, 12:35:45 PM] You: اه حضرتك السنترم ال 100 قرص
[7/11/26, 12:36:01 PM] You: 936
[7/11/26, 12:36:05 PM] You: والتوصيل 10
[7/11/26, 12:36:11 PM] Customer: تمام
[7/11/26, 12:36:23 PM] Customer: رقم تحويل
[7/11/26, 12:36:40 PM] You: 01028308235
[7/11/26, 12:40:02 PM] You: جاري الارسال نتشرف ب خدمة حضرتك
[7/11/26, 12:40:15 PM] You: تم الارسال نتشرف ب خدمة حضرتك`,
    expectedLevel: 'strongly_inferred',
  },
  {
    id: 'C04-synthetic-pure-thanks',
    source: 'synthetic',
    sourceNote: 'Structural negative: no purchase intent at all.',
    raw: `[9/15/26, 9:00:00 AM] Customer: شكرا
[9/15/26, 9:01:00 AM] You: تحت أمرك دائما`,
    expectedLevel: 'unknown',
  },
  {
    id: 'C05-synthetic-clean-organic-order',
    source: 'synthetic',
    sourceNote: 'Structural positive using a real catalog SKU and ordinary Dawaa organic closing language.',
    raw: `[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: موجود
[9/15/26, 9:02:00 AM] Customer: تمام ابعته
[9/15/26, 9:03:00 AM] You: جاري الارسال`,
    expectedLevel: 'strongly_inferred',
  },
];
