import type { CustomerRequest } from '@/lib/api/customerRequests';
import { supabase } from '@/lib/supabase';

export async function moveCustomerRequestToShortageSecure(
  request: CustomerRequest
): Promise<CustomerRequest> {
  const { error } = await supabase.rpc('move_customer_request_to_shortage_v1', {
    p_request_id: request.id,
  });
  if (error) throw new Error(error.message || 'تعذر ربط طلب العميل بالنواقص');

  const { data, error: reloadError } = await supabase
    .from('customer_requests')
    .select('*')
    .eq('id', request.id)
    .single();

  if (reloadError || !data) {
    throw new Error(reloadError?.message || 'تم تنفيذ الربط لكن تعذر إعادة تحميل الطلب');
  }

  return data as CustomerRequest;
}
