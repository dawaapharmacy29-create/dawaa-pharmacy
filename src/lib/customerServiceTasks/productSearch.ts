import { supabase } from '@/supabaseClient';

// بحث الأصناف لتسجيل طلبات العملاء (صاحب الصيدلية 2026-11-26): الكتالوج كله (حوالي ١١ ألف صنف) بيتحمّل مرة
// ويتحفظ في المتصفح، والبحث بيحصل في الصفحة مع كل حرف من غير ما يستنى السيرفر.
// - رقم: كود الصنف (المطابق الأول، وبعده اللي بيبدأ بيه).
// - إنجليزي: كل كلمة لازم تبقى في الاسم بأي ترتيب ("pana extra" = PANADOL EXTRA).
// - عربي: الأسماء العربي في الكتالوج، والحروف الساكنة للاسم الإنجليزي ("بانادول" = PANADOL، "كتافلام" = CATAFLAM).
// - النجمة * مكان أي حروف مش متأكدين منها ("الف*ن*رن"، "pan*ext").
// الأصناف اللي بتتباع أكتر آخر ١٢٠ يوم بتطلع الأول لما النتايج تتساوى.

export type CatalogItem = {
  code: string;
  name: string;
  price: number | null;
  sold: number;
};

type Entry = CatalogItem & {
  lower: string;
  arabic: string;
  skel: string;
  firstSkel: string;
  /** The consonants of each word of the name. */
  words: string[];
};
export type CatalogIndex = Entry[];

const AR_TO_LATIN: Record<string, string> = {
  ب: 'b',
  ت: 't',
  ث: 's',
  ج: 'g',
  ح: 'h',
  خ: 'k',
  د: 'd',
  ذ: 'z',
  ر: 'r',
  ز: 'z',
  س: 's',
  ش: 's',
  ص: 's',
  ض: 'd',
  ط: 't',
  ظ: 'z',
  غ: 'g',
  ف: 'f',
  ق: 'k',
  ك: 'k',
  ل: 'l',
  م: 'm',
  ن: 'n',
  ه: 'h',
  پ: 'b',
  ڤ: 'f',
};

const latinDigits = (v: string) =>
  v
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
const isArabic = (v: string) => /[؀-ۿ]/.test(v);
const normArabic = (v: string) =>
  v
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[ً-ْـ]/g, '');

/** The consonants of a word, the same for an Arabic spelling and its Latin catalog name. */
export function skeleton(text: string): string {
  const lower = latinDigits(text).toLowerCase();
  const latin = isArabic(lower)
    ? [...normArabic(lower)].map((ch) => AR_TO_LATIN[ch] ?? (/[a-z]/.test(ch) ? ch : '')).join('')
    : lower
        .replace(/ph/g, 'f')
        .replace(/th/g, 't')
        .replace(/sh|ch/g, 's')
        .replace(/c(?=[eiy])/g, 's')
        .replace(/q|c/g, 'k')
        .replace(/x/g, 'ks')
        .replace(/j/g, 'g')
        .replace(/v/g, 'f')
        .replace(/p/g, 'b')
        .replace(/[^a-z]/g, '');
  return latin
    .replace(/z/g, 's')
    .replace(/[aeiouwy]/g, '')
    .replace(/(.)\1+/g, '$1');
}

const firstWord = (name: string) =>
  latinDigits(name)
    .split(/[\s\d.\-_/()+,]+/)
    .find((w) => w.length >= 2) ?? '';

export function buildIndex(rows: CatalogItem[]): CatalogIndex {
  return rows.map((r) => ({
    ...r,
    lower: latinDigits(r.name).toLowerCase().replace(/\s+/g, ' '),
    arabic: isArabic(r.name) ? normArabic(r.name).replace(/\s+/g, ' ') : '',
    skel: skeleton(r.name),
    firstSkel: skeleton(firstWord(r.name)),
    words: latinDigits(r.name)
      .split(/[^p{L}]+/u)
      .map(skeleton)
      .filter((w) => w.length >= 2),
  }));
}

