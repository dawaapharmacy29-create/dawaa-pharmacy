import { supabase } from '@/lib/supabase';
import { customerRequestSourceBranch } from '@/lib/customerRequestsBranch';

export type CustomerRequestInsights = {
  period_days: number;
  period_from?: string;
  period_to?: string;
  generated_at?: string;
  kpis: {
    total: number;
    open: number;
    overdue: number;
    ready_not_contacted: number;
    linked_products: number;
    unlinked_products: number;
    delivered: number;
    cancelled: number;
    not_available: number;
    linked_products_rate: number | null;
    fulfillment_rate: number | null;
    avg_close_hours: number | null;
  };
  top_products: Array<{
    product_code: string;
    medicine_name: string;
    requests_count: number;
    fulfilled_count: number;
    not_available_count: number;
    fulfillment_rate: number | null;
    avg_price: number | null;
    last_requested_at: string | null;
    top_branch: string | null;
  }>;
  owners: Array<{
    owner_name: string;
    assigned_count: number;
    completed_count: number;
    overdue_count: number;
    ready_not_contacted_count: number;
    fulfilled_count: number;
    completion_rate: number | null;
    fulfillment_rate: number | null;
    avg_close_hours: number | null;
  }>;
  branches: Array<{
    branch: string;
    total: number;
    open: number;
    ready: number;
    completed: number;
    delivered: number;
    not_available: number;
    overdue: number;
    completion_rate: number | null;
    fulfillment_rate: number | null;
    avg_fulfillment_hours: number | null;
  }>;
  stages: Array<{ status: string; requests_count: number; avg_stage_hours: number | null }>;
  channels: Array<{
    channel: string;
    requests_count: number;
    fulfilled_count: number;
    fulfillment_rate: number | null;
    avg_close_hours: number | null;
  }>;
  priorities: Array<{
    priority: string;
    requests_count: number;
    overdue_count: number;
    completed_count: number;
    completion_rate: number | null;
  }>;
  top_customers: Array<{
    customer_key: string;
    customer_name: string;
    customer_code: string | null;
    customer_phone: string | null;
    requests_count: number;
    overdue_count: number;
    fulfilled_count: number;
    last_request_at: string | null;
  }>;
  delay_reasons: Array<{ reason: string; requests_count: number }>;
  registrars: Array<{ staff_name: string; requests_count: number; fulfilled_count: number }>;
  followers: Array<{ staff_name: string; actions_count: number; requests_count: number }>;
};

export async function getCustomerRequestOperationalInsights(branch = 'all', days = 30, to?: string) {
  const normalizedBranch = branch === 'all' ? null : customerRequestSourceBranch(branch);
  const { data, error } = await supabase.rpc('get_customer_request_operational_insights', {
    p_branch: normalizedBranch,
    p_days: days,
    p_to: to || null,
  });
  if (error) throw new Error(error.message);
  return data as CustomerRequestInsights;
}

/** Fetches the current window plus the immediately preceding window of equal length,
 *  so the UI can show whether performance improved or declined period-over-period. */
export async function getCustomerRequestOperationalInsightsWithTrend(branch = 'all', days = 30) {
  const now = new Date();
  const previousTo = new Date(now.getTime() - days * 86_400_000).toISOString();
  const [current, previous] = await Promise.all([
    getCustomerRequestOperationalInsights(branch, days),
    getCustomerRequestOperationalInsights(branch, days, previousTo),
  ]);
  return { current, previous };
}
