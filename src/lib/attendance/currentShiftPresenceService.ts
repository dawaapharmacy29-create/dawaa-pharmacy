import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { isCurrentlyOnShift } from "@/lib/utils";
import { DAYS_AR } from "@/lib/constants";

export type ShiftPresencePerson = {
  id: string;
  name: string;
  role: string;
  branch: string;
  shift_start: string | null;
  shift_end: string | null;
  attendance_status: "حاضر" | "لم يبصم" | "غير مجدول";
};

export type CurrentShiftPresence = {
  doctors: ShiftPresencePerson[];
  assistants: ShiftPresencePerson[];
  delivery: ShiftPresencePerson[];
  total: number;
  loadedAt: Date;
};

type StaffRow = {
  id: string;
  name: string;
  role: string;
  branch: string;
  status: string;
};

type ShiftScheduleRow = {
  staff_id: string | null;
  staff_name: string;
  branch: string;
  day_name: string;
  shift_start: string | null;
  shift_end: string | null;
  is_off: boolean | null;
};

type AttendanceRow = {
  staff_id: string | null;
  staff_name: string | null;
  date: string;
  check_in: string | null;
};

function todayName(): string {
  return DAYS_AR[new Date().getDay()];
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function categorize(role: string): "doctors" | "assistants" | "delivery" | null {
  const r = (role || "").toLowerCase();
  if (/صيد|دكتور|pharmacist|doctor/i.test(r)) return "doctors";
  if (/مساعد|assistant/i.test(r)) return "assistants";
  if (/توصيل|دليفري|delivery/i.test(r)) return "delivery";
  return null;
}

function staffMatchesSchedule(staff: StaffRow, schedule: ShiftScheduleRow): boolean {
  return (
    (schedule.staff_id && schedule.staff_id === staff.id) ||
    schedule.staff_name === staff.name
  ) && schedule.branch === staff.branch;
}

function hasAttendance(staff: StaffRow, attendanceRows: AttendanceRow[]): boolean {
  return attendanceRows.some(
    (a) =>
      (a.staff_id && a.staff_id === staff.id) ||
      a.staff_name === staff.name,
  );
}

export async function fetchCurrentShiftPresence(): Promise<CurrentShiftPresence> {
  const empty: CurrentShiftPresence = {
    doctors: [],
    assistants: [],
    delivery: [],
    total: 0,
    loadedAt: new Date(),
  };

  if (!isSupabaseConfigured) return empty;

  const today = todayName();
  const todayStr = todayDate();

  const [staffResult, schedulesResult, attendanceResult] = await Promise.all([
    supabase.from("staff").select("id,name,role,branch,status").eq("status", "نشط").limit(500),
    supabase.from("shift_schedules").select("staff_id,staff_name,branch,day_name,shift_start,shift_end,is_off").eq("day_name", today).limit(500),
    supabase
      .from("attendance")
      .select("staff_id,staff_name,date,check_in")
      .eq("date", todayStr)
      .limit(500)
      .then(
        (res) => res,
        () => ({ data: [], error: null }),
      ),
  ]);

  const staffRows: StaffRow[] = (staffResult.data ?? []) as StaffRow[];
  const scheduleRows: ShiftScheduleRow[] = (schedulesResult.data ?? []) as ShiftScheduleRow[];
  const attendanceRows: AttendanceRow[] = (attendanceResult.data ?? []) as AttendanceRow[];

  const result: CurrentShiftPresence = {
    doctors: [],
    assistants: [],
    delivery: [],
    total: 0,
    loadedAt: new Date(),
  };

  for (const staff of staffRows) {
    const category = categorize(staff.role);
    if (!category) continue;

    const schedule = scheduleRows.find((s) => staffMatchesSchedule(staff, s));
    if (!schedule || schedule.is_off) continue;

    const { shift_start, shift_end } = schedule;
    if (!shift_start || !shift_end) continue;

    const onShift = isCurrentlyOnShift(shift_start, shift_end);
    if (!onShift) continue;

    const checkedIn = hasAttendance(staff, attendanceRows);
    const attendance_status: ShiftPresencePerson["attendance_status"] = checkedIn
      ? "حاضر"
      : "لم يبصم";

    const person: ShiftPresencePerson = {
      id: staff.id,
      name: staff.name,
      role: staff.role,
      branch: staff.branch,
      shift_start,
      shift_end,
      attendance_status,
    };

    result[category].push(person);
  }

  result.total = result.doctors.length + result.assistants.length + result.delivery.length;
  return result;
}
