export const PURCHASE_DEMAND_EVIDENCE_MODEL = 'invoice_behavior_v1';

export type SalesEvidenceLine = {
  branch: string;
  productCode: string | null;
  invoiceNumber: string;
  invoiceDate: string | null;
  quantity: number | null;
  customerId?: string | null;
  customerCode?: string | null;
};

export type PurchaseDemandEvidence = {
  branch: 'دواء شكري' | 'دواء الشامي';
  product_code: string;
  units_30d: number;
  invoices_30d: number;
  active_days_30d: number;
  customers_30d: number;
  known_customer_invoices_30d: number;
  typical_invoice_qty_30d: number;
  max_invoice_qty_30d: number;
  dominant_invoice_share_30d: number;
  dominant_customer_share_30d: number | null;
  outlier_share_30d: number;
  last_sale_at: string;
  source_max_invoice_at: string;
  source_coverage_start_at: string;
  source_coverage_days: number;
  observed_span_days: number;
  window_start: string;
  window_end: string;
  evidence_model_version: typeof PURCHASE_DEMAND_EVIDENCE_MODEL;
  behavior_class: 'recurring' | 'sparse' | 'concentrated' | 'burst_one_off' | 'emerging';
  evidence_confidence_score: number;
  evidence_quality_class: 'high' | 'medium' | 'review';
};

const branchMap: Record<string, PurchaseDemandEvidence['branch'] | undefined> = {
  'فرع شكري': 'دواء شكري',
  'دواء شكري': 'دواء شكري',
  'شكري': 'دواء شكري',
  'فرع الشامي': 'دواء الشامي',
  'دواء الشامي': 'دواء الشامي',
  'الشامي': 'دواء الشامي',
};

function normalizeProductCode(value: string | null | undefined) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  return raw.replace(/\.0+$/, '');
}

