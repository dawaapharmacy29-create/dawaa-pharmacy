import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { normalizeProductCode, normalizeProductName, rankProductCandidates } from '@/lib/productMatching';

export type CatalogProduct = {
  id?: string;
  code: string;
  name: string;
  price: number | null;
};

export type SmartCatalogProduct = CatalogProduct & {
  matchScore: number;
  matchLabel: string;
};

export type CatalogSummary = {
  total: number;
  with_price: number;
  last_updated_at?: string | null;
};

function normalizeCode(value: unknown) {
  return normalizeProductCode(value);
}

function normalizeName(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function meaningfulName(value: string) {
  const normalized = normalizeName(value);
  if (!normalized) return false;
  if (/^\d+$/.test(normalized)) return false;
  if (/^[A-Za-z\u0600-\u06FF][\s._\-–—/\\|:;,*%#@!؟?]*$/.test(normalized)) return false;
  const core = normalized.replace(/[^A-Za-z0-9\u0600-\u06FF]/g, '');
  if (core.length < 2) return false;
  return /[A-Za-z\u0600-\u06FF]/.test(core);
}

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

type Layout = { code: number; name: number; price: number };

function scoreLayout(rows: unknown[][], layout: Layout) {
  let score = 0;
  for (const row of rows.slice(0, 250)) {
    const code = normalizeCode(row?.[layout.code]);
    const name = normalizeName(row?.[layout.name]);
    const price = numeric(row?.[layout.price]);
    if (code && name && meaningfulName(name) && price !== null && price >= 0) score += 1;
  }
  return score;
}

function detectLayout(rows: unknown[][]): Layout {
  const candidates: Layout[] = [
    { code: 0, name: 1, price: 2 },
    { code: 9, name: 8, price: 3 },
    { code: 10, name: 9, price: 4 },
  ];

  const headerRows = rows.slice(0, 15);
  for (const row of headerRows) {
    const normalized = row.map((cell) => normalizeName(cell));
    const codeIndex = normalized.findIndex((cell) => /^(الكود|كود|كود الصنف|الصنف كود|product code|item code|code)$/i.test(cell));
    const nameIndex = normalized.findIndex((cell) => /^(الإسم|الاسم|اسم الصنف|الصنف|اسم الدواء|product name|item name|name)$/i.test(cell));
    const priceIndex = normalized.findIndex((cell) => /(س\.البيع|سعر البيع|سعر الصنف|sale price|selling price|price)/i.test(cell));
    if (codeIndex >= 0 && nameIndex >= 0 && priceIndex >= 0) {
      candidates.push({ code: codeIndex, name: nameIndex, price: priceIndex });
      if (codeIndex > 0 && nameIndex > 0 && priceIndex > 0) {
        candidates.push({ code: codeIndex - 1, name: nameIndex - 1, price: priceIndex - 1 });
      }
    }
  }

  return candidates
    .map((layout) => ({ layout, score: scoreLayout(rows, layout) }))
    .sort((a, b) => b.score - a.score)[0]?.layout || candidates[0];
}

export async function parseProductsCatalogFile(file: File): Promise<CatalogProduct[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) throw new Error('الملف لا يحتوي على شيت قابل للقراءة');

  const rows = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, {
    header: 1,
    defval: null,
    raw: true,
  });
  const layout = detectLayout(rows);
  const unique = new Map<string, CatalogProduct>();

  for (const row of rows) {
    const code = normalizeCode(row?.[layout.code]);
    const name = normalizeName(row?.[layout.name]);
    const price = numeric(row?.[layout.price]);
    if (!code || !name || !meaningfulName(name)) continue;
    if (/^(الكود|كود|كود الصنف|product code|item code|code|عدد الأصناف|الإجمالى|الاجمالي)$/i.test(code)) continue;
    if (/^(الإسم|الاسم|اسم الصنف|الصنف|اسم الدواء|product name|item name|name)$/i.test(name)) continue;
    unique.set(code, { code, name, price });
  }

  return [...unique.values()];
}

export async function importProductsCatalog(products: CatalogProduct[]) {
  const chunkSize = 400;
  let processed = 0;
  for (let index = 0; index < products.length; index += chunkSize) {
    const chunk = products.slice(index, index + chunkSize);
    const { data, error } = await supabase.rpc('import_products_catalog', { p_rows: chunk });
    if (error) throw new Error(error.message);
    processed += Number((data as { processed?: number } | null)?.processed || chunk.length);
  }

  const { data: linkedData, error: linkedError } = await supabase.rpc('auto_link_customer_request_products');
  if (linkedError) throw new Error(linkedError.message);
  return {
    processed,
    linked: Number((linkedData as { linked?: number } | null)?.linked || 0),
  };
}

export async function searchProductsCatalog(query: string, limit = 20) {
  const { data, error } = await supabase.rpc('search_products_catalog', {
    p_query: query,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return ((data || []) as Array<{ id: string; product_code: string; name: string; price: number | null }>).map(
    (row) => ({ id: row.id, code: row.product_code, name: row.name, price: row.price })
  );
}

export async function searchProductsCatalogSmart(query: string, limit = 20): Promise<SmartCatalogProduct[]> {
  const raw = query.trim();
  if (!raw) return [];

  const candidateMap = new Map<string, CatalogProduct>();
  const add = (products: CatalogProduct[]) => {
    for (const product of products) {
      const key = product.id || normalizeCode(product.code) || `${normalizeProductName(product.name)}:${product.price ?? ''}`;
      if (!candidateMap.has(key)) candidateMap.set(key, product);
    }
  };

  add(await searchProductsCatalog(raw, 40));

  const normalized = normalizeProductName(raw);
  const tokens = normalized.split(' ').filter((token) => token.length >= 3 && !/^\d+$/.test(token));
  for (const token of tokens.slice(0, 3)) {
    if (candidateMap.size >= 50) break;
    try {
      add(await searchProductsCatalog(token, 30));
    } catch {
      // البحث الأساسي نجح؛ فشل توسيع Token واحد لا يمنع النتائج.
    }
  }

  const codeLike = /^[A-Za-z0-9._\-/]+$/.test(raw) && /\d/.test(raw) ? raw : '';
  const ranked = rankProductCandidates({ name: raw, code: codeLike }, [...candidateMap.values()]);
  return ranked.slice(0, Math.max(1, limit)).map(({ product, score, label }) => ({
    ...product,
    matchScore: score,
    matchLabel: label,
  }));
}

export async function createProductCatalogItem(input: { code: string; name: string; price?: number | null }) {
  const code = normalizeCode(input.code);
  const name = normalizeName(input.name);
  if (!code) throw new Error('اكتب كود الصنف');
  if (!meaningfulName(name)) throw new Error('اكتب اسم صنف صالح');
  const { data, error } = await supabase.rpc('create_product_catalog_item', {
    p_code: code,
    p_name: name,
    p_price: input.price ?? null,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('تعذر إضافة الصنف');
  return {
    id: row.id as string,
    code: row.product_code as string,
    name: row.name as string,
    price: row.price === null || row.price === undefined ? null : Number(row.price),
  } satisfies CatalogProduct;
}

export async function linkCustomerRequestProduct(requestId: string, productId: string) {
  const { data, error } = await supabase.rpc('link_customer_request_product', {
    p_request_id: requestId,
    p_product_id: productId,
  });
  if (error) throw new Error(error.message);
  return data as { linked?: boolean; product_id?: string; product_code?: string; price?: number | null } | null;
}

export async function getProductsCatalogSummary(): Promise<CatalogSummary> {
  const { data, error } = await supabase.rpc('products_catalog_summary');
  if (error) throw new Error(error.message);
  return {
    total: Number((data as CatalogSummary | null)?.total || 0),
    with_price: Number((data as CatalogSummary | null)?.with_price || 0),
    last_updated_at: (data as CatalogSummary | null)?.last_updated_at || null,
  };
}
