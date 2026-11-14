import { supabase } from '@/lib/supabase';
import type { ShiftWindow } from './groupChatCustomerRequests';

const CAIRO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

/** A timestamp as Cairo wall-clock `YYYY-MM-DDTHH:mm:ss` (the WhatsApp export's format). */
export function cairoLocal(iso: string) {
  const parts = Object.fromEntries(CAIRO.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

/** A punch with no checkout is taken as a 9-hour shift. */
const DEFAULT_SHIFT_MS = 9 * 36e5;

/** Punch windows of the given doctors between two days (inclusive); empty when attendance cannot be read. */
export async function loadShiftWindows(staffIds: string[], fromDay: string, toDay: string): Promise<ShiftWindow[]> {
  if (!staffIds.length) return [];
  const { data, error } = await supabase.from('attendance_daily_summary')
    .select('staff_id,first_in,last_out')
    .in('staff_id', staffIds)
    .gte('attendance_date', fromDay)
    .lte('attendance_date', toDay)
    .not('first_in', 'is', null)
    .limit(5000);
  if (error) return [];
  return ((data || []) as Array<{ staff_id: string; first_in: string; last_out: string | null }>).map((row) => ({
    staffId: String(row.staff_id),
    from: cairoLocal(row.first_in),
    to: cairoLocal(row.last_out || new Date(Date.parse(row.first_in) + DEFAULT_SHIFT_MS).toISOString()),
  }));
}
