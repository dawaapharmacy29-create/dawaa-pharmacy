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
