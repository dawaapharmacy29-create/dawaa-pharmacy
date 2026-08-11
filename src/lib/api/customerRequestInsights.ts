import { supabase } from '@/lib/supabase';

export type CustomerRequestInsights = {
  period_days: number;
  kpis: {
    total: number;
    open: number;
    overdue: number;
    ready_not_contacted: number;
    linked_products: number;
    unlinked_products: number;
    fulfillment_rate: number | null;
  };
  top_products: Array<{
    product_code: string;
    medicine_name: string;
    requests_count: number;
    fulfilled_count: number;
    not_available_count: number;
    avg_price: number | null;
  }>;
  owners: Array<{
    owner_name: string;
    assigned_count: number;
    completed_count: number;
    overdue_count: number;
    avg_close_hours: number | null;
  }>;
  branches: Array<{
    branch: string;
    total: number;
    completed: number;
    not_available: number;
    overdue: number;
  }>;
};

export async function getCustomerRequestOperationalInsights(branch = 'all', days = 30) {
  const { data, error } = await supabase.rpc('get_customer_request_operational_insights', {
    p_branch: branch === 'all' ? null : branch,
    p_days: days,
  });
  if (error) throw new Error(error.message);
  return data as CustomerRequestInsights;
}
