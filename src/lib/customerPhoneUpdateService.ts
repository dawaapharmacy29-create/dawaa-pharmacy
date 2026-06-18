import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { clearCustomersCache } from '@/lib/api/customers';
import { clearCustomerServiceCommandCenterCache } from '@/lib/api/customerServiceCommandCenter';
import { clearCustomerProfileCache } from '@/lib/customerProfileService';
import { clearExecutiveDashboardCache } from '@/lib/executiveDashboardDataService';
import { clearSalesAnalyticsSummaryCache } from '@/lib/salesAnalyticsSummaryService';
import { clearCustomerFollowupEnrichmentCache } from '@/lib/customerFollowupEnrichmentService';
import { logActivity } from '@/lib/activityLog';

export const CUSTOMER_PHONE_CONFIRMATION = 'استيراد العملاء';

export type CustomerPhoneCsvRow = {
  final_customer_key?: string | null;
  customer_id?: string | null;
  customer_code?: string | null;
  customer_name?: string | null;
  branch?: string | null;
  address?: string | null;
  current_phone?: string | null;
  new_phone?: string | null;
  new_whatsapp_phone?: string | null;
  phone_alt?: string | null;
  notes?: string | null;
};

export type CustomerPhoneColumnMapping = {
  customerIdColumn?: string | null;
  finalCustomerKeyColumn?: string | null;
  customerCodeColumn?: string | null;
  customerNameColumn?: string | null;
  branchColumn?: string | null;
  phoneColumn?: string | null;
  whatsappColumn?: string | null;
  phoneAltColumn?: string | null;
  addressColumn?: string | null;
  notesColumn?: string | null;
  ambiguousPhoneColumns: string[];
  ambiguousWhatsappColumns: string[];
};

export type CustomerPhoneParseStats = {
  totalRows: number;
  normalizedLeadingZero: number;
  normalizedInternational: number;
  invalidPhones: number;
};

export type CustomerPhoneParseResult = {
  rows: CustomerPhoneCsvRow[];
  mapping: CustomerPhoneColumnMapping;
  stats: CustomerPhoneParseStats;
};

export type CustomerPhoneParseOptions = {
  copyPhoneToWhatsappWhenMissing?: boolean;
};

export type CustomerPhoneUpdateResultRow = {
  row_no: number;
  customer_code: string | null;
  customer_name: string | null;
  branch: string | null;
  match_method: string | null;
  status: string;
  new_phone: string | null;
  new_whatsapp_phone: string | null;
  phone_alt?: string | null;
  address?: string | null;
  existing_phone: string | null;
  existing_whatsapp_phone: string | null;
  would_update_phone: boolean;
  would_update_whatsapp: boolean;
  would_update_phone_alt?: boolean;
  would_update_address?: boolean;
  would_update_name?: boolean;
  would_update_branch?: boolean;
};

export type CustomerPhoneUpdateResult = {
  apply: boolean;
  rowsInFile: number;
  matchedCustomers: number;
  validPhones: number;
  validWhatsappPhones: number;
  invalidPhones: number;
  wouldUpdatePhone: number;
  wouldUpdateWhatsapp: number;
  customersUpdated: number;
  insertedCustomers?: number;
  repairedAddresses?: number;
  repairedNames?: number;
  repairedBranches?: number;
  repairedPhoneAlt?: number;
  skippedExistingValid: number;
  unmatchedRows: number;
  needsReviewRows: number;
  rows: CustomerPhoneUpdateResultRow[];
  metricsRefreshed?: boolean;
  cacheInvalidated?: boolean;
  invalidSummaryPhoneCountBefore?: number | null;
  invalidSummaryPhoneCountAfter?: number | null;
};

function clean(value: unknown) {
  const text = String(value ?? '').trim();
  return text || null;
}

const ARABIC_DIGIT_MAP: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
};

function normalizeHeader(value: string) {
  return String(value || '')
    .replace(/[\u200e\u200f\u061c]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-./\\]+/g, '');
}

function normalizeDigits(value: unknown) {
  return String(value ?? '')
    .replace(/[٠-٩۰-۹]/g, (digit) => ARABIC_DIGIT_MAP[digit] || digit)
    .replace(/[\u200e\u200f\u061c]/g, '')
    .trim();
}

