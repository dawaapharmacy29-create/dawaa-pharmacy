/**
 * Phonetic bridge between a colloquial Arabic product mention and the Latin brand name printed on
 * an invoice line ("لاكسيول" ↔ "LAXEOL-PI 20 TAB", "نيكسكيور اطفال" ↔ "NEXICURE 5 MG 28 SACHET").
 *
 * It is deliberately narrow: it only ever chooses among the lines of ONE already-selected invoice,
 * compares consonant skeletons of whole words, needs at least three consonants, and returns a line
 * only when exactly one line matches. It never resolves a catalog identity and never proves a sale.
 */

const ARABIC_CLASS: Record<string, string> = {
  ب: 'b', پ: 'b', ت: 't', ط: 't', ث: 's', س: 's', ص: 's', ز: 's', ذ: 's', ظ: 's', ش: 's',
  ج: 'g', غ: 'g', گ: 'g', خ: 'k', ق: 'k', ك: 'k', د: 'd', ض: 'd', ر: 'r', ف: 'f', ڤ: 'f',
  ل: 'l', م: 'm', ن: 'n',
};

/** Words that describe a form, a pack or the customer's sentence, never the product brand. */
const ARABIC_STOP_WORDS = new Set([
  'حقنه', 'حقن', 'حقنة', 'شريط', 'شرايط', 'علبه', 'علبة', 'علب', 'كريم', 'نقط', 'نقطه', 'شراب', 'اقراص',
  'برشام', 'لبوس', 'امبول', 'فوار', 'اكياس', 'كيس', 'جل', 'دهان', 'بخاخ', 'قطره', 'قطرة', 'كبسول', 'اطفال',
  'كبار', 'عايز', 'عايزه', 'عاوز', 'عاوزه', 'محتاج', 'محتاجه', 'محتاجة', 'كنت', 'واحده', 'واحد', 'اتنين',
  'بتاع', 'بتاعت', 'الصنف', 'العلاج', 'الدوا', 'الدواء', 'بكام', 'سعره', 'سعرها', 'ممكن', 'لو', 'سمحت',
]);

function latinSkeleton(word: string): string {
  const w = word
    .toLowerCase()
    .replace(/ph/g, 'f')
    .replace(/th/g, 't')
    .replace(/sh/g, 's')
    .replace(/ch/g, 'k')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/x/g, 'ks');
  let out = '';
  for (const ch of w) {
    if ('bp'.includes(ch)) out += 'b';
    else if (ch === 't') out += 't';
    else if (ch === 'd') out += 'd';
    else if ('gj'.includes(ch)) out += 'g';
    else if ('kqc'.includes(ch)) out += 'k';
    else if ('sz'.includes(ch)) out += 's';
    else if ('fv'.includes(ch)) out += 'f';
    else if ('lmnr'.includes(ch)) out += ch;
  }
  return out.replace(/(.)\1+/g, '$1');
}

function arabicSkeleton(word: string): string {
  const w = word.replace(/^(?:وال|بال|فال|ال)(?=.{3,})/u, '');
  let out = '';
  for (const ch of w) out += ARABIC_CLASS[ch] ?? '';
  return out.replace(/(.)\1+/g, '$1');
}

/** Consonant skeletons of the brand-bearing words of a name (Arabic or Latin). */
export function productNameSkeletons(name: string): string[] {
  const words = String(name ?? '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
  const skeletons: string[] = [];
  for (const word of words) {
    if (ARABIC_STOP_WORDS.has(word)) continue;
    const skeleton = /[؀-ۿ]/.test(word) ? arabicSkeleton(word) : latinSkeleton(word);
    if (skeleton.length >= 3) skeletons.push(skeleton);
  }
  return skeletons;
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/** Two skeletons sound alike: identical, or one edit apart when both carry five or more consonants. */
function skeletonsAgree(a: string, b: string): boolean {
  if (a === b) return true;
  return Math.min(a.length, b.length) >= 5 && editDistance(a, b) <= 1;
}

/**
 * The single invoice line whose brand word sounds like a word of the basket mention, or null when
 * none or more than one line does. Only the first (brand) word of each invoice line is compared.
 */
export function findPhoneticInvoiceLine<T extends { productNameRaw: string }>(
  basketProductNameRaw: string,
  invoiceLines: readonly T[]
): T | null {
  const basket = productNameSkeletons(basketProductNameRaw);
  if (basket.length === 0) return null;
  const hits = invoiceLines.filter((line) => {
    const brand = productNameSkeletons(line.productNameRaw)[0];
    return Boolean(brand) && basket.some((skeleton) => skeletonsAgree(skeleton, brand));
  });
  return hits.length === 1 ? hits[0] : null;
}
