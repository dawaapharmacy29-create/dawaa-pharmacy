// Reads the ePlus «فواتير الشراء» report (Excel export) of one store: a header line per invoice
// (ملاحظات … مسلسل), its item lines, then a «الإجمالى» line. Sections «آجل» and «نقدى» split credit
// invoices from the ones paid cash; the report's own «صافى الفواتير» total is kept to check the sum.
// The same report grouped by supplier (one line per invoice under «<المورد> موردين», no codes) is read
// too: its invoices carry the supplier's name only, and the page fills the codes in from the names.

export type PurchaseBranch = 'فرع شكري' | 'فرع الشامي';

/** One item line of an invoice in the detailed report (the columns ن.الربح … الكود under the header). */
export interface ParsedLine {
  line_no: number;
  code: string;
  name: string;
  qty: number;
  bonus: number;
  return_qty: number;
  /** Purchase price of one unit, and the line's purchase total. */
  buy_price: number;
  buy_total: number;
  sell_price: number;
  sell_total: number;
  profit: number;
  profit_pct: number;
  /** «MM/YYYY» as written. */
  expiry: string | null;
}

export interface ParsedInvoice {
  serial: string;
  payment: 'credit' | 'cash';
  /** Local Cairo time as written in the report, «YYYY-MM-DDTHH:MM:00». */
  invoice_at: string;
  supplier_code: string;
  supplier_name: string;
  supplier_invoice_no: string | null;
  items: number;
  gross: number;
  discount: number;
  expenses: number;
  tax: number;
  net: number;
  entered_by: string | null;
  note: string | null;
  /** The item lines, when the report was exported with them. */
  lines?: ParsedLine[];
}

export interface ParsedReport {
  store: string;
  branch: PurchaseBranch;
  invoices: ParsedInvoice[];
  /** «صافى الفواتير» of the report's grand total line, when present. */
  reportNet: number | null;
  firstDay: string;
  lastDay: string;
  /** Grouped by supplier: the invoices have names but no supplier codes yet. */
  needsCodes?: boolean;
}

type Cell = string | number | null | undefined;

const text = (value: Cell) => String(value ?? '').trim();

export function reportNumber(value: Cell): number {
  if (typeof value === 'number') return value;
  const cleaned = text(value).replace(/[,%$\s]/g, '');
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Read the local Cairo time without applying the browser's timezone. */
export function reportDate(value: Cell, date1904 = false): string | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < (date1904 ? 0 : 1) || value >= 2958466) return null;
    const day = Math.floor(value);
    if (!date1904 && day === 60) return null; // Excel's fictitious 29 February 1900
    const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, day < 60 ? 31 : 30);
    const date = new Date(epoch + Math.round(value * 86400) * 1000);
    return date.getUTCFullYear() <= 9999 ? date.toISOString().slice(0, 19) : null;
  }

  const normalized = text(value)
    .replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/[٠-٩۰-۹]/g, (digit) => String(digit.charCodeAt(0) & 15))
    .trim();
  const iso = normalized.match(/^(\d{4})([-/])(\d{1,2})\2(\d{1,2})(.*)$/);
  const local = normalized.match(/^(\d{1,2})([./-])(\d{1,2})\2(\d{4})(.*)$/);
  if (!iso && !local) return null;
  const [, first, , middle, last, suffix] = (iso ?? local)!;
  const time = suffix.match(/^(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})?)?\s*(AM|PM|ص|م)?)?$/i);
  if (!time) return null;

  const year = Number(iso ? first : last);
  const month = Number(middle);
  const day = Number(iso ? last : first);
  let hour = Number(time[1] ?? 0);
  const minute = Number(time[2] ?? 0);
  const second = Number(time[3] ?? 0);
  const period = time[4]?.toUpperCase();
  if (period) {
    if (hour < 1 || hour > 12) return null;
    hour = hour % 12 + (period === 'PM' || period === 'م' ? 12 : 0);
  }
  if (year < 1900 || hour > 23 || minute > 59 || second > 59) return null;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 19);
}

