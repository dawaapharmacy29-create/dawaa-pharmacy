const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function normalizeAppSearchText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)))
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[\u200E\u200F\u202A-\u202E]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function normalizePhoneSearch(value: unknown): string {
  return normalizeAppSearchText(value).replace(/[^0-9*]/g, '');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function appSearchToRegExp(search: unknown): RegExp | null {
  const normalized = normalizeAppSearchText(search).replace(/\*+/g, '*');
  if (!normalized) return null;
  const source = normalized.split('*').map(escapeRegex).join('.*');
  return new RegExp(source, 'i');
}

export function matchesAppSearch(value: unknown, search: unknown): boolean {
  const pattern = appSearchToRegExp(search);
  if (!pattern) return true;
  return pattern.test(normalizeAppSearchText(value));
}

export function matchesAnyAppSearch(values: unknown[], search: unknown): boolean {
  const pattern = appSearchToRegExp(search);
  if (!pattern) return true;
  return values.some((value) => pattern.test(normalizeAppSearchText(value)));
}

function escapePostgrestLike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export function toPostgrestWildcardPattern(search: unknown): string | null {
  const normalized = normalizeAppSearchText(search).replace(/\*+/g, '*');
  if (!normalized) return null;
  const pattern = normalized.split('*').map(escapePostgrestLike).join('%');
  if (!pattern) return null;
  return pattern.includes('%') ? pattern : `%${pattern}%`;
}

export function getWildcardSearchHint(): string {
  return 'استخدم * قبل أو بعد أي جزء، مثل *احمد* أو 782* أو *2752';
}
