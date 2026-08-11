import { supabase } from '@/lib/supabase';

export type CustomerRequestInsights = {
  period_days: number;
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

export async function getCustomerRequestOperationalInsights(branch = 'all', days = 30) {
  const { data, error } = await supabase.rpc('get_customer_request_operational_insights', {
    p_branch: branch === 'all' ? null : branch,
    p_days: days,
  });
  if (error) throw new Error(error.message);
  return data as CustomerRequestInsights;
}
