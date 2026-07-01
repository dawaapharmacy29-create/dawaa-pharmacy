/**
 * صيدليات دواة - daily import engine.
 * Supports the permanent Excel layouts currently exported by the pharmacy system:
 * - Sales file: header row starts with "المخزن، الرقم، النوع، الكود، العميل..."
 * - Customers file: "العنوان، موبايل، تليفون، اسم العميل، الكود"
 */

/* xlsx will be imported statically here because callers expect synchronous parsing */
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { getCycleForDate } from '@/lib/pharmacy-cycle';
import { getShiftFromDateTime } from '@/lib/analyticsFromInvoices';
import { invalidateInvoiceCache } from '@/lib/salesInvoiceSource';
import { normalizeName } from '@/lib/utils';
import { clearExecutiveDashboardCache } from '@/lib/executiveDashboardDataService';
import { clearSalesAnalyticsSummaryCache } from '@/lib/salesAnalyticsSummaryService';
import { clearCustomerProfileCache } from '@/lib/customerProfileService';
import { clearCustomersCache } from '@/lib/api/customers';
import { clearCustomerServiceCommandCenterCache } from '@/lib/api/customerServiceCommandCenter';
import { clearStaffPerformanceProfileCache } from '@/lib/staff/staffPerformanceProfileService';
import { resolveStaffNameToStaffId } from '@/lib/staffIdentityMapping';
import { getInvoiceDuplicateKey, getInvoiceKey } from '@/lib/dawaa2027';

export interface RawInvoiceRow {
  rowIndex: number;
  invoiceNumber: string;
  customerCode: string;
  name: string;
  phone: string;
  amount: number;
  grossAmount: number | null;
  discountedAmount: number | null;
  netAmount: number | null;
  discountAmount: number | null;
  courierCash: number | null;
  extraFees: number | null;
  lineItemsCount: number | null;
  date: string;
  invoiceDateTime: string;
  closeDateTime: string | null;
  analysisDateTime: string;
  branch: string;
  invoiceType: string;
  seller: string;
  closeTime: string | null;
  deliveryStaff: string;
  specialty: string;
  clinic: string;
  deliveryAddress: string;
  notes: string;
  saveStatus: string;
  deviceName: string;
  customerLinkStatus: 'matched_by_file' | 'unmatched_customer';
  importValidationStatus: 'valid' | 'zero_amount';
  importWarning: string | null;
  raw: Record<string, unknown>;
}

export interface RawCustomerRow {
  rowIndex: number;
  code: string;
  name: string;
  phone: string;
  mobile: string;
  telephone: string;
  address: string;
  raw: Record<string, unknown>;
}

export interface ValidationError {
  row: number;
  field: string;
  message: string;
}

export interface ImportSummary {
  totalRows: number;
  validRows: number;
  rowsRead?: number;
  uniqueInvoices?: number;
  insertedInvoices?: number;
  skippedInvoices?: number;
  reviewInvoices?: number;
  missingCustomer?: number;
  missingDoctor?: number;
  missingBranch?: number;
  insertedRows: number;
  updatedInvoices?: number;
  /** فواتير كانت موجودة مسبقًا في قاعدة البيانات وتم تأكيدها من ملف الرفع الحالي */
  confirmedExistingInvoices?: number;
  skippedDuplicates: number;
  conflictReviewRows?: number;
  valueChangedUpdates?: number;
  errors: ValidationError[];
  updatedCustomers: number;
  newCustomers: number;
  importBatch: string;
  /** صفوف تحتاج مراجعة يدوية (ربط عميل ضعيف، بيانات ناقصة، إلخ) */
  needsReviewRows: number;
  /** عملاء لم يُربطوا بكود واضح */
  unlinkedCustomersEstimate: number;
  unmatchedCustomerRows?: number;
  zeroAmountRows?: number;
  rejectedRows?: number;
  firstInvoiceDate?: string | null;
  lastInvoiceDate?: string | null;
  fileNetSales?: number;
  importedNetSales?: number;
  insertedNetSales?: number;
  updatedNetSales?: number;
  /** صافي الفواتير الموجودة مسبقًا كما وردت في ملف الرفع الحالي */
  confirmedExistingNetSales?: number;
  /** صافي الملف الذي تم التعامل معه = الجديد + الموجود المؤكد، ولا يشترط أن يكون كله Insert جديد */
  processedNetSales?: number;
  savedNetSales?: number;
  savedOrUpdatedNetSales?: number;
  reviewNetSales?: number;
  dailyCounts?: Array<{ date: string; count: number; total: number }>;
  branchCounts?: Array<{ branch: string; count: number; total: number }>;
  skippedDuplicateInvoices?: Array<{ invoiceNumber: string; branch: string; date: string }>;
  distinctInvoicesInFile?: number;
  invoicesWithoutCustomer?: number;
  invoicesWithoutDoctor?: number;
  invoicesWithoutBranch?: number;
  schemaWarnings?: string[];
  staffLinkingMode?: 'staff_id' | 'name_fallback';
  summaryRefreshStatus?: 'refreshed' | 'manual_required' | 'skipped' | 'unavailable';
  summaryRefreshMessage?: string;
  postImportRefreshSteps?: PostImportRefreshStep[];
  fileName?: string | null;
  importedBy?: string | null;
  importedAt?: string | null;
}

export interface PostImportRefreshStep {
  key: string;
  label: string;
  status: 'success' | 'failed' | 'skipped';
  message: string;
}

export interface ParseResult {
  rows: RawInvoiceRow[];
  errors: ValidationError[];
  headers: string[];
}

export interface CustomerParseResult {
  rows: RawCustomerRow[];
  errors: ValidationError[];
  headers: string[];
}

const SALES_HEADER_MARKERS = [
  'المخزن',
  'الرقم',
  'الكود',
  'العميل',
  'التاريخ',
  'ق.الصافى',
  'المستخدم',
  'مندوب التوصيل',
];
const CUSTOMER_HEADER_MARKERS = ['العنوان', 'موبايل', 'تليفون', 'اسم العميل', 'الكود'];

const NAME_KEYS = [
  'العميل',
  'اسم العميل',
  'اسم العميل ',
  'الاسم',
  'name',
  'customer_name',
  'customer name',
];
const PHONE_KEYS = [
  'رقم الهاتف',
  'الهاتف',
  'موبايل',
  'الموبايل',
  'تليفون',
  'phone',
  'mobile',
  'tel',
  'telephone',
];
const AMOUNT_KEYS = [
  'ق.الصافى',
  'ق.بعد الخصم',
  'ق.الفاتورة',
  'إجمالي الفاتورة',
  'المبلغ',
  'الإجمالي',
  'amount',
  'total',
];
const DATE_KEYS = ['التاريخ', 'تاريخ الفاتورة', 'تاريخ', 'date', 'invoice_date', 'purchase_date'];
const CODE_KEYS = ['الكود', 'الكود ', 'كود العميل', 'customer_code', 'code'];
const INVOICE_NUMBER_KEYS = ['الرقم', 'رقم الفاتورة', 'invoice_number', 'invoice no'];
const BRANCH_KEYS = ['المخزن', 'الفرع', 'branch'];
const SELLER_KEYS = ['المستخدم', 'الدكتور', 'الصيدلي', 'doctor', 'seller', 'user'];
const CLOSE_TIME_KEYS = ['وقت الإقفال', 'وقت الاقفال', 'close_time'];
const INVOICE_TYPE_KEYS = ['النوع', 'نوع الفاتورة', 'invoice_type'];
const DELIVERY_KEYS = ['مندوب التوصيل', 'delivery_staff'];
const SPECIALTY_KEYS = ['تخصص', 'specialty'];
const ITEMS_COUNT_KEYS = ['ع.أصناف', 'عدد الأصناف', 'items_count'];
const REPLACEMENT_ITEMS_COUNT_KEYS = [
  'ع.أصناف الأستبدال',
  'عدد أصناف الاستبدال',
  'replacement_items_count',
];
const GROSS_AMOUNT_KEYS = ['ق.الفاتورة', 'gross_amount'];
const DISCOUNTED_AMOUNT_KEYS = ['ق.بعد الخصم', 'discounted_amount'];
const RETURNS_AMOUNT_KEYS = ['ق.الإستبدالات', 'returns_amount'];
const DISCOUNT_RATE_KEYS = ['ن.الخصم', 'discount_rate'];
const DISCOUNT_AMOUNT_KEYS = ['ق.الخصم', 'discount_amount'];
const COURIER_CASH_KEYS = ['مبلغ مع المندوب', 'courier_cash'];
const CLINIC_KEYS = ['عيادة', 'clinic'];
const EXTRA_FEES_KEYS = ['مصاريف إضافية', 'extra_fees'];
const DELIVERY_ADDRESS_KEYS = ['عنوان التوصيل', 'delivery_address'];
const NOTES_KEYS = ['ملاحظات', 'notes'];
const SAVE_STATUS_KEYS = ['النوع__2', 'حالة الحفظ', 'save_status'];
const DEVICE_KEYS = ['إسم الجهاز', 'اسم الجهاز', 'device_name'];

