import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { dashboardNumber } from "@/lib/dashboard/dashboardTruthService";

export type LoyaltyTier = "بلاتيني" | "ذهبي" | "فضي";

export type LoyaltyCustomer = {
  id: string;
  name: string;
  phone: string | null;
  branch: string | null;
  customer_code: string | null;
  total_purchases: number;
  total_invoices: number;
  avg_invoice: number;
  avg_monthly: number;
  first_purchase: string | null;
  last_purchase: string | null;
  tier: LoyaltyTier;
};

export type LoyaltyTierSummary = {
  tier: LoyaltyTier;
  label: string;
  min: number;
  max: number | null;
  customers_count: number;
  total_spent: number;
  avg_spent: number;
  top_customer: LoyaltyCustomer | null;
};

export type LoyaltyTiersResult = {
  customers: LoyaltyCustomer[];
  summaries: LoyaltyTierSummary[];
  source: string;
  warnings: string[];
  loadedAt: string;
};

type RawCustomer = Record<string, unknown>;
type RawInvoice = Record<string, unknown>;

const PAGE_SIZE = 1000;

export const LOYALTY_TIERS: Record<LoyaltyTier, { min: number; max: number | null; label: string }> = {
  بلاتيني: { min: 8000.000001, max: null, label: "أكثر من 8,000 جنيه" },
  ذهبي: { min: 4000, max: 8000, label: "4,000 إلى 8,000 جنيه" },
  فضي: { min: 1500, max: 3999.999999, label: "1,500 إلى أقل من 4,000 جنيه" },
};

export function classifyLoyalty(total: number): LoyaltyTier | null {
  if (total > 8000) return "بلاتيني";
  if (total >= 4000 && total <= 8000) return "ذهبي";
  if (total >= 1500 && total < 4000) return "فضي";
  return null;
}

function text(value: unknown) {
  const raw = String(value ?? "").trim();
  return raw || null;
}

function normalizePhone(value: unknown) {
  return String(value ?? "").replace(/\D/g, "").replace(/^20/, "0").trim() || null;
}

function amountFromInvoice(row: RawInvoice) {
  return dashboardNumber(row.net_amount ?? row.discounted_amount ?? row.amount ?? row.gross_amount ?? row.total_amount);
}

function customerKey(row: RawCustomer | RawInvoice) {
  return text(row.customer_code) || text(row.code) || normalizePhone(row.customer_phone ?? row.phone) || text(row.customer_id) || text(row.id) || text(row.customer_name) || text(row.name) || crypto.randomUUID();
}

