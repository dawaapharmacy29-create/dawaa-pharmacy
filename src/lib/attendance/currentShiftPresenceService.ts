import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { DAYS_AR } from "@/lib/constants";

export type ShiftPresencePerson = {
  id: string;
  name: string;
  role: string;
  branch: string;
  shift_name?: string | null;
  day_name?: string | null;
  shift_start: string | null;
  shift_end: string | null;
  attendance_status: "موجود الآن" | "خرج" | "متأخر" | "لم يبصم" | "غير مجدول";
  source: "day_name" | "shift_date" | "date" | "fallback";
};

export type CurrentShiftPresence = {
  doctors: ShiftPresencePerson[];
  assistants: ShiftPresencePerson[];
  delivery: ShiftPresencePerson[];
  total: number;
  loadedAt: Date;
  debug?: {
    todayArabic: string;
    todayDate: string;
    fetchedShiftCount: number;
    attendanceCount: number;
    source: "day_name" | "shift_date" | "date" | "mixed" | "fallback";
  };
};

type ShiftScheduleRow = {
  id?: string | null;
  staff_id?: string | null;
  staff_name?: string | null;
  name?: string | null;
  role?: string | null;
  branch?: string | null;
  day_name?: string | null;
  shift_date?: string | null;
  date?: string | null;
  shift_name?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  shift_start?: string | null;
  shift_end?: string | null;
  is_off?: boolean | null;
  status?: string | null;
};

type AttendanceRow = {
  staff_id?: string | null;
  staff_name?: string | null;
  date?: string | null;
  attendance_date?: string | null;
  check_in?: string | null;
  check_out?: string | null;
  first_in?: string | null;
  last_out?: string | null;
};

function egyptNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Africa/Cairo" }));
}

function todayName(): string {
  return DAYS_AR[egyptNow().getDay()] || "";
}

function todayDate(): string {
  return egyptNow().toISOString().slice(0, 10);
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .replace(/[\u064B-\u065F\u0640]/g, "")
    .replace(/[إأآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeTime(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const match = raw.match(/(\d{1,2}):(\d{2})/);
  if (!match) return raw;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function minutesFromTime(value?: string | null) {
  const time = normalizeTime(value);
  if (!time) return null;
  const [h, m] = time.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function hasShiftStarted(start?: string | null) {
  const startMin = minutesFromTime(start);
  if (startMin === null) return false;
  const now = egyptNow();
  return now.getHours() * 60 + now.getMinutes() >= startMin;
}

function categorize(role?: string | null): "doctors" | "assistants" | "delivery" {
  const r = normalizeText(role);
  if (/صيد|دكتور|pharmacist|doctor/.test(r)) return "doctors";
  if (/مساعد|assistant/.test(r)) return "assistants";
  if (/توصيل|دليفري|delivery|rider/.test(r)) return "delivery";
  return "assistants";
}

function attendanceKey(row: Pick<AttendanceRow, "staff_id" | "staff_name">) {
  return String(row.staff_id || "").trim() || normalizeText(row.staff_name);
}

function scheduleKey(row: ShiftScheduleRow) {
  return String(row.staff_id || "").trim() || normalizeText(row.staff_name || row.name);
}

function statusFor(schedule: ShiftScheduleRow, attendance?: AttendanceRow): ShiftPresencePerson["attendance_status"] {
  if (!attendance) return hasShiftStarted(schedule.shift_start || schedule.start_time) ? "لم يبصم" : "لم يبصم";
  if (attendance.check_out || attendance.last_out) return "خرج";
  if (attendance.check_in || attendance.first_in) return "موجود الآن";
  return hasShiftStarted(schedule.shift_start || schedule.start_time) ? "متأخر" : "لم يبصم";
}

async function safeSelect<T>(table: string, select: string, apply: (query: any) => any) {
  try {
    const result = await apply(supabase.from(table).select(select));
    if (result.error) return [] as T[];
    return (result.data || []) as T[];
  } catch {
    return [] as T[];
  }
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

  const todayArabic = todayName();
  const todayStr = todayDate();

  const byDate = await safeSelect<ShiftScheduleRow>(
    "shift_schedules",
    "id,staff_id,staff_name,name,role,branch,day_name,shift_date,date,shift_name,start_time,end_time,shift_start,shift_end,is_off,status",
    (query) => query.or(`shift_date.eq.${todayStr},date.eq.${todayStr}`).limit(700),
  );

  const byDay = await safeSelect<ShiftScheduleRow>(
    "shift_schedules",
    "id,staff_id,staff_name,name,role,branch,day_name,shift_date,date,shift_name,start_time,end_time,shift_start,shift_end,is_off,status",
    (query) => query.eq("day_name", todayArabic).limit(700),
  );

  const scheduleMap = new Map<string, ShiftScheduleRow>();
  [...byDate, ...byDay].forEach((row) => {
    if (row.is_off || normalizeText(row.status).includes("اجازه")) return;
    const key = scheduleKey(row) || `${row.staff_name || row.name || "unknown"}-${row.branch || ""}-${row.shift_start || row.start_time || ""}`;
    if (!scheduleMap.has(key)) scheduleMap.set(key, row);
  });

  const schedules = [...scheduleMap.values()];

  const attendanceRows = await safeSelect<AttendanceRow>(
    "attendance",
    "staff_id,staff_name,date,attendance_date,check_in,check_out,first_in,last_out",
    (query) => query.or(`date.eq.${todayStr},attendance_date.eq.${todayStr}`).limit(700),
  );

  const attendanceMap = new Map<string, AttendanceRow>();
  attendanceRows.forEach((row) => {
    const key = attendanceKey(row);
    if (key) attendanceMap.set(key, row);
  });

  const result: CurrentShiftPresence = {
    doctors: [],
    assistants: [],
    delivery: [],
    total: 0,
    loadedAt: new Date(),
    debug: {
      todayArabic,
      todayDate: todayStr,
      fetchedShiftCount: schedules.length,
      attendanceCount: attendanceRows.length,
      source: byDate.length && byDay.length ? "mixed" : byDate.length ? "shift_date" : byDay.length ? "day_name" : "fallback",
    },
  };

  for (const row of schedules) {
    const name = String(row.staff_name || row.name || "").trim();
    if (!name) continue;
    const start = normalizeTime(row.shift_start || row.start_time);
    const end = normalizeTime(row.shift_end || row.end_time);
    const key = scheduleKey(row);
    const attendance = attendanceMap.get(key) || attendanceMap.get(normalizeText(name));
    const category = categorize(row.role);
    const person: ShiftPresencePerson = {
      id: String(row.staff_id || row.id || key || name),
      name,
      role: row.role || "غير محدد",
      branch: row.branch || "غير محدد",
      shift_name: row.shift_name || null,
      day_name: row.day_name || todayArabic,
      shift_start: start,
      shift_end: end,
      attendance_status: statusFor(row, attendance),
      source: row.shift_date === todayStr ? "shift_date" : row.date === todayStr ? "date" : row.day_name === todayArabic ? "day_name" : "fallback",
    };
    result[category].push(person);
  }

  const sortPeople = (a: ShiftPresencePerson, b: ShiftPresencePerson) => `${a.shift_start || ""} ${a.name}`.localeCompare(`${b.shift_start || ""} ${b.name}`, "ar");
  result.doctors.sort(sortPeople);
  result.assistants.sort(sortPeople);
  result.delivery.sort(sortPeople);
  result.total = result.doctors.length + result.assistants.length + result.delivery.length;
  return result;
}
