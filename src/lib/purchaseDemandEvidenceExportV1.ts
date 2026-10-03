import { supabase } from '@/lib/supabase';
import {
  buildPurchaseDemandEvidence,
  type PurchaseDemandEvidence,
  type SalesEvidenceLine,
} from '@/lib/purchaseDemandEvidenceV1';

const PAGE_SIZE = 1000;
const MAX_SOURCE_ROWS = 100_000;
const MIN_COMPLETE_DAY_COVERAGE_PCT = 99;

type ExportOptions = {
  now?: Date;
  windowDays?: number;
};

export type PurchaseDemandEvidenceExport = {
  schema_version: 'purchase_demand_evidence_export_v1';
  generated_at: string;
  source: {
    table: 'sales_invoice_items_v21';
    source_coverage_start_at: string;
    source_max_invoice_at: string;
    source_rows: number;
    completeness_status: 'proven' | 'unproven';
    incomplete_days: Array<{ branch: string; sales_date: string; header_invoices: number; item_invoices: number; coverage_pct: number }>;
  };
  evidence: PurchaseDemandEvidence[];
};

export async function buildPurchaseDemandEvidenceExport(
  options: ExportOptions = {},
): Promise<PurchaseDemandEvidenceExport> {
  const now = options.now ? new Date(options.now) : new Date();
  const windowDays = Math.max(1, Math.min(90, Math.floor(options.windowDays ?? 30)));
  const requestedStart = new Date(now.getTime() - windowDays * 86_400_000);

  // First prove the extract's latest available invoice timestamp. We deliberately
  // do not pretend the source is fresh through "now" when invoice ingestion is stale.
  const { data: latestRows, error: latestError } = await supabase
    .from('sales_invoice_items_v21')
    .select('invoice_date')
    .in('branch', ['فرع شكري', 'فرع الشامي'])
    .not('invoice_date', 'is', null)
    .gte('invoice_date', requestedStart.toISOString())
    .lte('invoice_date', now.toISOString())
    .order('invoice_date', { ascending: false })
    .limit(1);
  if (latestError) throw latestError;

  const sourceMaxRaw = latestRows?.[0]?.invoice_date;
  const sourceMax = sourceMaxRaw ? new Date(sourceMaxRaw) : null;
  if (!sourceMax || Number.isNaN(sourceMax.getTime()) || sourceMax < requestedStart || sourceMax > now) {
    throw new Error('لا توجد حدود زمنية موثوقة لبيانات الفواتير داخل نافذة التحليل.');
  }

  // Prove that there are no hidden day-level gaps between the header truth and
  // line-item evidence. A first/last timestamp alone cannot prove continuous coverage.
  const { data: headerRows, error: headerError } = await supabase
    .from('sales_invoices')
    .select('branch,branch_name,invoice_number,invoice_no,invoice_datetime,invoice_date')
    .gte('invoice_datetime', requestedStart.toISOString())
    .lte('invoice_datetime', sourceMax.toISOString())
    .limit(MAX_SOURCE_ROWS);
  if (headerError) throw headerError;
  if ((headerRows ?? []).length >= MAX_SOURCE_ROWS) {
    throw new Error('تجاوز مصدر رؤوس الفواتير حد الأمان؛ لا يمكن إثبات اكتمال Evidence.');
  }

  const cairoDay = (value: string | null | undefined) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  };
  const normalizeBranch = (value: string | null | undefined) => {
    const raw = String(value ?? '').trim();
    if (raw === 'فرع شكري' || raw === 'دواء شكري' || raw === 'شكري') return 'فرع شكري';
    if (raw === 'فرع الشامي' || raw === 'دواء الشامي' || raw === 'الشامي') return 'فرع الشامي';
    return null;
  };
  const headerByDay = new Map<string, Set<string>>();
  for (const row of headerRows ?? []) {
    const branch = normalizeBranch(row.branch_name ?? row.branch);
    const day = cairoDay(row.invoice_datetime ?? row.invoice_date);
    const invoice = String(row.invoice_number ?? row.invoice_no ?? '').trim();
    if (!branch || !day || !invoice) continue;
    const key = `${branch}|${day}`;
    const set = headerByDay.get(key) ?? new Set<string>();
    set.add(invoice);
    headerByDay.set(key, set);
  }

  const rows: SalesEvidenceLine[] = [];
  for (let from = 0; from < MAX_SOURCE_ROWS; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('sales_invoice_items_v21')
      .select('branch,product_code,invoice_number,invoice_date,quantity,customer_id,customer_code')
      .in('branch', ['فرع شكري', 'فرع الشامي'])
      .gte('invoice_date', requestedStart.toISOString())
      .lte('invoice_date', sourceMax.toISOString())
      .order('invoice_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);
    if (error) throw error;

    const page = data ?? [];
    for (const row of page) {
      rows.push({
        branch: row.branch,
        productCode: row.product_code,
        invoiceNumber: row.invoice_number,
        invoiceDate: row.invoice_date,
        quantity: row.quantity == null ? null : Number(row.quantity),
        customerId: row.customer_id,
        customerCode: row.customer_code,
      });
    }
    if (page.length < PAGE_SIZE) break;
    if (from + PAGE_SIZE >= MAX_SOURCE_ROWS) {
      throw new Error('تجاوز مصدر الفواتير حد الأمان المسموح للتصدير؛ لم يتم إنشاء Evidence ناقص.');
    }
  }
  if (!rows.length) throw new Error('لا توجد تفاصيل فواتير صالحة لبناء Demand Evidence.');

  const itemsByDay = new Map<string, Set<string>>();
  for (const row of rows) {
    const branch = normalizeBranch(row.branch);
    const day = cairoDay(row.invoiceDate);
    const invoice = String(row.invoiceNumber ?? '').trim();
    if (!branch || !day || !invoice) continue;
    const key = `${branch}|${day}`;
    const set = itemsByDay.get(key) ?? new Set<string>();
    set.add(invoice);
    itemsByDay.set(key, set);
  }
  const incompleteDays = [...headerByDay.entries()].flatMap(([key, invoices]) => {
    const [branch, sales_date] = key.split('|');
    const headerInvoices = invoices.size;
    const itemInvoices = itemsByDay.get(key)?.size ?? 0;
    const coveragePct = headerInvoices > 0 ? (100 * itemInvoices) / headerInvoices : 100;
    return coveragePct < MIN_COMPLETE_DAY_COVERAGE_PCT
      ? [{ branch, sales_date, header_invoices: headerInvoices, item_invoices: itemInvoices, coverage_pct: Math.round(coveragePct * 10) / 10 }]
      : [];
  }).sort((a, b) => a.sales_date.localeCompare(b.sales_date) || a.branch.localeCompare(b.branch));
  const continuousCoverageProven = incompleteDays.length === 0;

  // The first fetched row proves only the lower bound actually available in the
  // requested window. This prevents claiming coverage for days absent from source data.
  const validDates = rows
    .map((row) => row.invoiceDate ? new Date(row.invoiceDate) : null)
    .filter((value): value is Date => Boolean(value && !Number.isNaN(value.getTime())));
  const firstObserved = validDates.reduce((min, value) => value < min ? value : min, validDates[0]);
  const sourceCoverageStart = firstObserved > requestedStart ? firstObserved : requestedStart;

  const evidence = buildPurchaseDemandEvidence(rows, {
    now,
    windowDays,
    sourceCoverageStart: continuousCoverageProven ? sourceCoverageStart : undefined,
    sourceMaxInvoiceAt: sourceMax,
  });

  return {
    schema_version: 'purchase_demand_evidence_export_v1',
    generated_at: now.toISOString(),
    source: {
      table: 'sales_invoice_items_v21',
      source_coverage_start_at: sourceCoverageStart.toISOString(),
      source_max_invoice_at: sourceMax.toISOString(),
      source_rows: rows.length,
      completeness_status: continuousCoverageProven ? 'proven' : 'unproven',
      incomplete_days: incompleteDays,
    },
    evidence,
  };
}

export function downloadPurchaseDemandEvidenceExport(payload: PurchaseDemandEvidenceExport) {
  // Only aggregate evidence leaves the administration app. The payload produced by
  // buildPurchaseDemandEvidence contains no customer IDs, codes, names or invoice numbers.
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `purchase-demand-evidence-${payload.generated_at.slice(0, 10)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