const escape = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NOISE =
  /^(?:علب[هة]?|علب|شريط|شرايط|اكياس|كيس|فيال|امبول|حقن[هة]?|شراب|كريم|اقراص|كبسول|نقط|دهان|جيل|بخاخ|لبوس)$/;

// اللي بيتحسب من الكلمة المكتوبة بيتحسب مرة واحدة للبحث، مش مع كل صنف من الـ ١١ ألف.
const memo = new Map<string, unknown>();
const once = <T>(key: string, make: () => T): T => {
  if (!memo.has(key)) memo.set(key, make());
  return memo.get(key) as T;
};
const rx = (src: string) => once('r' + src, () => new RegExp(src));
const qs = (word: string) => once('s' + word, () => skeleton(word));

function scoreEntry(e: Entry, q: string): number {
  if (/^\d+$/.test(q)) {
    if (e.code === q) return 1000;
    if (e.code.startsWith(q)) return 700 - Math.min(e.code.length - q.length, 50);
    return e.lower.split(/[^a-z0-9]+/).includes(q) ? 150 : 0;
  }

  if (q.includes('*')) {
    const parts = q
      .split('*')
      .map((p) => p.trim())
      .filter(Boolean);
    if (!parts.length) return 0;
    if (isArabic(q)) {
      const plain = rx(parts.map((p) => escape(normArabic(p))).join('.*'));
      if (e.arabic && plain.test(e.arabic)) return 700;
      const skels = parts.map(skeleton).filter(Boolean);
      if (skels.join('').length < 3) return 0;
      // جوه كلمة واحدة من الاسم، ومن أولها إلا لو بدأت بـ *: «الف*ن*رن» = ALPHINTERN مش أي اسم فيه الحروف دي متفرقة.
      const anchor = q.trim().startsWith('*') ? '' : '^';
      const inWord = (list: string[], first: number, other: number) => {
        const re = rx(anchor + list.map(escape).join('.*'));
        if (re.test(e.firstSkel)) return first;
        return e.words.some((w) => re.test(w)) ? other : 0;
      };
      const hit = inWord(skels, 500, 420);
      if (hit) return hit;
      // «الـ» في أول الكلمة العربي ممكن تبقى جزء من الاسم أو لأ.
      const noArticle = skels[0].replace(/^l/, '');
      if (anchor && noArticle.length >= 1 && noArticle !== skels[0])
        return inWord([noArticle, ...skels.slice(1)], 440, 400);
      return 0;
    }
    const re = rx(parts.map((p) => escape(p.toLowerCase())).join('.*'));
    if (!re.test(e.lower))
      return e.code && rx(`^${parts.map(escape).join('.*')}`).test(e.code) ? 300 : 0;
    return e.lower.startsWith(parts[0].toLowerCase()) ? 560 : 480;
  }

  if (isArabic(q)) {
    const nq = normArabic(q).replace(/\s+/g, ' ');
    if (e.arabic) {
      if (e.arabic.startsWith(nq)) return 650;
      if (e.arabic.includes(nq)) return 560;
    }
    const words = nq.split(' ').filter((w) => w.length >= 2 && !NOISE.test(w));
    if (!words.length) return 0;
    const [head, ...rest] = words;
    const options = [qs(head), qs(head.replace(/^ال/, ''))].filter((s) => s.length >= 2);
    let best = 0;
    for (const s of options) {
      if (e.firstSkel === s) best = Math.max(best, 520);
      else if (s.length >= 3 && e.firstSkel.startsWith(s))
        best = Math.max(best, 460 - (e.firstSkel.length - s.length) * 5);
      else if (e.firstSkel.length >= 4 && s.startsWith(e.firstSkel)) best = Math.max(best, 380);
      else if (s.length >= 4 && e.skel.includes(s)) best = Math.max(best, 260);
    }
    if (!best) return 0;
    for (const w of rest) {
      const digits = w.match(/\d+/)?.[0];
      if (digits) best += e.lower.includes(digits) ? 40 : -60;
      else if (qs(w).length >= 2 && e.skel.includes(qs(w))) best += 30;
    }
    return best;
  }

  const lq = q.toLowerCase().replace(/\s+/g, ' ');
  const tokens = lq.split(' ').filter(Boolean);
  if (tokens.every((t) => e.lower.includes(t))) {
    let s = 400;
    if (e.lower.startsWith(lq)) s += 250;
    else if (e.lower.startsWith(tokens[0])) s += 150;
    const words = e.lower.split(/[^a-z0-9]+/);
    s += tokens.filter((t) => words.some((w) => w.startsWith(t))).length * 20;
    return s;
  }
  // غلطة إملا: «panadl»، «augmntin».
  const sq = qs(tokens[0]);
  if (sq.length >= 3) {
    if (e.firstSkel.startsWith(sq)) return 220;
    if (sq.length >= 4 && e.skel.includes(sq)) return 120;
  }
  return 0;
}

