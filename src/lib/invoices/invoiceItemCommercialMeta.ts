// One reader for the commercial fields stored in sales_invoice_items_v21.raw_data.
//
// Production holds two shapes: the importer's `__dawaa_commercial` object and the compact
// B-Connect import rows whose keys sit at the top level (gross_line, line_discount, returned,
// invoice_net, unit, expiry). Readers that only understood the first shape silently dropped
// discounts, returns and the B-Connect invoice net for every compact row. Nothing is derived here:
// a value the stored row does not carry stays null.

export type InvoiceItemCommercialFormat = 'dawaa_commercial' | 'compact_import' | 'none';

export interface InvoiceItemCommercialMeta {
  format: InvoiceItemCommercialFormat;
  effectiveQuantity: number | null;
  returnedQuantity: number | null;
  unitName: string | null;
  expiryRaw: string | null;
  itemDiscountAmount: number | null;
  itemDiscountPercent: number | null;
  grossLineAmount: number | null;
  netLineAmount: number | null;
  invoiceDiscountAmount: number | null;
  allocatedInvoiceDiscountAmount: number | null;
  invoiceNetAmount: number | null;
}

function num(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function text(value: unknown): string | null {
  const s = String(value ?? '').trim();
  // The compact export writes «.» for "no value" (e.g. an item without expiry).
  return s && s !== '.' ? s : null;
}

export function readInvoiceItemCommercialMeta(rawData: unknown): InvoiceItemCommercialMeta {
  const raw = rawData && typeof rawData === 'object' ? (rawData as Record<string, unknown>) : {};
  const commercial = raw.__dawaa_commercial;
  if (commercial && typeof commercial === 'object') {
    const m = commercial as Record<string, unknown>;
    return {
      format: 'dawaa_commercial',
      effectiveQuantity: num(m.effective_quantity),
      returnedQuantity: num(m.returned_quantity),
      unitName: text(m.unit_name),
      expiryRaw: text(m.expiry_raw),
      itemDiscountAmount: num(m.item_discount_amount),
      itemDiscountPercent: num(m.item_discount_percent),
      grossLineAmount: num(m.gross_line_amount),
      netLineAmount: num(m.net_line_amount),
      invoiceDiscountAmount: num(m.invoice_discount_amount),
      allocatedInvoiceDiscountAmount: num(m.allocated_invoice_discount_amount),
      invoiceNetAmount: num(m.invoice_net_amount),
    };
  }
  const isCompact = ['gross_line', 'line_discount', 'returned', 'invoice_net', 'unit'].some(
    (key) => key in raw
  );
  if (!isCompact) {
    return {
      format: 'none',
      effectiveQuantity: null,
      returnedQuantity: null,
      unitName: null,
      expiryRaw: null,
      itemDiscountAmount: null,
      itemDiscountPercent: null,
      grossLineAmount: null,
      netLineAmount: null,
      invoiceDiscountAmount: null,
      allocatedInvoiceDiscountAmount: null,
      invoiceNetAmount: null,
    };
  }
  return {
    format: 'compact_import',
    // The compact row stores the sold quantity and the returned quantity; callers derive the
    // effective quantity from the row's own quantity column.
    effectiveQuantity: null,
    returnedQuantity: num(raw.returned),
    unitName: text(raw.unit),
    expiryRaw: text(raw.expiry),
    itemDiscountAmount: num(raw.line_discount),
    itemDiscountPercent: num(raw.line_discount_pct),
    grossLineAmount: num(raw.gross_line),
    // The net line value of a compact row is the row's line_total column.
    netLineAmount: null,
    invoiceDiscountAmount: null,
    allocatedInvoiceDiscountAmount: null,
    invoiceNetAmount: num(raw.invoice_net),
  };
}
