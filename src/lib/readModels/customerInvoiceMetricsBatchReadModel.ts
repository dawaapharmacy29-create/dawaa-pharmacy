import { supabase } from '@/lib/supabase';

export type CustomerInvoiceMetricsBatchRow = {
  customerCode: string;
  invoicesCount: number;
  totalSpent: number;
  firstPurchase: string | null;
  lastPurchase: string | null;
  activeMonths: number;
};

type RpcRow = {
  customer_code?: unknown;
  invoices_count?: unknown;
  total_spent?: unknown;
  first_purchase?: unknown;
  last_purchase?: unknown;
  active_months?: unknown;
};

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateValue(value: unknown) {
  const text = String(value ?? '').slice(0, 10);
  return text || null;
}

export async function fetchCustomerInvoiceMetricsBatch(
  customerCodes: string[]
): Promise<CustomerInvoiceMetricsBatchRow[]> {
  const codes = [
    ...new Set(customerCodes.map((code) => String(code || '').trim()).filter(Boolean)),
  ];
  if (!codes.length) return [];

  const { data, error } = await supabase.rpc('get_customer_invoice_metrics_batch_v1', {
    p_customer_codes: codes,
  });
  if (error) throw error;

  return ((data || []) as RpcRow[]).map((row) => ({
    customerCode: String(row.customer_code ?? '').trim(),
    invoicesCount: numberValue(row.invoices_count),
    totalSpent: numberValue(row.total_spent),
    firstPurchase: dateValue(row.first_purchase),
    lastPurchase: dateValue(row.last_purchase),
    activeMonths: numberValue(row.active_months),
  }));
}
