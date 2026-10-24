import { supabase } from '@/lib/supabase';
import { readInvoiceRecordsByIds } from '@/lib/readModels/invoiceRecordReadModel';
import { derivePricingExecutionAssessment } from './salesPricingExecutionV1';
import { summarizeStaffCommercialPerformanceV1, type StaffCommercialSummaryV1 } from './staffCommercialAnalyticsV1';
import { cairoDateBoundaryIso, cairoWallTimeDate } from '@/lib/time/cairoDateBoundary';
import { readInvoiceItemCommercialMeta } from '@/lib/invoices/invoiceItemCommercialMeta';

type AnyRow = Record<string, any>;

const PAGE_SIZE = 1000;
const MAX_ROWS = 50000;

// Delegates to the canonical Cairo boundary (one Cairo wall-clock implementation in the app);
// identical output to the former local conversion for every day 2020-2030.
function cairoWallClockToIso(date: string, endOfDay = false): string {
  if (!endOfDay) return cairoDateBoundaryIso(date);
  const [year, month, day] = date.split('-').map(Number);
  return new Date(cairoWallTimeDate(year, month, day + 1).getTime() - 1000).toISOString();
}

function normalizeBranch(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^فرع\s+/, '')
    .replace(/\s+/g, ' ');
}

async function fetchInvoiceItemsForCycle(fromIso: string, toIso: string): Promise<AnyRow[]> {
  const rows: AnyRow[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('sales_invoice_items_v21')
      .select('id,invoice_id,invoice_number,invoice_date,product_id,product_code,product_name,quantity,unit_price,line_total,raw_data')
      .gte('invoice_date', fromIso)
      .lte('invoice_date', toIso)
      .order('invoice_date', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

function chunks<T>(rows: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < rows.length; i += size) result.push(rows.slice(i, i + size));
  return result;
}

/**
 * One invoice line as a commercial fact. Reads both stored raw_data shapes through the shared
 * parser: the importer's `__dawaa_commercial` object and the compact B-Connect rows whose returns,
 * line discount and gross sit at the top level (previously ignored here, so a compact return still
 * counted as sold quantity). Nothing is derived that the row does not carry; no attribution or
 * incentive rule lives here.
 */
export function buildDoctorCommercialLineFactV1(row: AnyRow, header: AnyRow | null, offers: AnyRow[]) {
  const meta = readInvoiceItemCommercialMeta(row.raw_data);
  const dawaa = row.raw_data?.__dawaa_commercial ?? {};
  const branch = normalizeBranch(header?.branch_name ?? header?.branch);
  const saleDay = String(header?.invoice_datetime ?? header?.sale_date ?? row.invoice_date ?? '').slice(0, 10);
  const lineOffers = offers
    .filter((offer) => {
      if (String(offer.item_code ?? '') !== String(row.product_code ?? '')) return false;
      if (offer.active === false) return false;
      const offerBranch = normalizeBranch(offer.branch);
      if (offerBranch && branch && offerBranch !== branch) return false;
      const start = String(offer.start_date ?? '').slice(0, 10);
      const end = String(offer.end_date ?? '').slice(0, 10);
      if (saleDay && start && saleDay < start) return false;
      if (saleDay && end && saleDay > end) return false;
      return true;
    })
    .map((offer) => ({
      id: String(offer.id),
      title: offer.title == null ? null : String(offer.title),
      finalPrice: offer.final_price == null ? null : Number(offer.final_price),
    }));

  const quantity = row.quantity == null ? null : Number(row.quantity);
  const returned = Math.max(0, meta.returnedQuantity ?? 0);
  const netLineAmount = meta.netLineAmount ?? (row.line_total == null ? null : Number(row.line_total));
  const pricing = derivePricingExecutionAssessment(
    {
      quantity,
      returnedQuantity: meta.returnedQuantity,
      effectiveQuantity: meta.effectiveQuantity,
      unitPrice: row.unit_price == null ? null : Number(row.unit_price),
      itemDiscountAmount: meta.allocatedInvoiceDiscountAmount ?? meta.itemDiscountAmount,
      itemDiscountPercent: meta.itemDiscountPercent,
      grossLineAmount: meta.grossLineAmount,
      netLineAmount,
      invoiceDiscountAmount: meta.invoiceDiscountAmount,
      allocatedInvoiceDiscountAmount: meta.allocatedInvoiceDiscountAmount,
    },
    lineOffers
  );

  return {
    invoiceId: row.invoice_id == null ? null : String(row.invoice_id),
    invoiceNumber: String(row.invoice_number ?? ''),
    staffId: header?.staff_id == null ? null : String(header.staff_id),
    staffName: header?.staff_name ?? header?.seller_name ?? header?.normalized_seller_name ?? dawaa.staff_name ?? null,
    quantity: meta.effectiveQuantity ?? (quantity == null ? null : Math.max(0, quantity - returned)),
    grossLineAmount:
      meta.effectiveGrossAfterReturn ??
      (quantity != null && quantity > 0 && meta.grossLineAmount != null
        ? (meta.grossLineAmount * Math.max(0, quantity - returned)) / quantity
        : meta.grossLineAmount),
    netLineAmount,
    itemDiscountAmount: meta.itemDiscountAmount,
    returnedQuantity: meta.returnedQuantity,
    pricingStatus: pricing.status,
    quotedUnitPrice: null,
    quotedPriceStatus: 'not_quoted' as const,
    pricingNeedsHumanReview: pricing.needsHumanReview,
  };
}

export interface DoctorCommercialCycleDataV1 {
  summaries: StaffCommercialSummaryV1[];
  lineCount: number;
  truncated: boolean;
  linkedInvoiceLineCount: number;
  unmatchedInvoiceLineCount: number;
  needsReviewLineCount: number;
  offerReferenceCount: number;
}

export async function fetchDoctorCommercialCycleDataV1(
  cycleStart: string,
  cycleEnd: string
): Promise<DoctorCommercialCycleDataV1> {
  const fromIso = cairoWallClockToIso(cycleStart, false);
  const toIso = cairoWallClockToIso(cycleEnd, true);

  const items = await fetchInvoiceItemsForCycle(fromIso, toIso);

  const invoiceIds = Array.from(new Set(items.map((row) => String(row.invoice_id ?? '')).filter(Boolean)));
  const headers: AnyRow[] = [];
  for (const ids of chunks(invoiceIds, 500)) {
    headers.push(...(await readInvoiceRecordsByIds(ids, supabase)));
  }
  const headerById = new Map(headers.map((row) => [String(row.id), row]));

  const productCodes = Array.from(new Set(items.map((row) => String(row.product_code ?? '')).filter(Boolean)));
  const offers: AnyRow[] = [];
  for (const codes of chunks(productCodes, 500)) {
    const { data, error } = await supabase
      .from('offers')
      .select('id,title,branch,item_code,final_price,start_date,end_date,status,active')
      .in('item_code', codes)
      .lte('start_date', cycleEnd)
      .gte('end_date', cycleStart);
    if (error) throw error;
    offers.push(...(data ?? []));
  }

  let linkedInvoiceLineCount = 0;
  let unmatchedInvoiceLineCount = 0;
  let needsReviewLineCount = 0;

  const facts = items.map((row) => {
    const header = row.invoice_id ? headerById.get(String(row.invoice_id)) ?? null : null;
    if (header) linkedInvoiceLineCount += 1;
    else unmatchedInvoiceLineCount += 1;
    const fact = buildDoctorCommercialLineFactV1(row, header, offers);
    if (fact.pricingNeedsHumanReview) needsReviewLineCount += 1;
    const { pricingNeedsHumanReview: _review, ...line } = fact;
    return line;
  });

  return {
    summaries: summarizeStaffCommercialPerformanceV1(facts),
    lineCount: items.length,
    truncated: items.length >= MAX_ROWS,
    linkedInvoiceLineCount,
    unmatchedInvoiceLineCount,
    needsReviewLineCount,
    offerReferenceCount: offers.length,
  };
}
