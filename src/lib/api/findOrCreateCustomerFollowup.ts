import { supabase } from '@/lib/supabase';
import { normalizeEgyptianPhone } from '@/lib/customerFollowupCore';

export type FindOrCreateCustomerFollowupInput = {
  customerId?: string | null;
  customerCode?: string | null;
  customerName: string;
  customerPhone?: string | null;
  branch: string;
  requestType?: string | null;
  requestDetails?: string | null;
  followupReason?: string | null;
  priority?: string | null;
  nextFollowupDate?: string | null;
  actorStaffId: string;
  actorName: string;
  clientRequestId?: string | null;
  source?: string | null;
};

export type FindOrCreateCustomerFollowupResult = {
  followup_id: string;
  created: boolean;
  linked_to_open_case?: boolean;
  idempotent_replay?: boolean;
  identity_key?: string | null;
};

export function createFollowupClientRequestId(prefix = 'followup') {
  return `${prefix}:${crypto.randomUUID()}`;
}

export async function findOrCreateOpenCustomerFollowup(
  input: FindOrCreateCustomerFollowupInput
): Promise<FindOrCreateCustomerFollowupResult> {
  const actorStaffId = String(input.actorStaffId || '').trim();
  if (!actorStaffId) throw new Error('لا يمكن إنشاء المتابعة بدون حساب موظف صالح');
  if (!String(input.customerName || '').trim()) throw new Error('اسم العميل مطلوب');
  if (!String(input.branch || '').trim()) throw new Error('فرع العميل مطلوب');

  const { data, error } = await supabase.rpc('find_or_create_open_customer_followup', {
    p_customer_id: input.customerId || null,
    p_customer_code: input.customerCode || null,
    p_customer_name: input.customerName.trim(),
    p_customer_phone: normalizeEgyptianPhone(input.customerPhone) || null,
    p_branch: input.branch.trim(),
    p_request_type: input.requestType || 'general',
    p_request_details: input.requestDetails || null,
    p_followup_reason: input.followupReason || null,
    p_priority: input.priority || 'متوسطة',
    p_next_followup_date: input.nextFollowupDate || null,
    p_actor_staff_id: actorStaffId,
    p_actor_name: String(input.actorName || '').trim() || actorStaffId,
    p_client_request_id: input.clientRequestId || createFollowupClientRequestId(),
    p_source: input.source || 'manual',
  });

  if (error) throw new Error(error.message);
  const result = data as FindOrCreateCustomerFollowupResult | null;
  if (!result?.followup_id) throw new Error('لم ترجع قاعدة البيانات رقم المتابعة');
  return result;
}
