import { supabase } from '@/lib/supabase';

export type PayrollTransparencyDay = {
  id: string;
  date: string;
  branch: string | null;
  status: string | null;
  resolution_status: string | null;
  resolution_version: number | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  first_in: string | null;
  last_out: string | null;
  candidate_hours: number;
  payroll_eligible_hours: number | null;
  late_minutes: number;
  early_leave_minutes: number;
  missing_punch: boolean;
  time_off_request_id: string | null;
  approved_at: string | null;
  approved_by_name: string | null;
  approval_note: string | null;
};

export type PayrollTransparencyTimeOff = {
  id: string;
  kind: string;
  label: string | null;
  status: string;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number | null;
  reason: string | null;
  decided_at: string | null;
  decided_by_name: string | null;
  decision_note: string | null;
  source: string | null;
};

export type PayrollTransparencyMissingPunch = {
  id: string;
  date: string;
  missing_type: string;
  occurrence_no: number;
  allowance_limit: number;
  penalty_eligible: boolean;
  penalty_amount: number;
  deduction_applied: boolean;
  deduction_transaction_id: string | null;
  manual_punch_id: string | null;
  reason: string | null;
  actor_name: string | null;
};

export type PayrollTransparencyOvertime = {
  id: string;
  date: string;
  branch: string | null;
  status: string;
  overtime_hours: number;
  hourly_rate: number | null;
  overtime_amount: number | null;
  decided_at: string | null;
  decided_by_name: string | null;
  decision_note: string | null;
  evidence_version: string | null;
  source_resolution_id: string | null;
};

export type PayrollTransparencyTransaction = {
  id: string;
  date: string | null;
  type: string | null;
  status: string | null;
  source: string | null;
  source_id: string | null;
  title: string | null;
  reason: string | null;
  amount: number;
  points: number;
  category: string | null;
  employee_visible: boolean;
  approved_at: string | null;
  approved_by_name: string | null;
  metadata: Record<string, unknown>;
};

export type EmployeePayrollTransparencyV1 = {
  schema: 'employee_payroll_transparency_v1';
  staff: {
    id: string;
    username: string;
    name: string;
    branch: string | null;
  };
  cycle: {
    month_cycle: string;
    start: string;
    end: string;
  };
  finalization: {
    ready: boolean;
    blockers: Array<Record<string, unknown>>;
    warnings: Array<Record<string, unknown>>;
  };
  payroll_engine: Record<string, unknown>;
  payroll_components: Record<string, unknown>;
  attendance: {
    summary: Record<string, number>;
    days: PayrollTransparencyDay[];
  };
  time_off: {
    rollup: Array<Record<string, unknown>>;
    requests: PayrollTransparencyTimeOff[];
  };
  missing_punch: {
    summary: Record<string, number>;
    incidents: PayrollTransparencyMissingPunch[];
  };
  overtime: {
    summary: Record<string, number>;
    cases: PayrollTransparencyOvertime[];
  };
  transactions: {
    summary: Record<string, number>;
    rollup: Array<Record<string, unknown>>;
    items: PayrollTransparencyTransaction[];
  };
  incentives: Record<string, unknown>;
  generated_at: string;
};

export async function getEmployeePayrollTransparencyV1(
  staffId: string,
  monthCycle: string
): Promise<EmployeePayrollTransparencyV1> {
  const { data, error } = await supabase.rpc('employee_payroll_transparency_v1', {
    p_staff_id: staffId,
    p_month_cycle: monthCycle,
  });

  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('payroll_transparency_unavailable');
  }

  return data as EmployeePayrollTransparencyV1;
}
