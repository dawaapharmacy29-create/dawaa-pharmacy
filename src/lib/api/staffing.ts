import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { ParsedScheduleImport, ParsedStaffShifts } from '@/lib/shiftParser';
import { TABLES } from '@/lib/supabaseTables';

export interface StaffingSaveReport {
  staffTable: string | null;
  staffSaved: number;
  shiftsSaved: number;
  leavesSaved: number;
  skipped: string[];
  archivedStaff: string[];
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
  canonicalRole: string | null;
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

// أسماء زي "اسلام" (من ملف الإكسل) مقابل "اسلام فاروق" (الاسم الكامل في قائمة الموظفين)
// هي فعليًا نفس الشخص، لكن tokenSimilarity وحدها بتديها درجة منخفضة (Jaccard بيعاقب
// الفرق في عدد الكلمات). لو كلمات الاسم الأقصر كلها بادئة مطابقة لكلمات الاسم الأطول
// بنفس الترتيب، ده مؤشر قوي إنه نفس الاسم مختصر، فنضيف بونص واضح.
function subsetContainmentBoost(left: string, right: string) {
  if (!left || !right || left === right) return 0;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  const shortTokens = shorter.split(' ').filter(Boolean);
  const longTokens = longer.split(' ').filter(Boolean);
  if (!shortTokens.length || shortTokens.length >= longTokens.length) return 0;
  const isPrefixSubset = shortTokens.every((token, index) => longTokens[index] === token);
  return isPrefixSubset ? 0.4 : 0;
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

function findBestMatch(
  item: ParsedStaffShifts,
  pool: ExistingStaffRow[],
  importedName: string,
  importedBranch: string
): ExistingStaffRow | undefined {
  const exactCandidates = pool.filter((staff) => normalizeArabic(staff.name) === importedName);
  if (exactCandidates.length === 1) return exactCandidates[0];
  if (exactCandidates.length > 1) {
    const sameBranch = exactCandidates.filter((staff) => normalizeBranch(staff.branch) === importedBranch);
    if (sameBranch.length === 1) return sameBranch[0];
    return undefined; // أكتر من موظف نشط بنفس الاسم في نفس الفرع؛ ده تكرار في قاعدة البيانات نفسها ومحتاج مراجعة يدوية بدل تخمين.
  }

  const ranked = pool
    .map((staff) => {
      const staffName = normalizeArabic(staff.name);
      let score = tokenSimilarity(importedName, staffName);
      score += subsetContainmentBoost(importedName, staffName);
      if (importedBranch && normalizeBranch(staff.branch) === importedBranch) score += 0.12;
      if (appRole(item.role) === staff.role) score += 0.04;
      return { staff, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  const second = ranked[1];
  if (best && best.score >= 0.86 && (!second || best.score - second.score >= 0.1)) {
    return best.staff;
  }
  return undefined;
}

// في البيانات الحقيقية، معظم الصيادلة والمديرين والمشرفين هنا بيتلقبوا بـ"د" بغض
// النظر عن دورهم الوظيفي الفعلي (صيدلاني/مدير فرع/مسؤولة خدمة عملاء...)، فمينفعش
// نقصر المطابقة على appRole() بالظبط. لكن موظفي الدليفري لوحدهم مختلفون بوضوح، وهما
// مصدر التلخبط الوحيد اللي شفناه فعليًا (زي "اسلام" الدليفري مقابل "اسلام فاروق"
// الصيدلي). فبنفصل بس بين "دليفري" و"أي حاجة تانية" بدل التصنيف الدقيق بالدور.
function isDeliveryCompatible(itemRole: ParsedStaffShifts['role'], staffRole: string | null | undefined) {
  const isDeliveryStaff = staffRole === 'توصيل';
  const isDeliveryItem = itemRole === 'delivery';
  return isDeliveryStaff === isDeliveryItem;
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
    const compatiblePool = existing.filter((staff) => isDeliveryCompatible(item.role, staff.role));
    const pool = compatiblePool.length ? compatiblePool : existing; // خطة احتياطية لو تصنيف الدور في القائمة غير متوقع

    const selected = findBestMatch(item, pool, importedName, importedBranch);

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
      canonicalRole: selected.role || null,
    });
  }

  return mergeMatchedStaff(matched, skipped);
}

function mergeMatchedStaff(items: MatchedStaff[], skipped: string[]) {
  const byStaff = new Map<string, MatchedStaff>();

  for (const item of items) {
    const current = byStaff.get(item.staffId);
    if (!current) {
      byStaff.set(item.staffId, { ...item, shifts: { ...item.shifts } });
      continue;
    }

    skipped.push(`تم دمج التكرار في الملف للموظف "${item.canonicalName}" بدل إنشاء صف إضافي.`);
    for (const [day, shift] of Object.entries(item.shifts)) {
      const oldShift = current.shifts[day];
      const oldIsValidWork = oldShift && !oldShift.isOff && oldShift.start && oldShift.end;
      const newIsValidWork = !shift.isOff && shift.start && shift.end;

      if (!oldShift || newIsValidWork || !oldIsValidWork) {
        current.shifts[day] = shift;
      }
    }
  }

  return [...byStaff.values()];
}

async function updateMatchedStaffBaseShifts(table: string, staff: MatchedStaff[]) {
  let saved = 0;
  for (const item of staff) {
    const shift = firstWorkingShift(item);
    if (!shift) continue;

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
        role: item.canonicalRole || appRole(item.role),
        branch: item.canonicalBranch,
        day_name: day,
        shift_start: shift.start,
        shift_end: shift.end,
        hours: shift.hours,
        is_off: shift.isOff,
        is_day_off: shift.isOff,
        raw_shift: shift.raw,
        source: 'attendance_report.xlsx',
      }))
  );

  const map = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = `${row.staff_id}|${row.day_name}`;
    const current = map.get(key);
    const currentIsWork = current && !current.is_off && current.shift_start && current.shift_end;
    const nextIsWork = !row.is_off && row.shift_start && row.shift_end;
    if (!current || nextIsWork || !currentIsWork) map.set(key, row);
  }
  return Array.from(map.values());
}

