import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { ParsedScheduleImport, ParsedStaffShifts } from '@/lib/shiftParser';
import { TABLES } from '@/lib/supabaseTables';

export interface StaffingSaveReport {
  staffTable: string | null;
  staffSaved: number;
  shiftsSaved: number;
  leavesSaved: number;
  skipped: string[];
}

const STAFF_TABLES = [TABLES.staff];

function requireSupabaseConfig() {
  if (!isSupabaseConfigured) {
    throw new Error('إعدادات Supabase غير موجودة. أضف مفاتيح Supabase في ملف .env أو في Netlify.');
  }
}

function missingColumn(message: string) {
  return message.match(/'([^']+)' column/)?.[1] || message.match(/column "([^"]+)"/)?.[1] || '';
}

function isMissingTable(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes('does not exist') ||
    lower.includes('schema cache') ||
    lower.includes('could not find the table')
  );
}

function withoutColumn<T extends Record<string, unknown>>(records: T[], column: string) {
  return records.map((record) => {
    const next = { ...record };
    delete next[column];
    return next;
  });
}

async function detectTable(candidates: string[]) {
  for (const table of candidates) {
    const { error } = await supabase.from(table).select('*').limit(1);
    if (!error) return table;
    if (!isMissingTable(error.message)) return table;
  }
  return null;
}

async function insertFlexible(table: string, rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) return 0;
  let payload = rows;
  const removed = new Set<string>();

  for (let attempt = 0; attempt < 20; attempt++) {
    const { data, error } = await supabase.from(table).insert(payload).select('*');
    if (!error) return data?.length ?? payload.length;

    if (isMissingTable(error.message)) throw error;
    const column = missingColumn(error.message);
    if (!column || removed.has(column)) throw error;
    removed.add(column);
    payload = withoutColumn(payload, column);
  }

  return 0;
}

async function updateFlexible(table: string, id: string, row: Record<string, unknown>) {
  const payload = { ...row };
  const removed = new Set<string>();

  for (let attempt = 0; attempt < 20; attempt++) {
    const { error } = await supabase.from(table).update(payload).eq('id', id);
    if (!error) return true;

    const column = missingColumn(error.message);
    if (!column || removed.has(column) || !(column in payload)) return false;
    removed.add(column);
    delete payload[column];
  }

  return false;
}

function appRole(role: ParsedStaffShifts['role']) {
  if (role === 'doctor') return 'صيدلاني';
  if (role === 'assistant') return 'مساعد';
  if (role === 'delivery') return 'توصيل';
  return 'فريق';
}

function usernameFromName(name: string) {
  return name
    .replace(/^د\/\s*/, 'dr ')
    .replace(/[^\p{L}\p{N}]+/gu, '.')
    .replace(/^\.+|\.+$/g, '')
    .toLowerCase();
}

function firstWorkingShift(item: ParsedStaffShifts) {
  return Object.values(item.shifts).find((shift) => !shift.isOff && shift.start && shift.end);
}

function firstOffDay(item: ParsedStaffShifts) {
  return Object.entries(item.shifts).find(([, shift]) => shift.isOff)?.[0] || null;
}

async function saveStaffRows(table: string, staff: ParsedStaffShifts[]) {
  const rows = staff.map((item) => {
    const shift = firstWorkingShift(item);
    return {
      name: item.name,
      username: usernameFromName(item.name),
      phone: '',
      role: appRole(item.role),
      branch: item.branch,
      shift_start: shift?.start || '09:00',
      shift_end: shift?.end || '17:00',
      holiday_day: firstOffDay(item),
      status: 'نشط',
      active: true,
      points: 500,
      max_points: 500,
      starting_points: 500,
      notes: 'تم الاستيراد من ملف الحضور والشيفتات',
    };
  });

  let saved = 0;
  for (const row of rows) {
    const { data: existing } = await supabase
      .from(table)
      .select('id')
      .eq('name', row.name)
      .limit(1)
      .maybeSingle();
    if (existing?.id) {
      const ok = await updateFlexible(table, String(existing.id), row);
      if (ok) saved += 1;
    } else {
      saved += await insertFlexible(table, [row]);
    }
  }
  return saved;
}

function scheduleRows(staff: ParsedStaffShifts[]) {
  return staff.flatMap((item) =>
    Object.entries(item.shifts).map(([day, shift]) => ({
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
      source: 'attendance_report.xlsx',
    }))
  );
}

function leaveRows(staff: ParsedStaffShifts[]) {
  return staff.flatMap((item) =>
    Object.entries(item.shifts)
      .filter(([, shift]) => shift.isOff)
      .map(([day, shift]) => ({
        staff_name: item.name,
        employee_name: item.name,
        type: 'weekly_off',
        status: 'approved',
        branch: item.branch,
        day_name: day,
        reason: shift.raw || 'إجازة أسبوعية من جدول الحضور',
        source: 'attendance_report.xlsx',
      }))
  );
}

export async function saveScheduleImport(
  importData: ParsedScheduleImport
): Promise<StaffingSaveReport> {
  requireSupabaseConfig();

  const skipped: string[] = [];
  const staffTable = await detectTable(STAFF_TABLES);
  let staffSaved = 0;
  let shiftsSaved = 0;
  let leavesSaved = 0;

  if (!staffTable) {
    skipped.push('لم يتم العثور على جدول staff لحفظ بيانات الفريق.');
  } else {
    staffSaved = await saveStaffRows(staffTable, importData.staff);
  }

  const scheduleTable = await detectTable(['shift_schedules']);
  if (scheduleTable) {
    try {
      shiftsSaved = await insertFlexible(scheduleTable, scheduleRows(importData.staff));
    } catch (error) {
      skipped.push(`تعذر حفظ الشيفتات في shift_schedules: ${(error as Error).message}`);
    }
  } else {
    skipped.push('جدول shift_schedules غير موجود، لذلك تم حفظ بيانات الفريق فقط.');
  }

  const exceptionTable = await detectTable(['shift_exceptions']);
  if (exceptionTable) {
    try {
      leavesSaved = await insertFlexible(exceptionTable, leaveRows(importData.staff));
    } catch (error) {
      skipped.push(`تعذر حفظ الإجازات في shift_exceptions: ${(error as Error).message}`);
    }
  } else {
    skipped.push('جدول shift_exceptions غير موجود، لذلك لم يتم حفظ الإجازات كاستثناءات مستقلة.');
  }

  await supabase.from('activity_log').insert({
    user_id: 'system',
    user_name: 'النظام',
    action: 'استيراد بيانات الفريق والشيفتات',
    module: 'الفريق والجدول',
    details: `تمت قراءة ${importData.staffCount} عضو فريق، وحفظ ${staffSaved} سجل فريق.`,
    branch: 'كل الفروع',
  });

  return { staffTable, staffSaved, shiftsSaved, leavesSaved, skipped };
}
