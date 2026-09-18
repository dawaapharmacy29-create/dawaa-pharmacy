import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';

export interface RawSalesInvoiceItemV21 {
  sheetName: string;
  rowIndex: number;
  invoiceNumber: string;
  branch: string;
  invoiceDate: string | null;
  customerCode: string | null;
  lineNo: number | null;
  productCode: string | null;
  productName: string;
  quantity: number | null;
  unitPrice: number | null;
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
  invoice: ['رقم الفاتوره','رقم فاتوره','الفاتوره','الرقم','invoice number','invoice no','invoice_no'],
  branch: ['المخزن','الفرع','branch','branch name'],
  date: ['التاريخ','تاريخ الفاتوره','invoice date','date'],
  customerCode: ['كود العميل','الكود','customer code','customer_code'],
  lineNo: ['رقم السطر','مسلسل','line no','line number','line_no'],
  productCode: ['كود الصنف','كود المنتج','item code','product code','product_code','barcode'],
  productName: ['اسم الصنف','الصنف','اسم المنتج','item name','product name','description'],
  quantity: ['الكميه','كمية','qty','quantity'],
  unitPrice: ['سعر البيع','السعر','سعر الوحده','unit price','price'],
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
          branch: indexOfAlias(row, HEADER_ALIASES.branch),
          date: indexOfAlias(row, HEADER_ALIASES.date),
          customerCode: indexOfAlias(row, HEADER_ALIASES.customerCode),
          lineNo: indexOfAlias(row, HEADER_ALIASES.lineNo),
          productCode,
          productName,
          quantity,
          unitPrice: indexOfAlias(row, HEADER_ALIASES.unitPrice),
          lineTotal: indexOfAlias(row, HEADER_ALIASES.lineTotal),
        },
      };
    }
  }
  return null;
}

function excelDateToIso(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      const date = new Date(parsed.y, parsed.m - 1, parsed.d, parsed.H || 0, parsed.M || 0, Math.floor(parsed.S || 0));
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
  }
  const raw = text(value);
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function parseSalesInvoiceItemsV21(buffer: ArrayBuffer, fallbackBranch: string): SalesInvoiceItemsParseResultV21 {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true, raw: true });
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

      rows.push({
        sheetName,
        rowIndex: r + 1,
        invoiceNumber,
        branch: idx.branch >= 0 ? text(row[idx.branch]) || fallbackBranch : fallbackBranch,
        invoiceDate: idx.date >= 0 ? excelDateToIso(row[idx.date]) : null,
        customerCode: idx.customerCode >= 0 ? text(row[idx.customerCode]) || null : null,
        lineNo: idx.lineNo >= 0 ? numberOrNull(row[idx.lineNo]) : null,
        productCode,
        productName,
        quantity,
        unitPrice: idx.unitPrice >= 0 ? numberOrNull(row[idx.unitPrice]) : null,
        lineTotal: idx.lineTotal >= 0 ? numberOrNull(row[idx.lineTotal]) : null,
        raw: Object.fromEntries(header.headers.map((name, i) => [name || `col_${i + 1}`, row[i]])),
      });
    }
  }

  if (!detectedSheets.length) warnings.push('الملف الحالي لا يحتوي Sheet واضح لتفاصيل أصناف الفواتير؛ سيتم استيراد ملخص الفواتير فقط.');
  if (detectedSheets.length && !rows.length) warnings.push('تم اكتشاف أعمدة تفاصيل أصناف لكن لم توجد صفوف صالحة للاستيراد.');
  return { rows, detectedSheets, warnings };
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
  if (!rows.length) return { parsed: 0, saved: 0, failed: 0, reconciledProductConversions: 0 };

  const payload: any[] = [];
  for (const row of rows) {
    const identityBase = [
      row.invoiceNumber,
      normalize(row.branch),
      row.invoiceDate || '',
      row.lineNo ?? '',
      row.productCode || '',
      normalize(row.productName),
    ].join('|');
    payload.push({
      item_identity: await sha256(identityBase),
      invoice_number: row.invoiceNumber,
      branch: row.branch,
      invoice_date: row.invoiceDate,
      customer_code: row.customerCode,
      line_no: row.lineNo,
      product_code: row.productCode,
      product_name: row.productName,
      quantity: row.quantity,
      unit_price: row.unitPrice,
      line_total: row.lineTotal,
      source_file: params.sourceFile || null,
      import_batch: params.importBatch || null,
      raw_data: row.raw,
      created_by: params.createdBy || null,
      updated_at: new Date().toISOString(),
    });
  }

  let saved = 0;
  let failed = 0;
  let reconciledProductConversions = 0;
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
    for (const row of data || []) {
      const { data: count, error: reconcileError } = await supabase.rpc('dawaa_reconcile_whatsapp_product_conversion_v21', { p_item_id: row.id });
      if (!reconcileError) reconciledProductConversions += Number(count || 0);
    }
  }
  return { parsed: rows.length, saved, failed, reconciledProductConversions };
}