export function normalizeEgyptMobileForCustomerUpdate(
  value: unknown,
  customerCode?: string | null
) {
  let raw = normalizeDigits(value);
  if (!raw || /^code:/i.test(raw)) return null;

  const codeDigits = normalizeDigits(customerCode || '').replace(/\D/g, '');
  raw = raw.replace(/[()\-\s._]/g, '');

  if (/e\+?/i.test(raw)) {
    const asNumber = Number(raw);
    if (Number.isFinite(asNumber)) raw = Math.trunc(asNumber).toString();
  }

  let digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+20')) digits = `0${digits.slice(3)}`;
  else if (digits.startsWith('0020')) digits = `0${digits.slice(4)}`;
  else if (digits.startsWith('20') && digits.length === 12) digits = `0${digits.slice(2)}`;
  else digits = digits.replace(/\D/g, '');

  if (digits.length === 10 && /^1[0125]\d{8}$/.test(digits)) digits = `0${digits}`;
  if (codeDigits && digits === codeDigits) return null;

  return /^01[0125]\d{8}$/.test(digits) ? digits : null;
}

function normalizationKind(original: unknown, normalized: string | null) {
  if (!normalized) return null;
  const digits = normalizeDigits(original).replace(/\D/g, '');
  if (digits.length === 10 && normalized === `0${digits}`) return 'leading_zero';
  if (/^(?:\+?20|0020)/.test(normalizeDigits(original).replace(/\s/g, ''))) return 'international';
  return 'none';
}

const COLUMN_ALIASES = {
  customer_id: ['customer_id', 'customerid', 'id', 'معرفالعميل'],
  final_customer_key: ['final_customer_key', 'finalcustomerkey', 'مفتاحالعميل'],
  customer_code: [
    'customer_code',
    'customercode',
    'code',
    'الكود',
    'كود',
    'كودالعميل',
    'رقمالعميل',
  ],
  customer_name: ['customer_name', 'customername', 'name', 'اسم', 'اسمالعميل', 'العميل'],
  branch: ['branch', 'فرع', 'الفرع'],
  phone: [
    'new_phone',
    'phone',
    'mobile',
    'customer_phone',
    'tel',
    'telephone',
    'تليفون',
    'التليفون',
    'رقمالتليفون',
    'رقمالهاتف',
    'موبايل',
    'الموبايل',
    'هاتف',
  ],
  whatsapp: [
    'new_whatsapp_phone',
    'whatsapp_phone',
    'whatsappphone',
    'whatsapp',
    'واتساب',
    'رقمواتساب',
    'رقمالواتساب',
  ],
  phone_alt: [
    'phone_alt',
    'alternate_phone',
    'alt_phone',
    'هاتفاضافي',
    'رقماخر',
    'رقمآخر',
    'تليفوناخر',
    'تليفونآخر',
  ],
  address: ['address', 'customer_address', 'العنوان', 'عنوان', 'عنوانالعميل'],
  notes: ['notes', 'note', 'ملاحظات', 'ملاحظة'],
};

function findColumns(headers: string[], aliases: string[]) {
  const normalizedAliases = aliases.map(normalizeHeader);
  return headers.filter((header) => normalizedAliases.includes(normalizeHeader(header)));
}

function detectMapping(headers: string[]): CustomerPhoneColumnMapping {
  const phoneColumns = findColumns(headers, COLUMN_ALIASES.phone);
  const whatsappColumns = findColumns(headers, COLUMN_ALIASES.whatsapp);
  const pick = (aliases: string[]) => findColumns(headers, aliases)[0] || null;

  return {
    customerIdColumn: pick(COLUMN_ALIASES.customer_id),
    finalCustomerKeyColumn: pick(COLUMN_ALIASES.final_customer_key),
    customerCodeColumn: pick(COLUMN_ALIASES.customer_code),
    customerNameColumn: pick(COLUMN_ALIASES.customer_name),
    branchColumn: pick(COLUMN_ALIASES.branch),
    phoneColumn: phoneColumns[0] || null,
    whatsappColumn: whatsappColumns[0] || (phoneColumns.length > 1 ? phoneColumns[1] : null),
    phoneAltColumn: pick(COLUMN_ALIASES.phone_alt),
    addressColumn: pick(COLUMN_ALIASES.address),
    notesColumn: pick(COLUMN_ALIASES.notes),
    ambiguousPhoneColumns: phoneColumns,
    ambiguousWhatsappColumns: whatsappColumns,
  };
}