/** فرع شكري = «الادارة فرع شكري» + «مخزن د.وائل»; فرع الشامي = «الفرعية الشامي» + «مخزن د معاذ». */
export function branchOfStore(store: string): PurchaseBranch | null {
  if (/شكري|وائل/.test(store)) return 'فرع شكري';
  if (/الشامي|معاذ/.test(store)) return 'فرع الشامي';
  return null;
}

const isInvoiceHeader = (row: Cell[]) =>
  text(row[0]) === 'ملاحظات' && text(row[2]) === 'صافى الفاتورة';
/** An item line: a code and a name in their columns and a number in «كمية». */
function itemLine(row: Cell[], lineNo: number): ParsedLine | null {
  const code = text(row[15]);
  const name = text(row[14]).replace(/\s+/g, ' ');
  if (!code || !name || text(row[6]) === 'الإجمالى' || !/\d/.test(text(row[11]))) return null;
  return {
    line_no: lineNo,
    code,
    name,
    qty: reportNumber(row[11]),
    bonus: reportNumber(row[10]),
    return_qty: reportNumber(row[9]),
    buy_price: reportNumber(row[5]),
    buy_total: reportNumber(row[4]),
    sell_price: reportNumber(row[3]),
    sell_total: reportNumber(row[18]),
    profit: reportNumber(row[1]),
    profit_pct: reportNumber(row[0]),
    expiry: text(row[13]) || null,
  };
}

const isTotalLine = (row: Cell[]) => text(row[6]) === 'الإجمالى' && text(row[8]) === 'عدد الأصناف';
const SECTIONS: Record<string, 'credit' | 'cash'> = { آجل: 'credit', نقدى: 'cash', نقدي: 'cash' };

export class ReportError extends Error {}

const isGroupedHeader = (row: Cell[]) => text(row[0]) === 'المستخدم' && text(row[9]) === 'مسلسل';

export function parseEPlusPurchases(rows: Cell[][], date1904 = false): ParsedReport {
  const title = text(rows[0]?.[0]);
  if (rows.some(isGroupedHeader)) return parseBySupplier(rows, title, date1904);
  const store = text(rows[1]?.[0]) || title.match(/المخزن\s+([^,]+)/)?.[1]?.trim() || '';
  if (!/فواتير|الإسترجاع/.test(title) && !rows.some(isInvoiceHeader))
    throw new ReportError('الملف ده مش تقرير فواتير شراء من ePlus');
  const branch = branchOfStore(store);
  if (!branch) throw new ReportError(`المخزن «${store || '؟'}» مش معروف تبع أنهي فرع`);

  const invoices: ParsedInvoice[] = [];
  let section: 'credit' | 'cash' = 'credit';
  let current: ParsedInvoice | null = null;
  let reportNet: number | null = null;

  for (const row of rows.slice(2)) {
    const first = text(row[0]);
    const filled = row.filter((cell) => text(cell)).length;
    if (filled <= 3 && SECTIONS[first]) {
      section = SECTIONS[first];
      continue;
    }
    if (isInvoiceHeader(row)) {
      const at = reportDate(row[22], date1904);
      if (!at) throw new ReportError(`تاريخ الفاتورة ${text(row[23])} في ${store}: ${text(row[22]) ? `القيمة «${text(row[22])}» غير صالحة` : 'خانة التاريخ فاضية'}`);
      current = {
        serial: text(row[23]),
        payment: section,
        invoice_at: at,
        supplier_code: text(row[21]),
        supplier_name: text(row[20]),
        supplier_invoice_no: null,
        items: 0,
        gross: reportNumber(row[19]),
        discount: reportNumber(row[18]),
        expenses: reportNumber(row[16]),
        tax: reportNumber(row[15]),
        net: reportNumber(row[14]),
        entered_by: text(row[13]) || null,
        note: text(row[12]) || null,
      };
      invoices.push(current);
      continue;
    }
    if (current && !isTotalLine(row)) {
      const line = itemLine(row, (current.lines?.length ?? 0) + 1);
      if (line) {
        current.lines = [...(current.lines ?? []), line];
        continue;
      }
    }
    if (current && isTotalLine(row)) {
      current.items = reportNumber(row[7]);
      const supplierNo = text(row[9]);
      current.supplier_invoice_no = supplierNo && supplierNo !== current.serial ? supplierNo : null;
      current = null;
      continue;
    }
    if (text(row[10]).startsWith('الإجم') && text(row[3]) === 'صافى الفواتير')
      reportNet = reportNumber(row[2]);
  }

  const kept = invoices.filter((inv) => inv.serial && inv.supplier_code);
  if (!kept.length) throw new ReportError('مفيش فواتير في الملف');
  const days = kept.map((inv) => inv.invoice_at.slice(0, 10)).sort();
  return {
    store,
    branch,
    invoices: kept,
    reportNet,
    firstDay: days[0],
    lastDay: days[days.length - 1],
  };
}