function normalise(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function findColumn(headers: string[], candidates: string[]): number {
  const normHeaders = headers.map((header) => normalise(header.replace(/__\d+$/, '')));
  for (const candidate of candidates) {
    const idx = normHeaders.indexOf(normalise(candidate));
    if (idx !== -1) return idx;
  }
  for (const candidate of candidates) {
    const needle = normalise(candidate);
    const idx = normHeaders.findIndex(
      (header) => header.includes(needle) || needle.includes(header)
    );
    if (idx !== -1) return idx;
  }
  return -1;
}

function findHeaderRow(rows: unknown[][], markers: string[]): number {
  let bestIndex = 0;
  let bestScore = -1;

  // Check first 30 rows for header
  const searchRows = rows.slice(0, 30);

  searchRows.forEach((row, index) => {
    const cells = row.map(normalise);
    const score = markers.filter((marker) => cells.includes(normalise(marker))).length;

    // Bonus points for rows with more cells (likely header)
    const cellCountBonus = cells.filter((c) => c.length > 0).length * 0.1;

    const totalScore = score + cellCountBonus;

    if (totalScore > bestScore) {
      bestIndex = index;
      bestScore = totalScore;
    }
  });

  // If no good match found, default to row 0 or 1
  if (bestScore < 2) {
    // Try to find a row with common header patterns
    for (let i = 0; i < Math.min(5, rows.length); i++) {
      const cells = rows[i].map(normalise);
      const hasCommonHeaders = cells.some(
        (c) =>
          NAME_KEYS.some((k) => normalise(k) === c) ||
          AMOUNT_KEYS.some((k) => normalise(k) === c) ||
          DATE_KEYS.some((k) => normalise(k) === c)
      );
      if (hasCommonHeaders) {
        return i;
      }
    }
  }

  return bestIndex;
}

function rowsFromWorkbook(buffer: ArrayBuffer, markers: string[]) {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false, raw: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: '',
    raw: true,
    blankrows: false,
  });

  if (aoa.length === 0) {
    throw new Error('الملف فارغ');
  }

  const headerIndex = findHeaderRow(aoa, markers);
  const rawHeaders = (aoa[headerIndex] || []).map((cell) => cleanText(cell));
  const counts = new Map<string, number>();
  const headers = rawHeaders.map((header, index) => {
    const fallback = header || `Column ${index + 1}`;
    const seen = counts.get(fallback) || 0;
    counts.set(fallback, seen + 1);
    return seen === 0 ? fallback : `${fallback}__${seen + 1}`;
  });

  // Filter out empty headers
  const validHeaders = headers.map((h, i) => ({ header: h, index: i })).filter((h) => h.header);

  const rows = aoa
    .slice(headerIndex + 1)
    .map((row, index) => {
      const record: Record<string, unknown> = {};
      validHeaders.forEach(({ header, index: colIndex }) => {
        record[header] = row[colIndex] ?? '';
      });
      return { rowIndex: headerIndex + index + 2, record };
    })
    .filter((row) => {
      // Filter out completely empty rows
      return Object.values(row.record).some((v) => v !== '' && v !== null && v !== undefined);
    });

  return { headers: validHeaders.map((h) => h.header), rows };
}

export function normalisePhone(raw: string | number): string {
  let value = String(raw ?? '').replace(/[^\d٠-٩]/g, '');
  value = value.replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
  if (value.startsWith('20') && value.length === 12) value = value.slice(2);
  if (!value.startsWith('0') && value.length === 10) value = '0' + value;
  return value;
}

function isValidPhone(phone: string): boolean {
  return /^01[0-9]{9}$/.test(phone);
}

function parseAmount(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const value = String(raw)
    .trim()
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٬،,\s]/g, '')
    .replace(/[٫]/g, '.')
    .replace(/جنيه|ج\.م|egp/gi, '')
    .replace(/[^0-9.-]/g, '');
  const amount = Number.parseFloat(value);
  return Number.isFinite(amount) ? amount : null;
}

function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const excelEpoch = Date.UTC(1899, 11, 30);
  const date = new Date(excelEpoch + Math.round(serial * 86400000));
  const year = date.getUTCFullYear();
  if (year < 1900 || year > 2100) return null;
  return date;
}

function parseDate(raw: unknown): string | null {
  const dateTime = parseDateTime(raw);
  return dateTime ? dateTime.slice(0, 10) : null;
}

function parseDateTime(raw: unknown): string | null {
  if (!raw) return null;

  if (typeof raw === 'number') {
    return excelSerialToDate(raw)?.toISOString() ?? null;
  }

  const value = String(raw).trim();

  if (/^\d+(\.\d+)?$/.test(value)) {
    const serial = Number.parseFloat(value);
    if (serial > 40000 && serial < 60000) {
      return excelSerialToDate(serial)?.toISOString() ?? null;
    }
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      const year = parsed.getUTCFullYear();
      if (year >= 2000 && year <= 2100) {
        return parsed.toISOString();
      }
    }
  }

  const match = value.match(
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/
  );
  if (match) {
    const [, first, second, year, hours = '0', minutes = '0', seconds = '0'] = match;
    const fullYear = year.length === 2 ? `20${year}` : year;
    const firstNumber = Number(first);
    const secondNumber = Number(second);
    const day = firstNumber > 12 ? first : secondNumber > 12 ? second : first;
    const month = firstNumber > 12 ? second : secondNumber > 12 ? first : second;
    const parsed = new Date(
      Date.UTC(
        Number(fullYear),
        Number(month) - 1,
        Number(day),
        Number(hours),
        Number(minutes),
        Number(seconds)
      )
    );
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getUTCFullYear();
    if (year >= 2000 && year <= 2100) {
      return parsed.toISOString();
    }
  }

  return null;
}

function parseCloseDateTime(raw: unknown, invoiceDateTime: string): string | null {
  if (!raw || !invoiceDateTime) return null;

  if (typeof raw === 'number') {
    if (raw > 1) return parseDateTime(raw);
    const invoiceDate = new Date(invoiceDateTime);
    if (Number.isNaN(invoiceDate.getTime())) return null;
    const millis = Math.round(raw * 86400000);
    const date = new Date(
      Date.UTC(
        invoiceDate.getUTCFullYear(),
        invoiceDate.getUTCMonth(),
        invoiceDate.getUTCDate(),
        0,
        0,
        0
      ) + millis
    );
    return date.toISOString();
  }

  const value = String(raw).trim();
  if (!value) return null;

  const parsedDateTime = parseDateTime(value);
  if (parsedDateTime) return parsedDateTime;

  const timeMatch = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm)?$/);
  if (!timeMatch) return null;

  let hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  const seconds = Number(timeMatch[3] ?? 0);
  const meridiem = timeMatch[4]?.toLowerCase();
  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;

  const invoiceDate = new Date(invoiceDateTime);
  const date = new Date(
    Date.UTC(
      invoiceDate.getUTCFullYear(),
      invoiceDate.getUTCMonth(),
      invoiceDate.getUTCDate(),
      hours,
      minutes,
      seconds
    )
  );
  return date.toISOString();
}

function getValue(raw: Record<string, unknown>, headers: string[], keys: string[]) {
  const idx = findColumn(headers, keys);
  return idx === -1 ? '' : raw[headers[idx]];
}

function normalizeBranch(rawBranch: string, fallback: string) {
  if (rawBranch.includes('شكري')) return 'فرع شكري';
  if (rawBranch.includes('شامي') || rawBranch.includes('الشامى')) return 'فرع الشامي';
  return fallback;
}

function classifyByAvg(avg: number): string {
  if (avg >= 8000) return 'مهم جدًا';
  if (avg >= 4000) return 'مهم';
  if (avg >= 1500) return 'متوسط';
  return 'عادي';
}

function calcRetentionStatus(lastPurchase: string | null): string {
  if (!lastPurchase) return 'جديد';
  const daysSince = Math.floor((Date.now() - new Date(lastPurchase).getTime()) / 86400000);
  if (daysSince <= 30) return 'محتفظ';
  if (daysSince <= 60) return 'معرض للفقدان';
  return 'مفقود';
}

function safeIdentifier(phone: string, customerCode: string) {
  return phone || (customerCode ? `code:${customerCode}` : '');
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function schemaCacheMissingColumn(message?: string | null) {
  if (!message) return '';
  return (
    message.match(/Could not find the '([^']+)' column/)?.[1] ||
    message.match(/column "([^"]+)" does not exist/)?.[1] ||
    message.match(/'([^']+)' column/)?.[1] ||
    ''
  );
}

function finiteAmount(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function firstInvoiceNetCandidate(candidates: unknown[]): number {
  const finiteValues = candidates.map(finiteAmount).filter((value): value is number => value !== null);
  const positiveValue = finiteValues.find((value) => value > 0);
  return positiveValue ?? finiteValues[0] ?? 0;
}

function invoiceNetValue(row: Record<string, unknown>) {
  return firstInvoiceNetCandidate([
    row.net_total,
    row.net_amount,
    row.discounted_amount,
    row.total_amount,
    row.amount,
    row.gross_total,
    row.gross_amount,
  ]);
}

function rawInvoiceNetValue(row: RawInvoiceRow) {
  return firstInvoiceNetCandidate([row.netAmount, row.discountedAmount, row.amount, row.grossAmount]);
}

function invoiceDuplicateKey(invoiceNumber: string, branch: string, saleDate: string) {
  return getInvoiceDuplicateKey({
    invoice_no: invoiceNumber,
    invoice_number: invoiceNumber,
    branch,
    invoice_date: saleDate,
  });
}

function friendlyImportError(message: string) {
  if (message.includes('statement timeout') || message.includes('canceling statement')) {
    return 'المصدر استغرق وقتًا طويلًا. تم إيقاف أي تحديث ثقيل، ويفضل تحديث الملخصات من لوحة الإدارة أو RPC مخصص.';
  }
  if (message.includes('schema cache')) {
    return 'أحد الأعمدة لم يظهر بعد في Supabase schema cache. تم الاستيراد بالحقول المتاحة، ويُفضّل تحديث schema cache بعد الترقية.';
  }
  if (message.includes('unique constraint') || message.includes('duplicate key')) {
    return 'تم اكتشاف فاتورة مكررة أثناء الحفظ. سيتم تخطيها بدل تعطيل الاستيراد.';
  }
  return message;
}

function broadcastInvoiceImportRefresh() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem('dawaa_invoice_import_refresh', String(Date.now()));
  } catch {
    // Local storage may be unavailable in private/restricted contexts.
  }
}

