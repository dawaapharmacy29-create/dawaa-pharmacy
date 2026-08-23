import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { filterActiveStaffRows } from '@/lib/staffActiveFilter';
import { mergeStaffChoices } from '@/lib/staffFallback';
import {
  normalizeBranchName,
  timeRangesOverlap,
  type ShiftMemberDraft,
  type ShiftType,
} from '@/lib/shiftPerformance';

type Row = Record<string, unknown>;

export interface ShiftMembersResult {
  members: ShiftMemberDraft[];
  hasEnoughData: boolean;
  message: string;
}

function arabicDayName(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('ar-EG', { weekday: 'long' });
}

function rowName(row: Row) {
  return String(row.staff_name || row.employee_name || row.name || '').trim();
}

function rowStaffId(row: Row) {
  return String(row.staff_id || row.employee_id || row.id || '').trim();
}

async function readRows(query: PromiseLike<{ data: unknown[] | null; error: { message?: string } | null }>) {
  const { data, error } = await query;
  if (error) {
    const message = String(error.message || '');
    if (/does not exist|schema cache|relation .* does not exist/i.test(message)) return [] as Row[];
    throw error;
  }
  return ((data || []) as Row[]).filter(Boolean);
}

export async function loadShiftMembers(params: {
  date: string;
  branch: string;
  shiftType: ShiftType;
  shiftStart: string;
  shiftEnd: string;
}): Promise<ShiftMembersResult> {
  if (!isSupabaseConfigured) {
    return { members: [], hasEnoughData: false, message: 'إعدادات Supabase غير موجودة.' };
  }

  const branch = normalizeBranchName(params.branch);
  const day = arabicDayName(params.date);

  const [staffRows, scheduleRows, exceptionRows, attendanceRows] = await Promise.all([
    readRows(
      supabase
        .from('staff')
        .select('id,name,role,branch,branch_id,active,is_active,status,deleted_at,is_deleted')
        .eq('branch', branch)
        .limit(200)
    ),
    readRows(
      supabase
        .from('shift_schedules')
        .select('*')
        .eq('branch', branch)
        .eq('day_name', day)
        .limit(200)
    ),
    readRows(
      supabase
        .from('shift_exceptions')
        .select('*')
        .eq('branch', branch)
        .eq('status', 'approved')
        .eq('date', params.date)
        .limit(200)
    ),
    readRows(
      supabase
        .from('attendance')
        .select('*')
        .eq('branch', branch)
        .or(`attendance_date.eq.${params.date},date.eq.${params.date}`)
        .limit(200)
    ),
  ]);

  const staffChoices = mergeStaffChoices(
    filterActiveStaffRows(staffRows).map((row) => ({
      id: String(row.id || row.staff_id || row.employee_id || ''),
      name: String(row.name || row.staff_name || row.employee_name || ''),
      role: String(row.role || row.staff_role || ''),
      branch: String(row.branch || row.branch_name || ''),
      points: typeof row.points === 'number' ? row.points : null,
      max_points: typeof row.max_points === 'number' ? row.max_points : null,
    }))
  ).filter((staff) => normalizeBranchName(staff.branch) === branch);

  const branchSchedules = scheduleRows.filter((row) => {
    const isOff = Boolean(row.is_off) || String(row.shift_start || row.shift || '').includes('إجازة');
    return !isOff;
  });

  const scheduledNames = new Set(branchSchedules.map(rowName).filter(Boolean));
  const scheduledIds = new Set(branchSchedules.map(rowStaffId).filter(Boolean));
  const candidates = branchSchedules.length
    ? staffChoices.filter((staff) => scheduledNames.has(staff.name) || scheduledIds.has(staff.id))
    : staffChoices;

  const candidateNames = new Set(candidates.map((staff) => staff.name));
  const candidateIds = new Set(candidates.map((staff) => staff.id));
  const activeExceptions = exceptionRows.filter((row) => {
    const status = String(row.status || '').toLowerCase();
    return status === 'approved' && (candidateNames.has(rowName(row)) || candidateIds.has(rowStaffId(row)));
  });

  const scheduleByName = new Map<string, Row>();
  const scheduleById = new Map<string, Row>();
  branchSchedules.forEach((row) => {
    const name = rowName(row);
    const id = rowStaffId(row);
    if (name) scheduleByName.set(name, row);
    if (id) scheduleById.set(id, row);
  });

  const exceptionByName = new Map<string, Row>();
  const exceptionById = new Map<string, Row>();
  activeExceptions.forEach((row) => {
    const name = rowName(row);
    const id = rowStaffId(row);
    if (name) exceptionByName.set(name, row);
    if (id) exceptionById.set(id, row);
  });

  const attendanceByName = new Map<string, Row>();
  const attendanceById = new Map<string, Row>();
  attendanceRows.forEach((row) => {
    const name = rowName(row);
    const id = rowStaffId(row);
    if (name) attendanceByName.set(name, row);
    if (id) attendanceById.set(id, row);
  });

  const members = candidates
    .map((staff) => {
      const schedule = scheduleByName.get(staff.name) || scheduleById.get(staff.id);
      const scheduleStart = String(schedule?.shift_start || schedule?.start_time || '');
      const scheduleEnd = String(schedule?.shift_end || schedule?.end_time || '');
      if (schedule && !timeRangesOverlap(scheduleStart, scheduleEnd, params.shiftStart, params.shiftEnd)) {
        return null;
      }

      const exception = exceptionByName.get(staff.name) || exceptionById.get(staff.id);
      const exceptionType = String(exception?.type || '');
      if (exceptionType.includes('إجازة') || exceptionType.includes('غياب')) return null;

      const attendance = attendanceByName.get(staff.name) || attendanceById.get(staff.id);
      const hasPermission = Boolean(exception) && (exceptionType.includes('إذن') || exceptionType.includes('تبديل'));

      return {
        staff_id: staff.id,
        staff_name: staff.name,
        staff_role: staff.role,
        branch: staff.branch,
        shift_start: scheduleStart || params.shiftStart,
        shift_end: scheduleEnd || params.shiftEnd,
        was_present: attendance ? String(attendance.status || '').toLowerCase() !== 'absent' : true,
        has_permission: hasPermission,
        is_shift_leader: false,
        base_points: 0,
        repeat_count: 0,
        multiplier: 1,
        assigned_points: 0,
        notes: null,
      } satisfies ShiftMemberDraft;
    })
    .filter(Boolean) as ShiftMemberDraft[];

  return {
    members,
    hasEnoughData: branchSchedules.length > 0,
    message: branchSchedules.length
      ? 'تم تحديد أعضاء الشيفت من جدول الفرع واليوم فقط مع مراعاة الإجازات والحضور.'
      : 'لا توجد بيانات جدول كافية لهذا الفرع واليوم، يمكنك اختيار الأعضاء يدويًا.',
  };
}
