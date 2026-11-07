import { cairoDayOf, cairoWallTimeDate } from '@/lib/time/cairoDateBoundary';

// Each branch closes three shifts a day in the purchasing app. A shift is late two hours after its
// usual close (migration 20261101130000, shift_handover_due_v1 uses the same deadlines).

export const SHIFT_HANDOVER_BRANCHES = ['فرع شكري', 'فرع الشامي'] as const;
export const SHIFT_TYPES = ['ليلي', 'صباحي', 'مسائي'] as const;
/** Deadline in Cairo hours from the start of the shift's day (evening closes after midnight). */
export const SHIFT_DEADLINE_HOUR: Record<(typeof SHIFT_TYPES)[number], number> = {
  ليلي: 10,
  صباحي: 19,
  مسائي: 27,
};

export interface ShiftHandoverRow {
  id: string;
  branch: string;
  shift_type: string;
  shift_date: string;
  is_archived?: boolean | null;
}

export type ShiftSlotStatus = 'closed' | 'duplicate' | 'late' | 'pending';

export interface ShiftSlot<T extends ShiftHandoverRow> {
  day: string;
  branch: string;
  shift: (typeof SHIFT_TYPES)[number];
  dueAt: Date;
  rows: T[];
  status: ShiftSlotStatus;
}

export function shiftDeadline(day: string, shift: (typeof SHIFT_TYPES)[number]): Date {
  const [year, month, date] = day.split('-').map(Number);
  const hour = SHIFT_DEADLINE_HOUR[shift];
  return cairoWallTimeDate(year, month, date + Math.floor(hour / 24), hour % 24);
}

const addDays = (day: string, delta: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};

/**
 * Every branch × shift of the last `days` Cairo days (newest first), with its handovers. Archived
 * handovers do not count. A slot with no handover is late once its deadline passed, pending before.
 */
export function shiftCoverage<T extends ShiftHandoverRow>(
  rows: T[],
  days: number,
  now = new Date()
): ShiftSlot<T>[] {
  const today = cairoDayOf(now.toISOString()) as string;
  const live = rows.filter((row) => !row.is_archived);
  const slots: ShiftSlot<T>[] = [];
  for (let i = 0; i < days; i += 1) {
    const day = addDays(today, -i);
    for (const branch of SHIFT_HANDOVER_BRANCHES) {
      for (const shift of SHIFT_TYPES) {
        const own = live.filter(
          (row) => row.branch === branch && row.shift_date === day && row.shift_type === shift
        );
        const dueAt = shiftDeadline(day, shift);
        const status: ShiftSlotStatus =
          own.length > 1 ? 'duplicate' : own.length ? 'closed' : now >= dueAt ? 'late' : 'pending';
        slots.push({ day, branch, shift, dueAt, rows: own, status });
      }
    }
  }
  return slots;
}

/**
 * Someone on duty at a closing, from the fingerprints (shift_on_duty_doctors_v1, migration
 * 20261105220000): doctors, assistants and the branch manager. The schedule stands in only when nobody
 * punched, and only for staff still working here.
 */
export interface OnDutyDoctor {
  staff_id: string;
  name: string;
  role?: string | null;
  kind?: 'doctor' | 'assistant' | 'manager' | null;
  source: 'punch' | 'schedule';
}

/** "د أ، محمد (مساعد)" — assistants and schedule-only people are marked; nobody at all says so. */
export function onDutyLabel(doctors: OnDutyDoctor[] | null | undefined): string {
  if (!doctors) return '';
  if (!doctors.length) return 'مفيش بصمة ولا جدول';
  return doctors
    .map((d) => {
      const name = d.kind === 'assistant' ? `${d.name} (مساعد)` : d.name;
      return d.source === 'schedule' ? `${name} (جدول من غير بصمة)` : name;
    })
    .join('، ');
}

