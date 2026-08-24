import type { CustomerRequest } from '@/lib/api/customerRequests';
import { supabase } from '@/lib/supabase';

export async function moveCustomerRequestToShortageSecure(
  request: CustomerRequest
): Promise<CustomerRequest> {
  const { data, error } = await supabase.rpc('move_customer_request_to_shortage_v1', {
    p_request_id: request.id,
  });
  if (error) throw new Error(error.message || 'تعذر ربط طلب العميل بالنواقص');

  const payload = (data || {}) as Record<string, unknown>;
  const updated = payload.request as CustomerRequest | undefined;
  if (!updated?.id) {
    throw new Error('تم تنفيذ الربط لكن لم يرجع الطلب المحدث من العملية الذرية');
  }
  return updated;
}
