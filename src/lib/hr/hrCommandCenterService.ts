import { supabase } from '@/lib/supabase';

export type HRWorkforceCycleReadinessV2 = {
  month_cycle: string;
  cycle_start: string;
  cycle_end: string;
  effective_end: string;
  branch: string | null;
  cycle_closed: boolean;
  actions: {
    structural_hr_issues: number;
    attendance_pending: number;
    corrections_pending: number;
    timeoff_pending: number;
    overtime_pending: number;
    overtime_stale_approved: number;
    payroll_blocked_staff: number;
    lifecycle_pending: number;
    archived_login_enabled: number;
  };
  gates: {
    hr_truth_ready: boolean;
    attendance_truth_ready: boolean;
    overtime_truth_ready: boolean;
    payroll_ready: boolean | null;
  };
  hr_truth: Record<string, unknown>;
  attendance_truth: Record<string, unknown>;
  overtime_truth: Record<string, unknown>;
  payroll_readiness: Record<string, unknown>;
  generated_at: string;
};

export async function getHRWorkforceCycleReadinessV2(args: {
  monthCycle?: string | null;
  branch?: string | null;
} = {}): Promise<HRWorkforceCycleReadinessV2> {
  const { data, error } = await supabase.rpc('hr_workforce_cycle_readiness_v2', {
    p_month_cycle: args.monthCycle || null,
    p_branch: args.branch || null,
  });
  if (error) throw new Error(error.message);
  return data as HRWorkforceCycleReadinessV2;
}
