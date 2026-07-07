import { normalizeArabicName } from '@/lib/security/userDataScope';

type InvoiceUser = { username?: string | null; name?: string | null; role?: string | null } | null | undefined;

const INVOICE_IMPORT_KEYS = [
  'amira',
  'alyaa',
  'aliaa',
  'moaz',
  'moaaz',
  'maaz',
  'ola',
  'ala',
  'اميره',
  'اميرة',
  'علياء',
  'معاذ',
  'علا',
];

const INVOICE_DELETE_KEYS = ['moaz', 'moaaz', 'maaz', 'ola', 'ala', 'معاذ', 'علا'];

function userKeys(user: InvoiceUser) {
  return [normalizeArabicName(user?.username), normalizeArabicName(user?.name)].filter(Boolean);
}

function matchesKeys(user: InvoiceUser, keys: string[]) {
  const normalizedKeys = keys.map((item) => normalizeArabicName(item)).filter(Boolean);
  const values = userKeys(user);
  return values.some((value) =>
    normalizedKeys.some((key) => value === key || value.includes(key) || key.includes(value))
  );
}

export function canAccessInvoiceImportPage(user: InvoiceUser) {
  return matchesKeys(user, INVOICE_IMPORT_KEYS);
}

export function canDeleteInvoiceImportBatch(user: InvoiceUser) {
  return matchesKeys(user, INVOICE_DELETE_KEYS);
}

export function canManageInvoiceImportBatches(user: InvoiceUser) {
  return canAccessInvoiceImportPage(user);
}
