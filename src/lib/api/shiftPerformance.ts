import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { getCycleForDate } from '@/lib/pharmacy-cycle';
import { applyStaffDelta, persistPointsTransaction } from '@/lib/pointsPersistence';
import { mergeStaffChoices, type StaffChoice } from '@/lib/staffFallback';
import { TABLES } from '@/lib/supabaseTables';
import {
  normalizeBranchName,
  shiftDeductionRule,
  timeRangesOverlap,
  type NegligenceStatus,
  type ShiftActionMode,
  type ShiftMemberDraft,
  type ShiftReviewStatus,
  type ShiftType,
  type WorkloadPressure,
} from '@/lib/shiftPerformance';

export interface ShiftMembersResult {
  members: ShiftMemberDraft[];
  hasEnoughData: boolean;
  message: string;
}

export interface SaveShiftReviewInput {
  review_date: string;
  branch_id?: string | null;
  branch_name: string;
  shift_type: ShiftType;
  shift_start: string;
  shift_end: string;
  issue_category: string;
  issue_description: string;
  workload_pressure: WorkloadPressure;
  workload_pressure_notes?: string | null;
  negligence_suspected: NegligenceStatus;
  severity: 'low' | 'medium' | 'high' | 'critical';
  action_mode: ShiftActionMode;
  status: ShiftReviewStatus;
  reviewed_by?: string | null;
  reviewed_by_name?: string | null;
  approved_by?: string | null;
  approved_by_name?: string | null;
  evidence?: string | null;
  notes?: string | null;
  members: ShiftMemberDraft[];
}

function isMissingRelation(message: string) {
  return /does not exist|schema cache|relation .* does not exist/i.test(message);
}

function missingColumn(message: string) {
  return message.match(/'([^']+)' column/)?.[1] || message.match(/column "([^"]+)"/)?.[1] || '';
}

async function insertOneWithColumnFallback(table: string, payload: Record<string, unknown>) {
  const next = { ...payload };
  const removed = new Set<string>();

  for (let attempt = 0; attempt < 12; attempt++) {
    const { data, error } = await supabase.from(table).insert(next).select('id').single();
    if (!error) return { id: data?.id as string | undefined, error: null as string | null };
    if (isMissingRelation(error.message)) return { id: undefined, error: error.message };
    const column = missingColumn(error.message);
    if (!column || removed.has(column)) return { id: undefined, error: error.message };
    removed.add(column);
    delete next[column];
  }

  return { id: undefined, error: `تعذر حفظ السجل في جدول ${table}.` };
}

async function insertManyWithColumnFallback(table: string, payloads: Record<string, unknown>[]) {
  if (!payloads.length) return { error: null as string | null };
  let next = payloads.map((payload) => ({ ...payload }));
  const removed = new Set<string>();

  for (let attempt = 0; attempt < 12; attempt++) {
    const { error } = await supabase.from(table).insert(next);
    if (!error) return { error: null };
    if (isMissingRelation(error.message)) return { error: error.message };
    const column = missingColumn(error.message);
    if (!column || removed.has(column)) return { error: error.message };
    removed.add(column);
    next = next.map((payload) => {
      const copy = { ...payload };
      delete copy[column];
      return copy;
    });
  }

  return { error: `تعذر حفظ التفاصيل في جدول ${table}.` };
}

function arabicDayName(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('ar-EG', { weekday: 'long' });
}

function rowName(row: Record<string, unknown>) {
  return String(row.staff_name || row.employee_name || row.name || '');
}

function rowStaffId(row: Record<string, unknown>) {
  return String(row.staff_id || row.employee_id || row.id || '');
}

function coversDate(row: Record<string, unknown>, date: string) {
  const from = String(row.date || row.exception_date || row.day_date || '');
  const to = String(row.date_end || row.end_date || from || '');
  if (!from) return false;
  return date >= from.slice(0, 10) && date <= to.slice(0, 10);
}

async function safeSelect(table: string, select = '*', limit = 500) {
  const { data, error } = await supabase.from(table).select(select).limit(limit);
  if (error) {
    if (isMissingRelation(error.message)) return [] as Record<string, unknown>[];
    throw error;
  }
  return (data || []) as unknown as Record<string, unknown>[];
}