async function insertRowsWithOptionalColumns(table: string, rows: Array<Record<string, unknown>>) {
  let nextRows = rows;
  const removedColumns = new Set<string>();

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { error } = await supabase.from(table).insert(nextRows);
    if (!error) return { error: null, removedColumns: [...removedColumns] };

    const missingColumn = schemaCacheMissingColumn(error.message);
    if (!missingColumn || removedColumns.has(missingColumn)) {
      return { error, removedColumns: [...removedColumns] };
    }

    removedColumns.add(missingColumn);
    nextRows = nextRows.map((row) => {
      const copy = { ...row };
      delete copy[missingColumn];
      return copy;
    });
  }

  return {
    error: { message: 'تعذر الحفظ بعد إزالة الأعمدة الاختيارية غير الموجودة في قاعدة البيانات.' },
    removedColumns: [...removedColumns],
  };
}

async function updateRowWithOptionalColumns(
  table: string,
  id: string,
  row: Record<string, unknown>
) {
  let nextRow = { ...row };
  const removedColumns = new Set<string>();
  delete nextRow.id;
  delete nextRow.created_at;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { error } = await supabase.from(table).update(nextRow).eq('id', id);
    if (!error) return { error: null, removedColumns: [...removedColumns] };

    const missingColumn = schemaCacheMissingColumn(error.message);
    if (!missingColumn || removedColumns.has(missingColumn)) {
      return { error, removedColumns: [...removedColumns] };
    }

    removedColumns.add(missingColumn);
    const copy = { ...nextRow };
    delete copy[missingColumn];
    nextRow = copy;
  }

  return {
    error: {
      message: 'تعذر تحديث الفاتورة بعد إزالة الأعمدة الاختيارية غير الموجودة في قاعدة البيانات.',
    },
    removedColumns: [...removedColumns],
  };
}

function sameDateOnly(left: unknown, right: unknown) {
  return String(left || '').slice(0, 10) === String(right || '').slice(0, 10);
}

function normalizeComparableBranch(raw: unknown, fallback: string) {
  return normalizeBranch(String(raw || ''), fallback || 'غير محدد');
}

