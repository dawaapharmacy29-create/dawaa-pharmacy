/**
 * dateCycle.ts — Pharmacy billing cycle utilities
 * Cycles run from the 26th of each month to the 25th of the next.
 */

export interface PharmacyCycle {
  start: Date;
  end: Date;
  label: string;
}

/**
 * Returns the cycle that starts on or before the given date.
 * Cycle starts on the 26th of each month.
 */
export function getCycleForDate(date: Date): PharmacyCycle {
  const d = new Date(date);
  const day = d.getDate();
  let cycleStartYear = d.getFullYear();
  let cycleStartMonth = d.getMonth();

  if (day < 26) {
    // We are in the cycle that started the previous month
    cycleStartMonth -= 1;
    if (cycleStartMonth < 0) {
      cycleStartMonth = 11;
      cycleStartYear -= 1;
    }
  }

  const start = new Date(cycleStartYear, cycleStartMonth, 26, 0, 0, 0, 0);
  const end = new Date(cycleStartYear, cycleStartMonth + 1, 25, 23, 59, 59, 999);

  return { start, end, label: formatCycleLabel(start) };
}

/**
 * Returns the current active pharmacy cycle (based on today's date).
 */
export function getCurrentCycle(): PharmacyCycle {
  return getCycleForDate(new Date());
}

/**
 * Returns the cycle that started on or after the given 'from' date.
 * Used when you know the cycle start date explicitly.
 */
export function getCurrentCycleFrom26(fromDate?: Date): PharmacyCycle {
  return getCycleForDate(fromDate ?? new Date());
}

/**
 * Returns the start and end Date objects for a cycle.
 */
export function getCycleStartEnd(cycle: PharmacyCycle): { start: Date; end: Date } {
  return { start: cycle.start, end: cycle.end };
}

/**
 * Returns whether a given date falls within a cycle.
 */
export function isDateInCycle(date: Date, cycle: PharmacyCycle): boolean {
  return date >= cycle.start && date <= cycle.end;
}

/**
 * Formats a date in Egypt locale (Arabic numerals, Arabic month names).
 */
export function formatEgyptDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ar-EG", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Formats a date in a short format (DD/MM/YYYY).
 */
export function formatShortDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ar-EG", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function formatCycleLabel(start: Date): string {
  return start.toLocaleDateString("ar-EG", { month: "long", year: "numeric" });
}

/**
 * Returns the date one day after the given date (for exclusive end-date filters).
 */
export function nextDay(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Returns an ISO string for the start of a day (00:00:00).
 */
export function startOfDayISO(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Returns an ISO string for the exclusive end of a day (next day 00:00:00).
 */
export function exclusiveEndOfDayISO(date: Date): string {
  return nextDay(date).toISOString();
}
