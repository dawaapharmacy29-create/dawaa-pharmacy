import { monthCycleFromDate } from '@/lib/conversationReviews';

/**
 * دورة الحافز الشهري في دواء هي 26 → 25 (مش الشهر الميلادي العادي). أي كود
 * بيحسب فترة تقييم أو نقاط لازم يستخدم الدوال دي بدل ما يبني تاريخ بنفسه،
 * عشان منقعش في نفس الباگ اللي كان موجود قبل كده: اختيار شهر ميلادي عادي
 * بينفصل عن دورة النقاط الحقيقية بالظبط في يوم 26-30 (وقت التقييم فعليًا).
 */

export type EvaluationCycleRange = {
  /** تسمية الدورة بنفس فورمات monthCycleFromDate، مثال: '2026-09' */
  label: string;
  /** أول يوم في الدورة (26 من الشهر السابق) */
  start: Date;
  /** آخر يوم في الدورة (25 من شهر التسمية)، نهاية اليوم */
  end: Date;
  /** تاريخ اليوم التالي لنهاية الدورة، للاستخدام في استعلامات lt() */
  endExclusive: Date;
  /** نص عربي واضح للفترة، مثال: '26 أغسطس – 25 سبتمبر 2026' */
  displayLabel: string;
};

function toIsoDate(date: Date) {
  // Keep the pharmacy cycle in local calendar dates. Using toISOString() here
  // shifts Cairo midnight back to the previous UTC day and silently turns the
  // 26 → 25 cycle into 25 → 24 for date-only database filters.
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function currentEvaluationCycleLabel(referenceDate: Date = new Date()) {
  return monthCycleFromDate(referenceDate);
}

export function previousEvaluationCycleLabel(label: string) {
  const [year, month] = label.split('-').map(Number);
  const prev = new Date(year, month - 2, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
}

export function evaluationCycleRangeFromLabel(label: string): EvaluationCycleRange {
  const [year, month] = label.split('-').map(Number); // month: 1-indexed, matches monthCycleFromDate output
  const start = new Date(year, month - 2, 26);
  const end = new Date(year, month - 1, 25, 23, 59, 59, 999);
  const endExclusive = new Date(year, month - 1, 26);
  const displayLabel = `${start.toLocaleDateString('ar-EG', { day: 'numeric', month: 'long' })} – ${end.toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' })}`;
  return { label, start, end, endExclusive, displayLabel };
}

export function evaluationCycleDateKeys(label: string) {
  const range = evaluationCycleRangeFromLabel(label);
  return {
    startDate: toIsoDate(range.start),
    endDate: toIsoDate(range.end),
    endDateExclusive: toIsoDate(range.endExclusive),
  };
}

export function evaluationCycleQueryBounds(label: string) {
  const { startDate, endDateExclusive } = evaluationCycleDateKeys(label);
  return { startDate, endDateExclusive };
}

export function isEvaluationCycleClosed(label: string, referenceDate: Date = new Date()) {
  return referenceDate.getTime() > evaluationCycleRangeFromLabel(label).end.getTime();
}

export function latestClosedEvaluationCycleLabel(referenceDate: Date = new Date()) {
  return previousEvaluationCycleLabel(currentEvaluationCycleLabel(referenceDate));
}