function existingInvoiceValue(row: Record<string, unknown>) {
  const candidates = [row.net_amount, row.discounted_amount, row.amount, row.gross_amount];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function reportProgress(
  onProgress: ((done: number, total: number) => void) | undefined,
  done: number,
  total: number
) {
  onProgress?.(Math.min(done, total), total);
}

export function parseInvoiceFile(
  buffer: ArrayBuffer,
  _fileName: string,
  fallbackBranch = 'فرع شكري'
): ParseResult {
  const rows: RawInvoiceRow[] = [];
  const errors: ValidationError[] = [];

  let parsed: ReturnType<typeof rowsFromWorkbook>;
  try {
    parsed = rowsFromWorkbook(buffer, SALES_HEADER_MARKERS);
  } catch (error) {
    return {
      rows,
      errors: [
        {
          row: 0,
          field: 'الملف',
          message: `تعذر قراءة الملف: ${(error as Error).message}`,
        },
      ],
      headers: [],
    };
  }

  const { headers } = parsed;
  const nameIdx = findColumn(headers, NAME_KEYS);
  const amountIdx = findColumn(headers, AMOUNT_KEYS);
  const dateIdx = findColumn(headers, DATE_KEYS);
  const codeIdx = findColumn(headers, CODE_KEYS);

  if (nameIdx === -1)
    errors.push({
      row: 0,
      field: 'العميل',
      message: `عمود العميل غير موجود. الأعمدة: ${headers.join(' | ')}`,
    });
  if (amountIdx === -1)
    errors.push({
      row: 0,
      field: 'قيمة الفاتورة',
      message: 'عمود قيمة الفاتورة غير موجود',
    });
  if (dateIdx === -1)
    errors.push({
      row: 0,
      field: 'التاريخ',
      message: 'عمود التاريخ غير موجود',
    });
  if (codeIdx === -1)
    errors.push({
      row: 0,
      field: 'الكود',
      message: 'عمود كود العميل غير موجود',
    });
  if (nameIdx === -1 || amountIdx === -1 || dateIdx === -1) return { rows, errors, headers };

  const seen = new Set<string>();
  parsed.rows.forEach(({ rowIndex, record }) => {
    const rawName = cleanText(getValue(record, headers, NAME_KEYS));
    const grossAmount = parseAmount(getValue(record, headers, GROSS_AMOUNT_KEYS));
    const discountedAmount = parseAmount(getValue(record, headers, DISCOUNTED_AMOUNT_KEYS));
    const netAmount = parseAmount(getValue(record, headers, AMOUNT_KEYS));
    const discountAmount = parseAmount(getValue(record, headers, DISCOUNT_AMOUNT_KEYS));
    const courierCash = parseAmount(getValue(record, headers, COURIER_CASH_KEYS));
    const extraFees = parseAmount(getValue(record, headers, EXTRA_FEES_KEYS));
    const lineItemsCount = parseAmount(getValue(record, headers, ITEMS_COUNT_KEYS));
    const amount = netAmount ?? discountedAmount ?? grossAmount;
    const invoiceDateTime = parseDateTime(getValue(record, headers, DATE_KEYS));
    const date = invoiceDateTime ? invoiceDateTime.slice(0, 10) : null;
    const customerCode = cleanText(getValue(record, headers, CODE_KEYS));
    const phone = normalisePhone(getValue(record, headers, PHONE_KEYS) as string);
    const invoiceNumber = cleanText(getValue(record, headers, INVOICE_NUMBER_KEYS));
    const rawBranch = cleanText(getValue(record, headers, BRANCH_KEYS));
    const invoiceStatus = cleanText(record['النوع'] || '');
    const closeDateTime = invoiceDateTime
      ? parseCloseDateTime(getValue(record, headers, CLOSE_TIME_KEYS), invoiceDateTime)
      : null;
    const analysisDateTime = closeDateTime || invoiceDateTime;

    const isUnmatchedCustomer = !rawName || rawName === '.' || rawName === '*';
    const name = isUnmatchedCustomer ? 'عميل غير مسجل' : rawName;
    const normalizedAmount = amount ?? 0;
    if (amount === null && !(invoiceNumber || customerCode || rawName || date)) return;
    if (normalizedAmount < 0) {
      errors.push({
        row: rowIndex,
        field: 'قيمة الفاتورة',
        message: `قيمة فاتورة سالبة في الصف ${rowIndex}`,
      });
      return;
    }
    if (!date) {
      errors.push({
        row: rowIndex,
        field: 'التاريخ',
        message: `تاريخ غير صحيح في الصف ${rowIndex}`,
      });
      return;
    }
    if (!invoiceNumber) {
      errors.push({
        row: rowIndex,
        field: 'رقم الفاتورة',
        message: `رقم الفاتورة غير موجود في الصف ${rowIndex}`,
      });
      return;
    }
    // Import the invoice even when the old file has no customer code/phone.
    // It will be marked for review later, and customer matching can still use the name as a fallback.
    if (!customerCode && !isValidPhone(phone) && !name) return;

    const uniqueKey =
      invoiceNumber || customerCode || phone
        ? `${invoiceNumber || customerCode || phone}-${date}-${normalizedAmount}`
        : `row-${rowIndex}-${date}-${normalizedAmount}`;
    if (seen.has(uniqueKey)) {
      errors.push({
        row: rowIndex,
        field: 'تكرار',
        message: `فاتورة مكررة داخل الملف في الصف ${rowIndex}`,
      });
      return;
    }
    seen.add(uniqueKey);

    rows.push({
      rowIndex,
      invoiceNumber,
      customerCode: isUnmatchedCustomer ? '' : customerCode,
      name,
      phone: !isUnmatchedCustomer && isValidPhone(phone) ? phone : '',
      amount: normalizedAmount,
      grossAmount,
      discountedAmount,
      netAmount: normalizedAmount,
      discountAmount,
      courierCash,
      extraFees,
      lineItemsCount,
      date,
      invoiceDateTime: invoiceDateTime || `${date}T00:00:00.000Z`,
      closeDateTime,
      analysisDateTime: analysisDateTime || `${date}T00:00:00.000Z`,
      branch: normalizeBranch(rawBranch, fallbackBranch),
      invoiceType: cleanText(getValue(record, headers, INVOICE_TYPE_KEYS)),
      seller: cleanText(getValue(record, headers, SELLER_KEYS)),
      closeTime: closeDateTime,
      deliveryStaff: cleanText(getValue(record, headers, DELIVERY_KEYS)),
      specialty: cleanText(getValue(record, headers, SPECIALTY_KEYS)),
      clinic: cleanText(getValue(record, headers, CLINIC_KEYS)),
      deliveryAddress: cleanText(getValue(record, headers, DELIVERY_ADDRESS_KEYS)),
      notes: cleanText(getValue(record, headers, NOTES_KEYS)),
      saveStatus: cleanText(getValue(record, headers, SAVE_STATUS_KEYS)),
      deviceName: cleanText(getValue(record, headers, DEVICE_KEYS)),
      customerLinkStatus: isUnmatchedCustomer ? 'unmatched_customer' : 'matched_by_file',
      importValidationStatus: normalizedAmount === 0 ? 'zero_amount' : 'valid',
      importWarning: isUnmatchedCustomer
        ? 'عميل غير مسجل في الملف'
        : normalizedAmount === 0
          ? 'فاتورة صافيها صفر وتحتاج مراجعة'
          : null,
      raw: {
        ...record,
        invoice_datetime: invoiceDateTime,
        close_datetime: closeDateTime,
        analysis_datetime: analysisDateTime,
        items_count: lineItemsCount,
        replacement_items_count: getValue(record, headers, REPLACEMENT_ITEMS_COUNT_KEYS),
        gross_amount: getValue(record, headers, GROSS_AMOUNT_KEYS),
        discounted_amount: getValue(record, headers, DISCOUNTED_AMOUNT_KEYS),
        returns_amount: getValue(record, headers, RETURNS_AMOUNT_KEYS),
        discount_rate: getValue(record, headers, DISCOUNT_RATE_KEYS),
        discount_amount: getValue(record, headers, DISCOUNT_AMOUNT_KEYS),
        courier_cash: getValue(record, headers, COURIER_CASH_KEYS),
        clinic: getValue(record, headers, CLINIC_KEYS),
        extra_fees: getValue(record, headers, EXTRA_FEES_KEYS),
        delivery_address: getValue(record, headers, DELIVERY_ADDRESS_KEYS),
        notes: getValue(record, headers, NOTES_KEYS),
        save_status: getValue(record, headers, SAVE_STATUS_KEYS),
        device_name: getValue(record, headers, DEVICE_KEYS),
      },
    });
  });

  return { rows, errors, headers };
}

export function parseCustomerFile(buffer: ArrayBuffer, _fileName: string): CustomerParseResult {
  const rows: RawCustomerRow[] = [];
  const errors: ValidationError[] = [];

  let parsed: ReturnType<typeof rowsFromWorkbook>;
  try {
    parsed = rowsFromWorkbook(buffer, CUSTOMER_HEADER_MARKERS);
  } catch (error) {
    return {
      rows,
      errors: [
        {
          row: 0,
          field: 'الملف',
          message: `تعذر قراءة الملف: ${(error as Error).message}`,
        },
      ],
      headers: [],
    };
  }

  const { headers } = parsed;
  const codeIdx = findColumn(headers, CODE_KEYS);
  const nameIdx = findColumn(headers, NAME_KEYS);
  const mobileIdx = findColumn(headers, ['موبايل', 'mobile']);
  const telIdx = findColumn(headers, ['تليفون', 'telephone', 'phone']);
  const addressIdx = findColumn(headers, ['العنوان', 'address']);

  if (codeIdx === -1) errors.push({ row: 0, field: 'الكود', message: 'عمود الكود غير موجود' });
  if (nameIdx === -1)
    errors.push({
      row: 0,
      field: 'اسم العميل',
      message: 'عمود اسم العميل غير موجود',
    });
  if (codeIdx === -1 || nameIdx === -1) return { rows, errors, headers };

  const seen = new Set<string>();
  parsed.rows.forEach(({ rowIndex, record }) => {
    const code = cleanText(record[headers[codeIdx]]);
    const name = cleanText(record[headers[nameIdx]]).replace(/^\*/, '').trim();
    const mobile = mobileIdx === -1 ? '' : cleanText(record[headers[mobileIdx]]);
    const telephone = telIdx === -1 ? '' : cleanText(record[headers[telIdx]]);
    const address = addressIdx === -1 ? '' : cleanText(record[headers[addressIdx]]);
    const phone = [telephone, mobile].map(normalisePhone).find(isValidPhone) || '';

    if (!code || !name || name === '.' || name === '*') return;
    if (seen.has(code)) return;
    seen.add(code);

    rows.push({
      rowIndex,
      code,
      name,
      phone,
      mobile,
      telephone,
      address,
      raw: record,
    });
  });

  return { rows, errors, headers };
}

export async function importCustomersToDB(
  rows: RawCustomerRow[],
  importBatch: string
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    totalRows: rows.length,
    validRows: rows.length,
    insertedRows: 0,
    confirmedExistingInvoices: 0,
    skippedDuplicates: 0,
    errors: [],
    updatedCustomers: 0,
    newCustomers: 0,
    importBatch,
    needsReviewRows: 0,
    unlinkedCustomersEstimate: 0,
    rejectedRows: 0,
    summaryRefreshStatus: 'unavailable',
    summaryRefreshMessage: 'لم يبدأ تحديث العملاء بعد.',
  };

  const safeImportRows = rows.map((row) => ({
    final_customer_key: row.code || row.phone || row.mobile || row.telephone,
    customer_code: row.code || null,
    customer_name: row.name || null,
    new_phone: row.telephone || row.phone || row.mobile || null,
    new_whatsapp_phone: row.mobile || row.phone || row.telephone || null,
    phone_alt: row.phone || row.mobile || row.telephone || null,
    address: row.address || null,
    source_row: row.rowIndex,
    import_batch: importBatch,
  }));

  const uniqueCustomerCodes = Array.from(
    new Set(rows.map((row) => String(row.code || '').trim()).filter(Boolean))
  );

  if (safeImportRows.length) {
    for (const chunk of chunkArray(safeImportRows, 500)) {
      const { data, error } = await supabase.rpc('safe_daily_customer_import_from_json', {
        p_rows: chunk,
        p_apply: true,
      });

      if (error) {
        summary.errors.push({
          row: Number(chunk[0]?.source_row || 0),
          field: 'استيراد العملاء الآمن',
          message: friendlyImportError(error.message || 'تعذر تشغيل الاستيراد الآمن للعملاء.'),
        });
        summary.needsReviewRows += chunk.length;
        continue;
      }

      const result = (data || {}) as Record<string, unknown>;
      const inserted = Number(result.insertedCustomers || result.inserted_customers || 0);
      const updated = Number(result.customersUpdated || result.customers_updated || 0);
      const unchanged = Number(result.unchangedCustomers || result.unchanged_customers || 0);
      summary.insertedRows += inserted;
      summary.newCustomers += inserted;
      summary.updatedCustomers += updated;
      summary.skippedDuplicates += Math.max(0, unchanged);
      summary.needsReviewRows += Number(result.needsReviewRows || result.needs_review_rows || 0);
      summary.rejectedRows =
        Number(summary.rejectedRows || 0) +
        Number(result.invalidPhones || result.invalid_phones || 0);
    }

    if (uniqueCustomerCodes.length) {
      try {
        let generatedTasks = 0;
        for (const codeChunk of chunkArray(uniqueCustomerCodes, 500)) {
          const { data, error } = await supabase.rpc('generate_customer_welcome_tasks_for_codes', {
            p_customer_codes: codeChunk,
          });
          if (error) {
            const fallback = await supabase.rpc('generate_customer_welcome_tasks_v6', {
              p_target_date: new Date().toISOString().slice(0, 10),
            });
            if (fallback.error) throw error;
            generatedTasks += Number(fallback.data || 0);
          } else {
            generatedTasks += Number(data || 0);
          }
        }
        summary.summaryRefreshMessage = `تم تحديث العملاء بأمان، وتم إنشاء ${generatedTasks.toLocaleString('ar-EG')} مهمة ترحيب جديدة للعملاء الجدد/المحدثين.`;
      } catch (error) {
        summary.schemaWarnings = [
          ...(summary.schemaWarnings || []),
          'تعذر إنشاء مهام الرسائل الترحيبية تلقائيًا. تأكد من تشغيل migration generate_customer_welcome_tasks_for_codes.',
        ];
        summary.summaryRefreshMessage =
          'تم تحديث العملاء، وتعذر إنشاء بعض مهام الرسائل الترحيبية تلقائيًا.';
      }
    }

    const refresh = await supabase.rpc('rebuild_customer_metrics_summary');
    summary.summaryRefreshStatus = refresh.error ? 'unavailable' : 'refreshed';
    if (refresh.error && !summary.summaryRefreshMessage) {
      summary.summaryRefreshMessage = 'تم تحديث العملاء، وتعذر تحديث ملخص العملاء الآن.';
    }

    clearCustomersCache();
    clearCustomerServiceCommandCenterCache();
    clearCustomerProfileCache();
    clearExecutiveDashboardCache();
    clearSalesAnalyticsSummaryCache();
    clearStaffPerformanceProfileCache();
    try {
      window.localStorage.setItem('dawaa_invoice_import_refresh', String(Date.now()));
    } catch {
      // Ignore non-browser contexts.
    }

    if (summary.errors.length === 0) return summary;
  }

  const analysisPayloads = rows.map((row) => {
    const identifier = row.phone || `code:${row.code}`;
    return {
      customer_code: row.code,
      name: row.name,
      phone: identifier,
      branch: 'غير محدد',
      total_invoices: 0,
      total_spent: 0,
      avg_monthly: 0,
      segment: 'عادي',
      status: 'جديد',
      priority: 'عادي',
    };
  });

  for (const chunk of chunkArray(analysisPayloads, 500)) {
    const { error } = await supabase
      .from('customer_analysis')
      .upsert(chunk, { onConflict: 'customer_code' });

    if (error)
      summary.errors.push({
        row: 0,
        field: 'تحليل العملاء',
        message: error.message,
      });
    else {
      summary.insertedRows += chunk.length;
      summary.updatedCustomers += chunk.length;
    }
  }

  return summary;

  for (const row of rows) {
    const identifier = row.phone || `code:${row.code}`;
    const customerPayload = {
      name: row.name,
      phone: identifier,
      total_spent: 0,
      segment: 'عادي',
    };

    const { data: existingByPhone } = await supabase
      .from('customers')
      .select('id')
      .eq('phone', identifier)
      .maybeSingle();
    if (existingByPhone?.id) {
      const { error } = await supabase
        .from('customers')
        .update(customerPayload)
        .eq('id', existingByPhone.id);
      if (error)
        summary.errors.push({
          row: row.rowIndex,
          field: 'Supabase',
          message: error.message,
        });
      else summary.updatedCustomers++;
    } else {
      const { error } = await supabase.from('customers').insert(customerPayload);
      if (error)
        summary.errors.push({
          row: row.rowIndex,
          field: 'Supabase',
          message: error.message,
        });
      else {
        summary.insertedRows++;
        summary.newCustomers++;
      }
    }

    const branch =
      row.name.includes('ش') || row.address.includes('شام') ? 'فرع الشامي' : 'فرع شكري';
    const analysisPayload = {
      customer_code: row.code,
      name: row.name,
      phone: identifier,
      branch,
      total_invoices: 0,
      total_spent: 0,
      avg_monthly: 0,
      segment: 'عادي',
      status: 'جديد',
      priority: 'عادي',
    };

    const { data: existingAnalysis } = await supabase
      .from('customer_analysis')
      .select('customer_code')
      .eq('customer_code', row.code)
      .maybeSingle();

    if (existingAnalysis?.customer_code) {
      await supabase
        .from('customer_analysis')
        .update(analysisPayload)
        .eq('customer_code', row.code);
    } else {
      await supabase.from('customer_analysis').insert(analysisPayload);
    }
  }

  return summary;
}

