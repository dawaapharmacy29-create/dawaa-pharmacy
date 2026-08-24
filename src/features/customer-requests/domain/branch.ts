export type CustomerRequestBranchKey = 'shokry' | 'elshamy';

const BRANCH_ALIASES: Record<CustomerRequestBranchKey, readonly string[]> = {
  shokry: ['دواء شكري', 'فرع شكري', 'شكري', 'Dawaa Shokry', 'Shokry'],
  elshamy: ['دواء الشامي', 'فرع الشامي', 'الشامي', 'Dawaa Elshamy', 'Elshamy', 'El Shamy'],
};

function normalizeArabic(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ');
}

export function customerRequestBranchKey(value?: string | null): CustomerRequestBranchKey | null {
  const normalized = normalizeArabic(String(value || ''));
  if (!normalized || normalized === 'all' || normalized === 'الكل') return null;
  if (normalized.includes('شكري') || normalized.includes('shokry')) return 'shokry';
  if (normalized.includes('شامي') || normalized.includes('shamy') || normalized.includes('elshamy')) return 'elshamy';
  return null;
}

export function customerRequestBranchAliases(value?: string | null): string[] {
  const key = customerRequestBranchKey(value);
  if (!key) return value && value !== 'all' ? [value.trim()] : [];
  return [...BRANCH_ALIASES[key]];
}

export function customerRequestSourceBranch(value?: string | null) {
  const key = customerRequestBranchKey(value);
  if (key === 'shokry') return 'فرع شكري';
  if (key === 'elshamy') return 'فرع الشامي';
  return value && value !== 'all' ? value.trim() : null;
}

export function customerRequestBranchLabel(value?: string | null) {
  const key = customerRequestBranchKey(value);
  if (key === 'shokry') return 'دواء شكري';
  if (key === 'elshamy') return 'دواء الشامي';
  return value?.trim() || 'غير محدد';
}

export function customerRequestBranchIdentity(value?: string | null) {
  const key = customerRequestBranchKey(value);
  return {
    key,
    sourceValue: customerRequestSourceBranch(value),
    label: customerRequestBranchLabel(value),
    aliases: customerRequestBranchAliases(value),
  };
}
