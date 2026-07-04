import { normalizeBranchName } from '@/lib/branch';

export type InvoiceLike = Record<string, unknown>;

const EGYPTIAN_BRANCHES: Array<{ canonical: string; aliases: RegExp[] }> = [
  {
    canonical: 'فرع شكري',
    aliases: [/شكري/i, /شكرى/i, /shokry/i, /shoukry/i],
  },
  {
    canonical: 'فرع الشامي',
    aliases: [/الشامي/i, /الشامى/i, /shamy/i, /shami/i],
  },
];

function cleanText(value: unknown) {
  return String(value ?? '').trim();
}

export function normalizeInvoiceDigits(value: string) {
  return value
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
}

export function parseInvoiceAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = normalizeInvoiceDigits(cleanText(value))
    .replace(/[,،\s]/g, '')
    .replace(/[٫]/g, '.')
    .replace(/جنيه|ج\.م|egp/gi, '')
    .replace(/[^0-9.-]/g, '');
  const amount = Number.parseFloat(normalized);
  return Number.isFinite(amount) ? amount : null;
}

export function excelSerialToInvoiceDate(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const excelEpoch = Date.UTC(1899, 11, 30);
  const date = new Date(excelEpoch + Math.round(serial * 86400000));
  const year = date.getUTCFullYear();
  if (year < 1900 || year > 2100) return null;
  return date;
}

export function parseInvoiceDateTime(value: unknown): string | null {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  if (typeof value === 'number') {
    return excelSerialToInvoiceDate(value)?.toISOString() ?? null;
  }

  const text = cleanText(value);
  if (!text) return null;

  if (/^\d+(\.\d+)?$/.test(text)) {
    const serial = Number.parseFloat(text);
    if (serial > 40000 && serial < 60000) {
      return excelSerialToInvoiceDate(serial)?.toISOString() ?? null;
    }
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) {
      const year = parsed.getUTCFullYear();
      if (year >= 2000 && year <= 2100) return parsed.toISOString();
    }
  }

  const egyptian = text.match(
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/
  );
  if (egyptian) {
    const [, dayText, monthText, yearText, hourText = '0', minuteText = '0', secondText = '0'] =
      egyptian;
    const year = Number(yearText.length === 2 ? `20${yearText}` : yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    if (
      year < 2000 ||
      year > 2100 ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31 ||
      hour > 23 ||
      minute > 59 ||
      second > 59
    ) {
      return null;
    }
    const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    if (
      !Number.isNaN(parsed.getTime()) &&
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    ) {
      return parsed.toISOString();
    }
    return null;
  }

  const fallback = new Date(text);
  if (!Number.isNaN(fallback.getTime())) {
    const year = fallback.getUTCFullYear();
    if (year >= 2000 && year <= 2100) return fallback.toISOString();
  }

  return null;
}

export function parseInvoiceDate(value: unknown): string | null {
  return parseInvoiceDateTime(value)?.slice(0, 10) ?? null;
}

function firstValue(row: InvoiceLike, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && cleanText(value) !== '') return value;
  }
  return null;
}

export function getInvoiceDay(row: InvoiceLike): string | null {
  return parseInvoiceDate(
    firstValue(row, ['sale_date', 'invoice_date', 'invoice_datetime', 'close_datetime', 'date'])
  );
}

export function getInvoiceAmount(row: InvoiceLike): number {
  const value = firstValue(row, [
    'net_amount',
    'net_total',
    'total_amount',
    'amount',
    'gross_amount',
    'discounted_amount',
  ]);
  return parseInvoiceAmount(value) ?? 0;
}

export function getInvoiceId(row: InvoiceLike): string {
  return cleanText(firstValue(row, ['invoice_number', 'invoice_no', 'id']));
}

export function getInvoiceBranch(row: InvoiceLike, fallback = 'غير محدد'): string {
  const raw = cleanText(firstValue(row, ['branch_name', 'branch'])) || fallback;
  const normalized = normalizeBranchName(raw);
  for (const branch of EGYPTIAN_BRANCHES) {
    if (branch.aliases.some((alias) => alias.test(raw) || alias.test(normalized))) {
      return branch.canonical;
    }
  }
  return normalized || raw || fallback;
}

export function getInvoiceCustomerKey(row: InvoiceLike): string {
  return cleanText(firstValue(row, ['customer_code', 'customer_phone', 'phone', 'whatsapp_phone']));
}

export function getInvoiceSellerName(row: InvoiceLike): string {
  return cleanText(firstValue(row, ['normalized_seller_name', 'staff_name', 'seller_name']));
}

export function buildInvoiceIdentity(row: InvoiceLike, fallbackBranch = 'غير محدد') {
  return `${getInvoiceId(row)}|${getInvoiceBranch(row, fallbackBranch)}|${getInvoiceDay(row) || ''}`;
}
