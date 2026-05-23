import fs from "node:fs";
import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

function readEnv(path) {
  const out = {};
  const text = fs.existsSync(path) ? fs.readFileSync(path, "utf8") : "";
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    out[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return out;
}

const env = readEnv(".env");
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

const DAYS = ["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"];

function branchFromSheet(name) {
  if (/شامي|الشامي|الشامى/i.test(name)) return "فرع الشامي";
  if (/أبو العزم|ابو العزم|العزم|شكري|شكرى/i.test(name)) return "فرع شكري";
  return name || "غير محدد";
}

function roleFromText(text) {
  if (/دليفري|delivery|مندوب|التوصيل/i.test(text)) return "delivery";
  if (/مساعد|assistant/i.test(text)) return "assistant";
  if (/دكتور|الدكاترة|صيدلي|د\//i.test(text)) return "doctor";
  return "staff";
}

function appRole(role) {
  if (role === "doctor") return "صيدلاني";
  if (role === "assistant") return "مساعد";
  if (role === "delivery") return "توصيل";
  return "فريق";
}

function cleanName(value) {
  return String(value || "").replace(/\s+/g, " ").replace(/^د\s*\/?\s*/i, "د/ ").trim();
}

function toHour(hour, ampm) {
  const normalized = String(hour).replace(",", ".");
  const [h, m] = normalized.split(".");
  let value = Number.parseInt(h, 10);
  if (m) {
    const minutes = m === "5" ? 30 : Number.parseInt(m.padEnd(2, "0").slice(0, 2), 10);
    if (Number.isFinite(minutes)) value += minutes / 60;
  }
  const ap = String(ampm).toUpperCase().replace("ص", "AM").replace("م", "PM");
  if (ap === "PM" && value !== 12) value += 12;
  if (ap === "AM" && value === 12) value = 0;
  return value;
}

function formatHour(value) {
  const hours = Math.floor(value);
  const minutes = Math.round((value - hours) * 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function parseShift(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  if (/إجازة|اجازة|off|راحة|غياب/i.test(text)) return { isOff: true, start: null, end: null, hours: null, raw: text };
  const match = text.match(/(\d{1,2}(?:[.,]\d+)?)\s*(AM|PM|ص|م)\s*(?:→|->|-|الى|إلى)\s*(\d{1,2}(?:[.,]\d+)?)\s*(AM|PM|ص|م)/i);
  if (!match) return { isOff: false, start: text, end: null, hours: null, raw: text };
  const start = toHour(match[1], match[2]);
  const end = toHour(match[3], match[4]);
  let hours = end - start;
  if (hours <= 0) hours += 24;
  return { isOff: false, start: formatHour(start), end: formatHour(end), hours: Number(hours.toFixed(1)), raw: text };
}

function parseWorkbook(path) {
  const wb = XLSX.read(fs.readFileSync(path), { type: "buffer" });
  const staffMap = new Map();
  for (const sheetName of wb.SheetNames) {
    const branch = branchFromSheet(sheetName);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" });
    let header = null;
    let role = "doctor";
    for (const row of rows) {
      const first = String(row[0] || "").trim();
      const rowText = row.map((cell) => String(cell || "")).join(" ");
      const detected = roleFromText(rowText);
      if (detected !== "staff") role = detected;
      if (/الدكاترة|الصيادلة/i.test(rowText)) role = "doctor";
      if (/الدليفري|التوصيل|مندوب/i.test(rowText)) role = "delivery";
      if (first === "اليوم") {
        header = row;
        for (const cell of row.slice(2)) {
          const name = cleanName(cell);
          if (!name) continue;
          const key = `${branch}::${name}`;
          if (!staffMap.has(key)) staffMap.set(key, { name, role, branch, shifts: {} });
        }
        continue;
      }
      if (header && DAYS.includes(first)) {
        header.slice(2).forEach((cell, index) => {
          const name = cleanName(cell);
          if (!name) return;
          const shift = parseShift(row[index + 2]);
          if (!shift) return;
          const key = `${branch}::${name}`;
          const current = staffMap.get(key) || { name, role, branch, shifts: {} };
          current.role = current.role || role;
          current.shifts[first] = shift;
          staffMap.set(key, current);
        });
      }
    }
  }
  return [...staffMap.values()].filter((item) => Object.keys(item.shifts).length > 0);
}

function missingColumn(message) {
  return message.match(/'([^']+)' column/)?.[1] || message.match(/column "([^"]+)"/)?.[1] || "";
}

function isMissingTable(message) {
  const lower = String(message || "").toLowerCase();
  return lower.includes("does not exist") || lower.includes("schema cache") || lower.includes("could not find the table");
}

function withoutColumn(row, column) {
  const next = { ...row };
  delete next[column];
  return next;
}

async function detectTable(candidates) {
  for (const table of candidates) {
    const { error } = await supabase.from(table).select("*").limit(1);
    if (!error) return table;
    if (!isMissingTable(error.message)) return table;
  }
  return null;
}

async function insertFlexible(table, row) {
  let payload = { ...row };
  const removed = new Set();
  for (let attempt = 0; attempt < 20; attempt++) {
    const { data, error } = await supabase.from(table).insert(payload).select("*").single();
    if (!error) return data;
    const column = missingColumn(error.message);
    if (!column || removed.has(column)) throw error;
    removed.add(column);
    payload = withoutColumn(payload, column);
  }
  throw new Error(`Could not insert into ${table}`);
}

async function updateFlexible(table, id, row) {
  let payload = { ...row };
  const removed = new Set();
  for (let attempt = 0; attempt < 20; attempt++) {
    const { error } = await supabase.from(table).update(payload).eq("id", id);
    if (!error) return true;
    const column = missingColumn(error.message);
    if (!column || removed.has(column)) throw error;
    removed.add(column);
    payload = withoutColumn(payload, column);
  }
  return false;
}

function usernameFromName(name) {
  return name.replace(/^د\/\s*/, "dr ").replace(/[^\p{L}\p{N}]+/gu, ".").replace(/^\.+|\.+$/g, "").toLowerCase();
}

function firstWorking(item) {
  return Object.values(item.shifts).find((shift) => !shift.isOff && shift.start && shift.end);
}

function firstOff(item) {
  return Object.entries(item.shifts).find(([, shift]) => shift.isOff)?.[0] || null;
}

async function saveStaff(table, staff) {
  let saved = 0;
  for (const item of staff) {
    const shift = firstWorking(item);
    const row = {
      name: item.name,
      username: usernameFromName(item.name),
      phone: "",
      role: appRole(item.role),
      branch: item.branch,
      shift_start: shift?.start || "09:00",
      shift_end: shift?.end || "17:00",
      holiday_day: firstOff(item),
      status: "نشط",
      active: true,
      points: 500,
      max_points: 500,
      starting_points: 500,
      notes: "تم الاستيراد من ملف الحضور والشيفتات",
    };

    let query = supabase.from(table).select("id").eq("name", row.name).limit(1);
    if (row.branch) query = query.eq("branch", row.branch);
    const { data: existing, error: findError } = await query.maybeSingle();
    if (findError && !missingColumn(findError.message)) throw findError;
    if (existing?.id) await updateFlexible(table, existing.id, row);
    else await insertFlexible(table, row);
    saved += 1;
  }
  return saved;
}

async function rowExists(table, filters) {
  let query = supabase.from(table).select("id").limit(1);
  for (const [key, value] of Object.entries(filters)) query = query.eq(key, value);
  const { data, error } = await query.maybeSingle();
  if (error) return false;
  return Boolean(data?.id);
}

async function saveSchedules(table, staff) {
  let saved = 0;
  for (const item of staff) {
    for (const [day, shift] of Object.entries(item.shifts)) {
      const row = {
        staff_name: item.name,
        employee_name: item.name,
        role: appRole(item.role),
        branch: item.branch,
        day_name: day,
        shift_start: shift.start,
        shift_end: shift.end,
        hours: shift.hours,
        is_off: shift.isOff,
        raw_shift: shift.raw,
        source: "attendance_report.xlsx",
      };
      const exists = await rowExists(table, { staff_name: item.name, branch: item.branch, day_name: day, source: "attendance_report.xlsx" });
      if (!exists) {
        await insertFlexible(table, row);
        saved += 1;
      }
    }
  }
  return saved;
}

async function saveLeaves(table, staff) {
  let saved = 0;
  for (const item of staff) {
    for (const [day, shift] of Object.entries(item.shifts)) {
      if (!shift.isOff) continue;
      const row = {
        staff_name: item.name,
        employee_name: item.name,
        type: "weekly_off",
        status: "approved",
        branch: item.branch,
        day_name: day,
        reason: shift.raw || "إجازة أسبوعية من جدول الحضور",
        source: "attendance_report.xlsx",
      };
      const exists = await rowExists(table, { staff_name: item.name, branch: item.branch, day_name: day, source: "attendance_report.xlsx" });
      if (!exists) {
        await insertFlexible(table, row);
        saved += 1;
      }
    }
  }
  return saved;
}

const filePath = process.argv[2] || "attendance_report.xlsx";
const staff = parseWorkbook(filePath);
const allShifts = staff.flatMap((item) => Object.values(item.shifts));
const report = {
  parsedStaff: staff.length,
  parsedDoctors: staff.filter((item) => item.role === "doctor").length,
  parsedDelivery: staff.filter((item) => item.role === "delivery").length,
  parsedShifts: allShifts.filter((shift) => !shift.isOff).length,
  parsedLeaves: allShifts.filter((shift) => shift.isOff).length,
  staffTable: null,
  staffSaved: 0,
  scheduleTable: null,
  shiftsSaved: 0,
  exceptionTable: null,
  leavesSaved: 0,
  skipped: [],
};

const staffTable = await detectTable(["employees", "staff"]);
report.staffTable = staffTable;
if (staffTable) {
  try {
    report.staffSaved = await saveStaff(staffTable, staff);
  } catch (error) {
    report.skipped.push(`تعذر حفظ الفريق: ${error.message}`);
  }
} else {
  report.skipped.push("جدول employees أو staff غير موجود.");
}

const scheduleTable = await detectTable(["shift_schedules"]);
report.scheduleTable = scheduleTable;
if (scheduleTable) {
  try {
    report.shiftsSaved = await saveSchedules(scheduleTable, staff);
  } catch (error) {
    report.skipped.push(`تعذر حفظ الشيفتات: ${error.message}`);
  }
} else {
  report.skipped.push("جدول shift_schedules غير موجود.");
}

const exceptionTable = await detectTable(["shift_exceptions"]);
report.exceptionTable = exceptionTable;
if (exceptionTable) {
  try {
    report.leavesSaved = await saveLeaves(exceptionTable, staff);
  } catch (error) {
    report.skipped.push(`تعذر حفظ الإجازات: ${error.message}`);
  }
} else {
  report.skipped.push("جدول shift_exceptions غير موجود.");
}

await supabase.from("activity_log").insert({
  user_id: "system",
  user_name: "النظام",
  action: "استيراد بيانات الفريق والشيفتات",
  module: "الفريق والجدول",
  details: `تمت قراءة ${report.parsedStaff} عضو فريق من ملف الحضور`,
  branch: "كل الفروع",
});

console.log(JSON.stringify(report, null, 2));
