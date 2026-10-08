import { supabase } from '@/lib/supabase';
import type {
  PayrollFinalizationGate,
  PayrollFinalSnapshotPreview,
  PayrollSnapshotAuditRow,
  PayrollSnapshotReviewRow,
  PayrollStagedSnapshot,
} from '@/lib/hr/workforceServiceLegacy';

export type {
  PayrollFinalizationGate,
  PayrollFinalSnapshotPreview,
  PayrollSnapshotAuditRow,
  PayrollSnapshotReviewRow,
  PayrollStagedSnapshot,
} from '@/lib/hr/workforceServiceLegacy';

export async function getPayrollFinalizationGate(
  staffId: string,
  monthCycle: string
): Promise<PayrollFinalizationGate> {
  const { data, error } = await supabase.rpc('payroll_finalization_gate_current_v1', {
    p_staff_id: staffId,
    p_month_cycle: monthCycle,
  });
  if (error) throw new Error(error.message);
  return data as PayrollFinalizationGate;
}

export async function getPayrollFinalSnapshotPreview(
  staffId: string,
  monthCycle: string
): Promise<PayrollFinalSnapshotPreview> {
  const { data, error } = await supabase.rpc('payroll_final_snapshot_preview_v2', {
    p_staff_id: staffId,
    p_month_cycle: monthCycle,
  });
  if (error) throw new Error(error.message);
  return data as PayrollFinalSnapshotPreview;
}

export async function stagePayrollFinalSnapshot(args: {
  staffId: string;
  monthCycle: string;
  note?: string | null;
}): Promise<{ success: boolean; existing: boolean; snapshot: PayrollStagedSnapshot }> {
  const { data, error } = await supabase.rpc('stage_payroll_final_snapshot_v2', {
    p_staff_id: args.staffId,
    p_month_cycle: args.monthCycle,
    p_note: args.note || null,
  });
  if (error) throw new Error(error.message);
  return data as { success: boolean; existing: boolean; snapshot: PayrollStagedSnapshot };
}

export async function listPayrollStagedSnapshots(
  staffId: string,
  monthCycle: string,
  limit = 20
): Promise<PayrollStagedSnapshot[]> {
  const { data, error } = await supabase.rpc('list_payroll_final_snapshot_staging_v1', {
    p_staff_id: staffId,
    p_month_cycle: monthCycle,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data as PayrollStagedSnapshot[] : [];
}

export async function comparePayrollStagedSnapshot(snapshotId: string): Promise<{
  snapshot_id: string;
  stored_fingerprint: string;
  current_fingerprint: string;
  unchanged: boolean;
  stored_ready: boolean;
  current_ready: boolean;
  stored_created_at: string;
  current_generated_at: string;
}> {
  const { data, error } = await supabase.rpc('compare_payroll_final_snapshot_v2', {
    p_snapshot_id: snapshotId,
  });
  if (error) throw new Error(error.message);
  return data as {
    snapshot_id: string;
    stored_fingerprint: string;
    current_fingerprint: string;
    unchanged: boolean;
    stored_ready: boolean;
    current_ready: boolean;
    stored_created_at: string;
    current_generated_at: string;
  };
}

export async function listPayrollSnapshotAudit(
  staffId: string,
  monthCycle: string,
  limit = 50
): Promise<PayrollSnapshotAuditRow[]> {
  const { data, error } = await supabase.rpc('list_payroll_snapshot_audit_v1', {
    p_staff_id: staffId,
    p_month_cycle: monthCycle,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data as PayrollSnapshotAuditRow[] : [];
}

export async function reviewPayrollStagedSnapshot(args: {
  snapshotId: string;
  decision: 'approved' | 'rejected';
  note?: string | null;
}): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc('review_payroll_staged_snapshot_v2', {
    p_snapshot_id: args.snapshotId,
    p_decision: args.decision,
    p_note: args.note || null,
  });
  if (error) throw new Error(error.message);
  return (data || {}) as Record<string, unknown>;
}

export async function listPayrollSnapshotReviews(
  snapshotId: string,
  limit = 50
): Promise<PayrollSnapshotReviewRow[]> {
  const { data, error } = await supabase.rpc('list_payroll_snapshot_reviews_v2', {
    p_snapshot_id: snapshotId,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data as PayrollSnapshotReviewRow[] : [];
}
