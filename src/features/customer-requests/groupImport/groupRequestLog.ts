import { supabase } from '@/lib/supabase';
import type { RequestCandidate } from './groupChatCustomerRequests';

/** The candidates that go to the evaluation's group log: requests (not confirmations) with a customer code or phone. */
export const loggableCandidates = (candidates: readonly RequestCandidate[]) =>
  candidates.filter((c) => c.kind === 'request' && (c.customerCode || c.customerPhone));

export interface GroupImportResult {
  sent: number;
  /** Saved for the first time by this upload. */
  added: number;
  /** Already in the log from an earlier upload (left as they were, gaps filled). */
  already: number;
  /** New requests credited to a doctor. */
  credited: number;
  /** New requests matched to a customer card. */
  customers: number;
}

/**
 * Saves a group export's requests in one go (owner decisions 2026-11-15 and 2026-11-18): each is
 * logged once by its fingerprint with its customer, name and items, and credited to the chosen
 * doctor; a request with no doctor is kept for the branch only.
 */
export async function saveGroupRequests(
  fileName: string,
  branch: string,
  candidates: readonly RequestCandidate[],
  doctorFor: Record<string, string>
): Promise<GroupImportResult> {
  const rows = loggableCandidates(candidates).map((c) => ({
    fingerprint: c.fingerprint,
    sent_at_local: c.sentAtLocal,
    sender: c.sender,
    customer_code: c.customerCode,
    customer_phone: c.customerPhone,
    customer_name: c.customerName,
    details: c.details,
    body: c.body,
    staff_id: doctorFor[c.fingerprint] || null,
    attribution:
      doctorFor[c.fingerprint] && doctorFor[c.fingerprint] !== c.doctorId
        ? 'manual'
        : c.doctorReason,
  }));
  const { data, error } = await supabase.rpc('import_customer_request_group_v2', {
    p_file_name: fileName,
    p_branch: branch,
    p_rows: rows,
  });
  if (error) throw error;
  const result = data as { new: number; already: number; credited: number; customers: number };
  return {
    sent: rows.length,
    added: Number(result.new) || 0,
    already: Number(result.already) || 0,
    credited: Number(result.credited) || 0,
    customers: Number(result.customers) || 0,
  };
}
