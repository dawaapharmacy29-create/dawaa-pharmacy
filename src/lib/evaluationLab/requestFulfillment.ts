import { buildCanonicalProduct, countNormalizedNames, type RawProductRow } from '@/lib/salesIntelligence/pharmacyProducts/canonicalProduct';
import { normalizePharmacyText } from '@/lib/salesIntelligence/pharmacyProducts/pharmacyNormalization';
import {
  buildPharmacyProductIndex,
  isBasketEligibleProductResolution,
  resolveProductMention,
  type PharmacyProductIndex,
} from '@/lib/salesIntelligence/pharmacyProducts/pharmacyProductResolverV2';

// Customer request → actual sale. Pure: a request is proven fulfilled only by the same customer
// buying the same catalog product after the request. The request's free-text medicine name is
// resolved with the canonical product resolver restricted to the products this customer actually
// bought in the window, so Arabic/colloquial names match catalog (often Latin) names safely.
// The product identity is the invoice line's product code; the resolver index is built from the
// loaded invoice lines themselves (the products table is not readable from client sessions).

export const FULFILLMENT_WINDOW_DAYS = 14;

// Invoice item dates are stored as a day (midnight), requests carry a time: compare Cairo days.
// A sale on the request day or within the next 14 days belongs to it.
const CAIRO_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' });
const cairoDay = (at: number) => CAIRO_DAY.format(at);
const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);

export interface FulfillmentRequest {
  id: string;
  customerCode: string | null;
  medicineName: string | null;
  productCode: string | null;
  quantity: number | null;
  createdAt: string;
  status: string | null;
}

export interface FulfillmentItem {
  customerCode: string | null;
  invoiceAt: string;
  invoiceId: string | null;
  productId: string | null;
  productCode: string | null;
  productName: string | null;
  quantity: number | null;
}

export type FulfillmentState =
  /** Bought the requested quantity (or more) in the window. */
  | 'fulfilled'
  /** Bought the product, but less than requested. */
  | 'partial'
  /** The window is over and no matching purchase exists. */
  | 'not_found'
  /** The window is still open and nothing matched yet: not judged. */
  | 'window_open'
  /** No customer code: cannot be proven either way. */
  | 'no_customer'
  /** Cancelled/duplicate/rejected requests are not judged. */
  | 'invalid';

export interface FulfillmentResult {
  requestId: string;
  state: FulfillmentState;
  matchedQuantity: number;
  firstSaleAt: string | null;
  /** How the product was identified: request product code or the resolver basis. */
  basis: string | null;
}

const text = (value: unknown) => String(value ?? '').trim();
const INVALID = /^(cancelled|canceled|duplicate|rejected)$/i;

/**
 * Free-text requests often name several products in one line ("sheport 30 cap ....... oratrypsin
 * tab", "2 كيدمن وامينوسبيريت اكياس"). Split on list separators and on a leading Arabic "و" joining
 * product words; each part is matched on its own.
 */
export function splitRequestedProducts(value: string): string[] {
  return value
    .split(/\s*(?:\.{2,}|[،,+\n/|]|\s-\s)\s*|\s+(?=و[\u0621-\u064A]{3,})/u)
    .map((part) => part.replace(/^و(?=[\u0621-\u064A]{3,})/u, '').trim())
    .filter((part) => /[\p{L}]{3,}/u.test(part));
}

// Packaging/noise words that never identify a product.
const NOISE = /^(علبه|علبة|علب|شريط|شرايط|اكياس|كيس|فيال|فيالات|امبول|حقن|مستورد|من|عند|د|دكتور|نجيبه|نجيبها|ب|بس|اللى|اللي|بغطا|ابيض|دهبى|دهبي|ونبيعه|مش|يعني)$/u;

const AR_TO_LATIN: Record<string, string> = {
  ب: 'b', ت: 't', ث: 's', ج: 'g', ح: 'h', خ: 'k', د: 'd', ذ: 'z', ر: 'r', ز: 'z', س: 's', ش: 's', ص: 's', ض: 'd',
  ط: 't', ظ: 'z', غ: 'g', ف: 'f', ق: 'k', ك: 'k', ل: 'l', م: 'm', ن: 'n', ه: 'h', ة: '',
};

/** Consonant skeleton shared by an Arabic transliteration and its Latin catalog name. */
export function consonantSkeleton(word: string): string {
  const lower = word.toLowerCase();
  const latin = /[\u0621-\u064A]/u.test(lower)
    ? [...lower].map((ch) => AR_TO_LATIN[ch] ?? (/[a-z]/.test(ch) ? ch : '')).join('')
    : lower.replace(/ph/g, 'f').replace(/th/g, 't').replace(/sh|ch/g, 's').replace(/c(?=[eiy])/g, 's').replace(/q|c/g, 'k')
      .replace(/x/g, 'ks').replace(/j/g, 'g').replace(/v/g, 'f').replace(/p/g, 'b').replace(/[^a-z]/g, '');
  // z and s are written interchangeably in Arabic transliteration (امبيزوم = AMBISOME).
  return latin.replace(/z/g, 's').replace(/[aeiouwy]/g, '').replace(/(.)\1+/g, '$1');
}

const firstWord = (value: string) =>
  value.split(/[\s\d.\-_/()]+/u).map((word) => word.trim()).find((word) => word.length >= 3 && !NOISE.test(word)) || '';

/**
 * Last resort inside the customer's own purchases only: the first meaningful word of the request
 * and of a bought product share a consonant skeleton (≥3 consonants, equal or one a ≥4 prefix of
 * the other), and exactly one bought product qualifies.
 */
