// ============================
// PHARMACY MONTHLY CYCLE LOGIC
// Cycle: 26th of month → 25th of next month
// ============================

export interface PharmacyCycle {
  start: Date;
  end: Date;
  label: string;
  shortLabel: string;
}

export interface PointsCycleRange {
  cycle_start: string;
  cycle_end: string;
}

function isoDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatCycleDate(date: Date): string {
  return isoDateOnly(date);
}

export function getPointsCycle(date: Date | string = new Date()): PointsCycleRange {
  const baseDate = typeof date === 'string' ? new Date(`${date.slice(0, 10)}T12:00:00`) : date;
  const cycle = getCycleForDate(baseDate);
  return {
    cycle_start: isoDateOnly(cycle.start),
    cycle_end: isoDateOnly(cycle.end),
  };
}

/**
 * Get the current pharmacy cycle based on today's date
 */
export function getCurrentCycle(): PharmacyCycle {
  const today = new Date();
  return getCycleForDate(today);
}

/**
 * Get the pharmacy cycle that contains a given date
 */
export function getCycleForDate(date: Date): PharmacyCycle {
  const day = date.getDate();
  const month = date.getMonth(); // 0-indexed
  const year = date.getFullYear();

  let cycleStart: Date;
  let cycleEnd: Date;

  if (day >= 26) {
    // We're in the start of a new cycle
    cycleStart = new Date(year, month, 26);
    // End is 25th of next month
    const endMonth = month === 11 ? 0 : month + 1;
    const endYear = month === 11 ? year + 1 : year;
    cycleEnd = new Date(endYear, endMonth, 25, 23, 59, 59);
  } else {
    // We're in the second half of a cycle (1→25)
    // Cycle started on 26th of PREVIOUS month
    const startMonth = month === 0 ? 11 : month - 1;
    const startYear = month === 0 ? year - 1 : year;
    cycleStart = new Date(startYear, startMonth, 26);
    cycleEnd = new Date(year, month, 25, 23, 59, 59);
  }

  return {
    start: cycleStart,
    end: cycleEnd,
    label: formatCycleLabel(cycleStart, cycleEnd),
    shortLabel: formatShortCycleLabel(cycleStart, cycleEnd),
  };
}

/**
 * Get the previous pharmacy cycle
 */
export function getPreviousCycle(): PharmacyCycle {
  const current = getCurrentCycle();
  // Go back one day before the current cycle start
  const prevDate = new Date(current.start);
  prevDate.setDate(prevDate.getDate() - 1);
  return getCycleForDate(prevDate);
}

/**
 * Get the next pharmacy cycle
 */
export function getNextCycle(): PharmacyCycle {
  const current = getCurrentCycle();
  // Go forward one day after the current cycle end
  const nextDate = new Date(current.end);
  nextDate.setDate(nextDate.getDate() + 1);
  return getCycleForDate(nextDate);
}

/**
 * Check if a date falls within a given cycle
 */
export function isDateInCycle(date: Date, cycle: PharmacyCycle): boolean {
  return date >= cycle.start && date <= cycle.end;
}

/**
 * Get cycle progress percentage (0-100)
 */
export function getCycleProgress(cycle?: PharmacyCycle): number {
  const c = cycle || getCurrentCycle();
  const now = new Date();
  const total = c.end.getTime() - c.start.getTime();
  const elapsed = now.getTime() - c.start.getTime();
  return Math.min(100, Math.max(0, (elapsed / total) * 100));
}

/**
 * Get remaining days in current cycle
 */
export function getRemainingDays(cycle?: PharmacyCycle): number {
  const c = cycle || getCurrentCycle();
  const now = new Date();
  const diff = c.end.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

/**
 * Get all cycles between two dates
 */
export function getCyclesBetween(from: Date, to: Date): PharmacyCycle[] {
  const cycles: PharmacyCycle[] = [];
  let current = getCycleForDate(from);

  while (current.start <= to) {
    cycles.push(current);
    const next = getNextCycleFrom(current);
    if (next.start.getTime() === current.start.getTime()) break;
    current = next;
  }

  return cycles;
}

function getNextCycleFrom(cycle: PharmacyCycle): PharmacyCycle {
  const nextDate = new Date(cycle.end);
  nextDate.setDate(nextDate.getDate() + 1);
  return getCycleForDate(nextDate);
}

const ARABIC_MONTHS = [
  'يناير',
  'فبراير',
  'مارس',
  'إبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];

function formatCycleLabel(start: Date, end: Date): string {
  const startDay = start.getDate();
  const startMonth = [
    'يناير',
    'فبراير',
    'مارس',
    'أبريل',
    'مايو',
    'يونيو',
    'يوليو',
    'أغسطس',
    'سبتمبر',
    'أكتوبر',
    'نوفمبر',
    'ديسمبر',
  ][start.getMonth()];
  const endDay = end.getDate();
  const endMonth = [
    'يناير',
    'فبراير',
    'مارس',
    'أبريل',
    'مايو',
    'يونيو',
    'يوليو',
    'أغسطس',
    'سبتمبر',
    'أكتوبر',
    'نوفمبر',
    'ديسمبر',
  ][end.getMonth()];
  const year = end.getFullYear();
  return `${startDay} ${startMonth} — ${endDay} ${endMonth} ${year}`;
}

function formatShortCycleLabel(start: Date, end: Date): string {
  const startMonth = [
    'يناير',
    'فبراير',
    'مارس',
    'أبريل',
    'مايو',
    'يونيو',
    'يوليو',
    'أغسطس',
    'سبتمبر',
    'أكتوبر',
    'نوفمبر',
    'ديسمبر',
  ][start.getMonth()];
  const endMonth = [
    'يناير',
    'فبراير',
    'مارس',
    'أبريل',
    'مايو',
    'يونيو',
    'يوليو',
    'أغسطس',
    'سبتمبر',
    'أكتوبر',
    'نوفمبر',
    'ديسمبر',
  ][end.getMonth()];
  if (start.getMonth() === end.getMonth()) {
    return `${startMonth} ${end.getFullYear()}`;
  }
  return `${startMonth}/${endMonth} ${end.getFullYear()}`;
}

/**
 * Filter an array of records by current pharmacy cycle
 * @param records - array with a date field
 * @param dateField - the key of the date field
 */
export function filterByCycle<T extends Record<string, unknown>>(
  records: T[],
  dateField: keyof T,
  cycle?: PharmacyCycle
): T[] {
  const c = cycle || getCurrentCycle();
  return records.filter((record) => {
    const date = new Date(record[dateField] as string);
    return isDateInCycle(date, c);
  });
}

/**
 * Format date in Arabic
 */
export function formatArabicDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Format time in Arabic
 */
export function formatArabicTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString('ar-EG', {
    hour: '2-digit',
    minute: '2-digit',
  });
}
