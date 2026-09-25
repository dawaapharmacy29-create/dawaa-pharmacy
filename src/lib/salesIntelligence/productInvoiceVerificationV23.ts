export interface ProductInvoiceVerificationProductV23 {
  productId?: string | null;
  productCode?: string | null;
  productName?: string | null;
}

export interface ProductInvoiceVerificationInvoiceV23 {
  id: string;
  invoice_number?: string | null;
  invoice_datetime?: string | null;
  close_datetime?: string | null;
  net_total?: number | string | null;
  total_amount?: number | string | null;
  net_amount?: number | string | null;
  amount?: number | string | null;
}

export interface ProductInvoiceVerificationItemV23 {
  invoice_id: string;
  invoice_number?: string | null;
  product_id?: string | null;
  product_code?: string | null;
  product_name?: string | null;
  quantity?: number | string | null;
  line_total?: number | string | null;
}

export interface ProductInvoiceVerificationMatchV23 {
  invoiceId: string;
  invoiceNumber: string | null;
  invoiceValue: number | null;
  productEvidence: 'product_id' | 'product_code' | 'product_name';
  timeDistanceMinutes: number | null;
  finalPaid: boolean;
}

function clean(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeProductName(value: unknown) {
  return clean(value)
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[\u064B-\u065F]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function numeric(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function invoiceAmount(row: ProductInvoiceVerificationInvoiceV23): number | null {
  for (const value of [row.net_total, row.total_amount, row.net_amount, row.amount]) {
    const n = numeric(value);
    if (n != null) return n;
  }
  return null;
}

function parseMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function intervalDistanceMinutes(
  invoiceAt: string | null | undefined,
  openedAt: string | null | undefined,
  lastStageAt: string | null | undefined
): { distance: number | null; predates: boolean } {
  const invoiceMs = parseMs(invoiceAt);
  const startMs = parseMs(openedAt);
  const endMs = parseMs(lastStageAt);
  if (invoiceMs == null || (startMs == null && endMs == null)) return { distance: null, predates: false };

  const start = startMs ?? endMs!;
  const end = Math.max(endMs ?? start, start);
  if (invoiceMs < start) {
    const minutes = (invoiceMs - start) / 60000;
    return { distance: Math.round(minutes), predates: minutes < -10 };
  }
  if (invoiceMs <= end) return { distance: 0, predates: false };
  return { distance: Math.round((invoiceMs - end) / 60000), predates: false };
}

function productEvidenceKind(
  product: ProductInvoiceVerificationProductV23,
  item: ProductInvoiceVerificationItemV23
): ProductInvoiceVerificationMatchV23['productEvidence'] | null {
  const productId = clean(product.productId);
  const productCode = clean(product.productCode);
  if (productId && clean(item.product_id) === productId) return 'product_id';
  if (productCode && clean(item.product_code) === productCode) return 'product_code';

  const expectedName = normalizeProductName(product.productName);
  const itemName = normalizeProductName(item.product_name);
  if (expectedName && itemName && expectedName === itemName) return 'product_name';
  return null;
}

export function selectVerifiedProductInvoiceV23(input: {
  product: ProductInvoiceVerificationProductV23;
  openedAt?: string | null;
  lastStageAt?: string | null;
  invoices: ProductInvoiceVerificationInvoiceV23[];
  items: ProductInvoiceVerificationItemV23[];
}): ProductInvoiceVerificationMatchV23 | null {
  const itemsByInvoice = new Map<string, ProductInvoiceVerificationItemV23[]>();
  for (const item of input.items) {
    const id = clean(item.invoice_id);
    if (!id) continue;
    const rows = itemsByInvoice.get(id) || [];
    rows.push(item);
    itemsByInvoice.set(id, rows);
  }

  const ranked: Array<ProductInvoiceVerificationMatchV23 & { score: number }> = [];

  for (const invoice of input.invoices) {
    const invoiceId = clean(invoice.id);
    if (!invoiceId) continue;

    const matchingItems = (itemsByInvoice.get(invoiceId) || [])
      .map((item) => ({ item, kind: productEvidenceKind(input.product, item) }))
      .filter((row): row is { item: ProductInvoiceVerificationItemV23; kind: ProductInvoiceVerificationMatchV23['productEvidence'] } => Boolean(row.kind));

    if (!matchingItems.length) continue;

    const { distance, predates } = intervalDistanceMinutes(
      invoice.invoice_datetime,
      input.openedAt,
      input.lastStageAt
    );
    if (predates) continue;
    if (distance != null && distance > 36 * 60) continue;

    const amount = invoiceAmount(invoice);
    const closed = Boolean(invoice.close_datetime);
    // A zero-value invoice is not transaction truth for product-level sale verification.
    // B-Connect can emit draft/header rows with the right items and zero totals before the final invoice.
    if (amount != null && amount <= 0) continue;
    const finalPaid = Boolean(closed && amount != null && amount > 0);
    const bestEvidence = matchingItems.some((row) => row.kind === 'product_id')
      ? 'product_id'
      : matchingItems.some((row) => row.kind === 'product_code')
        ? 'product_code'
        : 'product_name';

    let score = bestEvidence === 'product_id' ? 100 : bestEvidence === 'product_code' ? 85 : 65;
    if (finalPaid) score += 40;
    else if (amount != null && amount > 0) score += 20;
    else if (closed) score += 5;

    if (distance != null) {
      const abs = Math.abs(distance);
      if (abs <= 30) score += 25;
      else if (abs <= 120) score += 18;
      else if (abs <= 360) score += 12;
      else if (abs <= 1440) score += 6;
    }

    ranked.push({
      invoiceId,
      invoiceNumber: clean(invoice.invoice_number) || null,
      invoiceValue: amount,
      productEvidence: bestEvidence,
      timeDistanceMinutes: distance,
      finalPaid,
      score,
    });
  }

  ranked.sort((a, b) =>
    b.score - a.score ||
    Number(b.finalPaid) - Number(a.finalPaid) ||
    Math.abs(a.timeDistanceMinutes ?? Number.MAX_SAFE_INTEGER) - Math.abs(b.timeDistanceMinutes ?? Number.MAX_SAFE_INTEGER)
  );

  const best = ranked[0];
  if (!best) return null;
  const { score: _score, ...match } = best;
  return match;
}
