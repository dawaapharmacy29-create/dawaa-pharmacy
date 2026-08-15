import { supabase } from '@/lib/supabase';

export type CustomerRequestSourceAuditSummary = {
  total: number;
  no_branch: number;
  unlinked_customer: number;
  missing_channel: number;
  missing_phone: number;
  missing_customer_code: number;
  sync_conflicts: number;
  branch_mismatch: number;
  request_time_mismatch: number;
  quantity_mismatch: number;
  channel_mismatch: number;
  assignee_mismatch: number;
  recorded_by_mismatch: number;
  request_type_mismatch: number;
  priority_mismatch: number;
  source_status_ahead: number;
  local_workflow_ahead: number;
  latest_source_update: string | null;
  last_seen: string | null;
};

export type CustomerRequestSourceAuditRow = {
  id: string;
  order_number: string | null;
  customer_name: string | null;
  customer_code: string | null;
  phone: string | null;
  branch: string | null;
  medicine_name: string | null;
  source_status: string | null;
  status: string | null;
  requested_at: string | null;
  source_updated_at: string | null;
  issues: string[];
};

export type CustomerRequestSourceAudit = {
  generated_at: string;
  source_system: string;
  source_entity: string;
  summary: CustomerRequestSourceAuditSummary;
  unresolved: CustomerRequestSourceAuditRow[];
};

export async function getCustomerRequestSourceAudit(branch = 'all') {
  const { data, error } = await supabase.rpc('get_customer_request_source_audit_v4', {
    p_branch: branch === 'all' ? null : branch,
  });
  if (error) throw new Error(error.message);
  return data as CustomerRequestSourceAudit;
}
