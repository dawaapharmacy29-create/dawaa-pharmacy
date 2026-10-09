import { supabase } from '@/lib/supabase';
import { getStaffSessionToken } from '@/lib/auth/staffSession';

export const OPERATION_ATTRIBUTION_COMMAND = 'dawaa_correct_whatsapp_operation_attribution_session_v1';
export const OPERATION_ATTRIBUTION_COLUMNS = 'customer_id,customer_code,customer_name,customer_phone';
type Row = Record<string, any>;

/** Persistence only: identity/owner selection stays in whatsappFollowupIdentity and its writers. */
export function operationAttribution(row: Row) {
  return {
    customer_id: row.customer_id || null,
    customer_code: row.customer_id ? row.customer_code || null : null,
    customer_name: row.customer_name || null,
    customer_phone: row.customer_phone || null,
  };
}

/** Correct one confirmed owner's mutable attribution; never inserts, rekeys or resets a task. */
export async function correctOperationAttribution(
  kind: 'action' | 'signal',
  owner: Row,
  candidate: Row,
  sourceId: string | null = null
): Promise<boolean> {
  const previous = operationAttribution(owner);
  const next = operationAttribution(candidate);
  const statusChanged = kind === 'signal' && owner.customer_identity_status !== candidate.customer_identity_status;
  if (!statusChanged && Object.keys(next).every((key) => next[key as keyof typeof next] === previous[key as keyof typeof previous])) return false;
  const token = getStaffSessionToken();
  if (!token) throw new Error('operation_attribution_staff_session_required');
  const { data, error } = await supabase.rpc(OPERATION_ATTRIBUTION_COMMAND, {
    p_session_token: token,
    p_kind: kind,
    p_row_id: owner.id,
    p_expected_identity: owner.followup_identity || null,
    p_expected_customer_id: owner.customer_id || null,
    p_attribution: { ...next, ...(kind === 'signal' ? { customer_identity_status: candidate.customer_identity_status } : {}) },
    p_source_id: sourceId,
  });
  if (error) throw error;
  if (!data || data.id !== owner.id || data.followup_identity !== owner.followup_identity)
    throw new Error('operation_attribution_owner_not_updated');
  Object.assign(owner, next, kind === 'signal' ? { customer_identity_status: candidate.customer_identity_status } : {});
  return true;
}
