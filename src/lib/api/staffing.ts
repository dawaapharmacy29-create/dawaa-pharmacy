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

interface ExistingStaffRow {
  id: string;
  name: string;
  branch?: string | null;
  role?: string | null;
}

interface MatchedStaff extends ParsedStaffShifts {
  staffId: string;
  canonicalName: string;
  canonicalBranch: string;
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

function normalizeArabic(value?: string | null) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ـ/g, '')
    .replace(/^(دكتور|دكتوره|دكتورة|د\s*[/.-]?|dr\.?|صيدلي)\s*/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeBranch(value?: string | null) {
  const normalized = normalizeArabic(value);
  if (normalized.includes('شكري') || normalized.includes('ابو العزم') || normalized.includes('العزم')) {
    return 'شكري';
  }
  if (normalized.includes('شامي')) return 'الشامي';
  if (normalized.includes('مخزن')) return 'المخزن';
  return normalized;
}

function tokenSimilarity(left: string, right: string) {
  if (!left || !right) return 0;
  if (left === right) return 1;

  const a = new Set(left.split(' ').filter(Boolean));
  const b = new Set(right.split(' ').filter(Boolean));
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  const tokenScore = union ? intersection / union : 0;

  const maxLength = Math.max(left.length, right.length);
  let common = 0;
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] === right[i]) common += 1;
  }
  const prefixScore = maxLength ? common / maxLength : 0;

  return tokenScore * 0.8 + prefixScore * 0.2;
}

function firstWorkingShift(item: ParsedStaffShifts) {
  return Object.values(item.shifts).find((shift) => !shift.isOff && shift.start && shift.end);
}

function staffWithSavableShifts(staff: ParsedStaffShifts[]) {
  return staff
    .map((item) => ({
      ...item,
      shifts: Object.fromEntries(
        Object.entries(item.shifts).filter(([, shift]) => !(shift.errors || []).length)
      ),
    }))
    .filter((item) => Object.keys(item.shifts).length > 0);
}

async function loadExistingStaff(table: string): Promise<ExistingStaffRow[]> {
  const { data, error } = await supabase
    .from(table)
    .select('id,name,branch,role')
    .order('name', { ascending: true });

  if (error) throw error;
  return (data || []) as ExistingStaffRow[];
}

function matchImportedStaff(
  imported: ParsedStaffShifts[],
  existing: ExistingStaffRow[],
  skipped: string[]
): MatchedStaff[] {
  const matched: MatchedStaff[] = [];

  for (const item of imported) {
    const importedName = normalizeArabic(item.name);
    const importedBranch = normalizeBranch(item.branch);

    const exactCandidates = existing.filter(
      (staff) => normalizeArabic(staff.name) === importedName
    );

    let selected: ExistingStaffRow | undefined;
    if (exactCandidates.length === 1) {
      selected = exactCandidates[0];
    } else if (exactCandidates.length > 1) {
      selected = exactCandidates.find(
        (staff) => normalizeBranch(staff.branch) === importedBranch
      );
    }

    if (!selected) {
      const ranked = existing
        .map((staff) => {
          let score = tokenSimilarity(importedName, normalizeArabic(staff.name));
          if (importedBranch && normalizeBranch(staff.branch) === importedBranch) score += 0.12;
          if (appRole(item.role) === staff.role) score += 0.04;
          return { staff, score };
        })
        .sort((a, b) => b.score - a.score);

      const best = ranked[0];
      const second = ranked[1];
      if (best && best.score >= 0.86 && (!second || best.score - second.score >= 0.1)) {
        selected = best.staff;
      }
    }

    if (!selected) {
      skipped.push(
        `لم يتم حفظ شيفتات "${item.name}" لأن الاسم غير موجود أو غير مؤكد في قائمة الموظفين. لن يتم إنشاء حساب تلقائيًا.`
      );
      continue;
    }

    matched.push({
      ...item,
      staffId: String(selected.id),
      canonicalName: selected.name,
      canonicalBranch: selected.branch || item.branch,
    });
  }

  return matched;
}

async function updateMatchedStaffBaseShifts(table: string, staff: MatchedStaff[]) {
  let saved = 0;
  for (const item of staff) {
    const shift = firstWorkingShift(item);
    if (!shift) continue;

    // استيراد الجدول لا ينشئ حسابات ولا يغيّر username أو الهاتف أو كلمة المرور.
    const ok = await updateFlexible(table, item.staffId, {
      shift_start: shift.start,
      shift_end: shift.end,
      notes: 'تم تحديث المواعيد من ملف الحضور والشيفتات بعد مطابقة الموظف الموجود',
    });
    if (ok) saved += 1;
  }
  return saved;
}

