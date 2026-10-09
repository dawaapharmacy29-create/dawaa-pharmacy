// Contract A: one open follow-up per customer + branch. The database commands link a new request to
// the open case; these are the only conflicts they can still report. Users never see a raw
// unique-violation message.
type RpcErrorLike = { code?: string | null; message?: string | null } | null | undefined;

export const FOLLOWUP_OPEN_CASE_EXISTS_MESSAGE =
  'يوجد متابعة مفتوحة لهذا العميل في نفس الفرع. افتح المتابعة الحالية بدلًا من إنشاء متابعة جديدة.';

export function followupWriteErrorMessage(error: RpcErrorLike, fallback = 'تعذر حفظ المتابعة') {
  const message = String(error?.message || '').trim();
  if (message.includes('followup_open_case_conflict')) {
    return 'يوجد متابعة مفتوحة لهذا العميل في نفس الفرع لكنها مخفية أو مدمجة. راجع المتابعة الحالية أولًا.';
  }
  if (message.includes('followup_client_request_scope_conflict')) {
    return 'رقم الطلب نفسه استُخدم من قبل لبيانات مختلفة. أعد فتح النموذج وحاول مرة أخرى.';
  }
  if (error?.code === '23505' || /duplicate key value|unique constraint/i.test(message)) {
    return FOLLOWUP_OPEN_CASE_EXISTS_MESSAGE;
  }
  return message || fallback;
}