function transliterationMatch(phrase: string, candidates: Array<{ productId: string; name: string }>): string | null {
  const wanted = consonantSkeleton(firstWord(phrase));
  if (wanted.length < 3) return null;
  const hits = new Set(candidates.filter((candidate) => {
    const have = consonantSkeleton(firstWord(candidate.name));
    if (have.length < 3) return false;
    if (have === wanted) return true;
    const shorter = have.length < wanted.length ? have : wanted;
    const longer = have.length < wanted.length ? wanted : have;
    return shorter.length >= 4 && longer.startsWith(shorter);
  }).map((candidate) => candidate.productId));
  return hits.size === 1 ? [...hits][0] : null;
}

/** Resolver index of the products present on the loaded invoice lines (identity = product code). */
export function buildInvoiceLineProductIndex(items: readonly FulfillmentItem[]): PharmacyProductIndex {
  const rows = new Map<string, RawProductRow>();
  for (const item of items) {
    const code = text(item.productCode);
    const name = text(item.productName);
    if (!code || !name || rows.has(code)) continue;
    rows.set(code, { id: code, name, product_code: code, normalized_name: name, category: null, price: null, source: 'sales_invoice_items_v21' } as RawProductRow);
  }
  const list = [...rows.values()];
  const counts = countNormalizedNames(list);
  return buildPharmacyProductIndex(list.map((row) => buildCanonicalProduct(row, counts, normalizePharmacyText)));
}

export function matchRequestFulfillment(
  requests: readonly FulfillmentRequest[],
  items: readonly FulfillmentItem[],
  asOf: Date = new Date(),
): FulfillmentResult[] {
  const index = buildInvoiceLineProductIndex(items);
  const byCustomer = new Map<string, FulfillmentItem[]>();
  for (const item of items) {
    const code = text(item.customerCode);
    if (!code) continue;
    byCustomer.set(code, [...(byCustomer.get(code) || []), item]);
  }
  const productIdOf = (item: FulfillmentItem) => text(item.productCode) || null;

  return requests.map((request) => {
    const base = { requestId: request.id, matchedQuantity: 0, firstSaleAt: null, basis: null };
    if (INVALID.test(text(request.status))) return { ...base, state: 'invalid' as const };
    const code = text(request.customerCode);
    if (!code || /^[0\s.-]*$/.test(code)) return { ...base, state: 'no_customer' as const };

    const requestDay = cairoDay(Date.parse(request.createdAt));
    const lastDay = addDays(requestDay, FULFILLMENT_WINDOW_DAYS);
    const today = cairoDay(asOf.getTime());
    const windowOpen = today <= lastDay;
    const candidates = (byCustomer.get(code) || []).filter((item) => {
      const day = cairoDay(Date.parse(item.invoiceAt));
      return day >= requestDay && day <= lastDay && day <= today;
    });
    const unmatched = { ...base, state: windowOpen ? 'window_open' as const : 'not_found' as const };
    if (!candidates.length) return unmatched;

    const requestedCode = text(request.productCode).toLowerCase();
    if (requestedCode) {
      const direct = candidates.filter((item) => text(item.productCode).toLowerCase() === requestedCode);
      return direct.length ? summarize(base, direct, request, 'request_product_code') : unmatched;
    }

    const candidateIds = [...new Set(candidates.map(productIdOf).filter((id): id is string => Boolean(id)))];
    const parts = splitRequestedProducts(text(request.medicineName));
    if (!candidateIds.length || !parts.length) return unmatched;
    const named = candidates
      .map((item) => ({ productId: productIdOf(item), name: text(item.productName) }))
      .filter((row): row is { productId: string; name: string } => Boolean(row.productId && row.name));
    const partMatches = parts.map((part) => {
      const resolution = resolveProductMention(part, index, { knownCandidateProductIds: candidateIds });
      if (resolution.selected && isBasketEligibleProductResolution(resolution.selected)) {
        return { productId: resolution.selected.product.productId, basis: resolution.selected.basis };
      }
      const transliterated = transliterationMatch(part, named);
      return transliterated ? { productId: transliterated, basis: 'transliteration_in_customer_purchases' } : null;
    });
    const found = partMatches.filter((match): match is { productId: string; basis: string } => Boolean(match));
    if (!found.length) return unmatched;
    const matchedItems = candidates.filter((item) => found.some((match) => match.productId === productIdOf(item)));
    const result = summarize(base, matchedItems, request, [...new Set(found.map((match) => match.basis))].join('+'));
    // A multi-product request is fulfilled only when every named product was bought.
    return found.length < parts.length ? { ...result, state: 'partial' } : result;
  });
}

function summarize(
  base: Pick<FulfillmentResult, 'requestId'>,
  matched: FulfillmentItem[],
  request: FulfillmentRequest,
  basis: string | null,
): FulfillmentResult {
  const quantity = matched.reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0), 0);
  const firstSaleAt = matched.map((item) => item.invoiceAt).sort()[0] ?? null;
  const requested = Number(request.quantity) || 1;
  return {
    requestId: base.requestId,
    state: quantity >= requested ? 'fulfilled' : 'partial',
    matchedQuantity: quantity,
    firstSaleAt,
    basis,
  };
}

/** Counts used by the lab (only judged requests: fulfilled, partial, not_found). */
export function summarizeFulfillment(results: readonly FulfillmentResult[]) {
  const count = (state: FulfillmentState) => results.filter((result) => result.state === state).length;
  const fulfilled = count('fulfilled');
  const partial = count('partial');
  const notFound = count('not_found');
  const judged = fulfilled + partial + notFound;
  return {
    fulfilled,
    partial,
    notFound,
    judged,
    windowOpen: count('window_open'),
    noCustomer: count('no_customer'),
    /** Partial purchases count half. */
    share: judged ? (fulfilled + partial / 2) / judged : null,
  };
}
