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

// ---------------------------------------------------------------------------
// Who was in a shift: only real punches, on that branch's device, during that shift's real window.
// ---------------------------------------------------------------------------

export interface PunchInterval {
  staff_id: string;
  name: string;
  kind: 'doctor' | 'assistant' | 'manager' | null;
  home_branch: string;
  /** The devices that saw it; empty for a manual punch, which counts on home_branch. */
  branches: string[];
  first_in: string | null;
  last_out: string | null;
  scheduled_end: string | null;
  /** Each device punch in the span with its branch, oldest first (migration 20261114120000). */
  punches?: { at: string; branch: string }[] | null;
}

export interface ShiftWindow {
  from: number;
  to: number;
}

export interface ShiftPresent {
  staff_id: string;
  name: string;
  kind: PunchInterval['kind'];
  first_in: string | null;
  last_out: string | null;
}

const HOUR = 3600000;
/** A window is clamped: a missing shift before it must not pull in two shifts, nor a double entry shrink it to nothing. */
const WINDOW_MIN_HOURS = 6;
const WINDOW_MAX_HOURS = 10;
const USUAL_SHIFT_HOURS = 8;
/** In the shift means at least this much of it: a handover overlap at the door does not count. */
const MIN_OVERLAP_MINUTES = 60;

export function handoverWindow(
  closedAt: string | null,
  previousClose: string | null
): ShiftWindow | null {
  const to = closedAt ? Date.parse(closedAt) : NaN;
  if (Number.isNaN(to)) return null;
  const previous = previousClose ? Date.parse(previousClose) : NaN;
  const span = Number.isNaN(previous) ? USUAL_SHIFT_HOURS * HOUR : to - previous;
  return {
    from: to - Math.min(Math.max(span, WINDOW_MIN_HOURS * HOUR), WINDOW_MAX_HOURS * HOUR),
    to,
  };
}

/** A shift nobody closed: its usual hours, ending two hours before its deadline. */
export function slotWindow(day: string, shift: (typeof SHIFT_TYPES)[number]): ShiftWindow {
  const to = shiftDeadline(day, shift).getTime() - 2 * HOUR;
  return { from: to - USUAL_SHIFT_HOURS * HOUR, to };
}

const seenAt = (interval: PunchInterval, branch: string) =>
  interval.branches.length ? interval.branches.includes(branch) : interval.home_branch === branch;

/** Start and end of a span. A missing checkout runs to the scheduled end, or 8 hours at most. */
function spanOf(interval: PunchInterval): { start: number; end: number } | null {
  const first = interval.first_in ? Date.parse(interval.first_in) : NaN;
  const last = interval.last_out ? Date.parse(interval.last_out) : NaN;
  if (Number.isNaN(first) && Number.isNaN(last)) return null;
  if (Number.isNaN(first)) return { start: last, end: last };
  if (!Number.isNaN(last)) return { start: first, end: last };
  const scheduled = interval.scheduled_end ? Date.parse(interval.scheduled_end) : NaN;
  const end =
    !Number.isNaN(scheduled) && scheduled > first ? scheduled : first + USUAL_SHIFT_HOURS * HOUR;
  return { start: first, end: Math.min(end, first + 12 * HOUR) };
}

const KIND_ORDER: Record<string, number> = { doctor: 0, assistant: 1, manager: 2 };

export function presenceIn(
  intervals: PunchInterval[],
  branch: string,
  window: ShiftWindow
): ShiftPresent[] {
  const best = new Map<string, { interval: PunchInterval; overlap: number }>();
  for (const interval of intervals) {
    if (!interval.kind || !seenAt(interval, branch)) continue;
    const span = spanOf(interval);
    if (!span) continue;
    const onePunch = span.start === span.end;
    const overlap = Math.min(span.end, window.to) - Math.max(span.start, window.from);
    const inside = onePunch
      ? span.start >= window.from && span.start <= window.to
      : overlap >= MIN_OVERLAP_MINUTES * 60000;
    if (!inside) continue;
    // Seen on both devices: count it where they were in the middle of the time they overlap the shift.
    const devices = new Set((interval.punches ?? []).map((p) => p.branch));
    if (devices.size > 1) {
      const middle = onePunch
        ? span.start
        : (Math.max(span.start, window.from) + Math.min(span.end, window.to)) / 2;
      if (branchAt(interval, middle) !== branch) continue;
    }
    const current = best.get(interval.staff_id);
    if (!current || overlap > current.overlap) best.set(interval.staff_id, { interval, overlap });
  }
  return [...best.values()]
    .map(({ interval }) => ({
      staff_id: interval.staff_id,
      name: interval.name,
      kind: interval.kind,
      first_in: interval.first_in,
      last_out: interval.last_out,
    }))
    .sort(
      (a, b) =>
        (KIND_ORDER[a.kind ?? ''] ?? 3) - (KIND_ORDER[b.kind ?? ''] ?? 3) ||
        String(a.first_in ?? a.last_out).localeCompare(String(b.first_in ?? b.last_out))
    );
}