interface CustomerRecord {
  id: string;
  phone: string;
  name: string;
  total_purchases?: number;
  total_invoices?: number;
  first_purchase?: string | null;
  last_purchase?: string | null;
  branch?: string;
}

interface CustomerAnalysisRecord {
  id?: string;
  customer_code?: string | null;
  [key: string]: unknown;
}

type SalesInvoiceForAnalysis = {
  customer_code?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  branch?: string | null;
  invoice_date?: string | null;
  amount?: number | null;
  seller_name?: string | null;
};

function customerKeyFromInvoice(row: { customerCode?: string; phone?: string }) {
  return row.customerCode || safeIdentifier(row.phone || '', row.customerCode || '');
}

function mergeInvoiceRows(rows: SalesInvoiceForAnalysis[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = [
      row.branch || '',
      row.customer_code || '',
      row.customer_phone || '',
      row.invoice_date || '',
      row.amount || 0,
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * إعادة بناء تحليل العملاء من جدول sales_invoices للعميل/العملاء المتأثرين بالاستيراد.
 * هذا يمنع بقاء آخر شراء أو إجمالي الفواتير قديمًا بعد رفع ملف مبيعات جديد.
 */
async function refreshCustomerAnalysisForImportedRows(
  rows: RawInvoiceRow[],
  fallbackBranch: string,
  summary: ImportSummary
) {
  void rows;
  void fallbackBranch;
  summary.summaryRefreshStatus = summary.summaryRefreshStatus || 'unavailable';
  summary.summaryRefreshMessage =
    summary.summaryRefreshMessage ||
    'تم الاستيراد، ويلزم تحديث الملخصات قبل الاعتماد على الداشبورد';
  return;

  const affectedCodes = Array.from(new Set(rows.map((row) => row.customerCode).filter(Boolean)));
  const affectedPhones = Array.from(new Set(rows.map((row) => row.phone).filter(Boolean)));
  if (affectedCodes.length === 0 && affectedPhones.length === 0) return;

  const invoiceRows: SalesInvoiceForAnalysis[] = [];

  for (const chunk of chunkArray(affectedCodes, 250)) {
    const { data, error } = await supabase
      .from('sales_invoices')
      .select('customer_code,customer_name,customer_phone,branch,invoice_date,amount,seller_name')
      .in('customer_code', chunk);
    if (error) {
      summary.errors.push({ row: 0, field: 'مزامنة تحليل العملاء', message: error.message });
    } else {
      invoiceRows.push(...((data || []) as SalesInvoiceForAnalysis[]));
    }
  }

  for (const chunk of chunkArray(affectedPhones, 250)) {
    const { data, error } = await supabase
      .from('sales_invoices')
      .select('customer_code,customer_name,customer_phone,branch,invoice_date,amount,seller_name')
      .in('customer_phone', chunk);
    if (error) {
      summary.errors.push({ row: 0, field: 'مزامنة تحليل العملاء', message: error.message });
    } else {
      invoiceRows.push(...((data || []) as SalesInvoiceForAnalysis[]));
    }
  }

  const grouped = new Map<
    string,
    {
      name: string;
      phone: string;
      total: number;
      count: number;
      branch: string;
      branchTotals: Record<string, number>;
      dates: string[];
    }
  >();

  for (const row of mergeInvoiceRows(invoiceRows)) {
    const identifier = row.customer_code || safeIdentifier(row.customer_phone || '', '');
    if (!identifier) continue;
    const amount = Number(row.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const date = String(row.invoice_date || '').slice(0, 10);
    if (!date) continue;
    const rowBranch = normalizeBranch(String(row.branch || ''), fallbackBranch);
    const current = grouped.get(identifier);
    if (current) {
      current.total += amount;
      current.count += 1;
      current.dates.push(date);
      current.branchTotals[rowBranch] = (current.branchTotals[rowBranch] || 0) + amount;
      current.branch =
        Object.entries(current.branchTotals).sort((a, b) => b[1] - a[1])[0]?.[0] || current.branch;
      if (!current.phone && row.customer_phone) current.phone = row.customer_phone;
      if (!current.name && row.customer_name) current.name = row.customer_name;
    } else {
      grouped.set(identifier, {
        name: row.customer_name || 'عميل بدون اسم',
        phone: row.customer_phone || `code:${identifier}`,
        total: amount,
        count: 1,
        branch: rowBranch,
        branchTotals: { [rowBranch]: amount },
        dates: [date],
      });
    }
  }

  if (grouped.size === 0) return;

  const existingAnalysisRows: CustomerAnalysisRecord[] = [];
  const identifiers = Array.from(grouped.keys());
  for (const chunk of chunkArray(identifiers, 250)) {
    const { data, error } = await supabase
      .from('customer_analysis')
      .select('*')
      .in('customer_code', chunk);
    if (error) {
      summary.errors.push({ row: 0, field: 'قراءة تحليل العملاء', message: error.message });
    } else {
      existingAnalysisRows.push(...((data || []) as CustomerAnalysisRecord[]));
    }
  }

  const analysisMap = new Map<string, CustomerAnalysisRecord>(
    existingAnalysisRows.map((row) => [String(row.customer_code), row])
  );

  for (const [identifier, group] of grouped) {
    const firstPurchase = group.dates.filter(Boolean).sort()[0] || null;
    const lastPurchase = group.dates.filter(Boolean).sort().pop() || null;
    const monthsActive =
      firstPurchase && lastPurchase
        ? Math.max(
            1,
            Math.ceil(
              (new Date(String(lastPurchase)).getTime() -
                new Date(String(firstPurchase)).getTime()) /
                (30 * 86400000)
            )
          )
        : 1;
    const avgMonthly = Math.round(group.total / monthsActive);
    const avgInvoice = Math.round(group.total / Math.max(1, group.count));
    const type = classifyByAvg(avgMonthly);
    const retentionStatus = calcRetentionStatus(lastPurchase);
    const analysisPayload = {
      customer_code: identifier,
      name: group.name,
      phone: group.phone || `code:${identifier}`,
      branch: group.branch,
      segment: type,
      status: retentionStatus,
      priority: type === 'مهم جدًا' ? 'عالية' : type === 'مهم' ? 'متوسطة' : 'عادي',
      total_spent: group.total,
      total_invoices: group.count,
      avg_monthly: avgMonthly,
      avg_invoice: avgInvoice,
      days_inactive: lastPurchase
        ? Math.floor((Date.now() - new Date(String(lastPurchase)).getTime()) / 86400000)
        : null,
      first_purchase: firstPurchase,
      last_purchase: lastPurchase,
      updated_at: new Date().toISOString(),
    };

    const existing = analysisMap.get(identifier);
    if (existing?.id) {
      const { error } = await supabase
        .from('customer_analysis')
        .update(analysisPayload)
        .eq('id', existing.id);
      if (error)
        summary.errors.push({ row: 0, field: 'تحديث تحليل العملاء', message: error.message });
    } else if (existing?.customer_code) {
      const { error } = await supabase
        .from('customer_analysis')
        .update(analysisPayload)
        .eq('customer_code', identifier);
      if (error)
        summary.errors.push({ row: 0, field: 'تحديث تحليل العملاء', message: error.message });
    } else {
      const { error } = await supabase.from('customer_analysis').insert(analysisPayload);
      if (error)
        summary.errors.push({ row: 0, field: 'إضافة تحليل العملاء', message: error.message });
      else summary.newCustomers++;
    }
  }
}

async function linkSellerToStaffId(sellerName: string, branch: string): Promise<string | null> {
  if (!sellerName) return null;

  // استخدام staffIdentityMapping لربط اسم البائع بـ staff_id
  const staffId = await resolveStaffNameToStaffId(sellerName);
  if (staffId) return staffId;

  // الرجوع للطريقة القديمة إذا لم يتم العثور على الربط
  const normalizedSeller = normalizeName(sellerName);

  // محاولة العثور على الموظف بالاسم المباشر
  const { data: staffByName } = await supabase
    .from('staff')
    .select('id')
    .eq('name', sellerName)
    .maybeSingle();

  if (staffByName?.id) return staffByName.id;

  // محاولة العثور على الموظف بالاسم المُطابق
  const { data: allStaff } = await supabase
    .from('staff')
    .select('id, name')
    .eq('branch', branch)
    .limit(500);

  if (allStaff) {
    for (const staff of allStaff) {
      const normalizedStaffName = normalizeName(staff.name);
      if (normalizedStaffName === normalizedSeller) {
        return staff.id;
      }
    }
  }

  return null;
}

async function refreshImportSummaries(summary: ImportSummary) {
  invalidateInvoiceCache();
  clearExecutiveDashboardCache();
  clearSalesAnalyticsSummaryCache();
  clearCustomersCache();
  clearCustomerServiceCommandCenterCache();
  clearCustomerProfileCache();
  clearStaffPerformanceProfileCache();
  broadcastInvoiceImportRefresh();

  summary.postImportRefreshSteps = [
    {
      key: 'summary_refresh_disabled',
      label: 'ملخصات المبيعات',
      status: 'skipped',
      message: 'تحديث الملخصات غير مفعل حاليًا، سيتم الاعتماد على الفواتير المباشرة.',
    },
  ];
  summary.summaryRefreshStatus = 'unavailable';
  summary.summaryRefreshMessage =
    'تحديث الملخصات غير مفعل حاليًا، سيتم الاعتماد على الفواتير المباشرة.';
}

async function persistInvoiceImportBatch(_summary: ImportSummary, _status: string, _errorMessage?: string | null) {
  // لا نستخدم جداول batches جديدة الآن. الاستيراد يعتمد على sales_invoices فقط.
  return;
}

export async function importInvoicesToDB(
  rows: RawInvoiceRow[],
  branch: string,
  importBatch: string,
  onProgress?: (done: number, total: number) => void,
  options?: { fileName?: string | null; importedBy?: string | null; importedAt?: string | null }
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    totalRows: rows.length,
    validRows: rows.length,
    insertedRows: 0,
    confirmedExistingInvoices: 0,
    skippedDuplicates: 0,
    errors: [],
    updatedCustomers: 0,
    newCustomers: 0,
    importBatch,
    needsReviewRows: 0,
    unlinkedCustomersEstimate: 0,
    skippedDuplicateInvoices: [],
    schemaWarnings: [],
    valueChangedUpdates: 0,
    staffLinkingMode: 'name_fallback',
    firstInvoiceDate:
      rows
        .map((row) => row.date)
        .filter(Boolean)
        .sort()[0] || null,
    lastInvoiceDate:
      rows
        .map((row) => row.date)
        .filter(Boolean)
        .sort()
        .pop() || null,
    fileName: options?.fileName || null,
    importedBy: options?.importedBy || null,
    importedAt: options?.importedAt || new Date().toISOString(),
    fileNetSales: rows.reduce((sum, row) => sum + rawInvoiceNetValue(row), 0),
    importedNetSales: 0,
    insertedNetSales: 0,
    updatedNetSales: 0,
    confirmedExistingNetSales: 0,
    processedNetSales: 0,
    savedNetSales: 0,
    reviewNetSales: 0,
  };
  if (rows.length === 0) {
    await persistInvoiceImportBatch(summary, 'imported');
    return summary;
  }

  const distinctInvoiceKeys = new Set(
    rows
      .filter((row) => row.invoiceNumber && row.date)
      .map((row) => invoiceDuplicateKey(row.invoiceNumber, row.branch || branch, row.date))
  );
  summary.distinctInvoicesInFile = distinctInvoiceKeys.size;
  summary.invoicesWithoutCustomer = rows.filter((row) => !row.customerCode && !row.phone).length;
  summary.invoicesWithoutDoctor = rows.filter((row) => !row.seller).length;
  summary.invoicesWithoutBranch = rows.filter((row) => !(row.branch || branch)).length;
  summary.unmatchedCustomerRows = rows.filter(
    (row) => row.customerLinkStatus === 'unmatched_customer'
  ).length;
  summary.zeroAmountRows = rows.filter((row) => row.importValidationStatus === 'zero_amount').length;

  // ربط seller_name بـ staff_id
  const staffIdMap = new Map<string, string | null>();
  const uniqueSellers = new Set(rows.map((r) => r.seller).filter(Boolean));

  for (const seller of uniqueSellers) {
    const staffId = await linkSellerToStaffId(seller, branch);
    staffIdMap.set(seller, staffId);
  }
  if ([...staffIdMap.values()].some(Boolean)) {
    summary.staffLinkingMode = 'staff_id';
  }

  const invoiceNumbers = Array.from(
    new Set(rows.map((row) => String(row.invoiceNumber || '').trim()).filter(Boolean))
  );

  const existingInvoices: Array<Record<string, unknown>> = [];
  const existingSelect =
    'id, branch, invoice_no, invoice_number, invoice_date, amount, net_amount, discounted_amount, gross_amount, customer_code, customer_name, customer_phone, seller_name, save_status, invoice_type';

  for (const numberChunk of chunkArray(invoiceNumbers, 500)) {
    const seenExistingIds = new Set(
      existingInvoices.map((row) => String(row.id || '')).filter(Boolean)
    );

    const byInvoiceNumber = await supabase
      .from('sales_invoices')
      .select(existingSelect)
      .in('invoice_number', numberChunk)
      .limit(50000);

    if (!byInvoiceNumber.error) {
      for (const row of (byInvoiceNumber.data || []) as Record<string, unknown>[]) {
        const id = String(row.id || '');
        if (id && seenExistingIds.has(id)) continue;
        if (id) seenExistingIds.add(id);
        existingInvoices.push(row);
      }
    } else if (import.meta.env.DEV) {
      console.warn('[invoiceImporter] invoice_number lookup failed', byInvoiceNumber.error);
    }

    const byInvoiceNo = await supabase
      .from('sales_invoices')
      .select(existingSelect)
      .in('invoice_no', numberChunk)
      .limit(50000);

    if (!byInvoiceNo.error) {
      for (const row of (byInvoiceNo.data || []) as Record<string, unknown>[]) {
        const id = String(row.id || '');
        if (id && seenExistingIds.has(id)) continue;
        if (id) seenExistingIds.add(id);
        existingInvoices.push(row);
      }
    } else if (byInvoiceNumber.error) {
      summary.errors.push({
        row: 0,
        field: 'فحص التكرار',
        message: friendlyImportError(byInvoiceNo.error.message || byInvoiceNumber.error.message),
      });
      break;
    }
  }

  const existingByInvoiceNumber = new Map<string, Array<Record<string, unknown>>>();
  for (const invoice of existingInvoices) {
    const number = getInvoiceKey(invoice as Record<string, unknown>);
    if (!number) continue;
    const key = String(number).trim();
    const list = existingByInvoiceNumber.get(key) || [];
    list.push(invoice);
    existingByInvoiceNumber.set(key, list);
  }

  const existingUpdateRecords: Array<{
    id: string;
    record: Record<string, unknown>;
    sourceRow: RawInvoiceRow;
    rowNumber: number;
  }> = [];
  const savedSummaryRows: RawInvoiceRow[] = [];
  let needsReviewRows = 0;
  let reviewNetSales = 0;
  let unlinkedCustomersEstimate = 0;
  const seenImportKeys = new Set<string>();

  const newRows = rows.filter((row) => {
    const rowBranch = row.branch || branch;
    const dedupeKey = invoiceDuplicateKey(row.invoiceNumber, rowBranch, row.date);
    if (seenImportKeys.has(dedupeKey)) {
      summary.skippedDuplicates++;
      summary.skippedDuplicateInvoices?.push({
        invoiceNumber: row.invoiceNumber,
        branch: rowBranch,
        date: row.date,
      });
      return false;
    }
    seenImportKeys.add(dedupeKey);

    const matches = row.invoiceNumber
      ? existingByInvoiceNumber.get(String(row.invoiceNumber).trim()) || []
      : [];

    if (matches.length > 0) {
      const sameBranchAndDate = matches.find((existing) => {
        const existingBranch = normalizeComparableBranch(existing.branch, branch);
        const incomingBranch = normalizeComparableBranch(rowBranch, branch);
        return sameDateOnly(existing.invoice_date, row.date) && existingBranch === incomingBranch;
      });

      if (sameBranchAndDate) {
        const recordForUpdate: Record<string, unknown> = {
          import_batch: importBatch,
          branch: rowBranch,
          invoice_no: row.invoiceNumber,
          invoice_number: row.invoiceNumber,
          invoice_type: row.invoiceType,
          customer_code:
            row.customerLinkStatus === 'unmatched_customer' ? null : row.customerCode || null,
          customer_name: row.name,
          customer_phone:
            row.customerLinkStatus === 'unmatched_customer' ? null : row.phone || null,
          invoice_date: row.date,
          sale_date: row.date,
          invoice_datetime: row.invoiceDateTime,
          close_datetime: row.closeDateTime,
          analysis_datetime: row.analysisDateTime,
          amount: row.amount,
          total_amount: row.netAmount ?? row.discountedAmount ?? row.amount,
          gross_amount: row.grossAmount,
          gross_total: row.grossAmount,
          discounted_amount: row.discountedAmount,
          net_amount: row.netAmount,
          net_total: row.netAmount,
          discount_amount: row.discountAmount,
          courier_cash: row.courierCash,
          extra_fees: row.extraFees,
          line_items_count: row.lineItemsCount,
          seller_name: row.seller,
          normalized_seller_name: normalizeName(row.seller),
          staff_name: row.seller,
          staff_id: staffIdMap.get(row.seller) || null,
          close_time: row.closeTime || null,
          shift_name: getShiftFromDateTime(row.analysisDateTime),
          delivery_staff: row.deliveryStaff,
          specialty: row.specialty,
          clinic: row.clinic,
          delivery_address: row.deliveryAddress,
          notes: row.notes,
          save_status: row.saveStatus,
          device_name: row.deviceName,
          customer_link_status: row.customerLinkStatus,
          import_validation_status: row.importValidationStatus,
          import_warning: row.importWarning,
          source_row_number: row.rowIndex,
          raw_data: row.raw,
          branch_name: rowBranch,
        };

        const existingValue = existingInvoiceValue(sameBranchAndDate);
        const incomingValue = rawInvoiceNetValue(row);
        summary.confirmedExistingInvoices = (summary.confirmedExistingInvoices || 0) + 1;
        summary.confirmedExistingNetSales = (summary.confirmedExistingNetSales || 0) + incomingValue;
        if (Math.abs(existingValue - incomingValue) >= 0.01) {
          summary.valueChangedUpdates = (summary.valueChangedUpdates || 0) + 1;
        }

        const existingId = String(sameBranchAndDate.id || '');
        if (existingId) {
          existingUpdateRecords.push({
            id: existingId,
            record: recordForUpdate,
            sourceRow: row,
            rowNumber: row.rowIndex,
          });
        } else {
          summary.skippedDuplicates++;
        }
        return false;
      }

      needsReviewRows++;
      reviewNetSales += rawInvoiceNetValue(row);
      summary.conflictReviewRows = (summary.conflictReviewRows || 0) + 1;
      summary.schemaWarnings?.push(
        `الفاتورة ${row.invoiceNumber} موجودة سابقًا برقم مطابق لكن بتاريخ أو فرع مختلف؛ لم يتم إدخالها لتجنب التكرار وتحتاج مراجعة.`
      );
      summary.skippedDuplicates++;
      summary.skippedDuplicateInvoices?.push({
        invoiceNumber: row.invoiceNumber,
        branch: rowBranch,
        date: row.date,
      });
      return false;
    }

    if (!row.customerCode && !row.phone) {
      needsReviewRows++;
      reviewNetSales += rawInvoiceNetValue(row);
      unlinkedCustomersEstimate++;
    }
    return true;
  });

  summary.needsReviewRows = needsReviewRows;
  summary.reviewNetSales = reviewNetSales;
  summary.unlinkedCustomersEstimate = unlinkedCustomersEstimate;

  const invoiceRecords = newRows.map((row) => ({
    import_batch: importBatch,
    branch: row.branch || branch,
    invoice_no: row.invoiceNumber,
    invoice_number: row.invoiceNumber,
    invoice_type: row.invoiceType,
    customer_code:
      row.customerLinkStatus === 'unmatched_customer' ? null : row.customerCode || null,
    customer_name: row.name,
    customer_phone: row.customerLinkStatus === 'unmatched_customer' ? null : row.phone || null,
    invoice_date: row.date,
    sale_date: row.date,
    invoice_datetime: row.invoiceDateTime,
    close_datetime: row.closeDateTime,
    analysis_datetime: row.analysisDateTime,
    amount: row.amount,
    total_amount: row.netAmount ?? row.discountedAmount ?? row.amount,
    gross_amount: row.grossAmount,
    gross_total: row.grossAmount,
    discounted_amount: row.discountedAmount,
    net_amount: row.netAmount,
    net_total: row.netAmount,
    discount_amount: row.discountAmount,
    courier_cash: row.courierCash,
    extra_fees: row.extraFees,
    line_items_count: row.lineItemsCount,
    seller_name: row.seller,
    normalized_seller_name: normalizeName(row.seller),
    staff_name: row.seller,
    staff_id: staffIdMap.get(row.seller) || null,
    close_time: row.closeTime || null,
    shift_name: getShiftFromDateTime(row.analysisDateTime),
    delivery_staff: row.deliveryStaff,
    specialty: row.specialty,
    clinic: row.clinic,
    delivery_address: row.deliveryAddress,
    notes: row.notes,
    save_status: row.saveStatus,
    device_name: row.deviceName,
    customer_link_status: row.customerLinkStatus,
    import_validation_status: row.importValidationStatus,
    import_warning: row.importWarning,
    source_row_number: row.rowIndex,
    raw_data: row.raw,
    branch_name: row.branch || branch,
  }));

  const chunkSize = 500;
  const totalWork = invoiceRecords.length + existingUpdateRecords.length + newRows.length;
  const optionalColumnsRemoved = new Set<string>();
  for (let i = 0; i < invoiceRecords.length; i += chunkSize) {
    const chunk = invoiceRecords.slice(i, i + chunkSize) as Array<Record<string, unknown>>;
    const { error, removedColumns } = await insertRowsWithOptionalColumns('sales_invoices', chunk);
    removedColumns.forEach((column) => optionalColumnsRemoved.add(column));
    if (error) {
      const isDuplicateError =
        error.message.includes('unique constraint') ||
        error.message.includes('duplicate key') ||
        error.message.includes('ON CONFLICT');
      if (isDuplicateError && chunk.length > 1) {
        for (const record of chunk) {
          const single = await insertRowsWithOptionalColumns('sales_invoices', [record]);
          single.removedColumns.forEach((column) => optionalColumnsRemoved.add(column));
          if (single.error) {
            const singleDuplicate =
              single.error.message.includes('unique constraint') ||
              single.error.message.includes('duplicate key') ||
              single.error.message.includes('ON CONFLICT');
            if (singleDuplicate) {
              summary.skippedDuplicates++;
              summary.skippedDuplicateInvoices?.push({
                invoiceNumber: String(record.invoice_number || ''),
                branch: String(record.branch || branch),
                date: String(record.invoice_date || '').slice(0, 10),
              });
            } else {
              summary.errors.push({
                row: Number(record.source_row_number || 0),
                field: 'sales_invoices',
                message: friendlyImportError(single.error.message),
              });
            }
          } else {
            summary.insertedRows += 1;
            const value = invoiceNetValue(record);
            summary.insertedNetSales = (summary.insertedNetSales || 0) + value;
            summary.importedNetSales = (summary.importedNetSales || 0) + value;
            const sourceRow = newRows.find(
              (row) =>
                row.invoiceNumber === String(record.invoice_number || '') &&
                row.date === String(record.invoice_date || '').slice(0, 10) &&
                normalizeComparableBranch(row.branch || branch, branch) ===
                  normalizeComparableBranch(record.branch, branch)
            );
            if (sourceRow) savedSummaryRows.push(sourceRow);
          }
        }
        reportProgress(onProgress, Math.min(i + chunkSize, invoiceRecords.length), totalWork);
        continue;
      }
      if (isDuplicateError && chunk.length === 1) {
        const record = chunk[0];
        summary.skippedDuplicates++;
        summary.skippedDuplicateInvoices?.push({
          invoiceNumber: String(record.invoice_number || ''),
          branch: String(record.branch || branch),
          date: String(record.invoice_date || '').slice(0, 10),
        });
        reportProgress(onProgress, Math.min(i + chunkSize, invoiceRecords.length), totalWork);
        continue;
      }
      // Provide user-friendly error message
      const errorMsg = error.message.includes('out of range')
        ? 'خطأ في التاريخ أو الوقت في بعض الصفوف. تأكد من صحة التواريخ في ملف Excel.'
        : error.message.includes('unique constraint') || error.message.includes('ON CONFLICT')
          ? 'يوجد فواتير مكررة في قاعدة البيانات.'
          : friendlyImportError(error.message);
      summary.errors.push({
        row: i + 1,
        field: 'sales_invoices',
        message: errorMsg,
      });
    } else {
      summary.insertedRows += chunk.length;
      const chunkNet = chunk.reduce((sum, row) => sum + invoiceNetValue(row), 0);
      summary.insertedNetSales = (summary.insertedNetSales || 0) + chunkNet;
      summary.importedNetSales = (summary.importedNetSales || 0) + chunkNet;
      savedSummaryRows.push(...newRows.slice(i, i + chunk.length));
    }
    reportProgress(onProgress, Math.min(i + chunkSize, invoiceRecords.length), totalWork);
  }

  if (optionalColumnsRemoved.size > 0) {
    if (optionalColumnsRemoved.has('staff_id')) {
      summary.staffLinkingMode = 'name_fallback';
      summary.schemaWarnings?.push('staff_id غير متاح، يتم الربط مؤقتًا بالاسم بعد التطبيع');
    }
    const otherColumns = [...optionalColumnsRemoved].filter((column) => column !== 'staff_id');
    if (otherColumns.length > 0) {
      summary.schemaWarnings?.push(
        `تم الاستيراد بالحقول المتاحة، لكن أعمدة لم تظهر بعد في Supabase schema cache: ${otherColumns.join(', ')}. يفضّل تحديث schema cache بعد الترقية.`
      );
    }
    optionalColumnsRemoved.clear();
  }

  if (optionalColumnsRemoved.size > 0) {
    summary.errors.push({
      row: 0,
      field: 'sales_invoices',
      message: `تم الاستيراد، لكن أعمدة المتابعة التالية غير موجودة أو لم تظهر بعد في Supabase schema cache: ${[...optionalColumnsRemoved].join(', ')}. شغّل ملف الترقية ثم أعد تحميل الصفحة للاحتفاظ بهذه التفاصيل في الاستيرادات القادمة.`,
    });
  }

  let updatedInvoiceProgress = 0;
  for (const item of existingUpdateRecords) {
    const { error, removedColumns } = await updateRowWithOptionalColumns(
      'sales_invoices',
      item.id,
      item.record
    );
    removedColumns.forEach((column) => optionalColumnsRemoved.add(column));
    if (error) {
      summary.errors.push({
        row: item.rowNumber,
        field: 'تحديث فاتورة موجودة',
        message: friendlyImportError(error.message),
      });
    } else {
      summary.updatedInvoices = (summary.updatedInvoices || 0) + 1;
      const value = rawInvoiceNetValue(item.sourceRow);
      summary.updatedNetSales = (summary.updatedNetSales || 0) + value;
      summary.importedNetSales = (summary.importedNetSales || 0) + value;
      savedSummaryRows.push(item.sourceRow);
    }
    updatedInvoiceProgress += 1;
    reportProgress(onProgress, invoiceRecords.length + updatedInvoiceProgress, totalWork);
  }

  const grouped = new Map<
    string,
    {
      name: string;
      phone: string;
      total: number;
      count: number;
      branch: string;
      branchTotals: Record<string, number>;
      dates: string[];
    }
  >();
  for (const row of newRows) {
    if (row.customerLinkStatus === 'unmatched_customer') continue;
    const key = row.customerCode || safeIdentifier(row.phone, row.customerCode);
    if (!key) continue;
    const rowBranch = row.branch || branch;
    const current = grouped.get(key);
    if (current) {
      current.total += rawInvoiceNetValue(row);
      current.count += 1;
      current.dates.push(row.date);
      if (!current.phone && row.phone) current.phone = row.phone;
      current.branchTotals[rowBranch] = (current.branchTotals[rowBranch] || 0) + rawInvoiceNetValue(row);
      current.branch =
        Object.entries(current.branchTotals).sort((a, b) => b[1] - a[1])[0]?.[0] || current.branch;
    } else {
      grouped.set(key, {
        name: row.name,
        phone: row.phone,
        total: rawInvoiceNetValue(row),
        count: 1,
        branch: rowBranch,
        branchTotals: { [rowBranch]: rawInvoiceNetValue(row) },
        dates: [row.date],
      });
    }
  }

  const codes = [...grouped.keys()];
  const existingAnalysisRows: CustomerAnalysisRecord[] = [];
  for (const chunk of chunkArray(codes, 500)) {
    const { data, error } = await supabase
      .from('customer_analysis')
      .select('*')
      .in('customer_code', chunk);

    if (error) {
      summary.errors.push({
        row: 0,
        field: 'قراءة تحليل العملاء',
        message: error.message,
      });
      break;
    }

    existingAnalysisRows.push(...((data || []) as CustomerAnalysisRecord[]));
  }

  const analysisMap = new Map<string, CustomerAnalysisRecord>(
    (existingAnalysisRows || []).map((row) => [String(row.customer_code), row])
  );

  const analysisPayloads: Record<string, unknown>[] = [];

  for (const [identifier, group] of grouped) {
    const existing = analysisMap.get(identifier);
    const previousTotal = Number(existing?.total_spent || 0);
    const previousCount = Number(existing?.total_invoices || 0);
    const totalPurchases = previousTotal + group.total;
    const totalCount = previousCount + group.count;
    const firstPurchase =
      [existing?.first_purchase as string | null, ...group.dates].filter(Boolean).sort()[0] || null;
    const lastPurchase =
      [existing?.last_purchase as string | null, ...group.dates].filter(Boolean).sort().pop() ||
      null;
    const monthsActive =
      firstPurchase && lastPurchase
        ? Math.max(
            1,
            Math.ceil(
              (new Date(String(lastPurchase)).getTime() -
                new Date(String(firstPurchase)).getTime()) /
                (30 * 86400000)
            )
          )
        : 1;
    const avgMonthly = Math.round(totalPurchases / monthsActive);
    const avgInvoice = Math.round(totalPurchases / Math.max(1, totalCount));
    const type = classifyByAvg(avgMonthly);
    const retentionStatus = calcRetentionStatus(lastPurchase);
    const riskScore = lastPurchase
      ? Math.min(
          100,
          Math.max(
            0,
            Math.floor((Date.now() - new Date(String(lastPurchase)).getTime()) / 86400000) - 10
          ) * 2
        )
      : 100;

    const phone = group.phone || (existing?.phone as string | undefined) || `code:${identifier}`;
    const analysisPayload = {
      customer_code: identifier,
      name: group.name,
      phone,
      branch: group.branch,
      segment: type,
      status: retentionStatus,
      priority: type === 'مهم جدًا' ? 'عالية' : type === 'مهم' ? 'متوسطة' : 'عادي',
      total_spent: totalPurchases,
      total_invoices: totalCount,
      avg_monthly: avgMonthly,
      days_inactive: lastPurchase
        ? Math.floor((Date.now() - new Date(String(lastPurchase)).getTime()) / 86400000)
        : null,
      first_purchase: firstPurchase,
      last_purchase: lastPurchase,
    };

    analysisPayloads.push(analysisPayload);
    continue;

    if (existing?.customer_code) {
      const { error } = await supabase
        .from('customer_analysis')
        .update(analysisPayload)
        .eq('customer_code', identifier);
      if (error)
        summary.errors.push({
          row: 0,
          field: 'تحديث العملاء',
          message: error.message,
        });
      else summary.updatedCustomers++;
    } else {
      const { error } = await supabase.from('customer_analysis').insert(analysisPayload);
      if (error)
        summary.errors.push({
          row: 0,
          field: 'إضافة العملاء',
          message: error.message,
        });
      else summary.newCustomers++;
    }

    const { data: customerRow } = await supabase
      .from('customers')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();
    const customerPayload = {
      name: group.name,
      phone,
      total_spent: totalPurchases,
      segment: type,
      last_order_date: lastPurchase,
    };
    if (customerRow?.id)
      await supabase.from('customers').update(customerPayload).eq('id', customerRow.id);
    else await supabase.from('customers').insert(customerPayload);

    onProgress?.(summary.updatedCustomers + summary.newCustomers, grouped.size);
  }

  let analysed = 0;
  for (const chunk of chunkArray(analysisPayloads, 500)) {
    for (const item of chunk) {
      const code = String(item.customer_code || '');
      if (!code) continue;

      const existing = analysisMap.get(code);
      if (existing?.id) {
        const { error } = await supabase
          .from('customer_analysis')
          .update(item)
          .eq('id', existing.id);
        if (error)
          summary.errors.push({
            row: 0,
            field: 'تحليل العملاء',
            message: error.message,
          });
        else summary.updatedCustomers++;
      } else if (existing?.customer_code) {
        const { error } = await supabase
          .from('customer_analysis')
          .update(item)
          .eq('customer_code', code);
        if (error)
          summary.errors.push({
            row: 0,
            field: 'تحليل العملاء',
            message: error.message,
          });
        else summary.updatedCustomers++;
      } else {
        const { error } = await supabase.from('customer_analysis').insert(item);
        if (error)
          summary.errors.push({
            row: 0,
            field: 'تحليل العملاء',
            message: error.message,
          });
        else {
          summary.newCustomers++;
          analysisMap.set(code, item);
        }
      }
    }

    analysed += chunk.length;
    reportProgress(onProgress, invoiceRecords.length + analysed, totalWork);
  }

  // Keep import fast and avoid any heavy summary refresh path.
  invalidateInvoiceCache();
  clearExecutiveDashboardCache();
  clearSalesAnalyticsSummaryCache();
  clearCustomersCache();
  clearCustomerServiceCommandCenterCache();
  clearCustomerProfileCache();
  clearStaffPerformanceProfileCache();
  await refreshImportSummaries(summary);
  const rebuilt = { customers: summary.updatedCustomers };
  summary.updatedCustomers = Math.max(summary.updatedCustomers, rebuilt.customers);

  const daily = new Map<string, { date: string; count: number; total: number }>();
  const branches = new Map<string, { branch: string; count: number; total: number }>();
  summary.savedNetSales = (summary.insertedNetSales || 0) + (summary.updatedNetSales || 0);
  summary.savedOrUpdatedNetSales = summary.savedNetSales;
  summary.processedNetSales =
    (summary.insertedNetSales || 0) + (summary.confirmedExistingNetSales || summary.updatedNetSales || 0);
  summary.importedNetSales = summary.savedNetSales;
  summary.rowsRead = summary.totalRows;
  summary.uniqueInvoices = summary.distinctInvoicesInFile || 0;
  summary.insertedInvoices = summary.insertedRows;
  summary.skippedInvoices = summary.skippedDuplicates;
  summary.reviewInvoices = summary.needsReviewRows;
  summary.missingCustomer = summary.invoicesWithoutCustomer || 0;
  summary.missingDoctor = summary.invoicesWithoutDoctor || 0;
  summary.missingBranch = summary.invoicesWithoutBranch || 0;

  for (const row of savedSummaryRows) {
    const value = rawInvoiceNetValue(row);
    const day = daily.get(row.date) || { date: row.date, count: 0, total: 0 };
    day.count += 1;
    day.total += value;
    daily.set(row.date, day);

    const branchName = row.branch || branch;
    const branchRow = branches.get(branchName) || { branch: branchName, count: 0, total: 0 };
    branchRow.count += 1;
    branchRow.total += value;
    branches.set(branchName, branchRow);
  }
  summary.dailyCounts = [...daily.values()].sort((a, b) => a.date.localeCompare(b.date));
  summary.branchCounts = [...branches.values()].sort((a, b) => b.count - a.count);
  summary.schemaWarnings = Array.from(new Set(summary.schemaWarnings || []));
  summary.errors = Array.from(
    new Map(summary.errors.map((error) => [`${error.field}|${error.message}`, error])).values()
  );
  summary.rejectedRows = summary.errors.length;

  await persistInvoiceImportBatch(summary, 'imported');
  return summary;
}

export function generateTemplateFile(): void {
  const ws = XLSX.utils.aoa_to_sheet([
    ['فواتير المبيعات من 16/05/2026 إلى 19/05/2026 لمخزن <<الكـــل>>'],
    [
      'المخزن',
      'الرقم',
      'النوع',
      'الكود',
      'العميل',
      'التاريخ',
      'ع.أصناف',
      'ع.أصناف الأستبدال',
      'ق.الفاتورة',
      'ق.بعد الخصم',
      'ق.الصافى',
      'ق.الإستبدالات',
      'ن.الخصم',
      'ق.الخصم',
      'مبلغ مع المندوب',
      'تخصص',
      'عيادة',
      'مصاريف إضافية',
      'مندوب التوصيل',
      'عنوان التوصيل',
      'المستخدم',
      'ملاحظات',
      'النوع',
      'وقت الإقفال',
      'إسم الجهاز',
    ],
    [
      'الادارة فرع شكري',
      53860,
      'توصيل منزلى',
      2592,
      'اسم العميل',
      '16/05/2026 05:55',
      3,
      0,
      518,
      518,
      518,
      0,
      0,
      0,
      0,
      'اطفال',
      '',
      0,
      'ا محمد',
      'عنوان العميل',
      'د اسلام',
      '',
      'تم حفظها',
      '16/05/2026 06:04',
      'MASTER-PC',
    ],
  ]);
  ws['!cols'] = [
    { wch: 20 },
    { wch: 10 },
    { wch: 14 },
    { wch: 10 },
    { wch: 26 },
    { wch: 18 },
    { wch: 10 },
    { wch: 18 },
    { wch: 12 },
    { wch: 14 },
    { wch: 12 },
    { wch: 14 },
    { wch: 10 },
    { wch: 12 },
    { wch: 16 },
    { wch: 12 },
    { wch: 12 },
    { wch: 14 },
    { wch: 18 },
    { wch: 28 },
    { wch: 14 },
    { wch: 20 },
    { wch: 12 },
    { wch: 18 },
    { wch: 16 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sales Bills 16052026');
  XLSX.writeFile(wb, 'نموذج_فواتير_دواء.xlsx');
}
