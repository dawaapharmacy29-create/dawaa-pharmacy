import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { normalizeBranchName } from '@/lib/branch';
import { cairoDateBoundaryIso } from '@/lib/time/cairoDateBoundary';

export interface RawSalesInvoiceItemV21 {
  sheetName: string;
  rowIndex: number;
  invoiceNumber: string;
  branch: string;
  sourceBranch?: string;
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
  invalidRows: number;
  warnings: string[];
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
  invoice: ['فاتورة','رقم الفاتوره','رقم فاتوره','الفاتوره','الرقم','invoice number','invoice no','invoice_no'],
  branch: ['المخزن','الفرع','branch','branch name'],
  date: ['تاريخ','التاريخ','تاريخ الفاتوره','invoice date','date'],
  customerCode: ['كود','كود العميل','الكود','customer code','customer_code'],
  lineNo: ['م','رقم السطر','مسلسل','line no','line number','line_no'],
  productCode: ['ك.صنف','كود الصنف','كود المنتج','item code','product code','product_code','barcode'],
  productName: ['صنف','اسم الصنف','الصنف','اسم المنتج','item name','product name','description'],
  quantity: ['الكميه','كمية','qty','quantity'],
  unitPrice: ['سعر بيع','سعر البيع','السعر','سعر الوحده','unit price','price'],
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

function excelSaleDay(value: unknown): string | null {
  let day: string;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    day = [parsed.y, parsed.m, parsed.d].map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0')).join('-');
  } else {
    const raw = text(value);
    const iso = /^(\d{4}-\d{2}-\d{2})(?:$|[T ])/.exec(raw);
    const local = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:$|\s)/.exec(raw);
    day = iso?.[1] ?? (local ? `${local[3]}-${local[2].padStart(2, '0')}-${local[1].padStart(2, '0')}` : '');
  }
  const utc = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(utc.getTime()) && utc.toISOString().slice(0, 10) === day ? day : null;
}

export function parseSalesInvoiceItemsV21(buffer: ArrayBuffer, fallbackBranch: string): SalesInvoiceItemsParseResultV21 {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false, raw: true });
  const rows: RawSalesInvoiceItemV21[] = [];
  const detectedSheets: string[] = [];
  const warnings: string[] = [];
  let invalidRows = 0;

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
      if (!row.some((cell) => text(cell))) continue;
      const saleDay = idx.date >= 0 ? excelSaleDay(row[idx.date]) : null;
      const lineNo = idx.lineNo >= 0 ? numberOrNull(row[idx.lineNo]) : null;
      if (!invoiceNumber || !productName || !productCode || quantity == null || !saleDay || lineNo == null || !Number.isSafeInteger(lineNo) || lineNo < 1) {
        invalidRows += 1;
        continue;
      }

      rows.push({
        sheetName,
        rowIndex: r + 1,
        invoiceNumber,
        branch: idx.branch >= 0 ? text(row[idx.branch]) || fallbackBranch : fallbackBranch,
        invoiceDate: saleDay,
        customerCode: idx.customerCode >= 0 ? text(row[idx.customerCode]) || null : null,
        lineNo,
        productCode,
        productName,
        quantity,
        unitPrice: idx.unitPrice >= 0 ? numberOrNull(row[idx.unitPrice]) : null,
        lineTotal: idx.lineTotal >= 0 ? numberOrNull(row[idx.lineTotal]) : null,
        raw: Object.fromEntries(header.headers.map((name, i) => [name || `col_${i + 1}`, row[i]])),
      });
    }
  }

  if (!detectedSheets.length) warnings.push('الملف الحالي لا يحتوي Sheet واضح لتفاصيل أصناف الفواتير');
  if (detectedSheets.length && !rows.length) warnings.push('تم اكتشاف أعمدة تفاصيل أصناف لكن لم توجد صفوف صالحة للاستيراد.');
  return { rows, detectedSheets, warnings, invalidRows };
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

type InvoiceMatch = { id: string; invoice_number: string; invoice_date: string | null };
type PreviewStatus = 'ready' | 'existing' | 'duplicate' | 'conflict' | 'missing' | 'ambiguous' | 'wrong_branch';

export type SalesItemPreviewRow = {
  row: RawSalesInvoiceItemV21;
  status: PreviewStatus;
  invoice?: InvoiceMatch;
};

