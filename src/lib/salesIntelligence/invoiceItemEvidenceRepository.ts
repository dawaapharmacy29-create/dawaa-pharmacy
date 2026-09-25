import { normalizeBranchName } from '../branch';
import { getInvoiceBranch, type InvoiceLike } from '../invoices/invoiceCore';
import type {
  InvoiceItemEvidenceProvider,
  InvoiceItemRecordForAttribution,
} from './saleAttributionEngine';

interface SalesInvoiceItemRow {
  invoice_id?: string | null;
  invoice_number?: string | null;
  branch?: string | null;
  product_id?: string | null;
  product_code?: string | null;
  product_name?: string | null;
  quantity?: number | string | null;
  unit_price?: number | string | null;
  line_total?: number | string | null;
  raw_data?: Record<string, any> | null;
}

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function invoiceId(row: InvoiceLike): string {
  return clean(row.id ?? row.invoice_number ?? row.invoice_no);
}

function invoiceNumber(row: InvoiceLike): string {
  return clean(row.invoice_number ?? row.invoice_no);
}

function candidateKey(number: string, branch: string | null | undefined): string {
  return `${number}|${normalizeBranchName(branch || '')}`;
}

function sameOrNull<T>(values: Array<T | null | undefined>): T | null {
  const present = values.filter((value): value is T => value != null);
  if (!present.length) return null;
  return present.every((value) => value === present[0]) ? present[0] : null;
}

function sumNullable(values: Array<number | null | undefined>): number | null {
  const present = values.filter((value): value is number => value != null && Number.isFinite(value));
  return present.length ? present.reduce((sum, value) => sum + value, 0) : null;
}

function aggregateInvoiceItems(items: InvoiceItemRecordForAttribution[]): InvoiceItemRecordForAttribution[] {
  const grouped = new Map<string, InvoiceItemRecordForAttribution[]>();
  const passthrough: InvoiceItemRecordForAttribution[] = [];

  for (const item of items) {
    const key = item.productId
      ? `id:${item.productId}`
      : item.productCode
        ? `code:${item.productCode}`
        : '';
    if (!key) {
      passthrough.push(item);
      continue;
    }
    const bucket = grouped.get(key) ?? [];
    bucket.push(item);
    grouped.set(key, bucket);
  }

  const aggregated = Array.from(grouped.values()).map((bucket) => {
    if (bucket.length === 1) return bucket[0];
    return {
      productNameRaw: bucket[0].productNameRaw,
      productId: sameOrNull(bucket.map((item) => item.productId ?? null)),
      productCode: sameOrNull(bucket.map((item) => item.productCode ?? null)),
      quantity: sumNullable(bucket.map((item) => item.quantity)),
      unitName: sameOrNull(bucket.map((item) => item.unitName ?? null)),
      expiryRaw: sameOrNull(bucket.map((item) => item.expiryRaw ?? null)),
      returnedQuantity: sumNullable(bucket.map((item) => item.returnedQuantity)),
      unitPrice: sameOrNull(bucket.map((item) => item.unitPrice ?? null)),
      itemDiscountAmount: sumNullable(bucket.map((item) => item.itemDiscountAmount)),
      itemDiscountPercent: sameOrNull(bucket.map((item) => item.itemDiscountPercent ?? null)),
      grossLineAmount: sumNullable(bucket.map((item) => item.grossLineAmount)),
      netLineAmount: sumNullable(bucket.map((item) => item.netLineAmount)),
      lineTotal: sumNullable(bucket.map((item) => item.lineTotal)),
    } satisfies InvoiceItemRecordForAttribution;
  });

  return [...aggregated, ...passthrough];
}

