import { supabase } from '@/lib/supabase';

export interface AttendanceDayRow {
  attendance_date: string;
  day_name: string;
  resolution_status: string;
  is_off_day: boolean | null;
  first_in: string | null;
  last_out: string | null;
  candidate_hours: string | number | null;
  scheduled_hours: number | null;
  overtime_hours: number;
  late_minutes: string | number | null;
  early_leave_minutes: string | number | null;
  time_off_kind: string | null;
  permission_attached: boolean | null;
  reason: string | null;
}

export interface AttendanceDetailSummary {
  period_days: number;
  off_days: number;
  approved_leave_days: number;
  late_days: number;
  absence_review_days: number;
  needs_review_days: number;
  total_late_minutes: number;
  total_early_leave_minutes: number;
  total_worked_hours: number;
  total_overtime_hours: number;
  hourly_rate: number | null;
  overtime_hour_rate: number | null;
  monthly_base_salary: number | null;
  late_deduction_amount: number | null;
  early_leave_deduction_amount: number | null;
  absence_deduction_amount: number | null;
  overtime_amount: number | null;
  compensation_profile_complete: boolean;
}

export interface StaffAttendanceDetail {
  staff: { id: string; name: string; role: string | null; branch: string | null };
  days: AttendanceDayRow[];
  summary: AttendanceDetailSummary;
}

export interface BranchRosterRow {
  staff_id: string;
  staff_name: string;
  role: string | null;
  total_late_minutes: number;
  late_days: number;
  absence_review_days: number;
  needs_review_days: number;
  total_worked_hours: number;
  total_overtime_hours: number;
}

export async function getStaffAttendanceDetail(staffId: string, start: string, end: string): Promise<StaffAttendanceDetail> {
  const { data, error } = await supabase.rpc('get_staff_attendance_detail_v1', {
    p_staff_id: staffId,
    p_start: start,
    p_end: end,
  });
  if (error) throw error;
  return data as StaffAttendanceDetail;
}

export async function getBranchAttendanceRoster(branch: string, start: string, end: string): Promise<BranchRosterRow[]> {
  const { data, error } = await supabase.rpc('get_branch_attendance_roster_v1', {
    p_branch: branch,
    p_start: start,
    p_end: end,
  });
  if (error) throw error;
  return (data || []) as BranchRosterRow[];
}

export const RESOLUTION_STATUS_LABELS: Record<string, string> = {
  on_time: 'في الموعد',
  on_time_with_permission: 'في الموعد (بإذن)',
  late: 'متأخر',
  very_late: 'متأخر جدًا',
  off_day: 'إجازة أسبوعية',
  approved_time_off: 'إجازة معتمدة',
  worked_on_off: 'حضور في يوم إجازة',
  absence_review: 'غياب (قيد المراجعة)',
  missing_checkin: 'بصمة دخول ناقصة',
  missing_checkout: 'بصمة خروج ناقصة',
  no_schedule: 'لا يوجد جدول شِفت',
  needs_event_review: 'يحتاج مراجعة',
  schedule_conflict: 'تعارض في الجدول',
  time_off_conflict: 'تعارض في طلبات الإجازة',
  invalid_schedule_time: 'موعد الشِفت غير صالح',
  shift_swap_requires_schedule: 'تبديل شيفت يحتاج تحديث الجدول',
  time_off_with_events: 'بصمة أثناء إجازة معتمدة',
  invalid_duration: 'مدة عمل غير منطقية',
  shift_in_progress: 'الشيفت لسه شغال',
  sync_pending_verification: 'في انتظار تأكيد مزامنة البصمة',
};

export function resolutionStatusTone(status: string): 'success' | 'warning' | 'danger' | 'info' | 'muted' {
  if (['on_time', 'on_time_with_permission', 'approved_time_off', 'off_day'].includes(status)) return 'success';
  if (['late', 'shift_in_progress'].includes(status)) return 'warning';
  if (['very_late', 'absence_review', 'missing_checkin', 'missing_checkout', 'invalid_duration'].includes(status)) return 'danger';
  if (status === 'sync_pending_verification' || status === 'no_schedule') return 'muted';
  return 'info';
}