async function previewBranch(rows: RawSalesInvoiceItemV21[], branch: string) {
  const preview: SalesItemPreviewRow[] = rows.map((row) => ({
    row,
    status: !row.branch || normalizeBranchName(row.branch) === branch ? 'missing' : 'wrong_branch',
  }));
  const days = new Map<string, SalesItemPreviewRow[]>();
  for (const entry of preview) {
    if (entry.status === 'wrong_branch' || !entry.row.invoiceDate) continue;
    const day = entry.row.invoiceDate;
    const entries = days.get(day) ?? [];
    entries.push(entry);
    days.set(day, entries);
  }

  for (const [day, entries] of days) {
    const numbers = [...new Set(entries.map(({ row }) => row.invoiceNumber))];
    for (let offset = 0; offset < numbers.length; offset += 30) {
      const batch = numbers.slice(offset, offset + 30);
      const selected = new Set(batch);
      const [{ data: invoices, error: invoiceError }, { data: items, error: itemError }] = await Promise.all([
        supabase.from('sales_invoices').select('id,invoice_number,invoice_date')
          .eq('branch', branch).eq('sale_date', day).in('invoice_number', batch).limit(1000),
        supabase.from('sales_invoice_items_v21').select('invoice_number,line_no,product_code')
          .eq('branch', branch).in('invoice_number', batch)
          .gte('invoice_date', cairoDateBoundaryIso(day))
          .lte('invoice_date', cairoDateBoundaryIso(day, true)).limit(1000),
      ]);
      if (invoiceError || itemError || invoices?.length === 1000 || items?.length === 1000) {
        throw new Error('تعذرت مطابقة تفاصيل الأصناف مع فواتير الفرع. جرّب ملفًا بفترة أقصر أو راجع صلاحية الاستيراد.');
      }

      const itemKey = (number: string, line: number | null, code: string | null) => JSON.stringify([number, line, code]);
      const existing = new Set((items ?? []).map((item) => itemKey(item.invoice_number, item.line_no, item.product_code)));
      const seen = new Map<string, SalesItemPreviewRow>();
      for (const entry of entries) {
        const { row } = entry;
        if (!selected.has(row.invoiceNumber)) continue;
        const matches = (invoices ?? []).filter((invoice) => invoice.invoice_number === row.invoiceNumber);
        if (matches.length !== 1) {
          entry.status = matches.length ? 'ambiguous' : 'missing';
          continue;
        }
        entry.row = { ...row, sourceBranch: row.branch, branch };
        const key = itemKey(row.invoiceNumber, row.lineNo, row.productCode);
        if (existing.has(key)) {
          entry.status = 'existing';
          continue;
        }
        const previous = seen.get(key);
        if (previous) {
          const sameValues = JSON.stringify(previous.row.raw) === JSON.stringify(row.raw);
          entry.status = sameValues ? 'duplicate' : 'conflict';
          if (!sameValues) previous.status = 'conflict';
          continue;
        }
        seen.set(key, entry);
        entry.invoice = matches[0];
        entry.status = 'ready';
      }
    }
  }
  return preview;
}

export async function previewSalesInvoiceItemsV21(rows: RawSalesInvoiceItemV21[], branches: readonly string[]) {
  if (!branches.length) throw new Error('اختار فرع الملف.');
  const results = await Promise.all(branches.map((branch) => previewBranch(rows, branch)));
  return rows.map((row, index): SalesItemPreviewRow => {
    const checked = results.map((result) => result[index]);
    const matched = checked.filter(({ status }) => status !== 'missing' && status !== 'wrong_branch');
    if (matched.length > 1) return { row, status: 'ambiguous' };
    return matched[0] ?? checked.find(({ status }) => status === 'missing') ?? checked[0];
  });
}

export async function saveSalesInvoiceItemsV21(
  rows: RawSalesInvoiceItemV21[],
  branches: readonly string[],
  sourceFile: string,
) {
  const current = await previewSalesInvoiceItemsV21(rows, branches);
  const ready = current.filter((entry) => entry.status === 'ready' && entry.invoice);
  const batch = `bconnect-items-${crypto.randomUUID()}`;
  const payload = await Promise.all(ready.map(async ({ row, invoice }) => ({
    item_identity: await sha256(JSON.stringify(['bconnect-items', invoice!.id, row.lineNo, row.productCode])),
    invoice_id: invoice!.id,
    invoice_number: row.invoiceNumber,
    branch: row.branch,
    invoice_date: invoice!.invoice_date ?? cairoDateBoundaryIso(row.invoiceDate!),
    customer_code: row.customerCode,
    line_no: row.lineNo,
    product_code: row.productCode,
    product_name: row.productName,
    quantity: row.quantity,
    unit_price: row.unitPrice,
    line_total: row.lineTotal,
    source_file: sourceFile,
    import_batch: batch,
    raw_data: {
      invoice_net: numberOrNull(row.raw['صافى الفاتورة']),
      unit: text(row.raw['وحدة']),
      expiry: text(row.raw['صلاحية']),
      returned: numberOrNull(row.raw['مرتجع']),
      line_discount: numberOrNull(row.raw['خصم صنف']),
      source_row: row.rowIndex,
      source_sheet: row.sheetName,
      source_columns: row.raw,
    },
  })));

  let saved = 0;
  let failed = 0;
  for (let offset = 0; offset < payload.length; offset += 200) {
    const chunk = payload.slice(offset, offset + 200);
    const { data, error } = await supabase.from('sales_invoice_items_v21')
      .upsert(chunk, { onConflict: 'item_identity', ignoreDuplicates: true }).select('id');
    if (error) failed += chunk.length;
    else saved += data?.length ?? 0;
  }
  return { saved, failed, skipped: current.length - saved - failed };
}
