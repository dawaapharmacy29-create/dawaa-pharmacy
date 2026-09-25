import { supabase } from '@/lib/supabase';

export type FinalizedPayrollSnapshotHistoryRow = {
  id: string;
  snapshot_id: string;
  staff_id: string;
  staff_username: string;
  staff_name: string | null;
  branch: string | null;
  month_cycle: string;
  cycle_start: string;
  cycle_end: string;
  snapshot_fingerprint: string;
  finalized_at: string;
  finalized_by_name: string | null;
};

export async function listFinalizedPayrollSnapshots(
  staffId: string,
  limit = 24
): Promise<FinalizedPayrollSnapshotHistoryRow[]> {
  const { data, error } = await supabase.rpc('list_payroll_finalized_snapshots_v2', {
    p_staff_id: staffId,
    p_month_cycle: null,
    p_limit: Math.max(1, Math.min(limit, 60)),
  });
  if (error) throw new Error(error.message);
  return (data || []) as FinalizedPayrollSnapshotHistoryRow[];
}