/** "د/ أحمد" and "د احمد" are one person: drop the title, unify alef/yaa/taa marbuta and spaces. */
export function personKey(name: string | null | undefined): string {
  return String(name ?? '')
    .replace(/^\s*(دكتوره|دكتور|د\.|د)\s*\/?\s*/u, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ـ/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Was the person who closed the shift fingerprinted in it? 'unknown' when there are no punches to
 * compare with (or the names are not loaded).
 */
export function closerOnShift(
  closer: { name?: string | null; staffId?: string | null },
  people: OnDutyDoctor[] | null | undefined
): 'yes' | 'no' | 'unknown' {
  const punched = (people ?? []).filter((p) => p.source === 'punch');
  if (!punched.length || !(closer.name || closer.staffId)) return 'unknown';
  const key = personKey(closer.name);
  const found = punched.some(
    (p) => (closer.staffId && p.staff_id === closer.staffId) || (key && personKey(p.name) === key)
  );
  return found ? 'yes' : 'no';
}

/** "صباحي التلات ٣/١١" — a shift with its day, so an older missing shift is never read as yesterday's. */
export function shiftWithDay(day: string, shift: string): string {
  const label = new Date(`${day}T12:00:00`).toLocaleDateString('ar-EG', {
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
  });
  return `${shift} ${label}`;
}

export interface ShiftHandoverCorrection {
  id: string;
  handover_id: string;
  changes: Record<string, unknown>;
  previous: Record<string, unknown>;
  reason: string;
  corrected_by_name: string | null;
  created_at: string;
}

/** The handover with its corrections applied in order (the latest value of a field wins). */
export function applyCorrections<T extends { id: string }>(
  row: T,
  corrections: ShiftHandoverCorrection[]
): T {
  return corrections
    .filter((c) => c.handover_id === row.id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .reduce((acc, c) => ({ ...acc, ...c.changes }), row);
}

// ---------------------------------------------------------------------------
// Reading a handover by when it was actually closed.
// ---------------------------------------------------------------------------

/** Between two closings: shorter than this is probably a double entry, longer probably hides a missing shift. */
export const SHIFT_GAP_SHORT_MINUTES = 4 * 60;
export const SHIFT_GAP_LONG_MINUTES = 12 * 60;

export interface ClosedHandoverRow extends ShiftHandoverRow {
  recorded_at: string | null;
}

export type ReadHandover<T extends ClosedHandoverRow> = T & {
  /** What the source app holds; shift_date and shift_type are what the closing time says. */
  source_date: string;
  source_type: string;
  reread: boolean;
  /** The closing before this one in the branch, and the minutes since it. */
  previous_close: string | null;
  gap_minutes: number | null;
  /** Entered this many days after its shift; such a row says nothing about the time between shifts. */
  entered_late_days: number;
};

const cairoHour = (iso: string) =>
  Number(
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Africa/Cairo' })
      .format(new Date(iso))
      .replace('24', '00')
  );

/**
 * The doctor picks the date and the shift in the source app, and an evening closed after midnight is
 * often saved on the new day. That shows as a false «ناقص» on one day and «×2» on the next.
 * An evening saved on the day it was closed is read as:
 *   before 13:00: the evening of the day before, or this morning's night shift if that evening is closed.
 *   13:00–20:00: this day's morning shift, if it is open.
 * Later than that it is a real evening. Nothing moves onto a closed shift, and no amount changes.
 */
export function readHandovers<T extends ClosedHandoverRow>(rows: T[]): ReadHandover<T>[] {
  const isCandidate = (row: T) => {
    if (row.shift_type !== 'مسائي' || !row.recorded_at) return false;
    return cairoDayOf(row.recorded_at) === row.shift_date && cairoHour(row.recorded_at) < 20;
  };
  const key = (branch: string, day: string, shift: string) => `${branch}|${day}|${shift}`;
  const taken = new Set(
    rows
      .filter((row) => !isCandidate(row))
      .map((row) => key(row.branch, row.shift_date, row.shift_type))
  );
  const place = new Map<string, { day: string; shift: string }>();
  const byClose = [...rows].sort((a, b) =>
    String(a.recorded_at ?? '').localeCompare(String(b.recorded_at ?? ''))
  );
  for (const row of byClose) {
    if (!isCandidate(row)) continue;
    const hour = cairoHour(row.recorded_at as string);
    const options =
      hour < 13
        ? [
            { day: addDays(row.shift_date, -1), shift: 'مسائي' },
            { day: row.shift_date, shift: 'ليلي' },
          ]
        : [{ day: row.shift_date, shift: 'صباحي' }];
    const open = options.find((o) => !taken.has(key(row.branch, o.day, o.shift)));
    const target = open ?? { day: row.shift_date, shift: row.shift_type };
    taken.add(key(row.branch, target.day, target.shift));
    place.set(row.id, target);
  }
  const lateDays = (row: T) => {
    const closed = row.recorded_at ? cairoDayOf(row.recorded_at) : null;
    if (!closed) return 0;
    const days = Math.round(
      (Date.parse(`${closed}T12:00:00Z`) - Date.parse(`${row.shift_date}T12:00:00Z`)) / 864e5
    );
    return days >= 2 ? days : 0;
  };
  const lastClose = new Map<string, string>();
  const gaps = new Map<string, { previous: string; minutes: number }>();
  for (const row of byClose) {
    if (!row.recorded_at || lateDays(row)) continue;
    const previous = lastClose.get(row.branch);
    if (previous)
      gaps.set(row.id, {
        previous,
        minutes: Math.round((Date.parse(row.recorded_at) - Date.parse(previous)) / 60000),
      });
    lastClose.set(row.branch, row.recorded_at);
  }
  return rows.map((row) => {
    const target = place.get(row.id);
    const shift_date = target?.day ?? row.shift_date;
    const shift_type = target?.shift ?? row.shift_type;
    const gap = gaps.get(row.id);
    return {
      ...row,
      shift_date,
      shift_type,
      source_date: row.shift_date,
      source_type: row.shift_type,
      reread: shift_date !== row.shift_date || shift_type !== row.shift_type,
      previous_close: gap?.previous ?? null,
      gap_minutes: gap?.minutes ?? null,
      entered_late_days: lateDays(row),
    };
  });
}

export function shiftGapLabel(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest}د`;
  return rest ? `${hours}س ${rest}د` : `${hours}س`;
}

export function shiftGapTone(minutes: number | null): 'normal' | 'short' | 'long' {
  if (minutes == null) return 'normal';
  if (minutes < SHIFT_GAP_SHORT_MINUTES) return 'short';
  return minutes > SHIFT_GAP_LONG_MINUTES ? 'long' : 'normal';
}

/** The missing shifts by branch, newest first, so the list reads as a table and not a paragraph. */
export function missingByBranch<T extends ShiftHandoverRow>(
  slots: ShiftSlot<T>[]
): { branch: string; slots: ShiftSlot<T>[] }[] {
  return SHIFT_HANDOVER_BRANCHES.map((branch) => ({
    branch,
    slots: slots
      .filter((slot) => slot.branch === branch && slot.status === 'late')
      .sort(
        (a, b) =>
          b.day.localeCompare(a.day) || SHIFT_TYPES.indexOf(b.shift) - SHIFT_TYPES.indexOf(a.shift)
      ),
  })).filter((group) => group.slots.length);
}
