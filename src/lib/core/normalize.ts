/**
 * normalize.ts — Data normalization utilities
 * Handles branch names, seller names, phones, customer codes, etc.
 */

const BRANCH_ALIASES: Record<string, string> = {
  "شكري": "فرع شكري",
  "فرع شكري": "فرع شكري",
  "الشامي": "فرع الشامي",
  "فرع الشامي": "فرع الشامي",
  "shokry": "فرع شكري",
  "el shamy": "فرع الشامي",
  "elshamy": "فرع الشامي",
  "shamy": "فرع الشامي",
};

/**
 * Normalizes a branch name to one of the canonical values.
 */
export function normalizeBranchName(name: string | null | undefined): string {
  if (!name) return "غير محدد";
  const lower = name.trim().toLowerCase();
  return BRANCH_ALIASES[lower] ?? BRANCH_ALIASES[name.trim()] ?? name.trim();
}

/**
 * Normalizes a seller/staff name for matching.
 * Strips extra spaces, Arabic diacritics, and lowercases.
 */
export function normalizeSellerName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7-\u06ED]/g, "")
    .toLowerCase();
}

/**
 * Normalizes an Egyptian phone number to 11 digits starting with 0.
 * Handles +20, 20, and local formats.
 */
export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return "";
  let p = phone.replace(/\D/g, "");
  if (p.startsWith("20") && p.length === 12) p = "0" + p.slice(2);
  if (p.startsWith("0") && p.length === 11) return p;
  if (p.length === 10 && !p.startsWith("0")) return "0" + p;
  return p;
}

/**
 * Validates that a phone is a valid Egyptian mobile number.
 */
export function isValidEgyptPhone(phone: string | null | undefined): boolean {
  const normalized = normalizePhone(phone);
  return /^01[0125]\d{8}$/.test(normalized);
}

/**
 * Normalizes a customer code to uppercase, trimmed string.
 */
export function normalizeCustomerCode(code: string | null | undefined): string {
  if (!code) return "";
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Returns true if a customer is likely a test/dummy entry.
 */
export function isTestCustomer(name: string | null | undefined): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  const testPatterns = [
    "test", "تجربة", "تجريبي", "dummy", "demo", "sample",
    "عميل وهمي", "xxxxx", "00000", "اختبار",
  ];
  return testPatterns.some((p) => lower.includes(p));
}

/**
 * Strips Arabic diacritics from a string for search/comparison.
 */
export function stripDiacritics(text: string): string {
  return text.replace(/[\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7-\u06ED]/g, "");
}

/**
 * Checks if a string matches a search query (Arabic-aware, case-insensitive).
 */
export function matchesSearch(text: string | null | undefined, query: string): boolean {
  if (!text) return false;
  const normalized = stripDiacritics(text.toLowerCase());
  const q = stripDiacritics(query.toLowerCase().trim());
  return normalized.includes(q);
}
