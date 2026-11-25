import { supabase } from '@/supabaseClient';

// أصناف فاتورة الشراء (من تقرير ePlus التفصيلي) ومطابقة أصناف التحويل بين الفرعين:
// فاتورة البيع في الفرع اللي بعت قصاد فاتورة الشراء في الفرع اللي استلم، صنف صنف.

export type InvoiceLine = {
  line_no: number;
  code: string;
  name: string;
  qty: number;
  bonus: number;
  return_qty: number;
  buy_price: number;
  buy_total: number;
  sell_price: number;
  sell_total: number;
  profit: number;
  profit_pct: number;
  expiry: string | null;
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export async function loadInvoiceLines(store: string, serial: string): Promise<InvoiceLine[]> {
  const { data, error } = await supabase.rpc('dawaa_purchase_invoice_lines_v1', {
    p_store: store,
    p_serial: serial,
  });
  if (error) {
    if (/does not exist|Could not find the function/i.test(error.message ?? ''))
      throw new Error('الصفحة لسه مستنية تحديث قاعدة البيانات');
    throw new Error('تعذّر تحميل أصناف الفاتورة');
  }
  return ((data ?? []) as InvoiceLine[]).map((l) => ({
    ...l,
    code: String(l.code),
    qty: num(l.qty),
    bonus: num(l.bonus),
    return_qty: num(l.return_qty),
    buy_price: num(l.buy_price),
    buy_total: num(l.buy_total),
    sell_price: num(l.sell_price),
    sell_total: num(l.sell_total),
    profit: num(l.profit),
    profit_pct: num(l.profit_pct),
  }));
}

/** One item on one side of a transfer. */
export type SideLine = { code: string; name: string; qty: number; price?: number };

export type LineCheck =
  /** Same code and quantity on both sides. */
  | 'ok'
  /** Same code, another quantity (a box against a strip, two against one). */
  | 'qty'
  /** The same item under two codes: a duplicate code to merge in B-Connect. */
  | 'code'
  | 'only_sale'
  | 'only_purchase';

export type LineCompare = {
  check: LineCheck;
  sale: SideLine | null;
  purchase: SideLine | null;
  /** For «code»: whether the quantities also differ. */
  qtyDiffers?: boolean;
};

export const LINE_CHECKS: Record<LineCheck, string> = {
  ok: 'مطابق',
  qty: 'الكمية مختلفة',
  code: 'نفس الصنف بكود تاني',
  only_sale: 'اتباع ومااتشراش',
  only_purchase: 'اتشرى ومااتباعش',
};

const sameQty = (a: number, b: number) => Math.abs(a - b) < 0.001;

const AR_DIGITS = /[٠-٩]/g;
/** Lower case, Arabic digits to Latin, numbers split from letters («500mg» → «500 mg»), no punctuation. */
export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(AR_DIGITS, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/(\d)([a-z؀-ۿ])/g, '$1 $2')
    .replace(/([a-z؀-ۿ])(\d)/g, '$1 $2')
    .replace(/[^a-z0-9.؀-ۿ]+/g, ' ')
    .split(' ')
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter(Boolean);
}

/**
 * How much two item names look like the same item, 0..1. The numbers (strength, size, count) must agree:
 * «pampers premium 1» and «pampers premium 2» are two items, «PAMPERS PREM 1 60 PCS» and «pampers premium 1» are one.
 */
export function nameSimilarity(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return 0;
  const numsA = ta.filter((t) => /^\d/.test(t));
  const numsB = tb.filter((t) => /^\d/.test(t));
  const [fewer, more] = numsA.length <= numsB.length ? [numsA, numsB] : [numsB, numsA];
  if (fewer.some((n) => !more.includes(n))) return 0;
  const words = (t: string[]) => t.filter((x) => !/^\d/.test(x));
  const wa = words(ta);
  const wb = words(tb);
  if (!wa.length || !wb.length) return 0;
  // كلمة بتطابق لو هي هي أو واحدة أول التانية («prem» و«premium»)، بشرط ٣ حروف على الأقل.
  const hit = (w: string, list: string[]) =>
    list.some(
      (x) => x === w || (w.length >= 3 && x.length >= 3 && (x.startsWith(w) || w.startsWith(x)))
    );
  // أول كلمة (اسم الصنف) لازم تطابق.
  if (!hit(wa[0], wb.slice(0, 2)) && !hit(wb[0], wa.slice(0, 2))) return 0;
  const shared = wa.filter((w) => hit(w, wb)).length;
  return shared / Math.max(wa.length, wb.length);
}

function bySum(lines: SideLine[]): Map<string, SideLine> {
  const m = new Map<string, SideLine>();
  for (const l of lines) {
    const code = String(l.code ?? '').trim();
    const e = m.get(code);
    if (e) e.qty += l.qty;
    else m.set(code, { ...l, code });
  }
  return m;
}

/** The transfer item by item: the sale in the branch that sent it against the purchase in the one that got it. */
export function compareTransferLines(sale: SideLine[], purchase: SideLine[]): LineCompare[] {
  const s = bySum(sale);
  const p = bySum(purchase);
  const out: LineCompare[] = [];
  for (const [code, sl] of s) {
    const pl = p.get(code);
    if (!pl) continue;
    out.push({ check: sameQty(sl.qty, pl.qty) ? 'ok' : 'qty', sale: sl, purchase: pl });
    s.delete(code);
    p.delete(code);
  }
  // اللي فاضل في الناحيتين: نفس الصنف بكودين؟ أقرب اسم الأول، والسعر بيرجّح لو الاسمين قريبين بنفس الدرجة.
  const candidates: Array<{ sl: SideLine; pl: SideLine; score: number }> = [];
  for (const sl of s.values())
    for (const pl of p.values()) {
      let score = nameSimilarity(sl.name, pl.name);
      if (score < 0.5) continue;
      if (sl.price && pl.price && Math.abs(sl.price - pl.price) <= Math.max(1, sl.price * 0.02))
        score += 0.1;
      candidates.push({ sl, pl, score });
    }
  candidates.sort((a, b) => b.score - a.score);
  for (const c of candidates) {
    if (!s.has(c.sl.code) || !p.has(c.pl.code)) continue;
    out.push({
      check: 'code',
      sale: c.sl,
      purchase: c.pl,
      qtyDiffers: !sameQty(c.sl.qty, c.pl.qty),
    });
    s.delete(c.sl.code);
    p.delete(c.pl.code);
  }
  for (const sl of s.values()) out.push({ check: 'only_sale', sale: sl, purchase: null });
  for (const pl of p.values()) out.push({ check: 'only_purchase', sale: null, purchase: pl });
  const order: LineCheck[] = ['code', 'qty', 'only_sale', 'only_purchase', 'ok'];
  return out.sort((a, b) => order.indexOf(a.check) - order.indexOf(b.check));
}

export const lineIssues = (rows: LineCompare[]) => rows.filter((r) => r.check !== 'ok');
