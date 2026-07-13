export const CUSTOMER_SEGMENTS = {
  VERY_IMPORTANT: 'مهم جدًا',
  IMPORTANT: 'مهم',
  MEDIUM: 'متوسط',
  LOW: '1500 أو أقل',
} as const;

export type CustomerSegment = (typeof CUSTOMER_SEGMENTS)[keyof typeof CUSTOMER_SEGMENTS];

export const CUSTOMER_SEGMENT_THRESHOLDS = {
  veryImportantExclusive: 8000,
  importantExclusive: 4000,
  mediumExclusive: 1500,
} as const;

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

export function normalizeCustomerCode(value: unknown): string {
  const raw = String(value ?? '')
    .trim()
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)))
    .replace(/^code:/i, '')
    .trim();

  if (!raw || raw === '.' || /^[-_/\\]+$/.test(raw)) return '';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
    return '';
  }

  return raw.replace(/\.0+$/, '').trim();
}

export function normalizeCustomerName(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase();
}

export function classifyCustomerByAverageMonthly(avgMonthly: unknown): CustomerSegment {
  const average = Number(avgMonthly ?? 0);
  const safeAverage = Number.isFinite(average) ? Math.max(0, average) : 0;

  if (safeAverage > CUSTOMER_SEGMENT_THRESHOLDS.veryImportantExclusive) {
    return CUSTOMER_SEGMENTS.VERY_IMPORTANT;
  }
  if (safeAverage > CUSTOMER_SEGMENT_THRESHOLDS.importantExclusive) {
    return CUSTOMER_SEGMENTS.IMPORTANT;
  }
  if (safeAverage > CUSTOMER_SEGMENT_THRESHOLDS.mediumExclusive) {
    return CUSTOMER_SEGMENTS.MEDIUM;
  }
  return CUSTOMER_SEGMENTS.LOW;
}

const PSEUDO_CUSTOMER_TERMS = [
  'عميل الصيدليه',
  'عميل غير مسجل',
  'عميل غير محدد',
  'غير معروف',
  'unknown',
  'anonymous',
  'نقدي',
  'كاش',
];

const INTERNAL_ACCOUNT_TERMS = [
  'الجرد',
  'العجز',
  'ابو العزم',
  'أبو العزم',
  'فرع الشامي',
  'فرع شكري',
  'حساب داخلي',
];

export type CustomerAccountKind =
  | 'real_customer'
  | 'pseudo_customer'
  | 'internal_account'
  | 'invalid_customer';

export function classifyCustomerAccount(input: {
  customerCode?: unknown;
  customerName?: unknown;
}): CustomerAccountKind {
  const code = normalizeCustomerCode(input.customerCode);
  const name = normalizeCustomerName(input.customerName);

  if (INTERNAL_ACCOUNT_TERMS.some((term) => name.includes(normalizeCustomerName(term)))) {
    return 'internal_account';
  }
  if (PSEUDO_CUSTOMER_TERMS.some((term) => name.includes(normalizeCustomerName(term)))) {
    return 'pseudo_customer';
  }
  if (!code || !name || name.length < 3 || /^[\d\W_]+$/u.test(name)) {
    return 'invalid_customer';
  }
  return 'real_customer';
}

export type BranchSales = Record<string, number>;

export type BranchResolution = {
  currentBranch: string | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
  share: number;
  isMultiBranch: boolean;
};

export function resolveCustomerBranch(
  branchSales: BranchSales,
  options: { confirmedShare?: number; probableShare?: number } = {}
): BranchResolution {
  const confirmedShare = options.confirmedShare ?? 0.7;
  const probableShare = options.probableShare ?? 0.6;
  const entries = Object.entries(branchSales)
    .map(([branch, amount]) => [branch, Number(amount) || 0] as const)
    .filter(([branch, amount]) => Boolean(branch) && amount > 0)
    .sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, amount]) => sum + amount, 0);

  if (!entries.length || total <= 0) {
    return { currentBranch: null, confidence: 'none', share: 0, isMultiBranch: false };
  }

  const [topBranch, topAmount] = entries[0];
  const share = topAmount / total;

  if (share >= confirmedShare) {
    return { currentBranch: topBranch, confidence: 'high', share, isMultiBranch: false };
  }
  if (share >= probableShare) {
    return { currentBranch: topBranch, confidence: 'medium', share, isMultiBranch: false };
  }
  return { currentBranch: topBranch, confidence: 'low', share, isMultiBranch: true };
}

export function calculateAverageMonthly(totalSpent: unknown, activeMonths: unknown): number {
  const total = Number(totalSpent ?? 0);
  const months = Number(activeMonths ?? 0);
  if (!Number.isFinite(total) || !Number.isFinite(months) || months <= 0) return 0;
  return Math.max(0, total / months);
}