const clockOf = (value: string) =>
  new Date(value).toLocaleTimeString('ar-EG', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Africa/Cairo',
  });

export function punchTimesLabel(person: Pick<ShiftPresent, 'first_in' | 'last_out'>): string {
  if (person.first_in && person.last_out)
    return `${clockOf(person.first_in)} ← ${clockOf(person.last_out)}`;
  if (person.first_in) return `دخل ${clockOf(person.first_in)} ومن غير انصراف`;
  return person.last_out ? `خرج ${clockOf(person.last_out)} ومن غير حضور` : '';
}

/** "د أ (9:02 ص ← 5:10 م)، محمد، مساعد (…)"; nobody says so, and never falls back on the schedule. */
export function presenceLabel(people: ShiftPresent[]): string {
  if (!people.length) return 'مفيش بصمة';
  return people
    .map((p) => `${p.name}${p.kind === 'assistant' ? '، مساعد' : ''} (${punchTimesLabel(p)})`)
    .join(' · ');
}

export type CloserPresence =
  | { status: 'here' | 'unknown' | 'no_punch' | 'other_branch' }
  | { status: 'other_time'; times: string };

/**
 * Was the person who closed it there when it closed? Around the close means from 3 hours before to an
 * hour after. 'unknown' only when there is nothing to tell who they are.
 */
export function closerPresence(
  closer: { name?: string | null; staffId?: string | null },
  intervals: PunchInterval[],
  branch: string,
  closedAt: string | null
): CloserPresence {
  const at = closedAt ? Date.parse(closedAt) : NaN;
  if (Number.isNaN(at) || !(closer.name || closer.staffId)) return { status: 'unknown' };
  const key = personKey(closer.name);
  const own = intervals.filter(
    (i) => (closer.staffId && i.staff_id === closer.staffId) || (key && personKey(i.name) === key)
  );
  if (!own.length && !closer.staffId) return { status: 'unknown' };
  const near = own
    .map((interval) => ({ interval, span: spanOf(interval) }))
    .filter(
      (x): x is { interval: PunchInterval; span: { start: number; end: number } } =>
        Boolean(x.span) &&
        (x.span as { start: number }).start <= at + 12 * HOUR &&
        (x.span as { end: number }).end >= at - 16 * HOUR
    );
  if (!near.length) return { status: 'no_punch' };
  // A lone departure means they were there before it, as long as a usual shift.
  const around = near.filter(
    ({ interval, span }) =>
      (interval.first_in ? span.start : span.end - USUAL_SHIFT_HOURS * HOUR) <= at + HOUR &&
      span.end >= at - 3 * HOUR
  );
  if (
    around.some(({ interval }) =>
      (interval.punches ?? []).length ? branchAt(interval, at) === branch : seenAt(interval, branch)
    )
  )
    return { status: 'here' };
  if (around.length) return { status: 'other_branch' };
  return { status: 'other_time', times: punchTimesLabel(near[0].interval) };
}

export function closerPresenceText(presence: CloserPresence): string | null {
  if (presence.status === 'no_punch') return 'اللي قفل مالوش بصمة اليوم ده';
  if (presence.status === 'other_branch') return 'اللي قفل بصمته في فرع تاني وقت التقفيل';
  if (presence.status === 'other_time') return `اللي قفل بصم في وقت تاني: ${presence.times}`;
  return null;
}

// ---------------------------------------------------------------------------
// Who was there at the handover: the doctor answerable for closing the shift (owner, 2026-11-14:
// a forgotten handover is deducted from whoever was on duty when it was due).
// ---------------------------------------------------------------------------

