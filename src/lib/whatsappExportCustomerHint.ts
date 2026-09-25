export interface WhatsAppExportCustomerHint {
  nameHint: string | null;
  codeHint: string | null;
  source: 'file_name' | 'none';
}

function toLatinDigits(value: string) {
  const arabic = '٠١٢٣٤٥٦٧٨٩';
  const eastern = '۰۱۲۳۴۵۶۷۸۹';
  return value.replace(/[٠-٩۰-۹]/g, (char) => {
    const a = arabic.indexOf(char);
    if (a >= 0) return String(a);
    const e = eastern.indexOf(char);
    return e >= 0 ? String(e) : char;
  });
}

export function extractCustomerHintFromExportFileName(fileName: string): WhatsAppExportCustomerHint {
  let value = String(fileName || '')
    .replace(/\.(zip|txt|md)$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!value) return { nameHint: null, codeHint: null, source: 'none' };

  value = value
    .replace(/^(whatsapp\s+chat\s+with|whatsapp\s+chat|chat\s+with)\s+/i, '')
    .replace(/^(محادث[هة]\s+واتساب\s+مع|واتساب\s+مع)\s+/i, '')
    .trim();

  // Windows/browser downloads often append copy suffixes such as "(1)" or "(5)".
  // Strip only a final copy suffix before reading the pharmacy customer code.
  value = value.replace(/\s*\(\d{1,3}\)\s*$/, '').trim();

  const normalizedDigits = toLatinDigits(value);
  // Real Dawaa exports are not always separated cleanly: "محمد الكموني17777.zip" is valid.
  // Limit the customer-code tail to 2..8 digits so an 11-digit Egyptian phone is never
  // accidentally treated as a customer code.
  const codeMatch = normalizedDigits.match(/(\d{2,8})\s*$/);
  const codeHint = codeMatch?.[1] || null;

  if (codeMatch) {
    const rawTail = value.match(/([٠-٩۰-۹\d]{2,8})\s*$/);
    if (rawTail?.[0]) value = value.slice(0, Math.max(0, value.length - rawTail[0].length)).trim();
  }

  value = value
    .replace(/[-–—]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // أسماء الملفات التقنية/العامة لا تُستخدم كهوية عميل.
  if (!value || /^(export|chat|whatsapp|واتساب|محادثه|محادثة)$/i.test(value)) {
    return { nameHint: null, codeHint, source: codeHint ? 'file_name' : 'none' };
  }

  return {
    nameHint: value.slice(0, 120),
    codeHint,
    source: 'file_name',
  };
}
