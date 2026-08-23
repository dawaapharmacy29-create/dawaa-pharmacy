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
  const { data, error } = await supabase
    .from('customer_request_incentive_events')
    .select('id,request_id,event_key,staff_id,tier_key,points,policy_version,event_at,employee_transaction_id')
    .eq('request_id', requestId)
    .order('event_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map((row) => ({
    ...row,
    points: Number(row.points || 0),
  })) as CustomerRequestIncentiveEventRow[];
}