function getMappedValue(row: Record<string, unknown>, column?: string | null) {
  return column ? clean(row[column]) : null;
}

function normalizeRow(
  row: Record<string, unknown>,
  mapping?: CustomerPhoneColumnMapping,
  options: CustomerPhoneParseOptions = {}
): CustomerPhoneCsvRow {
  if (mapping) {
    const customerCode = getMappedValue(row, mapping.customerCodeColumn);
    const phoneRaw = getMappedValue(row, mapping.phoneColumn);
    const whatsappRaw = getMappedValue(row, mapping.whatsappColumn);
    const phoneAltRaw = getMappedValue(row, mapping.phoneAltColumn);
    const phone = normalizeEgyptMobileForCustomerUpdate(phoneRaw, customerCode);
    const whatsapp =
      normalizeEgyptMobileForCustomerUpdate(whatsappRaw, customerCode) ||
      (options.copyPhoneToWhatsappWhenMissing ? phone : null);
    return {
      final_customer_key: getMappedValue(row, mapping.finalCustomerKeyColumn),
      customer_id: getMappedValue(row, mapping.customerIdColumn),
      customer_code: customerCode,
      customer_name: getMappedValue(row, mapping.customerNameColumn),
      branch: getMappedValue(row, mapping.branchColumn),
      address: getMappedValue(row, mapping.addressColumn),
      current_phone: clean((row as any).current_phone),
      new_phone: phone,
      new_whatsapp_phone: whatsapp,
      phone_alt: normalizeEgyptMobileForCustomerUpdate(phoneAltRaw, customerCode),
      notes: getMappedValue(row, mapping.notesColumn),
    };
  }

  return {
    final_customer_key: clean(row.final_customer_key),
    customer_id: clean(row.customer_id),
    customer_code: clean(row.customer_code),
    customer_name: clean(row.customer_name),
    branch: clean(row.branch),
    address: clean((row as any).address),
    current_phone: clean(row.current_phone),
    new_phone: normalizeEgyptMobileForCustomerUpdate(row.new_phone, clean(row.customer_code)),
    new_whatsapp_phone: normalizeEgyptMobileForCustomerUpdate(
      row.new_whatsapp_phone,
      clean(row.customer_code)
    ),
    phone_alt: normalizeEgyptMobileForCustomerUpdate(
      (row as any).phone_alt,
      clean(row.customer_code)
    ),
    notes: clean(row.notes),
  };
}

function parseCsvText(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let current = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(current);
      current = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(current);
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
      current = '';
      continue;
    }

    current += char;
  }

  row.push(current);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);

  const headers = (rows.shift() || []).map((header) => header.trim());
  return rows.map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = String(cells[index] ?? '').trim();
    });
    return record;
  });
}

export async function parseCustomerPhoneCsv(file: File): Promise<CustomerPhoneCsvRow[]> {
  return (await parseCustomerPhoneFile(file)).rows;
}

