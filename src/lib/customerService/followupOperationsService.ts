import { supabase } from '@/lib/supabase';

export type FollowupPerformanceRow = {
  responsible_name: string;
  branch: string;
  total_count: number;
  completed_count: number;
  open_count: number;
  no_answer_count: number;
  postponed_count: number;
  manager_count: number;
  invalid_phone_count: number;
  avg_close_hours: number | null;
};

export type FollowupDuplicateGroup = {
  identity_key: string;
  branch: string;
  request_type: string;
  open_count: number;
  canonical_id: string;
  duplicate_ids: string[] | null;
  customer_name: string;
  customer_code: string;
  customer_phone: string;
  newest_at: string;
};

export type FollowupAuditRow = {
  id: number;
  followup_id: string;
  customer_id: string | null;
  action: string;
  actor_name: string | null;
  branch: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

export async function loadFollowupOperationsSnapshot(params: { branch: string | null; day: string }) {
  const [performanceResult, duplicateResult, auditResult] = await Promise.all([
    supabase.rpc('customer_followup_daily_performance_v1', {
      p_branch: params.branch,
      p_day: params.day,
    }),
    supabase.rpc('list_open_followup_duplicate_groups_v1', { p_branch: params.branch }),
    supabase
      .from('customer_followup_audit_log')
      .select('id,followup_id,customer_id,action,actor_name,branch,created_at,metadata')
      .order('created_at', { ascending: false })
      .limit(100),
  ]);

  if (performanceResult.error) throw new Error(performanceResult.error.message);
  if (duplicateResult.error) throw new Error(duplicateResult.error.message);
  if (auditResult.error) throw new Error(auditResult.error.message);

  return {
    performance: (performanceResult.data || []) as FollowupPerformanceRow[],
    duplicates: (duplicateResult.data || []) as FollowupDuplicateGroup[],
    auditRows: (auditResult.data || []) as FollowupAuditRow[],
  };
}

export async function mergeOpenFollowupDuplicates(params: {
  canonicalId: string;
  duplicateIds: string[];
  actorStaffId: string;
  actorName: string;
  reason?: string;
}) {
  const { data, error } = await supabase.rpc('merge_open_followup_duplicates_v1', {
    p_canonical_id: params.canonicalId,
    p_duplicate_ids: params.duplicateIds,
    p_actor_staff_id: params.actorStaffId,
    p_actor_name: params.actorName,
    p_reason: params.reason || 'دمج يدوي من لوحة إدارة متابعات العملاء',
  });
  if (error) throw new Error(error.message);
  return Number((data as { merged_count?: number } | null)?.merged_count || 0);
}

export async function correctCustomerFollowupData(params: {
  followupId: string;
  customerName?: string | null;
  customerCode?: string | null;
  customerPhone?: string | null;
  branch?: string | null;
  actorStaffId: string;
  actorName: string;
  note?: string | null;
}) {
  const { data, error } = await supabase.rpc('correct_customer_followup_data_v1', {
    p_followup_id: params.followupId,
    p_customer_name: params.customerName || null,
    p_customer_code: params.customerCode || null,
    p_customer_phone: params.customerPhone || null,
    p_branch: params.branch || null,
    p_actor_staff_id: params.actorStaffId,
    p_actor_name: params.actorName,
    p_note: params.note || 'تصحيح من لوحة خدمة العملاء',
  });
  if (error) throw new Error(error.message);
  const result = data as { followups_updated?: number; customers_updated?: number } | null;
  return {
    followupsUpdated: Number(result?.followups_updated || 0),
    customersUpdated: Number(result?.customers_updated || 0),
  };
}
