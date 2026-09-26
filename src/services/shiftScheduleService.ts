import { supabase } from '@/lib/supabase';

export interface ShiftSchedulePayload {
  staff_id: string;
  staff_name: string;
  branch: string;
  branch_id?: string | null;
  day_name: string;
  day_of_week?: number;
  shift_start: string | null;
  shift_end: string | null;
  is_off: boolean;
  is_day_off?: boolean;
  is_different?: boolean;
  has_custom_time?: boolean;
  notes?: string | null;
  role?: string | null;
  hours?: number | null;
  raw_shift?: string | null;
  source?: string | null;
  status?: string | null;
}

function cairoToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export async function replaceStaffShiftSchedules(staffId: string, records: ShiftSchedulePayload[]) {
  const payload = records.map((record) => ({
    ...record,
    staff_id: undefined,
  }));
  const result = await supabase.rpc('replace_staff_shift_schedule_version_v1', {
    p_staff_id: staffId,
    p_rows: payload,
    p_effective_from: cairoToday(),
    p_note: 'تحديث جدول الموظف من التطبيق',
  });
  return { error: result.error, data: result.data };
}