export async function parseCustomerPhoneFile(
  file: File,
  options: CustomerPhoneParseOptions = {}
): Promise<CustomerPhoneParseResult> {
  let rawRows: Record<string, unknown>[] = [];

  if (file.name.toLowerCase().endsWith('.csv')) {
    const text = await file.text();
    rawRows = parseCsvText(text);
  } else {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, {
      type: 'array',
      cellText: true,
      cellNF: true,
      cellDates: false,
      raw: false,
    });
    const firstSheet = workbook.SheetNames[0];
    if (!firstSheet) return emptyParseResult();
    const sheet = workbook.Sheets[firstSheet];
    rawRows = worksheetToRecords(sheet);
  }

  const headers = Object.keys(rawRows[0] || {});
  const mapping = detectMapping(headers);
  const rows = rawRows
    .map((row) => normalizeRow(row, mapping, options))
    .filter(
      (row) =>
        row.customer_id ||
        row.customer_code ||
        row.final_customer_key ||
        row.customer_name ||
        row.new_phone ||
        row.new_whatsapp_phone ||
        row.phone_alt ||
        row.address
    );

  const stats = rawRows.reduce<CustomerPhoneParseStats>(
    (acc, rawRow) => {
      const customerCode = getMappedValue(rawRow, mapping.customerCodeColumn);
      const values = [
        getMappedValue(rawRow, mapping.phoneColumn),
        getMappedValue(rawRow, mapping.whatsappColumn),
      ].filter(Boolean);
      const normalizedValues = values.map((value) =>
        normalizeEgyptMobileForCustomerUpdate(value, customerCode)
      );
      if (normalizedValues.some(Boolean)) {
        for (const value of values) {
          const normalized = normalizeEgyptMobileForCustomerUpdate(value, customerCode);
          const kind = normalizationKind(value, normalized);
          if (kind === 'leading_zero') acc.normalizedLeadingZero += 1;
          if (kind === 'international') acc.normalizedInternational += 1;
        }
      } else {
        acc.invalidPhones += 1;
      }
      return acc;
    },
    {
      totalRows: rawRows.length,
      normalizedLeadingZero: 0,
      normalizedInternational: 0,
      invalidPhones: 0,
    }
  );

  return { rows, mapping, stats };
}

function worksheetToRecords(sheet: XLSX.WorkSheet): Record<string, unknown>[] {
  const ref = sheet['!ref'];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const headers: string[] = [];
  for (let column = range.s.c; column <= range.e.c; column += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c: column })];
    headers.push(String(cell?.w ?? cell?.v ?? '').trim());
  }

  const records: Record<string, unknown>[] = [];
  for (let rowIndex = range.s.r + 1; rowIndex <= range.e.r; rowIndex += 1) {
    const record: Record<string, unknown> = {};
    headers.forEach((header, columnOffset) => {
      if (!header) return;
      const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: range.s.c + columnOffset })];
      const formatted = cell?.w;
      const raw = cell?.v;
      record[header] = formatted !== undefined && formatted !== '' ? formatted : (raw ?? '');
    });
    if (Object.values(record).some((value) => String(value ?? '').trim() !== ''))
      records.push(record);
  }
  return records;
}

function emptyParseResult(): CustomerPhoneParseResult {
  return {
    rows: [],
    mapping: {
      ambiguousPhoneColumns: [],
      ambiguousWhatsappColumns: [],
    },
    stats: {
      totalRows: 0,
      normalizedLeadingZero: 0,
      normalizedInternational: 0,
      invalidPhones: 0,
    },
  };
}

function buildLocalCustomerImportPreview(
  rows: CustomerPhoneCsvRow[],
  apply = false
): CustomerPhoneUpdateResult {
  const validPhones = rows.filter((row) => row.new_phone).length;
  const validWhatsappPhones = rows.filter((row) => row.new_whatsapp_phone).length;
  const invalidPhones = rows.filter(
    (row) => !row.new_phone && !row.new_whatsapp_phone && !row.phone_alt
  ).length;
  const uniqueKeys = new Set(
    rows
      .map(
        (row) =>
          row.customer_code ||
          row.final_customer_key ||
          row.customer_id ||
          row.new_phone ||
          row.customer_name ||
          ''
      )
      .filter(Boolean)
  );
  return {
    apply,
    rowsInFile: rows.length,
    matchedCustomers: 0,
    validPhones,
    validWhatsappPhones,
    invalidPhones,
    wouldUpdatePhone: validPhones,
    wouldUpdateWhatsapp: validWhatsappPhones,
    customersUpdated: 0,
    insertedCustomers: 0,
    repairedAddresses: rows.filter((row) => row.address).length,
    repairedNames: rows.filter((row) => row.customer_name).length,
    repairedBranches: rows.filter((row) => row.branch).length,
    repairedPhoneAlt: rows.filter((row) => row.phone_alt).length,
    skippedExistingValid: 0,
    unmatchedRows: Math.max(0, rows.length - uniqueKeys.size),
    needsReviewRows: invalidPhones,
    rows: rows.slice(0, 200).map((row, index) => ({
      row_no: index + 1,
      customer_code: row.customer_code || row.final_customer_key || null,
      customer_name: row.customer_name || null,
      branch: row.branch || null,
      match_method: 'local_preview',
      status: 'preview_ready',
      new_phone: row.new_phone || null,
      new_whatsapp_phone: row.new_whatsapp_phone || null,
      phone_alt: row.phone_alt || null,
      address: row.address || null,
      existing_phone: null,
      existing_whatsapp_phone: null,
      would_update_phone: Boolean(row.new_phone),
      would_update_whatsapp: Boolean(row.new_whatsapp_phone),
      would_update_phone_alt: Boolean(row.phone_alt),
      would_update_address: Boolean(row.address),
      would_update_name: Boolean(row.customer_name),
      would_update_branch: Boolean(row.branch),
    })),
    metricsRefreshed: false,
    cacheInvalidated: false,
    invalidSummaryPhoneCountBefore: null,
    invalidSummaryPhoneCountAfter: null,
  };
}