/** The best matches for what she typed, most likely first. */
export function searchCatalog(index: CatalogIndex, raw: string, limit = 12): CatalogItem[] {
  const q = latinDigits(raw).trim();
  if (!q || q.replace(/\*/g, '').trim().length < 2) return [];
  memo.clear();
  const hits: Array<{ e: Entry; s: number }> = [];
  for (const e of index) {
    const s = scoreEntry(e, q);
    if (s > 0) hits.push({ e, s: s + Math.log1p(e.sold) * 12 });
  }
  hits.sort((a, b) => b.s - a.s || a.e.name.localeCompare(b.e.name));
  return hits
    .slice(0, limit)
    .map(({ e }) => ({ code: e.code, name: e.name, price: e.price, sold: e.sold }));
}

/** «بانادول x2» / «بانادول ×٢»: the quantity written after the name. */
export function splitQuantity(raw: string): { query: string; qty: number | null } {
  const m = latinDigits(raw).match(/^(.*?)\s*[x×]\s*(\d{1,3})\s*$/i);
  return m && m[1].trim()
    ? { query: m[1].trim(), qty: Number(m[2]) || null }
    : { query: raw, qty: null };
}

// ---------- التحميل ----------

const STORE_KEY = 'dawaa_products_compact_v1';
let memory: CatalogIndex | null = null;
let loading: Promise<CatalogIndex> | null = null;
let refreshed = false;

type Stored = { version: string; rows: Array<[string, string, number | null, number]> };

const toItems = (rows: Stored['rows']): CatalogItem[] =>
  rows
    .filter((r) => r && r[1])
    .map(([code, name, price, sold]) => ({
      code: String(code ?? ''),
      name: String(name),
      price: price == null ? null : Number(price),
      sold: Number(sold) || 0,
    }));

async function fetchCatalog(): Promise<CatalogIndex> {
  const { data, error } = await supabase.rpc('dawaa_products_compact_v1');
  if (error) throw new Error(error.message || 'تعذّر تحميل الأصناف');
  const d = data as Stored;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(d));
  } catch {
    /* المتصفح مليان: الأصناف تفضل للزيارة دي بس */
  }
  memory = buildIndex(toItems(d.rows ?? []));
  return memory;
}

/** The catalog: from memory, else what the browser kept (refreshed once in the background), else the server. */
export function loadCatalog(): Promise<CatalogIndex> {
  if (memory) return Promise.resolve(memory);
  if (loading) return loading;
  try {
    const stored = JSON.parse(localStorage.getItem(STORE_KEY) || 'null') as Stored | null;
    if (stored?.rows?.length) {
      memory = buildIndex(toItems(stored.rows));
      if (!refreshed) {
        refreshed = true;
        void fetchCatalog().catch(() => undefined);
      }
      return Promise.resolve(memory);
    }
  } catch {
    /* نسخة بايظة: تتحمّل من جديد */
  }
  refreshed = true;
  loading = fetchCatalog().finally(() => {
    loading = null;
  });
  return loading;
}
