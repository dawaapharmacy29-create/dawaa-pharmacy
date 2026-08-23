import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export type AttendanceReadRow = {
  staff_id?: string | null;
  staff_name?: string | null;
  status?: string | null;
  date?: string | null;
  attendance_date?: string | null;
  check_in?: string | null;
  check_out?: string | null;
  first_in?: string | null;
  last_out?: string | null;
  [key: string]: unknown;
};

export type AttendanceReadResult =
  | { status: 'available'; rows: AttendanceReadRow[] }
  | { status: 'unavailable'; rows: []; error: string };

/**
 * Canonical attendance read boundary.
 *
 * A failed database query is deliberately represented as unavailable instead of [] so
 * consumers cannot mistake a connectivity/schema failure for zero attendance or absence.
 */
export async function readAttendanceRange(args: {
  staffId: string;
  startDate: string;
  endDateExclusive: string;
  limit?: number;
}): Promise<AttendanceReadResult> {
  if (!isSupabaseConfigured) {
    return { status: 'unavailable', rows: [], error: 'Supabase غير مهيأ.' };
  }

  const { data, error } = await supabase
    .from('attendance')
    .select('status,check_in,check_out,date,attendance_date,staff_id,staff_name,first_in,last_out')
    .eq('staff_id', args.staffId)
    .gte('date', args.startDate.slice(0, 10))
    .lt('date', args.endDateExclusive.slice(0, 10))
    .order('date', { ascending: true })
    .limit(Math.min(Math.max(args.limit || 400, 1), 1000));

  if (error) {
    return { status: 'unavailable', rows: [], error: error.message };
  }

  return { status: 'available', rows: (data || []) as AttendanceReadRow[] };
}
