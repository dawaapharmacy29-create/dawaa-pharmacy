import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';

export interface RawSalesInvoiceItemV21 {
  sheetName: string;
  rowIndex: number;
  invoiceNumber: string;
  branch: string;
  invoiceDate: string | null;
  customerCode: string | null;
  customerName: string | null;
  invoiceType: string | null;
  invoiceItemsCount: number | null;
  invoiceNetAmount: number | null;
  invoiceDiscountPercent: number | null;
  invoiceDiscountAmount: number | null;
  invoiceExtraFees: number | null;
  lineNo: number | null;
  productCode: string | null;
  productName: string;
  quantity: number | null;
  unitName: string | null;
  expiryRaw: string | null;
  returnedQuantity: number | null;
  unitPrice: number | null;
  itemDiscountAmount: number | null;
  itemDiscountPercent: number | null;
  grossLineAmount: number | null;
  netLineAmount: number | null;
  lineTotal: number | null;
  raw: Record<string, unknown>;
}

export interface SalesInvoiceItemsParseResultV21 {
  rows: RawSalesInvoiceItemV21[];
  detectedSheets: string[];
  warnings: string[];
}

export interface SalesInvoiceItemsImportResultV21 {
  parsed: number;
  saved: number;
  failed: number;
  /** Rows now available to canonical Sales Intelligence as real line-item evidence. */
  canonicalEvidenceRows: number;
  linkedInvoiceRows: number;
  ambiguousInvoiceRows: number;
  unmatchedInvoiceRows: number;
  productLinkedRows: number;
  /** Deprecated legacy counter. V17 is never promoted automatically anymore. */
  reconciledProductConversions: number;
}

const normalize = (value: unknown) => String(value ?? '')
  .trim().toLowerCase().replace(/\s+/g, ' ')
  .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');

