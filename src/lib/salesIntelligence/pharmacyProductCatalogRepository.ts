import {
  buildCanonicalProduct,
  countNormalizedNames,
  type RawProductRow,
} from './pharmacyProducts/canonicalProduct';
import {
  buildPharmacyProductIndex,
  type PharmacyProductIndex,
} from './pharmacyProducts/pharmacyProductResolverV2';
import { normalizePharmacyText } from './pharmacyProducts/pharmacyNormalization';

const catalogCache = new WeakMap<object, Promise<PharmacyProductIndex>>();

async function fetchAllProductRows(supabaseClient: any): Promise<RawProductRow[]> {
  const rows: RawProductRow[] = [];
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await supabaseClient
      .from('products')
      .select('id,name,product_code,normalized_name,category,price,source')
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;

    const page = (data ?? [])
      .filter((row: any) => row?.id && row?.name && row?.product_code)
      .map((row: any) => ({
        id: String(row.id),
        name: String(row.name),
        product_code: String(row.product_code),
        normalized_name: String(row.normalized_name ?? row.name),
        category: row.category == null ? null : String(row.category),
        price: row.price,
        source: String(row.source ?? 'products'),
      })) satisfies RawProductRow[];

    rows.push(...page);
    if ((data ?? []).length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

export async function fetchPharmacyProductIndex(
  supabaseClient: any,
  options: { forceRefresh?: boolean } = {}
): Promise<PharmacyProductIndex> {
  if (
    !options.forceRefresh &&
    supabaseClient &&
    typeof supabaseClient === 'object' &&
    catalogCache.has(supabaseClient)
  ) {
    return catalogCache.get(supabaseClient)!;
  }

  const promise = (async () => {
    const rows = await fetchAllProductRows(supabaseClient);
    const counts = countNormalizedNames(rows);
    const catalog = rows.map((row) =>
      buildCanonicalProduct(row, counts, normalizePharmacyText)
    );
    return buildPharmacyProductIndex(catalog);
  })();

  if (supabaseClient && typeof supabaseClient === 'object') {
    catalogCache.set(supabaseClient, promise);
  }

  try {
    return await promise;
  } catch (error) {
    if (supabaseClient && typeof supabaseClient === 'object') {
      catalogCache.delete(supabaseClient);
    }
    throw error;
  }
}
