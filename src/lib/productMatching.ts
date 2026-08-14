export type ProductLike = {
  id?: string | null;
  code?: string | null;
  product_code?: string | null;
  name?: string | null;
  price?: number | null;
};

export type ProductMatch = {
  score: number;
  reason: 'exact_code' | 'exact_name' | 'compact_name' | 'strong_tokens' | 'partial_tokens' | 'weak';
  label: string;
};

const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const UNIT_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bmilligram(s)?\b/gi, 'mg'],
  [/مجم/g, 'mg'],
  [/مغ/g, 'mg'],
  [/\bgram(s)?\b/gi, 'g'],
  [/جرام/g, 'g'],
  [/\bmilliliter(s)?\b/gi, 'ml'],
  [/مللى/g, 'ml'],
  [/مللي/g, 'ml'],
  [/اقراص/g, 'tab'],
  [/قرص/g, 'tab'],
  [/\btablet(s)?\b/gi, 'tab'],
  [/\bcapsule(s)?\b/gi, 'cap'],
  [/كبسوله/g, 'cap'],
];

export function normalizeProductCode(value: unknown) {
  return String(value ?? '')
    .trim()
    .replace(/\.0$/, '')
    .replace(/\s+/g, '')
    .toUpperCase();
}

export function normalizeProductName(value: unknown) {
  let text = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(ARABIC_DIACRITICS, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي');

  for (const [pattern, replacement] of UNIT_REPLACEMENTS) text = text.replace(pattern, replacement);

  return text
    .replace(/([0-9])([a-z\u0600-\u06ff])/gi, '$1 $2')
    .replace(/([a-z\u0600-\u06ff])([0-9])/gi, '$1 $2')
    .replace(/[^a-z0-9\u0600-\u06ff.%]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function compactProductName(value: unknown) {
  return normalizeProductName(value).replace(/[\s.%]+/g, '');
}

export function productNameTokens(value: unknown) {
  return normalizeProductName(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function tokenSimilarity(left: string[], right: string[]) {
  if (!left.length || !right.length) return 0;
  const a = new Set(left);
  const b = new Set(right);
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

function productCode(product: ProductLike) {
  return normalizeProductCode(product.code || product.product_code);
}

export function scoreProductCandidate(input: {
  requestName?: unknown;
  requestCode?: unknown;
  product: ProductLike;
}): ProductMatch {
  const requestCode = normalizeProductCode(input.requestCode);
  const candidateCode = productCode(input.product);
  if (requestCode && candidateCode && requestCode === candidateCode) {
    return { score: 100, reason: 'exact_code', label: 'تطابق كود مؤكد' };
  }

  const requestName = normalizeProductName(input.requestName);
  const candidateName = normalizeProductName(input.product.name);
  if (!requestName || !candidateName) return { score: 0, reason: 'weak', label: 'تطابق ضعيف' };

  if (requestName === candidateName) {
    return { score: 97, reason: 'exact_name', label: 'تطابق اسم كامل' };
  }
  if (compactProductName(requestName) === compactProductName(candidateName)) {
    return { score: 94, reason: 'compact_name', label: 'نفس الاسم بعد توحيد الكتابة' };
  }

  const similarity = tokenSimilarity(productNameTokens(requestName), productNameTokens(candidateName));
  const requestCompact = compactProductName(requestName);
  const candidateCompact = compactProductName(candidateName);
  const prefixBonus = requestCompact.startsWith(candidateCompact) || candidateCompact.startsWith(requestCompact) ? 7 : 0;
  const score = Math.min(93, Math.round(similarity * 86 + prefixBonus));

  if (score >= 86) return { score, reason: 'strong_tokens', label: 'تشابه قوي في الاسم' };
  if (score >= 68) return { score, reason: 'partial_tokens', label: 'تشابه يحتاج مراجعة' };
  return { score, reason: 'weak', label: 'تطابق ضعيف' };
}

export function rankProductCandidates<T extends ProductLike>(request: { name?: unknown; code?: unknown }, products: T[]) {
  return products
    .map((product) => ({ product, ...scoreProductCandidate({ requestName: request.name, requestCode: request.code, product }) }))
    .sort((a, b) => b.score - a.score || String(a.product.name || '').localeCompare(String(b.product.name || ''), 'ar'));
}

export function confidentUniqueProductMatch<T extends ProductLike>(request: { name?: unknown; code?: unknown }, products: T[]) {
  const ranked = rankProductCandidates(request, products);
  const first = ranked[0];
  const second = ranked[1];
  if (!first) return null;

  const hasCode = Boolean(normalizeProductCode(request.code));
  if (hasCode) return first.score === 100 ? first : null;

  const gap = first.score - (second?.score || 0);
  return first.score >= 94 || (first.score >= 88 && gap >= 9) ? first : null;
}
