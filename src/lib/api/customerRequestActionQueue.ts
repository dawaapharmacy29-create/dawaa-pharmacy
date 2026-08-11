import { supabase } from '@/lib/supabase';
import type { CustomerRequest } from '@/lib/api/customerRequests';

export type CustomerRequestActionQueueItem = CustomerRequest & {
  priority_score: number;
  stage_age_hours: number;
  sla_hours: number;
  is_overdue: boolean;
  reason: string;
};

export async function getCustomerRequestActionQueue(branch = 'all', limit = 12) {
  const { data, error } = await supabase.rpc('get_customer_request_action_queue', {
    p_branch: branch === 'all' ? null : branch,
    p_limit: Math.max(1, Math.min(limit, 30)),
  });
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : []) as CustomerRequestActionQueueItem[];
}
