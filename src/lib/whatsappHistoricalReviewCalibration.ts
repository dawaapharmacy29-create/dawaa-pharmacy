export interface HistoricalReviewCriterionUsage {
  key: string;
  label: string;
  timesApplied: number;
  timesBelowFull: number;
  averagePercent: number | null;
}

// Snapshot from conversation_sales_reviews on 2026-09-17. This is calibration data only;
// it never creates or changes a score by itself.
export const HISTORICAL_REVIEW_USAGE_2026_09_17: HistoricalReviewCriterionUsage[] = [
  { key: 'first_response_speed', label: 'سرعة أول رد', timesApplied: 1442, timesBelowFull: 48, averagePercent: 97.6 },
  { key: 'greeting', label: 'رسالة الترحيب الرسمية', timesApplied: 1442, timesBelowFull: 28, averagePercent: 98.4 },
  { key: 'doctor_name', label: 'ذكر اسم الدكتور', timesApplied: 1441, timesBelowFull: 25, averagePercent: 98.3 },
  { key: 'closing_message', label: 'رسالة الختام', timesApplied: 1437, timesBelowFull: 222, averagePercent: 87.1 },
  { key: 'tone', label: 'احترام العميل وجودة الأسلوب', timesApplied: 1436, timesBelowFull: 73, averagePercent: 98.1 },
  { key: 'understanding', label: 'فهم طلب العميل', timesApplied: 1304, timesBelowFull: 28, averagePercent: 98.9 },
  { key: 'sales_closing', label: 'جودة عملية البيع وإغلاق الطلب', timesApplied: 1124, timesBelowFull: 18, averagePercent: 98.7 },
  { key: 'order_confirmation', label: 'تأكيد بيانات الطلب', timesApplied: 384, timesBelowFull: 3, averagePercent: 99.3 },
  { key: 'consultation_quality', label: 'جودة الاستشارة', timesApplied: 163, timesBelowFull: 17, averagePercent: 95.1 },
  { key: 'followup_after_wait', label: 'المتابعة بعد كلمة لحظات أو هراجع', timesApplied: 137, timesBelowFull: 71, averagePercent: 59.0 },
  { key: 'unavailable_items', label: 'النواقص وترشيح البدائل', timesApplied: 121, timesBelowFull: 26, averagePercent: 87.1 },
  { key: 'customer_request_registration', label: 'تسجيل طلبات واحتياجات العميل', timesApplied: 71, timesBelowFull: 35, averagePercent: 50.7 },
  { key: 'dosage_explanation', label: 'توضيح الجرعة وطريقة الاستخدام', timesApplied: 69, timesBelowFull: 3, averagePercent: 96.4 },
  { key: 'cross_sell_upsell', label: 'Cross-selling / Upselling', timesApplied: 53, timesBelowFull: 10, averagePercent: 89.6 },
  { key: 'order_delay_handling', label: 'متابعة تأخير الأوردر', timesApplied: 37, timesBelowFull: 2, averagePercent: 96.4 },
  { key: 'angry_customer', label: 'التعامل مع العميل الغاضب أو الشكوى', timesApplied: 16, timesBelowFull: 6, averagePercent: 85.0 },
  { key: 'exceptional_followup_recognition', label: 'التعرف على فرصة متابعة استثنائية وتسجيلها', timesApplied: 2, timesBelowFull: 2, averagePercent: 0.0 },
];

export function rankSuggestedCriteriaByHistoricalUse(keys: string[]) {
  const index = new Map(HISTORICAL_REVIEW_USAGE_2026_09_17.map((item) => [item.key, item]));
  return Array.from(new Set(keys)).sort((a, b) => {
    const aa = index.get(a);
    const bb = index.get(b);
    if (!aa && !bb) return a.localeCompare(b);
    if (!aa) return 1;
    if (!bb) return -1;
    // First prioritize frequently-applied criteria, then criteria that historically expose more misses.
    const missA = aa.timesApplied ? aa.timesBelowFull / aa.timesApplied : 0;
    const missB = bb.timesApplied ? bb.timesBelowFull / bb.timesApplied : 0;
    return bb.timesApplied - aa.timesApplied || missB - missA;
  });
}