function chunks<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export function buildInvoiceItemEvidenceProvider(
  invoiceRows: InvoiceLike[],
  itemRows: SalesInvoiceItemRow[]
): InvoiceItemEvidenceProvider {
  const candidateIds = new Set(invoiceRows.map(invoiceId).filter(Boolean));
  const candidateIdsByNumberBranch = new Map<string, string[]>();

  for (const invoice of invoiceRows) {
    const id = invoiceId(invoice);
    const number = invoiceNumber(invoice);
    if (!id || !number) continue;
    const key = candidateKey(number, getInvoiceBranch(invoice));
    const ids = candidateIdsByNumberBranch.get(key) ?? [];
    if (!ids.includes(id)) ids.push(id);
    candidateIdsByNumberBranch.set(key, ids);
  }

  const itemsByInvoiceId = new Map<string, InvoiceItemRecordForAttribution[]>();

  for (const row of itemRows) {
    const directId = clean(row.invoice_id);
    let resolvedId = directId && candidateIds.has(directId) ? directId : '';

    if (!resolvedId) {
      const number = clean(row.invoice_number);
      if (!number) continue;
      const ids = candidateIdsByNumberBranch.get(candidateKey(number, row.branch)) ?? [];
      // If invoice number+branch is still ambiguous, do not guess which invoice owns this item.
      if (ids.length !== 1) continue;
      resolvedId = ids[0];
    }

    const productName = clean(row.product_name);
    if (!productName) continue;

    const bucket = itemsByInvoiceId.get(resolvedId) ?? [];
    const meta = row.raw_data?.__dawaa_commercial ?? {};
    bucket.push({
      productNameRaw: productName,
      productId: clean(row.product_id) || null,
      productCode: clean(row.product_code) || null,
      quantity:
        numberOrNull(meta.effective_quantity) ??
        (() => {
          const quantity = numberOrNull(row.quantity);
          const returned = numberOrNull(meta.returned_quantity) ?? 0;
          return quantity == null ? null : Math.max(0, quantity - Math.max(0, returned));
        })(),
      unitName: clean(meta.unit_name) || null,
      expiryRaw: clean(meta.expiry_raw) || null,
      returnedQuantity: numberOrNull(meta.returned_quantity),
      unitPrice: numberOrNull(row.unit_price),
      itemDiscountAmount: numberOrNull(meta.item_discount_amount),
      itemDiscountPercent: numberOrNull(meta.item_discount_percent),
      grossLineAmount: numberOrNull(meta.gross_line_amount),
      netLineAmount: numberOrNull(meta.net_line_amount) ?? numberOrNull(row.line_total),
      lineTotal: numberOrNull(row.line_total),
    });
    itemsByInvoiceId.set(resolvedId, bucket);
  }

  return {
    getItemsForInvoice(id: string) {
      const rows = itemsByInvoiceId.get(clean(id));
      return rows && rows.length ? aggregateInvoiceItems(rows) : 'unavailable';
    },
  };
}

export async function fetchInvoiceItemEvidenceProvider(
  supabaseClient: any,
  invoiceRows: InvoiceLike[]
): Promise<InvoiceItemEvidenceProvider> {
  const uniqueInvoices = new Map<string, InvoiceLike>();
  for (const row of invoiceRows) {
    const id = invoiceId(row);
    if (id) uniqueInvoices.set(id, row);
  }
  const candidates = Array.from(uniqueInvoices.values());
  if (!candidates.length) return buildInvoiceItemEvidenceProvider([], []);

  const ids = Array.from(new Set(candidates.map(invoiceId).filter(Boolean)));
  const numbers = Array.from(new Set(candidates.map(invoiceNumber).filter(Boolean)));
  const itemMap = new Map<string, SalesInvoiceItemRow>();

  // Prefer exact invoice_id when populated.
  for (const group of chunks(ids, 100)) {
    const { data, error } = await supabaseClient
      .from('sales_invoice_items_v21')
      .select('id,invoice_id,invoice_number,branch,product_id,product_code,product_name,quantity,unit_price,line_total,raw_data')
      .in('invoice_id', group)
      .limit(5000);
    if (error) throw error;
    for (const row of data ?? []) itemMap.set(String(row.id), row);
  }

  // Legacy/current imports may not have invoice_id populated yet. Pull by number too, then the
  // pure provider resolves only an unambiguous invoice_number + normalized branch combination.
  for (const group of chunks(numbers, 100)) {
    const { data, error } = await supabaseClient
      .from('sales_invoice_items_v21')
      .select('id,invoice_id,invoice_number,branch,product_id,product_code,product_name,quantity,unit_price,line_total,raw_data')
      .in('invoice_number', group)
      .limit(5000);
    if (error) throw error;
    for (const row of data ?? []) itemMap.set(String(row.id), row);
  }

  return buildInvoiceItemEvidenceProvider(candidates, Array.from(itemMap.values()));
}


export function snapshotInvoiceItemEvidence(
  provider: InvoiceItemEvidenceProvider,
  invoiceIds: string[]
): Array<{ invoiceId: string; items: 'unavailable' | InvoiceItemRecordForAttribution[] }> {
  return Array.from(new Set(invoiceIds.filter(Boolean)))
    .sort()
    .map((invoiceId) => {
      const items = provider.getItemsForInvoice(invoiceId, null);
      if (items === 'unavailable') return { invoiceId, items: 'unavailable' as const };
      const normalized = [...items]
        .map((item) => ({
          productNameRaw: item.productNameRaw,
          productId: item.productId ?? null,
          productCode: item.productCode ?? null,
          quantity: item.quantity,
          unitName: item.unitName ?? null,
          expiryRaw: item.expiryRaw ?? null,
          returnedQuantity: item.returnedQuantity ?? null,
          unitPrice: item.unitPrice ?? null,
          itemDiscountAmount: item.itemDiscountAmount ?? null,
          itemDiscountPercent: item.itemDiscountPercent ?? null,
          grossLineAmount: item.grossLineAmount ?? null,
          netLineAmount: item.netLineAmount ?? null,
          lineTotal: item.lineTotal,
        }))
        .sort((a, b) =>
          String(a.productId ?? a.productCode ?? a.productNameRaw).localeCompare(
            String(b.productId ?? b.productCode ?? b.productNameRaw)
          )
        );
      return { invoiceId, items: normalized };
    });
}
