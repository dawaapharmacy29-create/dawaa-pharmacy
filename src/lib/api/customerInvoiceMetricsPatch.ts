import { supabase } from '@/lib/supabase';

export type CustomerInvoiceMetricPatchRow = {
  customer_code?: string | null;
  invoices_count?: number | string | null;
  total_spent?: number | string | null;
  first_purchase?: string | null;
  last_purchase?: string | null;
  active_months?: number | string | null;
};

/**
 * Server-side aggregate fast path for customer list invoice metrics.
 * Returns null when the RPC is unavailable so callers can preserve their
 * existing raw-invoice fallback without turning an RPC outage into bad data.
 */
export async function fetchCustomerInvoiceMetricsPatch(
  customerCodes: string[]
): Promise<CustomerInvoiceMetricPatchRow[] | null> {
  const codes = [...new Set(customerCodes.map((code) => String(code || '').trim()).filter(Boolean))];
  if (!codes.length) return [];

  const { data, error } = await supabase.rpc('get_customer_invoice_metrics_patch_v1', {
    p_customer_codes: codes,
  });

  if (error || !Array.isArray(data)) return null;
  return data as CustomerInvoiceMetricPatchRow[];
}
