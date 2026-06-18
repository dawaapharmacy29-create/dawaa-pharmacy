const DIGIT_MAP: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
};

export function toEnglishDigits(value: string) {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => DIGIT_MAP[digit] || digit);
}

export function cleanPhone(phone?: string | number | null) {
  let value = toEnglishDigits(String(phone ?? '')).trim();
  if (/^code:/i.test(value)) return '';
  value = value.replace(/[^\d+]/g, '');
  if (value.startsWith('+20')) value = `0${value.slice(3)}`;
  else if (value.startsWith('0020')) value = `0${value.slice(4)}`;
  else if (value.startsWith('20') && value.length === 12) value = `0${value.slice(2)}`;
  else value = value.replace(/\D/g, '');

  if (value.length === 10 && /^1[0125]\d{8}$/.test(value)) value = `0${value}`;
  return /^01[0125]\d{8}$/.test(value) ? value : '';
}

export function cleanPhoneForWhatsapp(phone?: string | number | null) {
  const local = cleanPhone(phone);
  return local ? `20${local.slice(1)}` : '';
}

export function isEgyptianMobile(phone?: string | number | null) {
  return Boolean(cleanPhone(phone));
}

export function phoneSearchTokens(phone?: string | number | null) {
  const local = cleanPhone(phone);
  return {
    local,
    last4: local.slice(-4),
    last5: local.slice(-5),
    whatsapp: cleanPhoneForWhatsapp(local),
  };
}

export function phoneMatchesSearch(phone: string | null | undefined, search: string) {
  const normalizedSearch =
    cleanPhone(search) || toEnglishDigits(String(search || '')).replace(/\D/g, '');
  if (!normalizedSearch) return true;
  const tokens = phoneSearchTokens(phone);
  return [tokens.local, tokens.whatsapp, tokens.last4, tokens.last5].some(
    (token) => token && token.includes(normalizedSearch)
  );
}
