// Reviewer-facing WhatsApp customer identity resolver.
//
// WhatsApp exports/source metadata sometimes concatenate the CRM customer code directly to the
// contact name (for example: "محمد الكموني17777"). This helper cleans that display identity
// conservatively. It never uses a phone-like suffix as a customer code and never invents a code.
export interface CustomerDisplayIdentityInput {
  sourceName?: string | null;
  sourceCode?: string | null;
  sourcePhone?: string | null;
  fallbackName?: string | null;
  fallbackCode?: string | null;
  fallbackPhone?: string | null;
}

export interface CustomerDisplayIdentity {
  name: string | null;
  code: string | null;
  phone: string | null;
  codeSource: 'explicit' | 'name_suffix' | 'fallback' | 'none';
}

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const EASTERN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

function westernDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (d) => {
    const a = ARABIC_DIGITS.indexOf(d);
    if (a >= 0) return String(a);
    const e = EASTERN_DIGITS.indexOf(d);
    return e >= 0 ? String(e) : d;
  });
}

function cleanSpaces(value: string | null | undefined): string | null {
  const cleaned = String(value ?? '').replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

function digitsOnly(value: string | null | undefined): string {
  return westernDigits(String(value ?? '')).replace(/\D/g, '');
}

function looksLikePhoneDigits(digits: string): boolean {
  if (digits.length >= 10) return true;
  return /^(?:20)?01[0125]\d{8}$/.test(digits);
}

function validExplicitCode(value: string | null | undefined): string | null {
  const digits = digitsOnly(value);
  if (!digits || looksLikePhoneDigits(digits)) return null;
  // Existing Dawaa customer codes are numeric; stay conservative about very short/very long noise.
  if (digits.length < 2 || digits.length > 9) return null;
  return digits;
}

function splitNameSuffixCode(rawName: string | null | undefined): { name: string | null; code: string | null } {
  const original = cleanSpaces(rawName);
  if (!original) return { name: null, code: null };

  const normalized = westernDigits(original);
  // Accept attached/separated forms:
  // "محمد الكموني17777", "محمد الكموني 17777", "محمد - 17777", "محمد (17777)", "محمد #17777".
  const match = normalized.match(/^(.+?)(?:\s*[-–—|/#:]?\s*|\s*\(\s*)(\d{2,9})\s*\)?$/u);
  if (!match) return { name: original, code: null };

  const code = match[2];
  if (looksLikePhoneDigits(code)) return { name: original, code: null };

  const name = cleanSpaces(match[1]?.replace(/[-–—|/#:(\s]+$/u, '')) ?? original;
  // Do not turn a numeric-only contact label into an empty/invalid person name.
  if (!name || /^\d+$/u.test(westernDigits(name))) return { name: original, code: null };
  return { name, code };
}

export function resolveCustomerDisplayIdentity(input: CustomerDisplayIdentityInput): CustomerDisplayIdentity {
  const explicitCode = validExplicitCode(input.sourceCode);
  const split = splitNameSuffixCode(input.sourceName);
  const fallbackSplit = splitNameSuffixCode(input.fallbackName);
  const fallbackCode = validExplicitCode(input.fallbackCode);

  const code = explicitCode ?? split.code ?? fallbackCode ?? fallbackSplit.code ?? null;
  const codeSource: CustomerDisplayIdentity['codeSource'] =
    explicitCode ? 'explicit' :
    split.code ? 'name_suffix' :
    (fallbackCode || fallbackSplit.code) ? 'fallback' : 'none';

  const name = split.name ?? fallbackSplit.name ?? cleanSpaces(input.fallbackName);
  const sourcePhone = cleanSpaces(input.sourcePhone);
  const fallbackPhone = cleanSpaces(input.fallbackPhone);

  return {
    name,
    code,
    phone: sourcePhone ?? fallbackPhone,
    codeSource,
  };
}

export const __customerIdentityTestOnly = { westernDigits, splitNameSuffixCode, validExplicitCode };