function leaveRows(staff: MatchedStaff[]) {
  const rows = staff.flatMap((item) =>
    Object.entries(item.shifts)
      .filter(([, shift]) => shift.isOff)
      .map(([day, shift]) => ({
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
  for (const row of rows) map.set(`${row.staff_name}|${row.branch}|${row.day_name}`, row);
  return Array.from(map.values());
}

// shift_exceptions مفيهوش عمود staff_id في السكيمة الحالية (الصفحة نفسها بتقرأه بالاسم +
// الفرع، مش بالـ id)، فأي حذف/مطابقة عليه لازم يكون بالاسم مش بالـ id، عكس shift_schedules.
async function deleteExceptionRowsByNameBranch(
  table: string,
  pairs: Array<{ name: string; branch: string }>
) {
  for (const { name, branch } of pairs) {
    await supabase.from(table).delete().eq('staff_name', name).eq('branch', branch);
  }
}

async function archiveMissingStaff(
  staffTable: string,
  scheduleTable: string | null,
  exceptionTable: string | null,
  existing: ExistingStaffRow[],
  imported: ParsedStaffShifts[],
  matchedStaff: MatchedStaff[]
): Promise<string[]> {
  // نحدد إيه الفروع/الأدوار اللي "غطاها" الملف فعليًا (مثلًا: دكاترة + دليفري لفرع الشامي).
  // أي موظف نشط حاليًا في نفس (الفرع، الدور) دول ومش موجود في الملف، معناها إنه سايب
  // الشغل ولازم يتشال من الجدول — لكن من غير ما نلمس فروع/أدوار مش موجودة في الملف أصلًا
  // (زي المساعدين أو خدمة العملاء لو الملف بيغطي الدكاترة والدليفري بس).
  const coveredCombos = new Set(
    imported.map((item) => `${normalizeBranch(item.branch)}|${appRole(item.role)}`)
  );
  const matchedIds = new Set(matchedStaff.map((item) => item.staffId));

  const missing = existing.filter((staff) => {
    if (matchedIds.has(String(staff.id))) return false;
    const combo = `${normalizeBranch(staff.branch)}|${staff.role}`;
    return coveredCombos.has(combo);
  });

  if (!missing.length) return [];

  const archivedNames: string[] = [];
  for (const staff of missing) {
    const ok = await updateFlexible(staffTable, String(staff.id), {
      active: false,
      is_active: false,
      visible_in_schedule: false,
      status: 'غير نشط',
      notes: `تمت الأرشفة تلقائيًا لعدم وجوده في آخر ملف حضور مستورد بتاريخ ${new Date().toISOString().slice(0, 10)}`,
    });
    if (ok) archivedNames.push(staff.name);
  }

  const archivedIds = missing.map((staff) => String(staff.id));
  if (scheduleTable && archivedIds.length) {
    await supabase.from(scheduleTable).delete().in('staff_id', archivedIds);
  }
  if (exceptionTable && missing.length) {
    await deleteExceptionRowsByNameBranch(
      exceptionTable,
      missing.map((staff) => ({ name: staff.name, branch: staff.branch || '' }))
    );
  }

  return archivedNames;
}

async function deleteExistingScheduleRows(table: string, staff: MatchedStaff[]) {
  const ids = [...new Set(staff.map((item) => item.staffId))];
  if (ids.length === 0) return;

  const { error } = await supabase.from(table).delete().in('staff_id', ids);
  if (error) throw error;
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
  let archivedStaff: string[] = [];
  let existingStaff: ExistingStaffRow[] = [];

  if (!staffTable) {
    skipped.push('لم يتم العثور على جدول staff، لذلك لم يتم حفظ أي بيانات.');
  } else {
    existingStaff = await loadExistingStaff(staffTable);
    matchedStaff = matchImportedStaff(savableStaff, existingStaff, skipped);
    staffSaved = await updateMatchedStaffBaseShifts(staffTable, matchedStaff);
  }

  const scheduleTable = await detectTable(['shift_schedules']);
  if (scheduleTable && matchedStaff.length > 0) {
    try {
      await deleteExistingScheduleRows(scheduleTable, matchedStaff);
      shiftsSaved = await insertFlexible(scheduleTable, scheduleRows(matchedStaff));
    } catch (error) {
      skipped.push(`تعذر استبدال الشيفتات في shift_schedules: ${(error as Error).message}`);
    }
  } else if (!scheduleTable) {
    skipped.push('جدول shift_schedules غير موجود، لذلك لم يتم حفظ الشيفتات.');
  }

  const exceptionTable = await detectTable(['shift_exceptions']);
  if (exceptionTable && matchedStaff.length > 0) {
    try {
      await deleteExceptionRowsByNameBranch(
        exceptionTable,
        matchedStaff.map((item) => ({ name: item.canonicalName, branch: item.canonicalBranch }))
      );
      leavesSaved = await insertFlexible(exceptionTable, leaveRows(matchedStaff));
    } catch (error) {
      skipped.push(`تعذر استبدال الإجازات في shift_exceptions: ${(error as Error).message}`);
    }
  } else if (!exceptionTable) {
    skipped.push('جدول shift_exceptions غير موجود، لذلك لم يتم حفظ الإجازات كاستثناءات مستقلة.');
  }

  if (staffTable && existingStaff.length && matchedStaff.length) {
    try {
      archivedStaff = await archiveMissingStaff(
        staffTable,
        scheduleTable,
        exceptionTable,
        existingStaff,
        savableStaff,
        matchedStaff
      );
    } catch (error) {
      skipped.push(`تعذر أرشفة الموظفين الغير موجودين في الملف: ${(error as Error).message}`);
    }
  }

  await supabase.from('activity_log').insert({
    user_id: 'system',
    user_name: 'النظام',
    action: 'استيراد واستبدال شيفتات الموظفين الموجودين',
    module: 'الفريق والجدول',
    details: `تمت قراءة ${importData.staffCount} اسم، ومطابقة ${matchedStaff.length} موظف موجود، واستبدال جدولهم بـ ${shiftsSaved} شيفت بدون تكرار، وأرشفة ${archivedStaff.length} موظف مش موجود في الملف الجديد. لم يتم إنشاء أي حسابات.`,
    branch: 'كل الفروع',
  });

  return { staffTable, staffSaved, shiftsSaved, leavesSaved, skipped, archivedStaff };
}
