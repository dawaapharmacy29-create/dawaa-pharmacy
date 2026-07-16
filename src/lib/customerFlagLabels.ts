import { CUSTOMER_FLAGS, getFlagByKey } from '@/lib/customerFlags';

const EXTRA_LABELS: Record<string, string> = {
  very_important: 'مهم جدًا',
  important: 'مهم',
  medium: 'متوسط',
  normal: 'عادي',
  stopped: 'متوقف',
  at_risk: 'مهدد بالتوقف',
};

const LABEL_TO_KEY = new Map<string, string>();

function normalizeArabic(value: string) {
  return value
    .replace(/[ًٌٍَُِّْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[\s_-]+/g, ' ')
    .trim()
    .toLowerCase();
}

for (const flag of CUSTOMER_FLAGS) LABEL_TO_KEY.set(normalizeArabic(flag.label), flag.key);
for (const [key, label] of Object.entries(EXTRA_LABELS)) LABEL_TO_KEY.set(normalizeArabic(label), key);

export function normalizeCustomerFlagKey(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export function getCustomerFlagLabel(value: unknown) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const key = normalizeCustomerFlagKey(raw);
  const known = getFlagByKey(key)?.label || EXTRA_LABELS[key];
  if (known) return known;

  const semanticKey = LABEL_TO_KEY.get(normalizeArabic(raw));
  if (semanticKey) return getFlagByKey(semanticKey)?.label || EXTRA_LABELS[semanticKey] || raw;

  if (import.meta.env.DEV && /^[a-z0-9_\-]+$/i.test(raw)) {
    console.warn('[customer-flags] unknown display key', raw);
  }
  return raw.replace(/_/g, ' ');
}

export function getCustomerFlagSemanticKey(value: unknown) {
  const label = getCustomerFlagLabel(value);
  const mappedKey = LABEL_TO_KEY.get(normalizeArabic(label));
  return mappedKey || normalizeArabic(label);
}

export function translateAndDedupeCustomerFlags(values: unknown[], limit = 8) {
  const unique = new Map<string, string>();
  for (const value of values) {
    const label = getCustomerFlagLabel(value);
    if (!label) continue;
    const key = getCustomerFlagSemanticKey(label);
    if (!unique.has(key)) unique.set(key, label);
  }
  return [...unique.values()].slice(0, limit);
}
