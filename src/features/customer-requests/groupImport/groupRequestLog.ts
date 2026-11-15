import { supabase } from '@/lib/supabase';
import type { RequestCandidate } from './groupChatCustomerRequests';

/** The candidates that go to the evaluation's group log: requests (not confirmations) with a customer code or phone. */
export const loggableCandidates = (candidates: readonly RequestCandidate[]) =>
  candidates.filter((c) => c.kind === 'request' && (c.customerCode || c.customerPhone));

/**
 * Saves a group export's requests in one go (owner decision 2026-11-15): each is logged once by its
 * fingerprint and credited to the chosen doctor; the evaluation counts it with the app's requests.
 */
export async function saveGroupRequests(
  fileName: string,
  branch: string,
  candidates: readonly RequestCandidate[],
  doctorFor: Record<string, string>
) {
  const rows = loggableCandidates(candidates).map((c) => ({
    fingerprint: c.fingerprint,
    sent_at_local: c.sentAtLocal,
    sender: c.sender,
    customer_code: c.customerCode,
    customer_phone: c.customerPhone,
    body: c.body,
    staff_id: doctorFor[c.fingerprint] || null,
    attribution:
      doctorFor[c.fingerprint] && doctorFor[c.fingerprint] !== c.doctorId
        ? 'manual'
        : c.doctorReason,
  }));
  const { data, error } = await supabase.rpc('import_customer_request_group_v1', {
    p_file_name: fileName,
    p_branch: branch,
    p_rows: rows,
  });
  if (error) throw error;
  const result = data as { total: number; saved: number; credited: number };
  return {
    sent: rows.length,
    saved: result.saved,
    credited: result.credited,
    withoutDoctor: rows.filter((r) => !r.staff_id).length,
  };
}