/** When a shift is normally handed over: an hour and a half before it counts as missing. */
export function handoverMoment(day: string, shift: (typeof SHIFT_TYPES)[number]): Date {
  return new Date(shiftDeadline(day, shift).getTime() - 1.5 * HOUR);
}

/**
 * The branch someone was at, at a moment: the device of their last punch by then (or their first
 * punch, if the moment is before it). Without per-punch devices, a span seen on one device is that
 * branch, and one seen on both counts on their own branch.
 */
export function branchAt(interval: PunchInterval, at: number): string {
  const punches = (interval.punches ?? []).filter(
    (p) => p.branch && !Number.isNaN(Date.parse(p.at))
  );
  if (punches.length) {
    const before = punches.filter((p) => Date.parse(p.at) <= at);
    return (before.length ? before[before.length - 1] : punches[0]).branch;
  }
  if (interval.branches.length === 1) return interval.branches[0];
  return interval.home_branch;
}

/**
 * Worked at least this much of the usual shift before the handover: the night doctor who comes in at
 * 11:30 pm is there when the evening is handed over at 1:30 am, but did not work the evening.
 */
const WORKED_SHIFT_MINUTES = 3 * 60;
/** …and still there at the handover, or left at most this long before it. */
const LEFT_BEFORE_MINUTES = 60;

/** Everyone who worked the shift and was still in the branch at its handover, by real punches only. */
export function onDutyAt(
  intervals: PunchInterval[],
  branch: string,
  at: Date | string
): ShiftPresent[] {
  const moment = typeof at === 'string' ? Date.parse(at) : at.getTime();
  if (Number.isNaN(moment)) return [];
  const found = new Map<string, ShiftPresent & { start: number }>();
  for (const interval of intervals) {
    if (!interval.kind) continue;
    const span = spanOf(interval);
    if (!span) continue;
    // A lone departure means they were there before it, as long as a usual shift.
    const start = interval.first_in ? span.start : span.end - USUAL_SHIFT_HOURS * HOUR;
    const worked = Math.min(span.end, moment) - Math.max(start, moment - USUAL_SHIFT_HOURS * HOUR);
    if (worked < WORKED_SHIFT_MINUTES * 60000) continue;
    if (span.end < moment - LEFT_BEFORE_MINUTES * 60000) continue;
    if (branchAt(interval, moment) !== branch) continue;
    if (found.has(interval.staff_id)) continue;
    found.set(interval.staff_id, {
      staff_id: interval.staff_id,
      name: interval.name,
      kind: interval.kind,
      first_in: interval.first_in,
      last_out: interval.last_out,
      start,
    });
  }
  return [...found.values()]
    .sort(
      (a, b) =>
        (KIND_ORDER[a.kind ?? ''] ?? 3) - (KIND_ORDER[b.kind ?? ''] ?? 3) || a.start - b.start
    )
    .map(({ start: _start, ...person }) => person);
}

export interface ShiftResponsible {
  /** The doctors (pharmacists and branch managers) there at the handover; assistants only when no doctor was. */
  people: ShiftPresent[];
  basis: 'doctor' | 'assistant' | 'none';
  /** Everyone there, doctors first. */
  everyone: ShiftPresent[];
  at: Date;
}

export function shiftResponsible(
  intervals: PunchInterval[],
  branch: string,
  at: Date | string
): ShiftResponsible {
  const moment = typeof at === 'string' ? new Date(at) : at;
  const everyone = onDutyAt(intervals, branch, moment);
  const doctors = everyone.filter((p) => p.kind === 'doctor' || p.kind === 'manager');
  if (doctors.length) return { people: doctors, basis: 'doctor', everyone, at: moment };
  const assistants = everyone.filter((p) => p.kind === 'assistant');
  return {
    people: assistants,
    basis: assistants.length ? 'assistant' : 'none',
    everyone,
    at: moment,
  };
}

/** "د أ، د ب" — or what there is to say when nobody punched. */
export function responsibleNames(responsible: ShiftResponsible): string {
  if (!responsible.people.length) return 'مفيش دكتور بصم';
  return responsible.people
    .map((p) => (p.kind === 'assistant' ? `${p.name} (مساعد)` : p.name))
    .join('، ');
}