function staffChoiceInput(row: Record<string, unknown>) {
  return {
    id: String(row.id || row.staff_id || row.employee_id || ''),
    name: String(row.name || row.staff_name || row.employee_name || ''),
    role: String(row.role || row.staff_role || ''),
    branch: String(row.branch || row.branch_name || ''),
    points: typeof row.points === 'number' ? row.points : null,
    max_points: typeof row.max_points === 'number' ? row.max_points : null,
  };
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
    safeSelect('staff', '*'),
    safeSelect('shift_schedules', '*'),
    safeSelect('shift_exceptions', '*'),
    safeSelect('attendance', '*'),
  ]);

  const staffChoices = mergeStaffChoices(
    staffRows.map(staffChoiceInput).filter((staff) => staff.id && staff.name && staff.branch)
  ).filter((staff) => normalizeBranchName(staff.branch) === branch);
  const branchSchedules = scheduleRows.filter((row) => {
    const rowBranch = normalizeBranchName(String(row.branch || row.branch_name || ''));
    const rowDay = String(row.day_name || row.day || '');
    const isOff =
      Boolean(row.is_off) || String(row.shift_start || row.shift || '').includes('إجازة');
    return rowBranch === branch && rowDay === day && !isOff;
  });

  const scheduledNames = new Set(branchSchedules.map(rowName).filter(Boolean));
  const candidates = branchSchedules.length
    ? staffChoices.filter((staff) => scheduledNames.has(staff.name))
    : staffChoices;

  const activeExceptions = exceptionRows.filter((row) => {
    const name = rowName(row);
    const rowBranch = normalizeBranchName(String(row.branch || row.branch_name || ''));
    const status = String(row.status || '').toLowerCase();
    return (
      candidates.some((staff) => staff.name === name) &&
      (!rowBranch || rowBranch === branch) &&
      coversDate(row, params.date) &&
      status === 'approved'
    );
  });

  const attendanceForDate = attendanceRows.filter((row) => {
    const date = String(row.date || row.attendance_date || row.created_at || '').slice(0, 10);
    const rowBranch = normalizeBranchName(String(row.branch || row.branch_name || ''));
    return date === params.date && (!rowBranch || rowBranch === branch);
  });

  const members = candidates
    .map((staff) => {
      const schedule = branchSchedules.find((row) => rowName(row) === staff.name);
      const scheduleStart = String(schedule?.shift_start || schedule?.start_time || '');
      const scheduleEnd = String(schedule?.shift_end || schedule?.end_time || '');
      const overlaps = schedule
        ? timeRangesOverlap(scheduleStart, scheduleEnd, params.shiftStart, params.shiftEnd)
        : true;
      if (!overlaps) return null;

      const exception = activeExceptions.find((row) => rowName(row) === staff.name);
      const exceptionType = String(exception?.type || '');
      const excluded = exceptionType.includes('إجازة') || exceptionType.includes('غياب');
      if (excluded) return null;

      const attendance = attendanceForDate.find(
        (row) => rowName(row) === staff.name || rowStaffId(row) === staff.id
      );
      const hasPermission =
        Boolean(exception) && (exceptionType.includes('إذن') || exceptionType.includes('تبديل'));

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

  const hasEnoughData = branchSchedules.length > 0;
  return {
    members,
    hasEnoughData,
    message: hasEnoughData
      ? 'تم تحديد أعضاء الشيفت من الجدول مع مراعاة الإجازات المعتمدة.'
      : 'لا توجد بيانات كافية لتحديد أعضاء الشيفت تلقائيًا، يمكنك اختيارهم يدويًا.',
  };
}

async function countPreviousLeaderRepeats(input: {
  staffId: string;
  staffName: string;
  ruleCode: string;
  cycleStart: string;
  cycleEnd: string;
}) {
  const { data, error } = await supabase
    .from(TABLES.employeeTransactions)
    .select('id,description,staff_id,source,created_at')
    .eq('staff_id', input.staffId)
    .eq('source', 'shift_review')
    .gte('created_at', `${input.cycleStart}T00:00:00`)
    .lte('created_at', `${input.cycleEnd}T23:59:59`)
    .limit(50);

  if (error) return 0;
  return (data || []).filter((row) =>
    String(row.description || '').includes(`__RULE__:${input.ruleCode}`)
  ).length;
}

async function logShiftReviewNotification(
  input: SaveShiftReviewInput,
  reviewId: string,
  message: string
) {
  await supabase.from('notifications').insert({
    title: 'تقييم أداء شيفت',
    message,
    type: 'shift_review',
    branch: input.branch_name,
    read: false,
    source_record_id: reviewId,
    created_at: new Date().toISOString(),
  } as Record<string, unknown>);
}

async function logShiftActivity(input: SaveShiftReviewInput, reviewId: string, details: string) {
  await supabase.from('activity_log').insert({
    user_id: input.reviewed_by || 'system',
    user_name: input.reviewed_by_name || 'النظام',
    action: 'تقييم شيفت',
    module: 'تقييم أداء الشيفتات',
    details,
    branch: input.branch_name,
    target_type: 'shift_performance_review',
    target_id: reviewId,
    created_at: new Date().toISOString(),
  } as Record<string, unknown>);
}

export async function saveShiftPerformanceReview(
  input: SaveShiftReviewInput
): Promise<{ id?: string; error: string | null }> {
  if (!isSupabaseConfigured) return { error: 'إعدادات Supabase غير موجودة.' };

  const cycle = getCycleForDate(new Date(`${input.review_date}T12:00:00`));
  const cycleStart = cycle.start.toISOString().slice(0, 10);
  const cycleEnd = cycle.end.toISOString().slice(0, 10);
  const rule = shiftDeductionRule(input.issue_category, input.severity);
  const now = new Date().toISOString();
  const totalPoints = input.members.reduce(
    (sum, member) => sum + Math.abs(Number(member.assigned_points || 0)),
    0
  );

  const reviewPayload = {
    review_date: input.review_date,
    branch_id: input.branch_id || null,
    branch_name: input.branch_name,
    shift_type: input.shift_type,
    shift_start: input.shift_start,
    shift_end: input.shift_end,
    issue_category: input.issue_category,
    issue_description: input.issue_description,
    workload_pressure: input.workload_pressure,
    workload_pressure_notes: input.workload_pressure_notes || null,
    negligence_suspected: input.negligence_suspected,
    severity: input.severity,
    action_mode: input.action_mode,
    status: input.status,
    reviewed_by: input.reviewed_by || null,
    reviewed_by_name: input.reviewed_by_name || null,
    approved_by:
      input.status === 'approved'
        ? input.approved_by || input.reviewed_by || null
        : input.approved_by || null,
    approved_by_name:
      input.status === 'approved'
        ? input.approved_by_name || input.reviewed_by_name || null
        : input.approved_by_name || null,
    approved_at: input.status === 'approved' ? now : null,
    evidence: input.evidence || null,
    notes: input.notes || null,
    total_points: totalPoints,
    cycle_start: cycleStart,
    cycle_end: cycleEnd,
    month_cycle: cycle.shortLabel,
    created_at: now,
    updated_at: now,
  };

  const review = await insertOneWithColumnFallback('shift_performance_reviews', reviewPayload);
  if (review.error || !review.id) {
    return {
      error:
        review.error || 'تعذر حفظ تقييم الشيفت. تأكد من تطبيق migration الخاص بتقييم الشيفتات.',
    };
  }

  const membersForStorage = input.members.map((member) => ({
    review_id: review.id,
    staff_id: member.staff_id,
    staff_name: member.staff_name,
    staff_role: member.staff_role,
    is_shift_leader: member.is_shift_leader,
    was_present: member.was_present,
    has_permission: member.has_permission,
    base_points: member.base_points,
    repeat_count: member.repeat_count,
    multiplier: member.multiplier,
    assigned_points: member.assigned_points,
    notes: member.notes || null,
    created_at: now,
  }));

  const membersInsert = await insertManyWithColumnFallback(
    'shift_performance_review_members',
    membersForStorage
  );
  if (membersInsert.error) return { id: review.id, error: membersInsert.error };

  const shouldCreateTransactions = input.status !== 'rejected';
  if (shouldCreateTransactions) {
    for (const member of input.members) {
      if (!member.assigned_points || member.assigned_points <= 0) continue;

      const isLeader = member.is_shift_leader;
      const previous = isLeader
        ? await countPreviousLeaderRepeats({
            staffId: member.staff_id,
            staffName: member.staff_name,
            ruleCode: rule.code,
            cycleStart,
            cycleEnd,
          })
        : 0;
      const multiplier = isLeader ? Math.min(4, 2 ** previous) : member.multiplier || 1;
      const finalPoints = isLeader
        ? Math.min(160, Math.round((member.base_points || 20) * multiplier))
        : member.assigned_points;
      const status = input.status === 'approved' ? 'approved' : 'pending';

      const result = await persistPointsTransaction({
        employeeId: member.staff_id,
        employeeName: member.staff_name,
        branch: input.branch_name,
        operation: 'deduction',
        rule,
        pointsToStore: finalPoints,
        basePoints: isLeader ? member.base_points || 20 : member.base_points || finalPoints,
        repeatCount: previous,
        multiplier,
        finalPoints,
        userNote: `${input.issue_description}\nالدليل/الملاحظات: ${input.evidence || input.notes || 'لا يوجد'}`,
        createdByName: input.reviewed_by_name || 'المدير',
        createdById: input.reviewed_by || 'system',
        createdByRole: 'مدير',
        status,
        cycle,
        sourceModule: 'shift_review',
        sourceRecordId: review.id,
        reasonLabel: `تقييم شيفت - ${rule.title}`,
      });

      if (result.error) return { id: review.id, error: result.error };

      const isFallback = member.staff_id.startsWith('fallback-');
      if (input.status === 'approved' && !isFallback && result.id) {
        await applyStaffDelta(
          member.staff_id,
          500,
          500,
          -Math.abs(finalPoints),
          member.staff_name,
          member.branch || input.branch_name
        );
      }
    }
  }

  const pressureMessage =
    input.workload_pressure === 'high' || input.workload_pressure === 'very_high'
      ? 'تم تسجيل ملاحظة تدريبية بدون خصم تلقائي بسبب ضغط الشغل.'
      : input.status === 'approved'
        ? 'تم اعتماد تقييم شيفت وربط الخصومات بسجل النقاط.'
        : 'تم إضافة تقييم شيفت يحتاج اعتماد.';

  await logShiftReviewNotification(input, review.id, pressureMessage).catch(() => undefined);
  await logShiftActivity(input, review.id, pressureMessage).catch(() => undefined);

  return { id: review.id, error: null };
}

export async function fetchShiftPerformanceStats() {
  if (!isSupabaseConfigured) return { reviews: [], error: 'إعدادات Supabase غير موجودة.' };
  const { data, error } = await supabase
    .from('shift_performance_reviews')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return { reviews: [], error: error.message };
  return { reviews: data || [], error: null };
}