function mergeImportResults(
  results: CustomerPhoneUpdateResult[],
  rowsInFile: number
): CustomerPhoneUpdateResult {
  const base = buildLocalCustomerImportPreview([], true);
  return {
    ...base,
    apply: true,
    rowsInFile,
    matchedCustomers: results.reduce((s, r) => s + Number(r.matchedCustomers || 0), 0),
    validPhones: results.reduce((s, r) => s + Number(r.validPhones || 0), 0),
    validWhatsappPhones: results.reduce((s, r) => s + Number(r.validWhatsappPhones || 0), 0),
    invalidPhones: results.reduce((s, r) => s + Number(r.invalidPhones || 0), 0),
    wouldUpdatePhone: results.reduce((s, r) => s + Number(r.wouldUpdatePhone || 0), 0),
    wouldUpdateWhatsapp: results.reduce((s, r) => s + Number(r.wouldUpdateWhatsapp || 0), 0),
    customersUpdated: results.reduce((s, r) => s + Number(r.customersUpdated || 0), 0),
    insertedCustomers: results.reduce((s, r) => s + Number(r.insertedCustomers || 0), 0),
    repairedAddresses: results.reduce((s, r) => s + Number(r.repairedAddresses || 0), 0),
    repairedNames: results.reduce((s, r) => s + Number(r.repairedNames || 0), 0),
    repairedBranches: results.reduce((s, r) => s + Number(r.repairedBranches || 0), 0),
    repairedPhoneAlt: results.reduce((s, r) => s + Number(r.repairedPhoneAlt || 0), 0),
    skippedExistingValid: results.reduce((s, r) => s + Number(r.skippedExistingValid || 0), 0),
    unmatchedRows: results.reduce((s, r) => s + Number(r.unmatchedRows || 0), 0),
    needsReviewRows: results.reduce((s, r) => s + Number(r.needsReviewRows || 0), 0),
    rows: results.flatMap((r) => r.rows || []).slice(0, 500),
  };
}

export async function previewCustomerPhoneUpdate(
  rows: CustomerPhoneCsvRow[]
): Promise<CustomerPhoneUpdateResult> {
  // معاينة محلية سريعة: لا نستدعي RPC على 15 ألف عميل حتى لا يحدث statement timeout.
  const preview = buildLocalCustomerImportPreview(rows, false);
  preview.invalidSummaryPhoneCountBefore = await countInvalidCustomerSummaryPhones().catch(
    () => null
  );
  return preview;
}

