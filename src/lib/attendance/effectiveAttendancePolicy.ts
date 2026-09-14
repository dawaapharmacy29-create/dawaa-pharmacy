export type ShiftExpectation = {
  start: string | null;
  end: string | null;
  source: 'base_schedule' | 'approved_time_off' | 'approved_exception' | 'approved_override' | 'pending_time_off' | 'manual';
  sourceId?: string | null;
  label?: string | null;
  reason?: string | null;
  protectedFromPenalty?: boolean;
};

export type ProtectedWindow = {
  start: string;
  end: string;
  sourceId: string;
  label: string;
  reason?: string | null;
  kind: 'permission' | 'mission' | 'break' | 'other';
};

export type TimeOffRequest = {
  id: string;
  request_kind: string | null;
  request_label: string | null;
  status: string | null;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number | null;
  reason: string | null;
  decided_by_name?: string | null;
};

export type ShiftException = {
  id: string;
  type: string | null;
  status: string | null;
  date: string;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
};

export type ScheduleOverride = {
  id: string;
  date: string;
  status: string | null;
  start_time: string | null;
  end_time: string | null;
  label?: string | null;
  reason?: string | null;
  swap_with_staff_id?: string | null;
};

export type EffectivePolicyResult = {
  base: ShiftExpectation;
  effective: ShiftExpectation;
  pendingReview: boolean;
  protectedWindows: ProtectedWindow[];
  isOvernightShift: boolean;
  rules: string[];
};

const APPROVED = new Set(['approved', 'accepted', 'معتمد', 'مقبول']);
const PENDING = new Set(['pending', 'pending_review', 'قيد المراجعة', 'انتظار المراجعة']);

function normalizeStatus(value?: string | null) {
  return String(value || '').trim().toLowerCase();
}