function scheduleRows(staff: MatchedStaff[]) {
  const rows = staff.flatMap((item) =>
    Object.entries(item.shifts)
      .filter(([, shift]) => !(shift.errors || []).length)
      .map(([day, shift]) => ({
        staff_id: item.staffId,
        staff_name: item.canonicalName,
        employee_name: item.canonicalName,
        role: appRole(item.role),
        branch: item.canonicalBranch,
        day_name: day,
        shift_start: shift.start,
        shift_end: shift.end,
        hours: shift.hours,
        is_off: shift.isOff,
        raw_shift: shift.raw,
        source: 'attendance_report.xlsx',
      }))
  );

  const map = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = `${row.staff_id}|${row.day_name}`;
    map.set(key, row);
  }
  return Array.from(map.values());
}

function leaveRows(staff: MatchedStaff[]) {
  const rows = staff.flatMap((item) =>
    Object.entries(item.shifts)
      .filter(([, shift]) => shift.isOff)
      .map(([day, shift]) => ({
        staff_id: item.staffId,
        staff_name: item.canonicalName,
        employee_name: item.canonicalName,
        type: 'weekly_off',
        status: 'approved',
        branch: item.canonicalBranch,
        day_name: day,
        reason: shift.raw || 'إجازة أسبوعية من جدول الحضور',
        source: 'attendance_report.xlsx',
      }))
  );

  const map = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = `${row.staff_id}|${row.day_name}`;
    map.set(key, row);
  }
  return Array.from(map.values());
}

export async function saveScheduleImport(
  importData: ParsedScheduleImport
): Promise<StaffingSaveReport> {
  requireSupabaseConfig();

  const skipped: string[] = [];
  const savableStaff = staffWithSavableShifts(importData.staff);
  const staffTable = await detectTable(STAFF_TABLES);
  let staffSaved = 0;
  let shiftsSaved = 0;
  let leavesSaved = 0;
  let matchedStaff: MatchedStaff[] = [];

  if (!staffTable) {
    skipped.push('لم يتم العثور على جدول staff، لذلك لم يتم حفظ أي بيانات.');
  } else {
    const existingStaff = await loadExistingStaff(staffTable);
    matchedStaff = matchImportedStaff(savableStaff, existingStaff, skipped);
    staffSaved = await updateMatchedStaffBaseShifts(staffTable, matchedStaff);
  }

  const scheduleTable = await detectTable(['shift_schedules']);
  if (scheduleTable && matchedStaff.length > 0) {
    try {
      const { error: delError } = await supabase
        .from(scheduleTable)
        .delete()
        .eq('source', 'attendance_report.xlsx');
      if (delError) {
        skipped.push(`تعذر حذف الشيفتات القديمة في ${scheduleTable}: ${delError.message}`);
      }

      shiftsSaved = await insertFlexible(scheduleTable, scheduleRows(matchedStaff));
    } catch (error) {
      skipped.push(`تعذر حفظ الشيفتات في shift_schedules: ${(error as Error).message}`);
    }
  } else if (!scheduleTable) {
    skipped.push('جدول shift_schedules غير موجود، لذلك لم يتم حفظ الشيفتات.');
  }

  const exceptionTable = await detectTable(['shift_exceptions']);
  if (exceptionTable && matchedStaff.length > 0) {
    try {
      const { error: delError } = await supabase
        .from(exceptionTable)
        .delete()
        .eq('source', 'attendance_report.xlsx');
      if (delError) {
        skipped.push(`تعذر حذف الإجازات القديمة في ${exceptionTable}: ${delError.message}`);
      }

      leavesSaved = await insertFlexible(exceptionTable, leaveRows(matchedStaff));
    } catch (error) {
      skipped.push(`تعذر حفظ الإجازات في shift_exceptions: ${(error as Error).message}`);
    }
  } else if (!exceptionTable) {
    skipped.push('جدول shift_exceptions غير موجود، لذلك لم يتم حفظ الإجازات كاستثناءات مستقلة.');
  }

  await supabase.from('activity_log').insert({
    user_id: 'system',
    user_name: 'النظام',
    action: 'استيراد الشيفتات للموظفين الموجودين',
    module: 'الفريق والجدول',
    details: `تمت قراءة ${importData.staffCount} اسم، ومطابقة ${matchedStaff.length} موظف موجود، وحفظ ${shiftsSaved} شيفت. لم يتم إنشاء أي حسابات.`,
    branch: 'كل الفروع',
  });

  return { staffTable, staffSaved, shiftsSaved, leavesSaved, skipped };
}