export async function applyCustomerPhoneUpdate(
  rows: CustomerPhoneCsvRow[],
  actor: { id?: string | null; name?: string | null; role?: string | null } = {}
): Promise<CustomerPhoneUpdateResult> {
  const chunks: CustomerPhoneCsvRow[][] = [];
  for (let index = 0; index < rows.length; index += 150)
    chunks.push(rows.slice(index, index + 150));
  const partialResults: CustomerPhoneUpdateResult[] = [];
  for (const chunk of chunks) {
    const { data, error } = await supabase.rpc('safe_daily_customer_import_from_json', {
      p_rows: chunk,
      p_apply: true,
    });
    if (error) {
      // لا نوقف استيراد الملف كله بسبب دفعة واحدة. نسجل الدفعة كمراجعة ونكمل الباقي.
      const message = error.message.includes('statement timeout')
        ? 'انتهى وقت دفعة صغيرة من تحديث العملاء. تم تخطي هذه الدفعة مؤقتًا؛ يمكن إعادة رفع نفس الجزء بعد تشغيل SQL V2.'
        : error.message.includes('function')
          ? 'دالة الاستيراد اليومي غير مفعلة في قاعدة البيانات. شغّل SQL V2 الخاص باستيراد العملاء والصلاحيات.'
          : error.message;

      partialResults.push({
        totalRows: chunk.length,
        rows: chunk.slice(0, 50).map(
          (item, localIndex) =>
            ({
              row_no: Number((item as any).source_row || localIndex + 1),
              customer_code: item.customer_code || null,
              customer_name: item.customer_name || null,
              branch: item.branch || null,
              match_method: null,
              status: 'needs_review',
              new_phone: item.new_phone || null,
              new_whatsapp_phone: item.new_whatsapp_phone || null,
              existing_phone: null,
              existing_whatsapp_phone: null,
              would_update_phone: false,
              would_update_whatsapp: false,
              reason: message,
            }) as any
        ),
        updatedPhoneCount: 0,
        updatedWhatsappCount: 0,
        updatedPhoneAltCount: 0,
        updatedAddressCount: 0,
        updatedNameCount: 0,
        updatedBranchCount: 0,
        insertedCustomers: 0,
        customersUpdated: 0,
        unchangedCustomers: 0,
        invalidPhoneRows: 0,
        unmatchedRows: chunk.length,
        needsReviewRows: chunk.length,
      } as any);
      continue;
    }
    partialResults.push(data as CustomerPhoneUpdateResult);
  }

  const result = mergeImportResults(partialResults, rows.length);

  const refresh = await supabase.rpc('dawaa_customer_import_post_refresh_v1');
  result.metricsRefreshed = !refresh.error;

  clearCustomersCache();
  clearCustomerServiceCommandCenterCache();
  clearCustomerFollowupEnrichmentCache();
  clearCustomerProfileCache();
  clearExecutiveDashboardCache();
  clearSalesAnalyticsSummaryCache();
  result.cacheInvalidated = true;
  result.invalidSummaryPhoneCountAfter = await countInvalidCustomerSummaryPhones();

  await logActivity({
    action: 'تم تصحيح بيانات العملاء',
    module: 'استيراد العملاء',
    target_type: 'customers',
    target_id: 'customer_phone_update_csv',
    user_id: actor.id || null,
    user_name: actor.name || 'النظام',
    user_role: actor.role || null,
    route_path: '/invoices',
    details: {
      updated_phone_count: result.wouldUpdatePhone,
      updated_whatsapp_count: result.wouldUpdateWhatsapp,
      inserted_customers: result.insertedCustomers || 0,
      repaired_addresses: result.repairedAddresses || 0,
      repaired_names: result.repairedNames || 0,
      repaired_branches: result.repairedBranches || 0,
      repaired_phone_alt: result.repairedPhoneAlt || 0,
      skipped_count: result.skippedExistingValid + result.invalidPhones,
      unmatched_count: result.unmatchedRows,
      needs_review_count: result.needsReviewRows,
      customers_updated: result.customersUpdated,
      timestamp: new Date().toISOString(),
    },
  });

  return result;
}

async function countInvalidCustomerSummaryPhones() {
  const rpc = await supabase.rpc('count_invalid_customer_summary_phones');
  if (!rpc.error && typeof rpc.data === 'number') return rpc.data;

  const { count, error } = await supabase
    .from('customer_metrics_summary')
    .select('final_customer_key', { count: 'exact', head: true })
    .or('customer_phone.is.null,customer_phone.eq.,customer_phone.ilike.code:%');
  if (error) return null;
  return count ?? 0;
}
