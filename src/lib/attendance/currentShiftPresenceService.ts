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
    activeShiftCount: number;
    attendanceCount: number;
    source: "day_name" | "shift_date" | "date" | "mixed" | "fallback";
  };
};

type ShiftScheduleRow = {
  id?: string | null;
  staff_id?: string | null;
  staff_name?: string | null;
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
  if (!match) return null;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function minutesFromTime(value?: string | null) {
  const time = normalizeTime(value);
  if (!time) return null;
  const [h, m] = time.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function nowMinutes() {
  const now = egyptNow();
  return now.getHours() * 60 + now.getMinutes();
}

function isShiftActive(start?: string | null, end?: string | null) {
  const startMin = minutesFromTime(start);
  const endMin = minutesFromTime(end);
  if (startMin === null || endMin === null) return true;
  const current = nowMinutes();
  if (startMin === endMin) return true;
  if (endMin > startMin) return current >= startMin && current < endMin;
  return current >= startMin || current < endMin;
}

function categorize(role?: string | null, name?: string | null): "doctors" | "assistants" | "delivery" {
  const r = normalizeText(role);
  const n = normalizeText(name);
  if (/صيد|دكتور|pharmacist|doctor/.test(r) || /^د\s*\/?/.test(n) || n.startsWith("د ")) return "doctors";
  if (/توصيل|دليفري|delivery|rider/.test(r)) return "delivery";
  if (/مساعد|assistant/.test(r)) return "assistants";
  return "delivery";
}

function attendanceKey(row: Pick<AttendanceRow, "staff_id" | "staff_name">) {
  return String(row.staff_id || "").trim() || normalizeText(row.staff_name);
}

function scheduleKey(row: ShiftScheduleRow) {
  return String(row.staff_id || "").trim() || normalizeText(row.staff_name);
}

function statusFor(attendance?: AttendanceRow): ShiftPresencePerson["attendance_status"] {
  if (!attendance) return "لم يبصم";
  if (attendance.check_out || attendance.last_out) return "خرج";
  if (attendance.check_in || attendance.first_in) return "موجود الآن";
  return "لم يبصم";
}

async function safeSelect<T>(table: string, select: string, apply: (query: any) => any) {
  try {
    const result = await apply(supabase.from(table).select(select));
    if (result.error) {
      console.warn(`[currentShiftPresence] ${table} select failed`, result.error.message);
      return [] as T[];
    }
    return (result.data || []) as T[];
  } catch (error) {
    console.warn(`[currentShiftPresence] ${table} select exception`, error);
    return [] as T[];
  }
}

const SHIFT_SELECT = "id,staff_id,staff_name,role,branch,day_name,shift_date,date,shift_name,start_time,end_time,shift_start,shift_end,is_off,status";
const ATTENDANCE_SELECT = "staff_id,staff_name,date,attendance_date,check_in,check_out,first_in,last_out";

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
    SHIFT_SELECT,
    (query) => query.or(`shift_date.eq.${todayStr},date.eq.${todayStr}`).limit(1000),
  );

  const byDay = await safeSelect<ShiftScheduleRow>(
    "shift_schedules",
    SHIFT_SELECT,
    (query) => query.eq("day_name", todayArabic).limit(1000),
  );

  const rawSchedules = [...byDate, ...byDay].filter((row) => {
    if (row.is_off || normalizeText(row.status).includes("اجازه")) return false;
    if (normalizeText(row.day_name) && normalizeText(row.day_name) !== normalizeText(todayArabic)) {
      if (String(row.shift_date || row.date || "").slice(0, 10) !== todayStr) return false;
    }
    return isShiftActive(row.shift_start || row.start_time, row.shift_end || row.end_time);
  });

  const scheduleMap = new Map<string, ShiftScheduleRow>();
  rawSchedules.forEach((row) => {
    const name = String(row.staff_name || "").trim();
    if (!name) return;
    const key = `${normalizeText(name)}|${normalizeText(row.branch)}|${normalizeTime(row.shift_start || row.start_time) || ""}|${normalizeTime(row.shift_end || row.end_time) || ""}`;
    const existing = scheduleMap.get(key);
    if (!existing) {
      scheduleMap.set(key, row);
      return;
    }
    const existingScore = (existing.staff_id ? 2 : 0) + (existing.role ? 1 : 0);
    const newScore = (row.staff_id ? 2 : 0) + (row.role ? 1 : 0);
    if (newScore > existingScore) scheduleMap.set(key, row);
  });

  const schedules = [...scheduleMap.values()];

  const attendanceRows = await safeSelect<AttendanceRow>(
    "attendance",
    ATTENDANCE_SELECT,
    (query) => query.or(`date.eq.${todayStr},attendance_date.eq.${todayStr}`).limit(1000),
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
      fetchedShiftCount: [...byDate, ...byDay].length,
      activeShiftCount: schedules.length,
      attendanceCount: attendanceRows.length,
      source: byDate.length && byDay.length ? "mixed" : byDate.length ? "shift_date" : byDay.length ? "day_name" : "fallback",
    },
  };

  for (const row of schedules) {
    const name = String(row.staff_name || "").trim();
    if (!name) continue;
    const start = normalizeTime(row.shift_start || row.start_time);
    const end = normalizeTime(row.shift_end || row.end_time);
    const key = scheduleKey(row);
    const attendance = attendanceMap.get(key) || attendanceMap.get(normalizeText(name));
    const category = categorize(row.role, name);
    const person: ShiftPresencePerson = {
      id: String(row.staff_id || row.id || key || name),
      name,
      role: row.role || (category === "doctors" ? "صيدلاني" : category === "delivery" ? "توصيل" : "مساعد"),
      branch: row.branch || "غير محدد",
      shift_name: row.shift_name || null,
      day_name: row.day_name || todayArabic,
      shift_start: start,
      shift_end: end,
      attendance_status: statusFor(attendance),
      source: String(row.shift_date || "").slice(0, 10) === todayStr ? "shift_date" : String(row.date || "").slice(0, 10) === todayStr ? "date" : normalizeText(row.day_name) === normalizeText(todayArabic) ? "day_name" : "fallback",
    };
    result[category].push(person);
  }

  const sortPeople = (a: ShiftPresencePerson, b: ShiftPresencePerson) => `${a.branch} ${a.shift_start || ""} ${a.name}`.localeCompare(`${b.branch} ${b.shift_start || ""} ${b.name}`, "ar");
  result.doctors.sort(sortPeople);
  result.assistants.sort(sortPeople);
  result.delivery.sort(sortPeople);
  result.total = result.doctors.length + result.assistants.length + result.delivery.length;
  return result;
}
