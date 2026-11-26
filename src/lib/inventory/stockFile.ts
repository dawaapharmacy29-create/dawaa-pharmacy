// قراءة ملفات رصيد المخازن من بي كونكت (صاحب الصيدلية 2026-11-26):
// - «رصيد الأصناف في المخازن»: كل مخزن ليه عنوان («الادارة فرع شكري» + «المخزن»)، وكل صنف سطر عنوان (الكود والاسم والشركة
//   والوحدة والإجمالي) وتحته سطر لكل تشغيلة (الصلاحية، تاريخ الشراء، سعر البيع، التكلفة، الكمية، المورد). العناوين مقلوبة
//   (الملف RTL)، فبنقرا بالمكان: أول ٥ خانات في سطر الصنف = الإجمالي/الوحدة/الشركة/الاسم/الكود، وسطر التشغيلة بنفس ترتيب
//   «موقع الصنف ... كود المورد».
// - «رصيد الأصناف»: سطر لكل صنف وعمود لكل مخزن («الادارة فرع شكري»، «م. د.وائل»، «الفرعية الشامي»، «م. د معاذ») من غير تكلفة.

export type StockRow = {
  /** store */ s: string;
  /** product code */ c: string;
  /** name */ n: string;
  /** company */ co?: string;
  /** unit */ u?: string;
  /** qty */ q: number;
  /** cost */ k?: number | null;
  /** sale price */ p?: number | null;
  /** expiry (YYYY-MM-DD) */ e?: string | null;
  /** purchase day */ b?: string | null;
  /** supplier */ sp?: string | null;
  /** location */ l?: string | null;
};

export type StockFile = {
  kind: 'batches' | 'summary';
  rows: StockRow[];
  stores: Array<{ store: string; items: number; qty: number }>;
  /** The day the report was printed, when the footer has it. */
  printedDay: string | null;
};

type Cell = string | number | null | undefined;

const txt = (v: Cell) =>
  String(v ?? '')
    .replace(/ـ/g, '')
    .trim();
const num = (v: Cell): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = txt(v).replace(/,/g, '');
  if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
};