/** «فواتير الشراء» grouped by supplier: «<المورد> | موردين», «<المخزن> | آجل/نقدى», then a line per
 * invoice (المستخدم, الصافى, ض.إضافة, مصاريف, خصم %, خصم قيمة, ق.المرتجع, ق.الفاتورة, العدد, مسلسل,
 * التاريخ) and the supplier's totals; the last «الإجمالى النهائى» line has the report's net. */
function parseBySupplier(rows: Cell[][], title: string, date1904: boolean): ParsedReport {
  const store = title.match(/المخزن\s+([^,]+)/)?.[1]?.trim() ?? '';
  const branch = branchOfStore(store);
  if (!branch) throw new ReportError(`المخزن «${store || '؟'}» مش معروف تبع أنهي فرع`);

  const invoices: ParsedInvoice[] = [];
  let supplier = '';
  let section: 'credit' | 'cash' = 'credit';
  let reportNet: number | null = null;
  for (const row of rows.slice(1)) {
    const filled = row.filter((cell) => text(cell)).length;
    if (filled === 2 && text(row[1]) === 'موردين') {
      supplier = text(row[0]);
      continue;
    }
    if (filled === 2 && SECTIONS[text(row[1])]) {
      section = SECTIONS[text(row[1])];
      continue;
    }
    if (text(row[9]) === 'الإجمالى النهائى') {
      reportNet = reportNumber(row[8]);
      continue;
    }
    const serial = text(row[9]);
    if (!serial || !supplier) continue;
    const at = reportDate(row[10], date1904);
    if (!at && !/^[0-9٠-٩۰-۹]+$/.test(serial)) continue;
    if (!at) throw new ReportError(`تاريخ الفاتورة ${serial} في ${store}: ${text(row[10]) ? `القيمة «${text(row[10])}» غير صالحة` : 'خانة التاريخ فاضية'}`);
    invoices.push({
      serial,
      payment: section,
      invoice_at: at,
      supplier_code: '',
      supplier_name: supplier,
      supplier_invoice_no: null,
      items: reportNumber(row[8]),
      gross: reportNumber(row[7]),
      discount: reportNumber(row[5]),
      expenses: reportNumber(row[3]),
      tax: reportNumber(row[2]),
      net: reportNumber(row[1]),
      entered_by: text(row[0]) || null,
      note: null,
    });
  }
  if (!invoices.length) throw new ReportError('مفيش فواتير في الملف');
  const days = invoices.map((inv) => inv.invoice_at.slice(0, 10)).sort();
  return {
    store,
    branch,
    invoices,
    reportNet,
    firstDay: days[0],
    lastDay: days[days.length - 1],
    needsCodes: true,
  };
}

/** Fills the supplier codes of a report grouped by supplier from the names we know (same name after
 * normalizing). A name we never saw keeps itself as its code, so it still shows up as a supplier. */
export function fillSupplierCodes(
  report: ParsedReport,
  known: { code: string; name: string }[],
  normalize: (name: string) => string
): { report: ParsedReport; unknown: string[] } {
  if (!report.needsCodes) return { report, unknown: [] };
  const byName = new Map<string, string | null>();
  for (const s of known) {
    const key = normalize(s.name);
    byName.set(key, byName.has(key) && byName.get(key) !== s.code ? null : s.code);
  }
  const unknown = new Set<string>();
  const invoices = report.invoices.map((inv) => {
    const code = byName.get(normalize(inv.supplier_name));
    if (!code) unknown.add(inv.supplier_name);
    return { ...inv, supplier_code: code ?? inv.supplier_name };
  });
  return { report: { ...report, invoices, needsCodes: false }, unknown: [...unknown] };
}