export function normalizeAttendanceTime(value?: string | null) {
  if (!value) return null;
  const match = String(value).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

export function attendanceMinutes(value?: string | null) {
  const normalized = normalizeAttendanceTime(value);
  if (!normalized) return null;
  const [h, m] = normalized.split(':').map(Number);
  return h * 60 + m;
}

function appliesToDate(date: string, req: Pick<TimeOffRequest, 'start_date' | 'end_date'>) {
  return date >= req.start_date && date <= req.end_date;
}

function isLeaveLike(req: TimeOffRequest) {
  const kind = String(req.request_kind || '').toLowerCase();
  const label = String(req.request_label || '').toLowerCase();
  return kind.includes('leave') || kind.includes('vacation') || kind.includes('absence') || label.includes('إجاز');
}

function protectedKind(req: TimeOffRequest): ProtectedWindow['kind'] {
  const value = `${req.request_kind || ''} ${req.request_label || ''}`.toLowerCase();
  if (value.includes('mission') || value.includes('مأمور')) return 'mission';
  if (value.includes('break') || value.includes('راحة')) return 'break';
  if (value.includes('permission') || value.includes('إذن') || value.includes('اذن')) return 'permission';
  return 'other';
}

export function isOvernightWindow(start?: string | null, end?: string | null) {
  const startMinutes = attendanceMinutes(start);
  const endMinutes = attendanceMinutes(end);
  return startMinutes != null && endMinutes != null && endMinutes <= startMinutes;
}

export function resolveEffectiveAttendancePolicy(args: {
  date: string;
  baseStart: string | null;
  baseEnd: string | null;
  timeOff?: TimeOffRequest[];
  exceptions?: ShiftException[];
  overrides?: ScheduleOverride[];
}): EffectivePolicyResult {
  const base: ShiftExpectation = {
    start: normalizeAttendanceTime(args.baseStart),
    end: normalizeAttendanceTime(args.baseEnd),
    source: 'base_schedule',
    protectedFromPenalty: false,
  };

  let effective: ShiftExpectation = { ...base };
  let pendingReview = false;
  const protectedWindows: ProtectedWindow[] = [];
  const rules: string[] = ['تم تحميل الجدول الأساسي'];

  const approvedOverrides = (args.overrides || []).filter((x) => x.date === args.date && APPROVED.has(normalizeStatus(x.status)));
  for (const override of approvedOverrides) {
    effective = {
      start: normalizeAttendanceTime(override.start_time) ?? effective.start,
      end: normalizeAttendanceTime(override.end_time) ?? effective.end,
      source: 'approved_override',
      sourceId: override.id,
      label: override.label || (override.swap_with_staff_id ? 'تبديل شيفت معتمد' : 'تعديل شيفت معتمد'),
      reason: override.reason,
      protectedFromPenalty: false,
    };
    rules.push(override.swap_with_staff_id ? 'تم تطبيق تبديل شيفت معتمد' : 'تم تطبيق تعديل شيفت معتمد');
  }

  const approvedExceptions = (args.exceptions || []).filter((x) => x.date === args.date && APPROVED.has(normalizeStatus(x.status)));
  for (const ex of approvedExceptions) {
    effective = {
      start: normalizeAttendanceTime(ex.start_time) ?? effective.start,
      end: normalizeAttendanceTime(ex.end_time) ?? effective.end,
      source: 'approved_exception',
      sourceId: ex.id,
      label: ex.type || 'استثناء شيفت',
      reason: ex.reason,
      protectedFromPenalty: false,
    };
    rules.push(`تم تطبيق استثناء شيفت معتمد${ex.type ? `: ${ex.type}` : ''}`);
  }

  const sameDayRequests = (args.timeOff || []).filter((x) => appliesToDate(args.date, x));
  const approved = sameDayRequests.filter((x) => APPROVED.has(normalizeStatus(x.status)));
  for (const req of approved) {
    const label = req.request_label || req.request_kind || 'إذن معتمد';
    const start = normalizeAttendanceTime(req.start_time);
    const end = normalizeAttendanceTime(req.end_time);

    if (isLeaveLike(req)) {
      effective = {
        start: null,
        end: null,
        source: 'approved_time_off',
        sourceId: req.id,
        label,
        reason: req.reason,
        protectedFromPenalty: true,
      };
      rules.push('إجازة/غياب معتمد يلغي توقع الحضور لهذا اليوم');
      continue;
    }

    if (start && !end) {
      effective = { ...effective, start, source: 'approved_time_off', sourceId: req.id, label, reason: req.reason };
      rules.push(`تم تعديل موعد بداية الشيفت إلى ${start} بسبب إذن معتمد`);
    } else if (!start && end) {
      effective = { ...effective, end, source: 'approved_time_off', sourceId: req.id, label, reason: req.reason };
      rules.push(`تم تعديل موعد نهاية الشيفت إلى ${end} بسبب إذن معتمد`);
    } else if (start && end) {
      protectedWindows.push({ start, end, sourceId: req.id, label, reason: req.reason, kind: protectedKind(req) });
      rules.push(`نافذة ${label} معتمدة من ${start} إلى ${end}؛ هذه الفترة لا تُحسب مخالفة`);
    } else {
      effective = { ...effective, protectedFromPenalty: true, source: 'approved_time_off', sourceId: req.id, label, reason: req.reason };
      rules.push(`يوجد ${label} معتمد بدون نافذة زمنية دقيقة؛ يمنع الجزاء الآلي ويحتاج تسوية بشرية`);
    }
  }

  const pending = sameDayRequests.filter((x) => PENDING.has(normalizeStatus(x.status)));
  if (pending.length) {
    pendingReview = true;
    effective = { ...effective, protectedFromPenalty: true, source: 'pending_time_off' };
    rules.push('يوجد إذن قيد المراجعة؛ يتم تعليق أي جزاء نهائي لحين القرار');
  }

  const isOvernightShift = isOvernightWindow(effective.start, effective.end);
  if (isOvernightShift) rules.push('الشيفت يعبر منتصف الليل؛ الخروج يُنسب لليوم التالي ولا يُعامل كبصمة يوم جديد');

  return { base, effective, pendingReview, protectedWindows, isOvernightShift, rules };
}

export function minutesBetween(actual: string | null, expected: string | null, overnightReference = false) {
  const actualMinutes = attendanceMinutes(actual);
  const expectedMinutes = attendanceMinutes(expected);
  if (actualMinutes == null || expectedMinutes == null) return null;
  let delta = actualMinutes - expectedMinutes;
  if (overnightReference && delta < -12 * 60) delta += 24 * 60;
  if (overnightReference && delta > 12 * 60) delta -= 24 * 60;
  return delta;
}

export function isMinuteInsideProtectedWindow(time: string | null, window: ProtectedWindow) {
  const value = attendanceMinutes(time);
  const start = attendanceMinutes(window.start);
  const end = attendanceMinutes(window.end);
  if (value == null || start == null || end == null) return false;
  if (end > start) return value >= start && value <= end;
  return value >= start || value <= end;
}