const text = (value: unknown) => String(value ?? '').trim();
const numberOrNull = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const n = Number(String(value).replace(/,/g, '').replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const HEADER_ALIASES = {
  invoice: ['فاتورة','فاتوره','رقم الفاتوره','رقم فاتوره','الفاتوره','الرقم','invoice number','invoice no','invoice_no'],
  invoiceType: ['نوع','نوع الفاتوره','نوع الفاتورة','invoice type','invoice_type'],
  branch: ['المخزن','الفرع','branch','branch name'],
  date: ['تاريخ','التاريخ','تاريخ الفاتوره','تاريخ الفاتورة','invoice date','date'],
  customerCode: ['كود','كود العميل','الكود','customer code','customer_code'],
  customerName: ['عميل','اسم العميل','customer','customer name'],
  invoiceItemsCount: ['عددأصناف','عدد اصناف','عدد الأصناف','عدد الاصناف','items count','line items count'],
  invoiceNetAmount: ['صافى الفاتورة','صافي الفاتورة','صافى الفاتوره','صافي الفاتوره','net invoice','invoice net'],
  invoiceDiscountPercent: ['خصم نسبة','خصم نسبه','invoice discount %','discount percent'],
  invoiceDiscountAmount: ['خصم قيمة','خصم قيمه','invoice discount','discount amount'],
  invoiceExtraFees: ['مصاريف','رسوم','extra fees','fees'],
  lineNo: ['م','رقم السطر','مسلسل','line no','line number','line_no'],
  productCode: ['ك.صنف','ك صنف','كود الصنف','كود المنتج','item code','product code','product_code','barcode'],
  productName: ['صنف','اسم الصنف','الصنف','اسم المنتج','item name','product name','description'],
  expiry: ['صلاحية','صلاحيه','expiry','expiry date'],
  quantity: ['كمية','الكميه','qty','quantity'],
  unit: ['وحدة','وحده','unit'],
  returnedQuantity: ['مرتجع','كمية مرتجع','returned','return qty'],
  unitPrice: ['سعر بيع','سعر البيع','السعر','سعر الوحده','unit price','price'],
  itemDiscountAmount: ['خصم صنف','خصم الصنف','item discount','item discount amount'],
  itemDiscountPercent: ['خصم صنف%','خصم صنف %','خصم الصنف%','item discount %','item discount percent'],
  lineTotal: ['اجمالي البيع','اجمالي السطر','الاجمالي','line total','total value','total'],
};

function indexOfAlias(headers: string[], aliases: string[]) {
  const normalizedAliases = aliases.map(normalize);
  return headers.findIndex((header) => normalizedAliases.includes(normalize(header)));
}

function findHeader(matrix: unknown[][]) {
  for (let rowIndex = 0; rowIndex < Math.min(matrix.length, 50); rowIndex += 1) {
    const row = (matrix[rowIndex] || []).map((cell) => text(cell));
    const invoice = indexOfAlias(row, HEADER_ALIASES.invoice);
    const productName = indexOfAlias(row, HEADER_ALIASES.productName);
    const productCode = indexOfAlias(row, HEADER_ALIASES.productCode);
    const quantity = indexOfAlias(row, HEADER_ALIASES.quantity);
    if (invoice >= 0 && (productName >= 0 || productCode >= 0) && quantity >= 0) {
      return {
        rowIndex,
        headers: row,
        indexes: {
          invoice,
          invoiceType: indexOfAlias(row, HEADER_ALIASES.invoiceType),
          branch: indexOfAlias(row, HEADER_ALIASES.branch),
          date: indexOfAlias(row, HEADER_ALIASES.date),
          customerCode: indexOfAlias(row, HEADER_ALIASES.customerCode),
          customerName: indexOfAlias(row, HEADER_ALIASES.customerName),
          invoiceItemsCount: indexOfAlias(row, HEADER_ALIASES.invoiceItemsCount),
          invoiceNetAmount: indexOfAlias(row, HEADER_ALIASES.invoiceNetAmount),
          invoiceDiscountPercent: indexOfAlias(row, HEADER_ALIASES.invoiceDiscountPercent),
          invoiceDiscountAmount: indexOfAlias(row, HEADER_ALIASES.invoiceDiscountAmount),
          invoiceExtraFees: indexOfAlias(row, HEADER_ALIASES.invoiceExtraFees),
          lineNo: indexOfAlias(row, HEADER_ALIASES.lineNo),
          productCode,
          productName,
          expiry: indexOfAlias(row, HEADER_ALIASES.expiry),
          quantity,
          unit: indexOfAlias(row, HEADER_ALIASES.unit),
          returnedQuantity: indexOfAlias(row, HEADER_ALIASES.returnedQuantity),
          unitPrice: indexOfAlias(row, HEADER_ALIASES.unitPrice),
          itemDiscountAmount: indexOfAlias(row, HEADER_ALIASES.itemDiscountAmount),
          itemDiscountPercent: indexOfAlias(row, HEADER_ALIASES.itemDiscountPercent),
          lineTotal: indexOfAlias(row, HEADER_ALIASES.lineTotal),
        },
      };
    }
  }
  return null;
}

function cairoWallClockToIso(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0
): string | null {
  const desiredWallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  if (!Number.isFinite(desiredWallAsUtc)) return null;

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const offsetAt = (instantMs: number) => {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(instantMs))
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value])
    ) as Record<string, string>;
    const localAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second)
    );
    return localAsUtc - instantMs;
  };

  let offset = offsetAt(desiredWallAsUtc);
  let result = desiredWallAsUtc - offset;
  const correctedOffset = offsetAt(result);
  if (correctedOffset !== offset) result = desiredWallAsUtc - correctedOffset;
  return new Date(result).toISOString();
}

