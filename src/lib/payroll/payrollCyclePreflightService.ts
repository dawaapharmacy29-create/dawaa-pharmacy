import { supabase } from '@/lib/supabase';

export type PayrollCyclePreflightIssue = {
  code: string;
  label: string;
  affectedStaff: number;
};

export type PayrollCyclePreflightRow = {
  staffId: string;
  staffName: string;
  role: string;
  branch: string;
  route: 'standard' | 'delivery';
  preflightClear: boolean;
  pendingAttendanceDays: number;
  v3PendingDays: number;
  pendingOtCases: number;
  hasActiveLogin: boolean;
  hasProfile: boolean;
  deliveryMapped: boolean;
  deliverySnapshotAt: string | null;
  ordersPending: number;
  tripsPending: number;
  mappingWarning: string | null;
  issueCodes: string[];
};

export type PayrollCyclePreflight = {
  monthCycle: string;
  cycleStart: string;
  cycleEnd: string;
  branch: string | null;
  scopeStaffCount: number;
  standardStaffCount: number;
  deliveryStaffCount: number;
  deliveryCandidateWithoutPolicyCount: number;
  preflightClearCount: number;
  preflightAttentionCount: number;
  standardPreflightClearCount: number;
  deliveryPreflightClearCount: number;
  deliveryMappedCount: number;
  deliverySnapshotCoveredCount: number;
  deliveryStaleSnapshotCount: number;
  topIssues: PayrollCyclePreflightIssue[];
  rows: PayrollCyclePreflightRow[];
  finalizationRule: string;
};

const n = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const s = (value: unknown) => String(value ?? '');
const b = (value: unknown) => value === true;

export async function fetchPayrollCyclePreflight(args: {
  monthCycle: string;
  branch?: string | null;
}): Promise<PayrollCyclePreflight> {
  const { data, error } = await supabase.rpc('payroll_cycle_preflight_v3', {
    p_month_cycle: args.monthCycle,
    p_branch: args.branch || null,
  });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('payroll_cycle_preflight_unavailable');
  const raw = data as Record<string, unknown>;
  const issues = Array.isArray(raw.top_issues) ? raw.top_issues : [];
  const rows = Array.isArray(raw.rows) ? raw.rows : [];
  return {
    monthCycle: s(raw.month_cycle),
    cycleStart: s(raw.cycle_start),
    cycleEnd: s(raw.cycle_end),
    branch: raw.branch == null ? null : s(raw.branch),
    scopeStaffCount: n(raw.scope_staff_count),
    standardStaffCount: n(raw.standard_staff_count),
    deliveryStaffCount: n(raw.delivery_staff_count),
    deliveryCandidateWithoutPolicyCount: n(raw.delivery_candidate_without_policy_count),
    preflightClearCount: n(raw.preflight_clear_count),
    preflightAttentionCount: n(raw.preflight_attention_count),
    standardPreflightClearCount: n(raw.standard_preflight_clear_count),
    deliveryPreflightClearCount: n(raw.delivery_preflight_clear_count),
    deliveryMappedCount: n(raw.delivery_mapped_count),
    deliverySnapshotCoveredCount: n(raw.delivery_snapshot_covered_count),
    deliveryStaleSnapshotCount: n(raw.delivery_stale_snapshot_count),
    topIssues: issues.map((item) => {
      const row = item as Record<string, unknown>;
      return { code: s(row.code), label: s(row.label), affectedStaff: n(row.affected_staff) };
    }),
    rows: rows.map((item) => {
      const row = item as Record<string, unknown>;
      return {
        staffId: s(row.staff_id),
        staffName: s(row.staff_name),
        role: s(row.role),
        branch: s(row.branch),
        route: row.route === 'delivery' ? 'delivery' : 'standard',
        preflightClear: b(row.preflight_clear),
        pendingAttendanceDays: n(row.pending_attendance_days),
        v3PendingDays: n(row.v3_pending_days),
        pendingOtCases: n(row.pending_ot_cases),
        hasActiveLogin: b(row.has_active_login),
        hasProfile: b(row.has_profile),
        deliveryMapped: b(row.delivery_mapped),
        deliverySnapshotAt: row.delivery_snapshot_at == null ? null : s(row.delivery_snapshot_at),
        ordersPending: n(row.orders_pending),
        tripsPending: n(row.trips_pending),
        mappingWarning: row.mapping_warning == null ? null : s(row.mapping_warning),
        issueCodes: Array.isArray(row.issue_codes) ? row.issue_codes.map(s) : [],
      };
    }),
    finalizationRule: s(raw.finalization_rule),
  };
}
