import { supabase } from '@/lib/supabase';
import type { FollowupRow } from '@/lib/api/customerServiceCommandCenter';

export type FollowupEventRow = {
  id: string;
  followup_id: string;
  event_type: string;
  old_status: string | null;
  new_status: string | null;
  event_note: string | null;
  event_payload: Record<string, unknown> | null;
  actor_id: string | null;
  actor_name: string | null;
  created_at: string;
};

function rpcError(error: { message?: string } | null, fallback: string): never {
  throw new Error(error?.message?.trim() || fallback);
}

export async function archiveCustomerFollowup(followupId: string, reason: string) {
  if (!followupId.trim()) throw new Error('رقم المتابعة غير موجود');
  if (!reason.trim()) throw new Error('سبب الأرشفة مطلوب');
  const { data, error } = await supabase.rpc('dawaa_archive_customer_followup_v1', {
    p_followup_id: followupId,
    p_reason: reason.trim(),
    p_actor: null,
  });
  if (error) rpcError(error, 'تعذر أرشفة المتابعة');
  return data as FollowupRow;
}

export async function restoreCustomerFollowup(followupId: string) {
  if (!followupId.trim()) throw new Error('رقم المتابعة غير موجود');
  const { data, error } = await supabase.rpc('dawaa_restore_customer_followup_v1', {
    p_followup_id: followupId,
    p_actor: null,
  });
  if (error) rpcError(error, 'تعذر استعادة المتابعة');
  return data as FollowupRow;
}

export async function postponeCustomerFollowup(followupId: string, postponedUntil: string) {
  if (!followupId.trim()) throw new Error('رقم المتابعة غير موجود');
  if (!postponedUntil.trim()) throw new Error('اختر موعد التأجيل');
  const selected = new Date(postponedUntil);
  if (Number.isNaN(selected.getTime())) throw new Error('موعد التأجيل غير صحيح');
  if (selected.getTime() <= Date.now()) throw new Error('موعد التأجيل يجب أن يكون في المستقبل');
  const { data, error } = await supabase.rpc('dawaa_postpone_customer_followup_v1', {
    p_followup_id: followupId,
    p_postponed_until: postponedUntil,
    p_actor: null,
  });
  if (error) rpcError(error, 'تعذر تأجيل المتابعة');
  return data as FollowupRow;
}

export async function createExceptionalCustomerFollowup(input: {
  customerId?: string | null;
  customerCode?: string | null;
  customerName: string;
  customerPhone?: string | null;
  branch: string;
  priority?: string | null;
  reason: string;
  followupDatetime?: string | null;
  assignedDoctor?: string | null;
  requestDetails?: string | null;
  notes?: string | null;
}) {
  if (!input.customerName.trim()) throw new Error('اسم العميل مطلوب');
  if (!input.branch.trim()) throw new Error('الفرع مطلوب');
  if (!input.reason.trim()) throw new Error('سبب المتابعة مطلوب');
  const { data, error } = await supabase.rpc('dawaa_create_exceptional_followup_v2', {
    p_customer_id: input.customerId || null,
    p_customer_code: input.customerCode || null,
    p_customer_name: input.customerName.trim(),
    p_customer_phone: input.customerPhone || null,
    p_branch: input.branch.trim(),
    p_priority: input.priority || 'مهم',
    p_reason: input.reason.trim(),
    p_followup_datetime: input.followupDatetime || null,
    p_assigned_doctor: input.assignedDoctor || null,
    p_request_details: input.requestDetails || null,
    p_notes: input.notes || null,
    p_created_by: null,
    p_created_by_name: null,
  });
  if (error) rpcError(error, 'تعذر إنشاء المتابعة الاستثنائية');
  return data as FollowupRow;
}

export async function completeCustomerFollowup(input: {
  followupId: string;
  result: string;
  summary: string;
  score?: number | null;
  notes?: string | null;
}) {
  if (!input.result.trim()) throw new Error('نتيجة المتابعة مطلوبة');
  if (input.summary.trim().length < 10) throw new Error('اكتب ملخصًا واضحًا لا يقل عن 10 أحرف');
  const score = input.score ?? null;
  if (score != null && (score < 0 || score > 100)) throw new Error('درجة التقييم يجب أن تكون من 0 إلى 100');
  const { data, error } = await supabase.rpc('dawaa_complete_customer_followup_v1', {
    p_followup_id: input.followupId,
    p_result: input.result.trim(),
    p_summary: input.summary.trim(),
    p_score: score,
    p_notes: input.notes || null,
    p_actor_id: null,
    p_actor_name: null,
  });
  if (error) rpcError(error, 'تعذر إكمال المتابعة');
  return data as FollowupRow;
}

export async function cancelCustomerFollowup(followupId: string, reason: string) {
  if (!reason.trim()) throw new Error('سبب الإلغاء مطلوب');
  const { data, error } = await supabase.rpc('dawaa_cancel_customer_followup_v1', {
    p_followup_id: followupId,
    p_reason: reason.trim(),
    p_actor_id: null,
    p_actor_name: null,
  });
  if (error) rpcError(error, 'تعذر إلغاء المتابعة');
  return data as FollowupRow;
}

export async function fetchCustomerFollowupEvents(followupId: string) {
  const { data, error } = await supabase
    .from('customer_followup_events')
    .select('id,followup_id,event_type,old_status,new_status,event_note,event_payload,actor_id,actor_name,created_at')
    .eq('followup_id', followupId)
    .order('created_at', { ascending: false });
  if (error) rpcError(error, 'تعذر تحميل سجل المتابعة');
  return (data || []) as FollowupEventRow[];
}