async function fetchAll<T = Record<string, unknown>>(table: string, select: string, orderColumn?: string) {
  const rows: T[] = [];
  let from = 0;
  while (true) {
    let query = supabase.from(table).select(select);
    if (orderColumn) query = query.order(orderColumn, { ascending: false, nullsFirst: false });
    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data || []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

function toLoyaltyCustomer(row: RawCustomer): LoyaltyCustomer | null {
  const total = dashboardNumber(row.total_purchases ?? row.total_spent ?? row.clv ?? 0);
  const tier = classifyLoyalty(total);
  if (!tier) return null;
  const invoices = dashboardNumber(row.total_invoices ?? row.invoices_count ?? 0);
  return {
    id: String(row.id ?? row.customer_id ?? row.final_customer_key ?? customerKey(row)),
    name: text(row.customer_name) || text(row.name) || "عميل بدون اسم",
    phone: text(row.customer_phone) || text(row.phone),
    branch: text(row.branch),
    customer_code: text(row.customer_code) || text(row.code),
    total_purchases: total,
    total_invoices: invoices,
    avg_invoice: dashboardNumber(row.avg_invoice ?? (invoices ? total / invoices : 0)),
    avg_monthly: dashboardNumber(row.avg_monthly ?? 0),
    first_purchase: text(row.first_purchase),
    last_purchase: text(row.last_purchase ?? row.last_invoice_date),
    tier,
  };
}

function buildSummaries(customers: LoyaltyCustomer[]): LoyaltyTierSummary[] {
  return (Object.keys(LOYALTY_TIERS) as LoyaltyTier[]).map((tier) => {
    const cfg = LOYALTY_TIERS[tier];
    const rows = customers.filter((customer) => customer.tier === tier).sort((a, b) => b.total_purchases - a.total_purchases);
    const total = rows.reduce((sum, row) => sum + row.total_purchases, 0);
    return {
      tier,
      label: cfg.label,
      min: cfg.min,
      max: cfg.max,
      customers_count: rows.length,
      total_spent: total,
      avg_spent: rows.length ? total / rows.length : 0,
      top_customer: rows[0] || null,
    };
  });
}

function aggregateInvoices(rows: RawInvoice[], customerRows: RawCustomer[]) {
  const customersByKey = new Map<string, RawCustomer>();
  customerRows.forEach((row) => customersByKey.set(customerKey(row), row));

  const map = new Map<string, RawCustomer & { total_spent: number; invoices_count: number; first_purchase: string | null; last_purchase: string | null }>();
  for (const inv of rows) {
    const key = customerKey(inv);
    const base = customersByKey.get(key) || {};
    const current = map.get(key) || {
      ...base,
      id: base.id || inv.customer_id || key,
      customer_code: base.customer_code || inv.customer_code || null,
      customer_name: base.customer_name || base.name || inv.customer_name || "عميل بدون اسم",
      customer_phone: base.customer_phone || base.phone || inv.customer_phone || null,
      branch: base.branch || inv.branch || null,
      total_spent: 0,
      invoices_count: 0,
      first_purchase: null,
      last_purchase: null,
    };
    const day = text(inv.invoice_date)?.slice(0, 10) || null;
    current.total_spent += amountFromInvoice(inv);
    current.invoices_count += 1;
    if (day && (!current.first_purchase || day < current.first_purchase)) current.first_purchase = day;
    if (day && (!current.last_purchase || day > current.last_purchase)) current.last_purchase = day;
    map.set(key, current);
  }
  return [...map.values()].map((row) => ({ ...row, total_purchases: row.total_spent, total_invoices: row.invoices_count }));
}

export async function fetchLoyaltyTiers(): Promise<LoyaltyTiersResult> {
  if (!isSupabaseConfigured) {
    return { customers: [], summaries: buildSummaries([]), source: "not_configured", warnings: ["Supabase غير مضبوط"], loadedAt: new Date().toISOString() };
  }

  const warnings: string[] = [];
  let source = "customers";
  let rawCustomers: RawCustomer[] = [];

  try {
    rawCustomers = await fetchAll<RawCustomer>(
      "customers",
      "id,name,phone,branch,type,total_purchases,total_spent,avg_monthly,total_invoices,invoices_count,avg_invoice,clv,retention_status,last_purchase,last_invoice_date,first_purchase,customer_code,code",
      "total_purchases",
    );
  } catch (error) {
    warnings.push(`customers: ${error instanceof Error ? error.message : "تعذر تحميل العملاء"}`);
  }

  let customers = rawCustomers.map(toLoyaltyCustomer).filter(Boolean) as LoyaltyCustomer[];

  const strongCustomerTotals = customers.filter((row) => row.total_purchases > 0).length;
  if (strongCustomerTotals < 10) {
    try {
      const invoices = await fetchAll<RawInvoice>(
        "sales_invoices",
        "id,customer_id,customer_code,customer_name,customer_phone,phone,branch,invoice_date,net_amount,discounted_amount,amount,gross_amount,total_amount,invoice_no,invoice_number",
        "invoice_date",
      );
      const aggregated = aggregateInvoices(invoices, rawCustomers);
      customers = aggregated.map(toLoyaltyCustomer).filter(Boolean) as LoyaltyCustomer[];
      source = "sales_invoices_aggregation";
    } catch (error) {
      warnings.push(`sales_invoices: ${error instanceof Error ? error.message : "تعذر حساب الولاء من الفواتير"}`);
    }
  }

  customers = customers.sort((a, b) => b.total_purchases - a.total_purchases);
  return {
    customers,
    summaries: buildSummaries(customers),
    source,
    warnings,
    loadedAt: new Date().toISOString(),
  };
}
