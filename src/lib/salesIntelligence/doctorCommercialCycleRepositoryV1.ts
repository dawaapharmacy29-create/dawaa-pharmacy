import { supabase } from '@/lib/supabase';
import { derivePricingExecutionAssessment } from './salesPricingExecutionV1';
import { summarizeStaffCommercialPerformanceV1, type StaffCommercialSummaryV1 } from './staffCommercialAnalyticsV1';

type AnyRow = Record<string, any>;

const PAGE_SIZE = 1000;
const MAX_ROWS = 50000;

async function pagedSelect(
  table: string,
  columns: string,
  apply: (query: any) => any
): Promise<AnyRow[]> {
  const rows: AnyRow[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    const query = apply(
      supabase
        .from(table)
        .select(columns)
        .range(from, from + PAGE_SIZE - 1)
    );
    const { data, error } = await query;
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

export interface DoctorCommercialCycleDataV1 {
  summaries: StaffCommercialSummaryV1[];
  lineCount: number;
  truncated: boolean;
  linkedInvoiceLineCount: number;
  unmatchedInvoiceLineCount: number;
  needsReviewLineCount: number;
}

export async function fetchDoctorCommercialCycleDataV1(
  cycleStart: string,
  cycleEnd: string
): Promise<DoctorCommercialCycleDataV1> {
  const fromIso = `${cycleStart}T00:00:00`;
  const toIso = `${cycleEnd}T23:59:59`;

  const items = await pagedSelect(
    'sales_invoice_items_v21',
    'id,invoice_id,invoice_number,invoice_date,product_id,product_code,product_name,quantity,unit_price,line_total,raw_data',
    (query) => query.gte('invoice_date', fromIso).lte('invoice_date', toIso).order('invoice_date', { ascending: true })
  );

  const invoiceIds = Array.from(new Set(items.map((row) => String(row.invoice_id ?? '')).filter(Boolean)));
  const headers: AnyRow[] = [];
  for (const ids of chunks(invoiceIds, 500)) {
    const { data, error } = await supabase
      .from('sales_invoices')
      .select('id,invoice_number,invoice_no,branch,branch_name,invoice_datetime,sale_date,seller_name,normalized_seller_name,staff_id,staff_name')
      .in('id', ids);
    if (error) throw error;
    headers.push(...(data ?? []));
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

    const meta = row.raw_data?.__dawaa_commercial ?? {};
    const branch = String(header?.branch_name ?? header?.branch ?? '').trim();
    const saleDay = String(header?.invoice_datetime ?? header?.sale_date ?? row.invoice_date ?? '').slice(0, 10);
    const lineOffers = offers
      .filter((offer) => {
        if (String(offer.item_code ?? '') !== String(row.product_code ?? '')) return false;
        if (offer.active === false) return false;
        const offerBranch = String(offer.branch ?? '').trim();
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

    const pricing = derivePricingExecutionAssessment(
      {
        quantity: row.quantity == null ? null : Number(row.quantity),
        unitPrice: row.unit_price == null ? null : Number(row.unit_price),
        itemDiscountAmount: meta.item_discount_amount == null ? null : Number(meta.item_discount_amount),
        itemDiscountPercent: meta.item_discount_percent == null ? null : Number(meta.item_discount_percent),
        grossLineAmount: meta.gross_line_amount == null ? null : Number(meta.gross_line_amount),
        netLineAmount: meta.net_line_amount == null ? (row.line_total == null ? null : Number(row.line_total)) : Number(meta.net_line_amount),
        invoiceDiscountAmount: meta.invoice_discount_amount == null ? null : Number(meta.invoice_discount_amount),
      },
      lineOffers
    );
    if (pricing.needsHumanReview) needsReviewLineCount += 1;

    return {
      invoiceId: row.invoice_id == null ? null : String(row.invoice_id),
      invoiceNumber: String(row.invoice_number ?? ''),
      staffId: header?.staff_id == null ? null : String(header.staff_id),
      staffName: header?.staff_name ?? header?.seller_name ?? header?.normalized_seller_name ?? meta.staff_name ?? null,
      quantity: row.quantity == null ? null : Number(row.quantity),
      grossLineAmount: meta.gross_line_amount == null
        ? (row.quantity != null && row.unit_price != null ? Number(row.quantity) * Number(row.unit_price) : null)
        : Number(meta.gross_line_amount),
      netLineAmount: meta.net_line_amount == null ? (row.line_total == null ? null : Number(row.line_total)) : Number(meta.net_line_amount),
      itemDiscountAmount: meta.item_discount_amount == null ? null : Number(meta.item_discount_amount),
      returnedQuantity: meta.returned_quantity == null ? null : Number(meta.returned_quantity),
      pricingStatus: pricing.status,
      quotedUnitPrice: null,
      quotedPriceStatus: 'not_quoted',
    };
  });

  return {
    summaries: summarizeStaffCommercialPerformanceV1(facts),
    lineCount: items.length,
    truncated: items.length >= MAX_ROWS,
    linkedInvoiceLineCount,
    unmatchedInvoiceLineCount,
    needsReviewLineCount,
  };
}
