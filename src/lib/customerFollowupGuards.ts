export const FINAL_FOLLOWUP_RESULTS = new Set([
  'تم الرد والعميل راضي',
  'تم الرد ولا يحتاج الآن',
  'تم الشراء بعد المتابعة',
  'تم حل الشكوى',
  'تم تنفيذ الطلب والتأكد من العميل',
  'تم إلغاء المتابعة',
  'completed',
  'closed',
  'cancelled',
  'archived',
]);

export const OPEN_FOLLOWUP_RESULTS = new Set([
  'معلق',
  'لم تبدأ',
  'جارٍ التواصل',
  'تمت محاولة',
  'موعد قادم',
  'تحتاج مديرًا',
  'تم الرد ويحتاج طلب',
  'تم الرد ويوجد شكوى',
  'طلب صنف',
  'طلب توصيل',
  'يحتاج متابعة مدير',
  'لم يرد',
  'طلب التواصل لاحقًا',
  'الرقم غير صحيح',
  'مؤجل',
  'pending',
  'open',
  'not_started',
  'in_progress',
  'attempted',
  'scheduled',
  'needs_manager',
]);

export function normalizeEgyptianPhone(value?: string | null) {
  let digits = String(value || '').replace(/\D+/g, '');
  if (digits.startsWith('0020')) digits = digits.slice(4);
  else if (digits.startsWith('20')) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith('1')) digits = `0${digits}`;
  return digits;
}

export function isValidEgyptianMobile(value?: string | null) {
  return /^(010|011|012|015)\d{8}$/.test(normalizeEgyptianPhone(value));
}

export function normalizeCustomerIdentityName(value?: string | null) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\++/g, ' ')
    .replace(/\(\s*p\s*\d+\s*\)/gi, ' ')
    .replace(/\(\s*\d+\s*%\s*\)/g, ' ')
    .replace(/\bش\s+\d+\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildCustomerIdentity(input: {
  customerId?: string | null;
  customerCode?: string | null;
  phone?: string | null;
  name?: string | null;
}) {
  const customerId = String(input.customerId || '').trim();
  if (customerId) return `id:${customerId}`;
  const customerCode = String(input.customerCode || '').trim();
  if (customerCode) return `code:${customerCode}`;
  const phone = normalizeEgyptianPhone(input.phone);
  if (isValidEgyptianMobile(phone)) return `phone:${phone}`;
  const name = normalizeCustomerIdentityName(input.name);
  return name ? `name:${name}` : '';
}

export function isFinalFollowupStatus(value?: string | null) {
  return FINAL_FOLLOWUP_RESULTS.has(String(value || '').trim());
}

export function isOpenFollowupStatus(value?: string | null) {
  const normalized = String(value || '').trim();
  return !normalized || OPEN_FOLLOWUP_RESULTS.has(normalized);
}

export function resolveRequestedBy(row: Record<string, unknown>) {
  const direct = [
    row.created_by_name,
    row.requested_by_name,
    row.assigned_doctor,
    row.responsible_name,
  ]
    .map((value) => String(value || '').trim())
    .find((value) => value && !['غير محدد', 'غير معروف'].includes(value));
  if (direct) return direct;
  const source = [row.followup_reason, row.request_details, row.notes].join(' ');
  const match = source.match(/(?:طلب\s*من\s*:|طلب\s*د\/?|requested\s*by\s*:?)\s*([^|\n]+)/i);
  return match?.[1]?.trim() || 'غير محدد';
}

export function getFollowupDataIssues(input: {
  customerId?: string | null;
  customerCode?: string | null;
  customerName?: string | null;
  phone?: string | null;
  branch?: string | null;
  requestedBy?: string | null;
  reason?: string | null;
  status?: string | null;
  result?: string | null;
  nextFollowupDate?: string | null;
  completedAt?: string | null;
}) {
  const issues: string[] = [];
  if (!String(input.customerId || '').trim()) issues.push('معرف العميل غير موجود');
  if (!String(input.customerCode || '').trim()) issues.push('كود العميل غير موجود');
  if (!String(input.customerName || '').trim()) issues.push('اسم العميل غير موجود');
  if (!String(input.phone || '').trim()) issues.push('رقم الهاتف غير موجود');
  else if (!isValidEgyptianMobile(input.phone)) issues.push('رقم الهاتف غير صالح');
  if (!String(input.branch || '').trim() || ['غير محدد', 'متعدد الفروع'].includes(String(input.branch)))
    issues.push('الفرع يحتاج مراجعة');
  if (!String(input.requestedBy || '').trim() || input.requestedBy === 'غير محدد')
    issues.push('مقدم الطلب غير محدد');
  if (!String(input.reason || '').trim() || String(input.reason).trim() === '0')
    issues.push('سبب المتابعة غير واضح');
  const completed = Boolean(input.completedAt) || isFinalFollowupStatus(input.status);
  const invalidPhoneResult = String(input.result || '').trim() === 'الرقم غير صحيح';
  if (!completed && !invalidPhoneResult && !String(input.nextFollowupDate || '').trim())
    issues.push('متابعة مفتوحة بدون موعد قادم');
  if (completed && !String(input.result || '').trim()) issues.push('متابعة مكتملة بدون نتيجة رسمية');
  return issues;
}
