export type CustomerIdentityInput = {
  customerId?: string | number | null;
  customerCode?: string | number | null;
  phone?: string | number | null;
  name?: string | null;
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

export function customerIdentityText(value: unknown) {
  return String(value ?? '').trim();
}

export function isMeaningfulCustomerIdentityText(value: unknown) {
  return !INVALID_TEXT_VALUES.has(customerIdentityText(value).toLowerCase());
}

export function normalizeCustomerCode(value: unknown) {
  const raw = customerIdentityText(value).replace(/^code:/i, '').trim();
  return isMeaningfulCustomerIdentityText(raw) ? raw : '';
}

export function normalizeEgyptianCustomerPhone(value: unknown) {
  let digits = customerIdentityText(value)
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/\D/g, '');

  if (digits.startsWith('0020')) digits = `0${digits.slice(4)}`;
  else if (digits.startsWith('20') && digits.length === 12) digits = `0${digits.slice(2)}`;
  else if (digits.length === 10 && /^1[0125]\d{8}$/.test(digits)) digits = `0${digits}`;

  return digits;
}

export function customerPhoneTail(value: unknown) {
  const digits = normalizeEgyptianCustomerPhone(value);
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

export function isValidEgyptianCustomerMobile(value: unknown) {
  return /^01[0125]\d{8}$/.test(normalizeEgyptianCustomerPhone(value));
}

export function normalizeCustomerIdentityName(value: unknown) {
  return customerIdentityText(value)
    .replace(/\++/g, ' ')
    .replace(/\(\s*p\s*\d+\s*\)/gi, ' ')
    .replace(/\(\s*\d+\s*%\s*\)/g, ' ')
    .replace(/\bش\s*\d+\b/gi, ' ')
    .replace(/[|*_]+/g, ' ')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function sanitizeCustomerIdentityNameForIlike(value: unknown) {
  return customerIdentityText(value)
    .replace(/[%_,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isCustomerIdentityUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    customerIdentityText(value)
  );
}

export function buildCustomerIdentity(input: CustomerIdentityInput) {
  const customerId = customerIdentityText(input.customerId);
  if (customerId) return `id:${customerId}`;

  const customerCode = normalizeCustomerCode(input.customerCode);
  if (customerCode) return `code:${customerCode}`;

  const phone = normalizeEgyptianCustomerPhone(input.phone);
  if (isValidEgyptianCustomerMobile(phone)) return `phone:${phone}`;

  const name = normalizeCustomerIdentityName(input.name);
  if (isMeaningfulCustomerIdentityText(name)) return `name:${name}`;

  return 'unknown';
}
