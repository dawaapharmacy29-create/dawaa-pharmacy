import { supabase } from "@/lib/supabase";
import { logSupabaseError } from "@/lib/supabaseError";
import { TABLES } from "@/lib/supabaseTables";

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
}

function missingColumn(message: string) {
  return (
    message.match(/Could not find the ["']([^"']+)["'] column/i)?.[1] ||
    message.match(/column ["']?([^"'\s]+)["']? (?:of relation [^ ]+ )?does not exist/i)?.[1] ||
    message.match(/record has no field ["']?([^"'\s]+)["']?/i)?.[1] ||
    null
  );
}

async function insertSchedulesFlexible(records: ShiftSchedulePayload[]) {
  let next = records.map((record) => ({ ...record }));
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const inserted = await supabase.from(TABLES.shiftSchedules).insert(next as unknown as Record<string, unknown>[]);
    if (!inserted.error) return inserted;
    logSupabaseError("insert staff shift schedules", inserted.error);
    const column = missingColumn(inserted.error.message);
    if (!column || !next.some((record) => (record as Record<string, unknown>)[column] !== undefined)) return inserted;
    next = next.map((record) => {
      const { [column]: _removed, ...rest } = record as Record<string, unknown>;
      return rest as unknown as ShiftSchedulePayload;
    });
  }
  const inserted = await supabase.from(TABLES.shiftSchedules).insert(next as unknown as Record<string, unknown>[]);
  if (inserted.error) logSupabaseError("insert staff shift schedules", inserted.error);
  return inserted;
}

export async function replaceStaffShiftSchedules(staffId: string, records: ShiftSchedulePayload[]) {
  const deleted = await supabase.from(TABLES.shiftSchedules).delete().eq("staff_id", staffId);
  if (deleted.error) {
    logSupabaseError("delete staff shift schedules", deleted.error);
    return { error: deleted.error };
  }

  return insertSchedulesFlexible(records);
}
