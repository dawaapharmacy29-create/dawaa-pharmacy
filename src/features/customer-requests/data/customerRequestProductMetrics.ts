import { supabase } from '@/lib/supabase';
import { customerRequestSourceBranch } from '../domain/branch';

export interface CustomerRequestProductMetricRow {
  product_code: string;
  requests_count: number;
  fulfilled_count: number;
  fulfillment_rate: number | null;
}

export async function getCustomerRequestProductMetrics(
  productCodes: string[],
  branch = 'all',
  days = 90
): Promise<CustomerRequestProductMetricRow[]> {
  const codes = Array.from(
    new Set(productCodes.map((value) => String(value || '').trim()).filter(Boolean))
  ).slice(0, 100);
  if (!codes.length) return [];

  const { data, error } = await supabase.rpc('get_customer_request_product_metrics_v2', {
    p_product_codes: codes,
    p_branch: branch === 'all' ? null : customerRequestSourceBranch(branch),
    p_days: Math.max(1, Math.min(365, days)),
  });
  if (error) throw new Error(error.message);

  return (Array.isArray(data) ? data : []).map((row) => {
    const item = row as Record<string, unknown>;
    return {
      product_code: String(item.product_code || ''),
      requests_count: Number(item.requests_count || 0),
      fulfilled_count: Number(item.fulfilled_count || 0),
      fulfillment_rate:
        item.fulfillment_rate === null || item.fulfillment_rate === undefined
          ? null
          : Number(item.fulfillment_rate),
    };
  });
}
