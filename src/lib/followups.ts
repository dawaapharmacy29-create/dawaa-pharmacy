import type { CustomerClassKey, CustomerStatusKey } from '@/lib/customerMetrics';

export type CustomerReaction =
  | 'interested'
  | 'ordered'
  | 'no_answer'
  | 'call_later'
  | 'refused'
  | 'wrong_number'
  | 'complained'
  | 'satisfied'
  | 'manager_needed'
  | 'price_objection'
  | 'unavailable_item';

export function reactionScore(reaction: CustomerReaction) {
  if (reaction === 'ordered' || reaction === 'satisfied') return 5;
  if (reaction === 'interested' || reaction === 'call_later') return 4;
  if (reaction === 'no_answer') return 3;
  if (reaction === 'price_objection' || reaction === 'unavailable_item') return 2;
  return 1;
}

export function nextFollowupDays(
  reaction: CustomerReaction,
  customerClass?: CustomerClassKey | string,
  status?: CustomerStatusKey | string
) {
  if (reaction === 'ordered' || reaction === 'satisfied') return 7;
  if (reaction === 'interested') return customerClass === 'vip' ? 1 : 2;
  if (reaction === 'call_later') return 2;
  if (reaction === 'complained' || reaction === 'manager_needed') return 1;
  if (reaction === 'no_answer') return customerClass === 'vip' || status === 'stopped' ? 1 : 2;
  if (reaction === 'price_objection' || reaction === 'unavailable_item') return 3;
  if (reaction === 'wrong_number') return 0;
  if (reaction === 'refused') return 14;
  return 3;
}

export const FOLLOWUP_REACTIONS = [
  { value: 'interested', label: 'مهتم' },
  { value: 'ordered', label: 'طلب أوردر' },
  { value: 'no_answer', label: 'لم يرد' },
  { value: 'call_later', label: 'طلب التواصل لاحقًا' },
  { value: 'refused', label: 'رفض' },
  { value: 'wrong_number', label: 'رقم غير صحيح' },
  { value: 'complained', label: 'اشتكى من مشكلة' },
  { value: 'satisfied', label: 'راضٍ جدًا' },
  { value: 'manager_needed', label: 'يحتاج تدخل مدير' },
  { value: 'price_objection', label: 'اعتراض على السعر' },
  { value: 'unavailable_item', label: 'الصنف غير متوفر' },
] as const;
