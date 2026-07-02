import { normalizeBranchName } from '@/lib/branch';

type InvoiceLike = Record<string, unknown>;

function cleanText(value: unknown) {
  return String(value ?? '').trim();
}

function valueOf(row: InvoiceLike, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return null;
}

function invoiceDate(row: InvoiceLike) {
  const value = valueOf(row, ['sale_date', 'invoice_date', 'invoice_datetime', 'date', 'created_at']);
  if (!value) return null;
  const parsed = new Date(String(value));
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function parseMoney(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const normalized = String(value ?? '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[^0-9.\-]/g, '');
  const n = Number(normalized || 0);
  return Number.isFinite(n) ? n : 0;
}

function invoiceAmount(row: InvoiceLike) {
  const v = valueOf(row, ['net_amount', 'net_total', 'total_amount', 'amount']);
  return parseMoney(v);
}

function invoiceIdentity(row: InvoiceLike) {
  return (
    cleanText(valueOf(row, ['invoice_number', 'invoice_no', 'id'])) ||
    `${invoiceDate(row) || 'no-date'}-${invoiceAmount(row)}-${normalizeBranchName(valueOf(row, ['branch', 'branch_name']) || '')}`
  );
}

export function buildCustomerLiveMetrics(rows: InvoiceLike[]) {
  const map = new Map<string, InvoiceLike>();
  for (const r of rows) {
    map.set(invoiceIdentity(r), r);
  }
  const unique = [...map.values()];
  const amounts = unique.map(invoiceAmount);
  const total = amounts.reduce((s, v) => s + v, 0);
  const dated = unique
    .map((r) => ({ r, date: invoiceDate(r), amount: invoiceAmount(r), branch: normalizeBranchName(valueOf(r, ['branch', 'branch_name'])) }))
    .filter((x) => x.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const dates = dated.map((d) => d.date as string);
  const invoicesCount = unique.length;
  const avg = invoicesCount ? total / invoicesCount : 0;
  const latestInvoices = dated.slice(-20).reverse().map((d) => ({
    invoice_number: d.r.invoice_number || d.r.invoice_no || d.r.id || null,
    invoice_date: d.date || null,
    amount: d.amount,
    seller_name: d.r.seller_name || null,
    branch: d.branch || null,
  }));

  return {
    invoicesCount,
    totalPurchases: total,
    avgInvoice: avg,
    firstPurchase: dates[0] || null,
    lastPurchase: dates.at(-1) || null,
    latestInvoices,
    maxInvoiceAmount: Math.max(0, ...amounts),
  } as const;
}
