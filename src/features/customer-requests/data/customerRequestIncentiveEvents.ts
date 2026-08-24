import { supabase } from '@/lib/supabase';

export interface CustomerRequestIncentiveEventRow {
  id: string;
  request_id: string;
  event_key: 'request_registered' | 'request_achieved';
  staff_id: string;
  tier_key: string;
  points: number;
  policy_version: string;
  event_at: string;
  employee_transaction_id: string | null;
}

export async function getCustomerRequestIncentiveEvents(requestId: string) {
  const { data, error } = await supabase.rpc('get_customer_request_incentive_events', {
    p_request_id: requestId,
  });
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : []).map((row) => ({
    ...row,
    points: Number((row as { points?: unknown }).points || 0),
  })) as CustomerRequestIncentiveEventRow[];
}
