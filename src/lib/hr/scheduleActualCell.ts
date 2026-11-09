export type ScheduleActualDay = {
  staff_id: string;
  date: string;
  has_summary: boolean;
  first_in: string | null;
  last_out: string | null;
  status: string | null;
  resolution_status: string | null;
  time_off_kind: string | null;
};

export type SchedulePlanDay = {
  shift_start?: string | null;
  shift_end?: string | null;
  is_off?: boolean | null;
  is_day_off?: boolean | null;
  source_kind?: string | null;
} | null;

export type ScheduleCellKind =
  | 'leave'
  | 'off'
  | 'worked_on_off'
  | 'checkout_only_on_off'
  | 'present'
  | 'missing_punch'
  | 'no_punch'
  | 'no_data'
  | 'planned'
  | 'unscheduled';

export type ScheduleCell = {
  kind: ScheduleCellKind;
  label: string;
  plan: string | null;
  actualIn: string | null;
  actualOut: string | null;
  changedByDate: boolean;
};

const LEAVE_LABELS: Record<string, string> = {
  annual_leave: 'إجازة سنوية',
  sick_leave: 'إجازة مرضية',
  exceptional_leave: 'إجازة استثنائية',
  approved_absence: 'غياب معتمد',
};

const cairoTimeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Cairo',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function cairoClock(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : cairoTimeFormat.format(date);
}

function shortTime(value: string | null | undefined): string {
  return value ? value.slice(0, 5) : '-';
}

/**
 * The published plan says what should happen; the attendance day says what did.
 * A failed attendance read must leave the plan visible and must never read as absence.
 */
export function resolveScheduleCell(input: {
  date: string;
  today: string;
  plan: SchedulePlanDay;
  actual: ScheduleActualDay | null;
  actualsAvailable: boolean;
}): ScheduleCell {
  const { date, today, plan, actual, actualsAvailable } = input;
  const planIsOff = plan?.is_off === true || plan?.is_day_off === true;
  const planText = plan && !planIsOff && plan.shift_start && plan.shift_end
    ? `${shortTime(plan.shift_start)} - ${shortTime(plan.shift_end)}`
    : null;
  const actualIn = cairoClock(actual?.first_in);
  const actualOut = cairoClock(actual?.last_out);
  const base = {
    plan: planText,
    actualIn,
    actualOut,
    changedByDate: plan?.source_kind === 'date_override',
  };
  const leaveKind = actual?.time_off_kind || null;

  if (leaveKind || planIsOff) {
    const offLabel = leaveKind ? LEAVE_LABELS[leaveKind] || 'إجازة' : 'راحة';
    if (actualIn) return { ...base, kind: 'worked_on_off', label: leaveKind ? 'حضر رغم الإجازة' : 'حضر في يوم راحته' };
    // A lone check-out on an off day is usually the tail of the previous night's shift.
    if (actualOut) return { ...base, kind: 'checkout_only_on_off', label: offLabel };
    return { ...base, kind: leaveKind ? 'leave' : 'off', label: offLabel };
  }

  if (actualIn && actualOut) return { ...base, kind: 'present', label: 'حضر' };
  if (actualIn || actualOut) return { ...base, kind: 'missing_punch', label: 'بصمة ناقصة' };
  if (!plan) return { ...base, kind: 'unscheduled', label: 'غير محدد' };
  if (!actualsAvailable || date >= today) return { ...base, kind: 'planned', label: 'مخطط' };
  if (!actual?.has_summary) return { ...base, kind: 'no_data', label: 'لا توجد بيانات' };
  if (String(actual.resolution_status || '').startsWith('flexible')) return { ...base, kind: 'planned', label: 'دوام مرن' };
  return { ...base, kind: 'no_punch', label: 'لم يبصم' };
}