function toFinitePositive(value: number | null | undefined) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function round(value: number, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function customerKey(row: SalesEvidenceLine) {
  const id = String(row.customerId ?? '').trim();
  if (id) return `id:${id}`;
  const code = String(row.customerCode ?? '').trim();
  return code ? `code:${code}` : null;
}

export function buildPurchaseDemandEvidence(
  rows: SalesEvidenceLine[],
  options: { now: Date; windowDays?: number; sourceCoverageStart?: Date } = { now: new Date() },
): PurchaseDemandEvidence[] {
  const windowDays = Math.max(1, Math.min(90, Math.floor(options.windowDays ?? 30)));
  const windowEnd = new Date(options.now);
  const windowStart = new Date(windowEnd.getTime() - windowDays * 86_400_000);
  const requestedCoverageStart = options.sourceCoverageStart && !Number.isNaN(options.sourceCoverageStart.getTime())
    ? new Date(Math.max(windowStart.getTime(), options.sourceCoverageStart.getTime()))
    : windowStart;
  const sourceCoverageDays = Math.max(1, Math.min(windowDays, Math.ceil((windowEnd.getTime() - requestedCoverageStart.getTime()) / 86_400_000)));

  type InvoiceAgg = {
    branch: PurchaseDemandEvidence['branch'];
    productCode: string;
    invoiceNumber: string;
    invoiceAt: Date;
    quantity: number;
    customer: string | null;
  };

  const invoiceMap = new Map<string, InvoiceAgg>();

  for (const row of rows) {
    const branch = branchMap[String(row.branch ?? '').trim()];
    const productCode = normalizeProductCode(row.productCode);
    const invoiceNumber = String(row.invoiceNumber ?? '').trim();
    const invoiceAt = row.invoiceDate ? new Date(row.invoiceDate) : null;
    const quantity = toFinitePositive(row.quantity);
    if (!branch || !productCode || !invoiceNumber || !invoiceAt || Number.isNaN(invoiceAt.getTime()) || quantity <= 0) continue;
    if (invoiceAt < windowStart || invoiceAt > windowEnd) continue;

    const key = [branch, productCode, invoiceNumber].join('|');
    const existing = invoiceMap.get(key);
    if (existing) {
      existing.quantity += quantity;
      if (invoiceAt > existing.invoiceAt) existing.invoiceAt = invoiceAt;
      existing.customer ||= customerKey(row);
    } else {
      invoiceMap.set(key, { branch, productCode, invoiceNumber, invoiceAt, quantity, customer: customerKey(row) });
    }
  }

  const productMap = new Map<string, InvoiceAgg[]>();
  for (const invoice of invoiceMap.values()) {
    const key = `${invoice.branch}|${invoice.productCode}`;
    const group = productMap.get(key) ?? [];
    group.push(invoice);
    productMap.set(key, group);
  }

  const result: PurchaseDemandEvidence[] = [];
  for (const invoices of productMap.values()) {
    invoices.sort((a, b) => a.invoiceAt.getTime() - b.invoiceAt.getTime());
    const quantities = invoices.map((x) => x.quantity);
    const units = quantities.reduce((sum, x) => sum + x, 0);
    if (units <= 0) continue;

    const typical = median(quantities);
    const deviations = quantities.map((x) => Math.abs(x - typical));
    const mad = median(deviations);
    const outlierThreshold = Math.max(typical * 3, typical + 3 * mad, typical + 2);
    const outlierUnits = invoices.filter((x) => x.quantity > outlierThreshold).reduce((sum, x) => sum + x.quantity, 0);
    const maxQty = Math.max(...quantities);

    const activeDays = new Set(invoices.map((x) => x.invoiceAt.toISOString().slice(0, 10))).size;
    const customerUnits = new Map<string, number>();
    let knownCustomerInvoices = 0;
    for (const invoice of invoices) {
      if (!invoice.customer) continue;
      knownCustomerInvoices += 1;
      customerUnits.set(invoice.customer, (customerUnits.get(invoice.customer) ?? 0) + invoice.quantity);
    }
    const knownCustomerUnits = [...customerUnits.values()].reduce((sum, x) => sum + x, 0);
    const dominantCustomerUnits = customerUnits.size ? Math.max(...customerUnits.values()) : 0;
    const dominantCustomerShare = knownCustomerUnits > 0 ? dominantCustomerUnits / knownCustomerUnits : null;
    const outlierShare = outlierUnits / units;
    const dominantInvoiceShare = maxQty / units;
    const coverageRatio = Math.min(1, sourceCoverageDays / windowDays);
    const customerEvidenceRatio = invoices.length > 0 ? knownCustomerInvoices / invoices.length : 0;
    const volumeScore = Math.min(35, (invoices.length / 8) * 35);
    const recurrenceScore = Math.min(25, (activeDays / 10) * 25);
    const coverageScore = coverageRatio * 20;
    const customerScore = Math.min(10, customerEvidenceRatio * 10);
    const breadthScore = Math.min(10, (customerUnits.size / 4) * 10);
    const bulkPenalty = Math.min(20, outlierShare * 20);
    const concentrationPenalty = dominantCustomerShare === null ? 0 : Math.min(15, Math.max(0, dominantCustomerShare - 0.5) * 30);
    const evidenceConfidenceScore = round(Math.max(0, Math.min(100,
      volumeScore + recurrenceScore + coverageScore + customerScore + breadthScore - bulkPenalty - concentrationPenalty
    )), 1);
    const evidenceQualityClass: PurchaseDemandEvidence['evidence_quality_class'] =
      coverageRatio < 0.5 || invoices.length < 2 ? 'review'
        : evidenceConfidenceScore >= 70 && activeDays >= 5 ? 'high'
          : evidenceConfidenceScore >= 45 && activeDays >= 3 ? 'medium'
            : 'review';

    let behavior: PurchaseDemandEvidence['behavior_class'] = 'recurring';
    if (invoices.length <= 2 && (outlierShare >= 0.5 || dominantInvoiceShare >= 0.7)) behavior = 'burst_one_off';
    else if (dominantCustomerShare !== null && dominantCustomerShare >= 0.75 && knownCustomerInvoices >= 2) behavior = 'concentrated';
    else if (invoices.length <= 2 || activeDays <= 2) behavior = 'sparse';
    else {
      const recentCutoff = new Date(windowEnd.getTime() - Math.min(7, windowDays) * 86_400_000);
      const recentInvoices = invoices.filter((x) => x.invoiceAt >= recentCutoff).length;
      if (invoices.length >= 3 && recentInvoices / invoices.length >= 0.75 && activeDays >= 3) behavior = 'emerging';
    }

    const firstSale = invoices[0].invoiceAt.toISOString();
    const lastSale = invoices[invoices.length - 1].invoiceAt.toISOString();
    const observedSpanDays = Math.max(1, Math.ceil((invoices[invoices.length - 1].invoiceAt.getTime() - invoices[0].invoiceAt.getTime()) / 86_400_000) + 1);
    result.push({
      branch: invoices[0].branch,
      product_code: invoices[0].productCode,
      units_30d: round(units, 3),
      invoices_30d: invoices.length,
      active_days_30d: activeDays,
      customers_30d: customerUnits.size,
      known_customer_invoices_30d: knownCustomerInvoices,
      typical_invoice_qty_30d: round(typical, 3),
      max_invoice_qty_30d: round(maxQty, 3),
      dominant_invoice_share_30d: round(dominantInvoiceShare),
      dominant_customer_share_30d: dominantCustomerShare === null ? null : round(dominantCustomerShare),
      outlier_share_30d: round(outlierShare),
      last_sale_at: lastSale,
      source_max_invoice_at: lastSale,
      source_coverage_start_at: requestedCoverageStart.toISOString(),
      source_coverage_days: sourceCoverageDays,
      observed_span_days: observedSpanDays,
      window_start: windowStart.toISOString(),
      window_end: windowEnd.toISOString(),
      evidence_model_version: PURCHASE_DEMAND_EVIDENCE_MODEL,
      behavior_class: behavior,
      evidence_confidence_score: evidenceConfidenceScore,
      evidence_quality_class: evidenceQualityClass,
    });
  }

  return result.sort((a, b) => a.branch.localeCompare(b.branch) || a.product_code.localeCompare(b.product_code));
}