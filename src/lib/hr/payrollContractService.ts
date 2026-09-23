import { supabase } from '@/lib/supabase';

export type PayrollFinalizedSnapshotV2 = {
  id: string;
  snapshot_id: string;
  staff_id: string;
  staff_username: string;
  staff_name: string;
  branch: string | null;
  month_cycle: string;
  cycle_start: string | null;
  cycle_end: string | null;
  snapshot_fingerprint: string;
  payload: Record<string, unknown>;
  finalized_by: string;
  finalized_by_name: string;
  finalized_at: string;
  state: 'finalized';
};

export async function finalizePayrollSnapshotV2(snapshotId: string): Promise<{
  success: boolean;
  existing: boolean;
  finalized: PayrollFinalizedSnapshotV2;
  paid: boolean;
  financial_effect: 'none';
}> {
  const { data, error } = await supabase.rpc('finalize_payroll_snapshot_v2', {
    p_snapshot_id: snapshotId,
  });
  if (error) throw new Error(error.message);
  return data as {
    success: boolean;
    existing: boolean;
    finalized: PayrollFinalizedSnapshotV2;
    paid: boolean;
    financial_effect: 'none';
  };
}

export async function listPayrollFinalizedSnapshotsV2(args: {
  staffId?: string | null;
  monthCycle?: string | null;
  limit?: number;
} = {}): Promise<PayrollFinalizedSnapshotV2[]> {
  const { data, error } = await supabase.rpc('list_payroll_finalized_snapshots_v2', {
    p_staff_id: args.staffId || null,
    p_month_cycle: args.monthCycle || null,
    p_limit: args.limit ?? 100,
  });
  if (error) throw new Error(error.message);
  return (data || []) as PayrollFinalizedSnapshotV2[];
}
