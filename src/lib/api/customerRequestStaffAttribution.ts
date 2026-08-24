import { supabase } from '@/lib/supabase';

export type CustomerRequestStaffAttributionMatchState =
  | 'unique_exact_normalized'
  | 'ambiguous'
  | 'unmatched';

export type CustomerRequestStaffAttributionRow = {
  source_label: string;
  branch: string | null;
  requests_count: number;
  suggested_staff_id: string | null;
  suggested_staff_name: string | null;
  suggested_staff_role: string | null;
  match_state: CustomerRequestStaffAttributionMatchState;
};

export type CustomerRequestStaffAttributionPreview = {
  approved: boolean;
  requests_to_attribute: number;
  currently_points_identity_ready: number;
  points_are_still_subject_to_tier_policy_and_effective_date: boolean;
};

export async function getCustomerRequestStaffAttributionReview(
  branch: string,
  limit = 100
): Promise<CustomerRequestStaffAttributionRow[]> {
  const { data, error } = await supabase.rpc('get_customer_request_staff_attribution_review_v1', {
    p_branch: !branch || branch === 'all' ? null : branch,
    p_limit: Math.min(500, Math.max(1, limit)),
  });
  if (error) throw new Error(error.message);
  return ((data || []) as Array<Record<string, unknown>>).map((row) => ({
    source_label: String(row.source_label || ''),
    branch: row.branch ? String(row.branch) : null,
    requests_count: Number(row.requests_count || 0),
    suggested_staff_id: row.suggested_staff_id ? String(row.suggested_staff_id) : null,
    suggested_staff_name: row.suggested_staff_name ? String(row.suggested_staff_name) : null,
    suggested_staff_role: row.suggested_staff_role ? String(row.suggested_staff_role) : null,
    match_state: String(row.match_state || 'unmatched') as CustomerRequestStaffAttributionMatchState,
  }));
}

export async function reviewCustomerRequestStaffAttribution(input: {
  sourceLabel: string;
  branch: string | null;
  staffId: string;
  decision: 'approved' | 'rejected';
  reason: string;
}) {
  const { data, error } = await supabase.rpc('review_customer_request_staff_attribution_v1', {
    p_source_label: input.sourceLabel,
    p_branch: input.branch,
    p_staff_id: input.staffId,
    p_decision: input.decision,
    p_reason: input.reason,
  });
  if (error) throw new Error(error.message);
  return String(data || '');
}

export async function previewCustomerRequestStaffAttributionApply(input: {
  sourceLabel: string;
  branch: string | null;
  staffId: string;
}): Promise<CustomerRequestStaffAttributionPreview> {
  const { data, error } = await supabase.rpc('get_customer_request_staff_attribution_apply_preview_v1', {
    p_source_label: input.sourceLabel,
    p_branch: input.branch,
    p_staff_id: input.staffId,
  });
  if (error) throw new Error(error.message);
  const row = (data || {}) as Record<string, unknown>;
  return {
    approved: Boolean(row.approved),
    requests_to_attribute: Number(row.requests_to_attribute || 0),
    currently_points_identity_ready: Number(row.currently_points_identity_ready || 0),
    points_are_still_subject_to_tier_policy_and_effective_date: Boolean(row.points_are_still_subject_to_tier_policy_and_effective_date),
  };
}

export async function applyCustomerRequestStaffAttribution(input: {
  sourceLabel: string;
  branch: string | null;
  staffId: string;
}) {
  const { data, error } = await supabase.rpc('apply_customer_request_staff_attribution_v1', {
    p_source_label: input.sourceLabel,
    p_branch: input.branch,
    p_staff_id: input.staffId,
    p_confirm: 'APPLY_CONFIRMED_MAPPING',
  });
  if (error) throw new Error(error.message);
  return Number(data || 0);
}
