import { supabase } from '@/lib/supabase';

export type CanonicalScheduleDayV2 = {
  date: string;
  schedule_id: string | null;
  day_name: string;
  shift_start: string | null;
  shift_end: string | null;
  is_off: boolean;
  is_day_off: boolean;
  source_kind: 'weekly' | 'date_override' | string | null;
  has_schedule: boolean;
};

export type CanonicalScheduleStaffV2 = {
  staff_id: string;
  staff_name: string;
  role: string | null;
  branch: string | null;
  days: CanonicalScheduleDayV2[];
};

export type CanonicalScheduleWeekV2 = {
  week_start: string;
  week_end: string;
  branch: string | null;
  staff: CanonicalScheduleStaffV2[];
  summary: {
    staff_count: number;
    staff_days: number;
    missing_schedule_days: number;
    date_override_days: number;
    overnight_days: number;
  };
  generated_at: string;
};

export async function getCanonicalScheduleWeekV2(args: {
  weekStart: string;
  branch?: string | null;
}): Promise<CanonicalScheduleWeekV2> {
  const { data, error } = await supabase.rpc('hr_canonical_schedule_week_v2', {
    p_week_start: args.weekStart,
    p_branch: args.branch || null,
  });
  if (error) throw new Error(error.message);
  return data as CanonicalScheduleWeekV2;
}


export type WeeklyOffSwapCandidateV1 = {
  date: string;
  day_name: string;
  schedule_id: string | null;
  shift_start: string | null;
  shift_end: string | null;
  source_kind: string | null;
};

export type WeeklyOffSwapPreviewV1 = {
  staff_id: string;
  staff_name: string;
  branch: string | null;
  date: string;
  week_start: string;
  week_end: string;
  current_schedule: {
    schedule_id: string;
    day_name: string;
    shift_start: string | null;
    shift_end: string | null;
    is_off: boolean;
    is_day_off: boolean;
    source_kind: string | null;
  } | null;
  off_day_candidates: WeeklyOffSwapCandidateV1[];
};

export async function getWeeklyOffSwapPreviewV1(
  staffId: string,
  date: string
): Promise<WeeklyOffSwapPreviewV1> {
  const { data, error } = await supabase.rpc('weekly_off_swap_preview_v1', {
    p_staff_id: staffId,
    p_date: date,
  });
  if (error) throw new Error(error.message);
  return data as WeeklyOffSwapPreviewV1;
}

export async function resolveWeeklyOffSwapFromAttendanceV1(args: {
  staffId: string;
  date: string;
  swapWithDate: string;
  note?: string | null;
}): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc('resolve_weekly_off_swap_from_attendance_v1', {
    p_staff_id: args.staffId,
    p_date: args.date,
    p_swap_with_date: args.swapWithDate,
    p_note: args.note || null,
  });
  if (error) throw new Error(error.message);
  return (data || {}) as Record<string, unknown>;
}
