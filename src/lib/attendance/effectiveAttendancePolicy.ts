export type ShiftExpectation = {
  start: string | null;
  end: string | null;
  source: 'base_schedule' | 'approved_time_off' | 'approved_exception' | 'pending_time_off' | 'manual';
  sourceId?: string | null;
  label?: string | null;
  reason?: string | null;
  protectedFromPenalty?: boolean;
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

export type EffectivePolicyResult = {
  base: ShiftExpectation;
  effective: ShiftExpectation;
  pendingReview: boolean;
  rules: string[];
};

const APPROVED = new Set(['approved', 'accepted', 'معتمد', 'مقبول']);
const PENDING = new Set(['pending', 'pending_review', 'قيد المراجعة', 'انتظار المراجعة']);

function normalizeStatus(value?: string | null) {
  return String(value || '').trim().toLowerCase();
}

function normalizeTime(value?: string | null) {
  if (!value) return null;
  const match = String(value).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function appliesToDate(date: string, req: Pick<TimeOffRequest, 'start_date' | 'end_date'>) {
  return date >= req.start_date && date <= req.end_date;
}

export function resolveEffectiveAttendancePolicy(args: {
  date: string;
  baseStart: string | null;
  baseEnd: string | null;
  timeOff?: TimeOffRequest[];
  exceptions?: ShiftException[];
}): EffectivePolicyResult {
  const base: ShiftExpectation = {
    start: normalizeTime(args.baseStart),
    end: normalizeTime(args.baseEnd),
    source: 'base_schedule',
    protectedFromPenalty: false,
  };

  let effective: ShiftExpectation = { ...base };
  let pendingReview = false;
  const rules: string[] = ['تم تحميل الجدول الأساسي'];

  const approvedExceptions = (args.exceptions || []).filter((x) => x.date === args.date && APPROVED.has(normalizeStatus(x.status)));
  for (const ex of approvedExceptions) {
    const start = normalizeTime(ex.start_time) ?? effective.start;
    const end = normalizeTime(ex.end_time) ?? effective.end;
    effective = {
      start,
      end,
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
    const kind = String(req.request_kind || '').toLowerCase();
    const label = req.request_label || req.request_kind || 'إذن معتمد';
    const start = normalizeTime(req.start_time);
    const end = normalizeTime(req.end_time);

    if (kind.includes('leave') || kind.includes('vacation') || kind.includes('absence') || label.includes('إجاز')) {
      effective = {
        start: null,
        end: null,
        source: 'approved_time_off',
        sourceId: req.id,
        label,
        reason: req.reason,
        protectedFromPenalty: true,
      };
      rules.push(`إجازة/غياب معتمد يلغي توقع الحضور لهذا اليوم`);
      continue;
    }

    if (start && !end) {
      effective = { ...effective, start, source: 'approved_time_off', sourceId: req.id, label, reason: req.reason, protectedFromPenalty: false };
      rules.push(`تم تعديل موعد بداية الشيفت إلى ${start} بسبب إذن معتمد`);
    } else if (!start && end) {
      effective = { ...effective, end, source: 'approved_time_off', sourceId: req.id, label, reason: req.reason, protectedFromPenalty: false };
      rules.push(`تم تعديل موعد نهاية الشيفت إلى ${end} بسبب إذن معتمد`);
    } else if (start && end) {
      // For partial-day permission, treat the permission window as protected rather than replacing the whole shift.
      effective = { ...effective, source: 'approved_time_off', sourceId: req.id, label, reason: req.reason, protectedFromPenalty: true };
      rules.push(`يوجد إذن معتمد من ${start} إلى ${end}؛ الفارق داخل نافذة الإذن لا يتحول لجزاء`);
    }
  }

  const pending = sameDayRequests.filter((x) => PENDING.has(normalizeStatus(x.status)));
  if (pending.length) {
    pendingReview = true;
    effective = { ...effective, protectedFromPenalty: true };
    rules.push('يوجد إذن قيد المراجعة؛ يتم تعليق أي جزاء نهائي لحين القرار');
  }

  return { base, effective, pendingReview, rules };
}

export function minutesBetween(actual: string | null, expected: string | null) {
  if (!actual || !expected) return null;
  const toMinutes = (value: string) => {
    const [h, m] = value.slice(0, 5).split(':').map(Number);
    return h * 60 + m;
  };
  return toMinutes(actual) - toMinutes(expected);
}
