// Reads the ePlus «فواتير الشراء» report (Excel export) of one store: a header line per invoice
// (ملاحظات … مسلسل), its item lines, then a «الإجمالى» line. Sections «آجل» and «نقدى» split credit
// invoices from the ones paid cash; the report's own «صافى الفواتير» total is kept to check the sum.

export type PurchaseBranch = 'فرع شكري' | 'فرع الشامي';

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
}

export interface ParsedReport {
  store: string;
  branch: PurchaseBranch;
  invoices: ParsedInvoice[];
  /** «صافى الفواتير» of the report's grand total line, when present. */
  reportNet: number | null;
  firstDay: string;
  lastDay: string;
}

type Cell = string | number | null | undefined;

const text = (value: Cell) => String(value ?? '').trim();

export function reportNumber(value: Cell): number {
  if (typeof value === 'number') return value;
  const cleaned = text(value).replace(/[,%$\s]/g, '');
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** «13/09/2026  00:05: » → «2026-09-13T00:05:00». */
export function reportDate(value: Cell): string | null {
  const match = text(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!match) return null;
  const [, d, m, y, hh = '0', mm = '00'] = match;
  const pad = (s: string) => s.padStart(2, '0');
  return `${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${mm}:00`;
}

/** فرع شكري = «الادارة فرع شكري» + «مخزن د.وائل»; فرع الشامي = «الفرعية الشامي» + «مخزن د معاذ». */
export function branchOfStore(store: string): PurchaseBranch | null {
  if (/شكري|وائل/.test(store)) return 'فرع شكري';
  if (/الشامي|معاذ/.test(store)) return 'فرع الشامي';
  return null;
}

const isInvoiceHeader = (row: Cell[]) =>
  text(row[0]) === 'ملاحظات' && text(row[2]) === 'صافى الفاتورة';
const isTotalLine = (row: Cell[]) => text(row[6]) === 'الإجمالى' && text(row[8]) === 'عدد الأصناف';
const SECTIONS: Record<string, 'credit' | 'cash'> = { آجل: 'credit', نقدى: 'cash', نقدي: 'cash' };

export class ReportError extends Error {}

export function parseEPlusPurchases(rows: Cell[][]): ParsedReport {
  const title = text(rows[0]?.[0]);
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
      const at = reportDate(row[22]);
      if (!at) throw new ReportError(`تاريخ مش مفهوم في الفاتورة ${text(row[23])}`);
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
