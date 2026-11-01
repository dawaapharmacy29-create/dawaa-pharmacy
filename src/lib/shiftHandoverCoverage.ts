import { cairoDayOf, cairoWallTimeDate } from '@/lib/time/cairoDateBoundary';

// Each branch closes three shifts a day in the purchasing app. A shift is late two hours after its
// usual close (migration 20261101130000, shift_handover_due_v1 uses the same deadlines).

export const SHIFT_HANDOVER_BRANCHES = ['فرع شكري', 'فرع الشامي'] as const;
export const SHIFT_TYPES = ['ليلي', 'صباحي', 'مسائي'] as const;
/** Deadline in Cairo hours from the start of the shift's day (evening closes after midnight). */
export const SHIFT_DEADLINE_HOUR: Record<(typeof SHIFT_TYPES)[number], number> = { 'ليلي': 10, 'صباحي': 19, 'مسائي': 27 };

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
export function shiftCoverage<T extends ShiftHandoverRow>(rows: T[], days: number, now = new Date()): ShiftSlot<T>[] {
  const today = cairoDayOf(now.toISOString()) as string;
  const live = rows.filter((row) => !row.is_archived);
  const slots: ShiftSlot<T>[] = [];
  for (let i = 0; i < days; i += 1) {
    const day = addDays(today, -i);
    for (const branch of SHIFT_HANDOVER_BRANCHES) {
      for (const shift of SHIFT_TYPES) {
        const own = live.filter((row) => row.branch === branch && row.shift_date === day && row.shift_type === shift);
        const dueAt = shiftDeadline(day, shift);
        const status: ShiftSlotStatus = own.length > 1 ? 'duplicate' : own.length ? 'closed' : now >= dueAt ? 'late' : 'pending';
        slots.push({ day, branch, shift, dueAt, rows: own, status });
      }
    }
  }
  return slots;
}

/** A doctor on duty at a closing (migration 20261101150000, shift_on_duty_doctors_v1). */
export interface OnDutyDoctor {
  staff_id: string;
  name: string;
  role?: string | null;
  source: 'punch' | 'schedule';
}

/** "د أ، د ب" — doctors known only from the schedule are marked; nobody at all says so. */
export function onDutyLabel(doctors: OnDutyDoctor[] | null | undefined): string {
  if (!doctors) return '';
  if (!doctors.length) return 'مفيش بصمة ولا جدول';
  return doctors.map((d) => (d.source === 'schedule' ? `${d.name} (جدول من غير بصمة)` : d.name)).join('، ');
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
export function applyCorrections<T extends { id: string }>(row: T, corrections: ShiftHandoverCorrection[]): T {
  return corrections
    .filter((c) => c.handover_id === row.id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .reduce((acc, c) => ({ ...acc, ...c.changes }), row);
}