/** An Excel serial day (46296) or a dd/mm/yyyy text as YYYY-MM-DD. */
export function excelDay(v: Cell): string | null {
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return d.toISOString().slice(0, 10);
  }
  const m = txt(v).match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const iso = txt(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

/** Services, not stock (home delivery, sugar and pressure checks, nursing): left out of the balance. */
export const SERVICE_ITEM = /^\s*(توصيل|قياس|خدم[ةه]|nursing|delivery)/i;

const SUMMARY_STORE = /فرع|مخزن|^م\.|اكسب|المكتب/;

function printedDayOf(rows: Cell[][]): string | null {
  for (let i = rows.length - 1; i >= Math.max(0, rows.length - 5); i -= 1) {
    const r = rows[i] ?? [];
    if (!r.some((c) => /وقت الطباعة|Page/.test(txt(c)))) continue;
    for (const c of r) {
      const d = typeof c === 'number' ? excelDay(Math.floor(c)) : null;
      if (d) return d;
    }
  }
  return null;
}

function finish(kind: StockFile['kind'], all: StockRow[], printed: string | null): StockFile {
  const rows = all.filter((r) => !SERVICE_ITEM.test(r.n));
  const by = new Map<string, { store: string; items: Set<string>; qty: number }>();
  for (const r of rows) {
    const e = by.get(r.s) ?? { store: r.s, items: new Set<string>(), qty: 0 };
    if (r.q > 0) e.items.add(r.c);
    e.qty += r.q;
    by.set(r.s, e);
  }
  return {
    kind,
    rows,
    stores: [...by.values()].map((e) => ({
      store: e.store,
      items: e.items.size,
      qty: Math.round(e.qty),
    })),
    printedDay: printed,
  };
}

/** The batches report: store titles, item header lines and a line per batch. */
function parseBatches(rows: Cell[][]): StockRow[] {
  const out: StockRow[] = [];
  let store = '';
  let item: { c: string; n: string; co: string; u: string; total: number } | null = null;
  let batches = 0;
  const flushEmpty = () => {
    // صنف من غير ولا تشغيلة: الإجمالي بس.
    if (item && batches === 0 && store && item.total)
      out.push({ s: store, c: item.c, n: item.n, co: item.co, u: item.u, q: item.total });
  };
  for (const r of rows) {
    const a = txt(r[0]);
    const b = txt(r[1]);
    if (b === 'المخزن' && a) {
      flushEmpty();
      item = null;
      store = a;
      continue;
    }
    if (a === 'الإجمالى' || a === 'الإجمالي') {
      flushEmpty();
      batches = 0;
      const code = txt(r[9]);
      item = code
        ? {
            c: code,
            n: txt(r[8]),
            co: txt(r[7]),
            u: txt(r[6]),
            total: num(r[5]) ?? 0,
          }
        : null;
      continue;
    }
    if (!item || !store) continue;
    const qty = num(r[6]);
    // سطر التشغيلة: الكمية في الخانة السابعة والتكلفة قبلها.
    if (qty == null || (num(r[5]) == null && num(r[4]) == null && excelDay(r[1]) == null)) continue;
    batches += 1;
    out.push({
      s: store,
      c: item.c,
      n: item.n,
      co: item.co || undefined,
      u: item.u || undefined,
      q: qty,
      k: num(r[5]),
      p: num(r[4]),
      e: excelDay(r[1]),
      b: excelDay(typeof r[3] === 'number' ? Math.floor(r[3]) : r[3]),
      sp: txt(r[7]) || null,
      l: a && a !== '.' ? a : null,
    });
  }
  flushEmpty();
  return out;
}

/** The per-store balance report: a column per store. */
function parseSummary(rows: Cell[][], headerAt: number): StockRow[] {
  const head = rows[headerAt].map(txt);
  const codeCol = head.lastIndexOf('الكود');
  const nameCol = head.findIndex((h) => /^(إسم|اسم) الصنف$|^الإسم$/.test(h));
  const companyCol = head.findIndex((h) => h === 'الشركة' || h === 'الشركة المنتجة');
  const unitCol = head.indexOf('الوحدة');
  const stores = head
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => h && SUMMARY_STORE.test(h) && h !== 'الإجمالى' && h !== 'الإجمالي');
  const out: StockRow[] = [];
  for (const r of rows.slice(headerAt + 1)) {
    const c = txt(r[codeCol]);
    if (!c || !/^\d+$/.test(c)) continue;
    for (const { h, i } of stores) {
      const q = num(r[i]);
      if (!q) continue;
      out.push({
        s: h,
        c,
        n: txt(r[nameCol]),
        co: companyCol >= 0 ? txt(r[companyCol]) || undefined : undefined,
        u: unitCol >= 0 ? txt(r[unitCol]) || undefined : undefined,
        q,
      });
    }
  }
  return out;
}

export function parseStockRows(rows: Cell[][]): StockFile {
  const printed = printedDayOf(rows);
  const first = rows.slice(0, 15);
  if (first.some((r) => txt(r[1]) === 'المخزن'))
    return finish('batches', parseBatches(rows), printed);
  // «رصيد الأصناف»: سطر العناوين فيه الكود وعمودين مخازن على الأقل (وأوله «الإجمالى» برضه).
  const headerAt = first.findIndex(
    (r) =>
      r.map(txt).includes('الكود') && r.map(txt).filter((h) => SUMMARY_STORE.test(h)).length >= 2
  );
  if (headerAt >= 0) return finish('summary', parseSummary(rows, headerAt), printed);
  throw new Error(
    'الملف ده مش «رصيد الأصناف في المخازن» ولا «رصيد الأصناف» من بي كونكت. صدّري التقرير إكسيل زي ما هو وارفعيه.'
  );
}

export async function readStockFile(file: File): Promise<StockFile> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, defval: '', raw: true });
  return parseStockRows(rows);
}