function excelDateToIso(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return cairoWallClockToIso(
        parsed.y,
        parsed.m,
        parsed.d,
        parsed.H || 0,
        parsed.M || 0,
        Math.floor(parsed.S || 0)
      );
    }
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return cairoWallClockToIso(
      value.getFullYear(),
      value.getMonth() + 1,
      value.getDate(),
      value.getHours(),
      value.getMinutes(),
      value.getSeconds()
    );
  }
  const raw = text(value);
  const egyptian = raw.match(/^(\d{1,4})[\/-](\d{1,2})[\/-](\d{1,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (egyptian) {
    const a = Number(egyptian[1]);
    const b = Number(egyptian[2]);
    const c = Number(egyptian[3]);
    const hour = Number(egyptian[4] || 0);
    const minute = Number(egyptian[5] || 0);
    const second = Number(egyptian[6] || 0);
    const year = a > 1900 ? a : (c < 100 ? 2000 + c : c);
    const month = a > 1900 ? b : b;
    const day = a > 1900 ? c : a;
    return cairoWallClockToIso(year, month, day, hour, minute, second);
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeCustomerCode(value: unknown): string {
  return text(value).replace(/\.0+$/, '');
}

export function parseSalesInvoiceItemsV21(buffer: ArrayBuffer, fallbackBranch: string): SalesInvoiceItemsParseResultV21 {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false, raw: true });
  const rows: RawSalesInvoiceItemV21[] = [];
  const detectedSheets: string[] = [];
  const warnings: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
    const header = findHeader(matrix);
    if (!header) continue;
    detectedSheets.push(sheetName);

    const idx = header.indexes;
    for (let r = header.rowIndex + 1; r < matrix.length; r += 1) {
      const row = matrix[r] || [];
      const invoiceNumber = text(row[idx.invoice]);
      const productCode = idx.productCode >= 0 ? text(row[idx.productCode]) || null : null;
      const productName = idx.productName >= 0 ? text(row[idx.productName]) : productCode || '';
      const quantity = numberOrNull(row[idx.quantity]);
      if (!invoiceNumber || !productName || quantity == null) continue;

      const unitPrice = idx.unitPrice >= 0 ? numberOrNull(row[idx.unitPrice]) : null;
      const itemDiscountAmount = idx.itemDiscountAmount >= 0 ? numberOrNull(row[idx.itemDiscountAmount]) : null;
      const itemDiscountPercent = idx.itemDiscountPercent >= 0 ? numberOrNull(row[idx.itemDiscountPercent]) : null;
      const explicitLineTotal = idx.lineTotal >= 0 ? numberOrNull(row[idx.lineTotal]) : null;
      const grossLineAmount = quantity != null && unitPrice != null ? quantity * unitPrice : null;
      const derivedDiscount =
        itemDiscountAmount != null
          ? itemDiscountAmount
          : grossLineAmount != null && itemDiscountPercent != null
            ? grossLineAmount * itemDiscountPercent / 100
            : 0;
      const netLineAmount =
        explicitLineTotal != null
          ? explicitLineTotal
          : grossLineAmount != null
            ? grossLineAmount - derivedDiscount
            : null;

      rows.push({
        sheetName,
        rowIndex: r + 1,
        invoiceNumber,
        branch: idx.branch >= 0 ? text(row[idx.branch]) || fallbackBranch : fallbackBranch,
        invoiceDate: idx.date >= 0 ? excelDateToIso(row[idx.date]) : null,
        customerCode: idx.customerCode >= 0 ? normalizeCustomerCode(row[idx.customerCode]) || null : null,
        customerName: idx.customerName >= 0 ? text(row[idx.customerName]) || null : null,
        invoiceType: idx.invoiceType >= 0 ? text(row[idx.invoiceType]) || null : null,
        invoiceItemsCount: idx.invoiceItemsCount >= 0 ? numberOrNull(row[idx.invoiceItemsCount]) : null,
        invoiceNetAmount: idx.invoiceNetAmount >= 0 ? numberOrNull(row[idx.invoiceNetAmount]) : null,
        invoiceDiscountPercent: idx.invoiceDiscountPercent >= 0 ? numberOrNull(row[idx.invoiceDiscountPercent]) : null,
        invoiceDiscountAmount: idx.invoiceDiscountAmount >= 0 ? numberOrNull(row[idx.invoiceDiscountAmount]) : null,
        invoiceExtraFees: idx.invoiceExtraFees >= 0 ? numberOrNull(row[idx.invoiceExtraFees]) : null,
        lineNo: idx.lineNo >= 0 ? numberOrNull(row[idx.lineNo]) : null,
        productCode,
        productName,
        quantity,
        unitName: idx.unit >= 0 ? text(row[idx.unit]) || null : null,
        expiryRaw: idx.expiry >= 0 ? text(row[idx.expiry]) || null : null,
        returnedQuantity: idx.returnedQuantity >= 0 ? numberOrNull(row[idx.returnedQuantity]) : null,
        unitPrice,
        itemDiscountAmount,
        itemDiscountPercent,
        grossLineAmount,
        netLineAmount,
        lineTotal: netLineAmount,
        raw: Object.fromEntries(header.headers.map((name, i) => [name || `col_${i + 1}`, row[i]])),
      });
    }
  }

  if (!detectedSheets.length) warnings.push('الملف الحالي لا يحتوي Sheet واضح لتفاصيل أصناف الفواتير؛ سيتم استيراد ملخص الفواتير فقط.');
  if (detectedSheets.length && !rows.length) warnings.push('تم اكتشاف أعمدة تفاصيل أصناف لكن لم توجد صفوف صالحة للاستيراد.');
  return { rows, detectedSheets, warnings };
}

function normalizeBranch(value: unknown) {
  const v = normalize(value);
  if (/شكري|shokry|shoukry/.test(v)) return 'فرع شكري';
  if (/شامي|الشامي|shamy|shami/.test(v)) return 'فرع الشامي';
  return v;
}

function isoDay(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value).slice(0, 10) : date.toISOString().slice(0, 10);
}

