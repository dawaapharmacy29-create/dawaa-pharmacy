export function toEnglishDigits(value: string) {
  return value.replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
}

export function cleanPhone(phone?: string | number | null) {
  let value = toEnglishDigits(String(phone ?? "")).trim();
  value = value.replace(/[^\d+]/g, "");
  if (value.startsWith("+20")) value = value.slice(3);
  if (value.startsWith("0020")) value = value.slice(4);
  if (value.startsWith("20") && value.length === 12) value = value.slice(2);
  if (!value.startsWith("0") && value.length === 10) value = `0${value}`;
  return value;
}

export function cleanPhoneForWhatsapp(phone?: string | number | null) {
  const local = cleanPhone(phone);
  if (!/^01\d{9}$/.test(local)) return "";
  return `20${local.slice(1)}`;
}

export function isEgyptianMobile(phone?: string | number | null) {
  return /^01\d{9}$/.test(cleanPhone(phone));
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
  const normalizedSearch = cleanPhone(search);
  if (!normalizedSearch) return true;
  const tokens = phoneSearchTokens(phone);
  return [tokens.local, tokens.whatsapp, tokens.last4, tokens.last5].some((token) => token && token.includes(normalizedSearch));
}
