export type CustomerIdentityInput = {
  customerId?: string | null;
  customerCode?: string | null;
  phone?: string | null;
  name?: string | null;
};

export type CustomerActivityState = {
  key: 'active' | 'care' | 'at_risk' | 'stopped' | 'unknown';
  label: string;
  daysSinceLastPurchase: number | null;
  isAtRisk: boolean;
  isStopped: boolean;
  isCertain: boolean;
};

const INVALID_TEXT_VALUES = new Set([
  '',
  '0',
  'null',
  'undefined',
  'غير محدد',
  'غير معروف',
  'عميل غير مسجل',
  'عميل الصيدلية',
]);

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
  'معلق',
  'pending',
  'open',
  'not_started',
  'in_progress',
  'attempted',
  'scheduled',
  'needs_manager',
  'postponed',
]);

function text(value: unknown) {
  return String(value ?? '').trim();
}

export function isMeaningfulText(value: unknown) {
  return !INVALID_TEXT_VALUES.has(text(value).toLowerCase());
}

export function normalizeEgyptianPhone(value: unknown) {
  let digits = text(value)
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/\D/g, '');

  if (digits.startsWith('0020')) digits = `0${digits.slice(4)}`;
  else if (digits.startsWith('20') && digits.length === 12) digits = `0${digits.slice(2)}`;
  else if (digits.length === 10 && /^1[0125]/.test(digits)) digits = `0${digits}`;

  return digits;
}

export function isValidEgyptianMobile(value: unknown) {
  return /^01[0125]\d{8}$/.test(normalizeEgyptianPhone(value));
}

export function normalizeCustomerName(value: unknown) {
  return text(value)
    .replace(/\++/g, ' ')
    .replace(/\(\s*p\s*\d+\s*\)/gi, ' ')
    .replace(/\(\s*\d+\s*%\s*\)/g, ' ')
    .replace(/\bش\s*\d+\b/gi, ' ')
    .replace(/[|*_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function cleanCustomerDisplayName(value: unknown) {
  const cleaned = normalizeCustomerName(value);
  return cleaned || 'عميل غير مسجل';
}

export function buildCustomerIdentity(input: CustomerIdentityInput) {
  const customerId = text(input.customerId);
  if (customerId) return `id:${customerId}`;

  const customerCode = text(input.customerCode).replace(/^code:/i, '').trim();
  if (isMeaningfulText(customerCode)) return `code:${customerCode}`;

  const phone = normalizeEgyptianPhone(input.phone);
  if (isValidEgyptianMobile(phone)) return `phone:${phone}`;

  const name = normalizeCustomerName(input.name);
  if (isMeaningfulText(name)) return `name:${name}`;

  return 'unknown';
}

export function isFinalFollowupResult(value: unknown) {
  const normalized = text(value);
  return FINAL_FOLLOWUP_RESULTS.has(normalized.toLowerCase()) || FINAL_FOLLOWUP_RESULTS.has(normalized);
}

export function isOpenFollowupResult(value: unknown) {
  const normalized = text(value);
  return !normalized || OPEN_FOLLOWUP_RESULTS.has(normalized.toLowerCase()) || OPEN_FOLLOWUP_RESULTS.has(normalized);
}

export function isCancelledFollowup(row: Record<string, unknown> | null | undefined) {
  if (!row) return false;
  return Boolean(row.cancelled_at) || /cancelled|تم إلغاء المتابعة/i.test(text(row.status || row.followup_status || row.followup_result));
}

export function isArchivedFollowup(row: Record<string, unknown> | null | undefined) {
  if (!row) return false;
  return Boolean(row.archived_at || row.hidden_at || row.is_hidden) || /archived|مؤرشف/i.test(text(row.status || row.followup_status));
}

export function isCompletedFollowup(row: Record<string, unknown> | null | undefined) {
  if (!row || isCancelledFollowup(row) || isArchivedFollowup(row)) return false;
  const result = row.followup_result || row.contact_result || row.followup_status || row.status;
  if (isOpenFollowupResult(result)) return false;
  return Boolean(row.completed_at || row.closed_at) || isFinalFollowupResult(result);
}

export function getCustomerActivityState(lastPurchase: unknown, now = new Date()): CustomerActivityState {
  if (!lastPurchase) {
    return { key: 'unknown', label: 'النشاط غير مؤكد', daysSinceLastPurchase: null, isAtRisk: false, isStopped: false, isCertain: false };
  }
  const date = new Date(String(lastPurchase));
  if (Number.isNaN(date.getTime())) {
    return { key: 'unknown', label: 'النشاط غير مؤكد', daysSinceLastPurchase: null, isAtRisk: false, isStopped: false, isCertain: false };
  }
  const days = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86_400_000));
  if (days <= 30) return { key: 'active', label: 'نشط', daysSinceLastPurchase: days, isAtRisk: false, isStopped: false, isCertain: true };
  if (days <= 45) return { key: 'care', label: 'يحتاج اهتمام', daysSinceLastPurchase: days, isAtRisk: false, isStopped: false, isCertain: true };
  if (days <= 90) return { key: 'at_risk', label: 'مهدد بالتوقف', daysSinceLastPurchase: days, isAtRisk: true, isStopped: false, isCertain: true };
  return { key: 'stopped', label: 'متوقف', daysSinceLastPurchase: days, isAtRisk: true, isStopped: true, isCertain: true };
}

export function resolveRequestedBy(row: Record<string, unknown> | null | undefined) {
  if (!row) return 'غير محدد';
  const direct = [
    row.created_by_name,
    row.requested_by_name,
    row.assigned_doctor,
    row.responsible_name,
  ].map(text).find(isMeaningfulText);
  if (direct) return direct;

  const source = [row.request_details, row.followup_reason, row.notes].map(text).join(' | ');
  const patterns = [
    /طلب\s*من\s*:\s*([^|\n]+)/i,
    /طلب\s*(?:د\/|دكتور|الدكتور)\s*([^|\n]+)/i,
    /requested\s*by\s*:\s*([^|\n]+)/i,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return 'غير محدد';
}