function chunk<T>(values: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

async function sha256(value: string) {
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return `fallback-${(h >>> 0).toString(16)}`;
}

export async function importSalesInvoiceItemsV21(
  rows: RawSalesInvoiceItemV21[],
  params: { sourceFile?: string | null; importBatch?: string | null; createdBy?: string | null },
): Promise<SalesInvoiceItemsImportResultV21> {
  if (!rows.length) {
    return {
      parsed: 0,
      saved: 0,
      failed: 0,
      canonicalEvidenceRows: 0,
      linkedInvoiceRows: 0,
      ambiguousInvoiceRows: 0,
      unmatchedInvoiceRows: 0,
      productLinkedRows: 0,
      reconciledProductConversions: 0,
    };
  }

  // Resolve product ids by the pharmacy's globally-unique product_code. Name-only rows remain
  // usable as strongly-inferred text evidence, but are never assigned a product id by guessing.
  const productIdByCode = new Map<string, string>();
  const productCodes = Array.from(new Set(rows.map((row) => text(row.productCode)).filter(Boolean)));
  for (const group of chunk(productCodes)) {
    const { data, error } = await supabase
      .from('products')
      .select('id,product_code')
      .in('product_code', group)
      .limit(5000);
    if (error) throw error;
    for (const row of data ?? []) {
      if (row.product_code && row.id) productIdByCode.set(String(row.product_code).trim(), String(row.id));
    }
  }

  // Resolve invoice ids after the invoice-header import has succeeded. Invoice numbers can repeat,
  // so number alone is never enough: branch must match, and when the item file has a date the day
  // must match too. If more than one header remains, leave invoice_id null rather than guessing.
  const invoiceHeadersByNumber = new Map<string, any[]>();
  const invoiceNumbers = Array.from(new Set(rows.map((row) => text(row.invoiceNumber)).filter(Boolean)));
  const invoiceHeaderRowsById = new Map<string, any>();
  for (const group of chunk(invoiceNumbers)) {
    for (const field of ['invoice_number', 'invoice_no'] as const) {
      const { data, error } = await supabase
        .from('sales_invoices')
        .select('id,invoice_number,invoice_no,branch,branch_name,invoice_datetime,invoice_date,sale_date,customer_id,customer_code,customer_name,seller_name,normalized_seller_name,staff_id,staff_name')
        .in(field, group)
        .limit(5000);
      if (error) throw error;
      for (const row of data ?? []) {
        if (row.id) invoiceHeaderRowsById.set(String(row.id), row);
      }
    }
  }
  for (const row of invoiceHeaderRowsById.values()) {
    const number = text(row.invoice_number || row.invoice_no);
    if (!number) continue;
    const bucket = invoiceHeadersByNumber.get(number) ?? [];
    bucket.push(row);
    invoiceHeadersByNumber.set(number, bucket);
  }

  const payload: any[] = [];
  for (const row of rows) {
    const itemBranch = normalizeBranch(row.branch);
    const itemDay = isoDay(row.invoiceDate);
    const itemCustomerCode = normalizeCustomerCode(row.customerCode);
    const headerCandidates = (invoiceHeadersByNumber.get(row.invoiceNumber) ?? []).filter((invoice) => {
      const invoiceBranch = normalizeBranch(invoice.branch_name || invoice.branch);
      if (invoiceBranch !== itemBranch) return false;
      if (itemDay) {
        const invoiceDay = isoDay(invoice.invoice_datetime || invoice.invoice_date || invoice.sale_date);
        if (invoiceDay !== itemDay) return false;
      }
      const headerCustomerCode = normalizeCustomerCode(invoice.customer_code);
      if (itemCustomerCode && headerCustomerCode && itemCustomerCode !== headerCustomerCode) return false;
      return true;
    });

    let uniqueHeader: any | null = null;
    let invoiceLinkStatus = 'header_missing';
    let invoiceLinkReason = 'no_header_candidate';

    if (headerCandidates.length === 1) {
      uniqueHeader = headerCandidates[0];
      invoiceLinkStatus = 'linked_exact';
      invoiceLinkReason = 'invoice_number_branch_day_customer_unique';
    } else if (headerCandidates.length > 1 && row.invoiceDate) {
      const itemMs = new Date(row.invoiceDate).getTime();
      const ranked = headerCandidates
        .map((candidate) => {
          const candidateRaw = candidate.invoice_datetime || candidate.invoice_date || candidate.sale_date;
          const candidateMs = candidateRaw ? new Date(candidateRaw).getTime() : NaN;
          return {
            candidate,
            diff: Number.isFinite(candidateMs) ? Math.abs(candidateMs - itemMs) : Number.POSITIVE_INFINITY,
          };
        })
        .sort((a, b) => a.diff - b.diff);
      const first = ranked[0];
      const second = ranked[1];
      if (
        first &&
        first.diff <= 10 * 60 * 1000 &&
        (!second || second.diff - first.diff >= 60 * 1000 || first.diff === 0)
      ) {
        uniqueHeader = first.candidate;
        invoiceLinkStatus = 'linked_time_resolved';
        invoiceLinkReason = `closest_invoice_time_diff_ms:${first.diff}`;
      } else {
        invoiceLinkStatus = 'ambiguous';
        invoiceLinkReason = `multiple_header_candidates:${headerCandidates.length}`;
      }
    } else if (headerCandidates.length > 1) {
      invoiceLinkStatus = 'ambiguous';
      invoiceLinkReason = `multiple_header_candidates:${headerCandidates.length}`;
    }

    const identityBase = [
      row.invoiceNumber,
      itemBranch,
      row.invoiceDate || '',
      row.lineNo ?? '',
      row.productCode || '',
      normalize(row.productName),
    ].join('|');

    payload.push({
      item_identity: await sha256(identityBase),
      invoice_id: uniqueHeader?.id ? String(uniqueHeader.id) : null,
      invoice_number: row.invoiceNumber,
      branch: row.branch,
      invoice_date: row.invoiceDate,
      customer_id: uniqueHeader?.customer_id || null,
      customer_code: row.customerCode,
      line_no: row.lineNo,
      product_id: row.productCode ? productIdByCode.get(row.productCode) ?? null : null,
      product_code: row.productCode,
      product_name: row.productName,
      quantity: row.quantity,
      unit_price: row.unitPrice,
      line_total: row.lineTotal,
      source_file: params.sourceFile || null,
      import_batch: params.importBatch || null,
      raw_data: {
        ...row.raw,
        __dawaa_commercial: {
          customer_name: row.customerName || uniqueHeader?.customer_name || null,
          invoice_type: row.invoiceType,
          invoice_items_count: row.invoiceItemsCount,
          invoice_net_amount: row.invoiceNetAmount,
          invoice_discount_percent: row.invoiceDiscountPercent,
          invoice_discount_amount: row.invoiceDiscountAmount,
          invoice_extra_fees: row.invoiceExtraFees,
          unit_name: row.unitName,
          expiry_raw: row.expiryRaw,
          returned_quantity: row.returnedQuantity,
          item_discount_amount: row.itemDiscountAmount,
          item_discount_percent: row.itemDiscountPercent,
          gross_line_amount: row.grossLineAmount,
          net_line_amount: row.netLineAmount,
          invoice_link_status: invoiceLinkStatus,
          invoice_link_reason: invoiceLinkReason,
          seller_name: uniqueHeader?.seller_name || uniqueHeader?.normalized_seller_name || null,
          staff_id: uniqueHeader?.staff_id || null,
          staff_name: uniqueHeader?.staff_name || uniqueHeader?.seller_name || null,
        },
      },
      created_by: params.createdBy || null,
      updated_at: new Date().toISOString(),
    });
  }

  let saved = 0;
  let failed = 0;
  for (let start = 0; start < payload.length; start += 300) {
    const batch = payload.slice(start, start + 300);
    const { data, error } = await supabase
      .from('sales_invoice_items_v21')
      .upsert(batch, { onConflict: 'item_identity', ignoreDuplicates: false })
      .select('id');
    if (error) {
      failed += batch.length;
      console.warn('[sales-items-v21] batch upsert failed', error);
      continue;
    }
    saved += data?.length || batch.length;
  }

  // IMPORTANT: Do NOT call dawaa_reconcile_whatsapp_product_conversion_v21 here. That legacy RPC
  // promotes V17 opportunities using the old statistical invoice matcher. Real line items now feed
  // Sales Intelligence through invoiceItemEvidenceRepository instead.
  const linkedInvoiceRows = payload.filter(
    (row) => row.invoice_id && String(row.raw_data?.__dawaa_commercial?.invoice_link_status).startsWith('linked_')
  ).length;
  const ambiguousInvoiceRows = payload.filter((row) => row.raw_data?.__dawaa_commercial?.invoice_link_status === 'ambiguous').length;
  const unmatchedInvoiceRows = payload.filter(
    (row) => !row.invoice_id && row.raw_data?.__dawaa_commercial?.invoice_link_status !== 'ambiguous'
  ).length;
  const productLinkedRows = payload.filter((row) => row.product_id).length;

  return {
    parsed: rows.length,
    saved,
    failed,
    canonicalEvidenceRows: saved,
    linkedInvoiceRows,
    ambiguousInvoiceRows,
    unmatchedInvoiceRows,
    productLinkedRows,
    reconciledProductConversions: 0,
  };
}
