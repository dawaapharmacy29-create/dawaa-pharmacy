import { resolutionStatusTone } from '@/lib/attendance/attendanceBreakdownService';

export type PeriodMode = 'day' | 'week' | 'month';

function parseYmd(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return { year, month, day };
}

function ymdFromUtc(date: Date): string {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

export function cairoToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function addDays(date: string, days: number): string {
  const { year, month, day } = parseYmd(date);
  return ymdFromUtc(new Date(Date.UTC(year, month - 1, day + days)));
}

export function addMonths(date: string, months: number): string {
  const { year, month, day } = parseYmd(date);
  return ymdFromUtc(new Date(Date.UTC(year, month - 1 + months, day)));
}

export function startOfWeek(date: string): string {
  const { year, month, day } = parseYmd(date);
  const d = new Date(Date.UTC(year, month - 1, day));
  const dow = d.getUTCDay();
  const diff = (dow + 1) % 7;
  return addDays(date, -diff);
}

export function startOfMonth(date: string): string {
  const { year, month, day } = parseYmd(date);
  const startMonthOffset = day >= 26 ? 0 : -1;
  return ymdFromUtc(new Date(Date.UTC(year, month - 1 + startMonthOffset, 26)));
}

export function endOfMonth(date: string): string {
  const { year, month } = parseYmd(startOfMonth(date));
  return ymdFromUtc(new Date(Date.UTC(year, month, 25)));
}

export function computeRange(mode: PeriodMode, anchor: string): { start: string; end: string } {
  if (mode === 'day') return { start: anchor, end: anchor };
  if (mode === 'week') {
    const start = startOfWeek(anchor);
    return { start, end: addDays(start, 6) };
  }

  const start = startOfMonth(anchor);
  const cycleEnd = endOfMonth(anchor);
  const today = cairoToday();
  const end = start <= today && cycleEnd > today ? today : cycleEnd;
  return { start, end };
}

export function shiftAnchor(mode: PeriodMode, anchor: string, dir: 1 | -1): string {
  if (mode === 'day') return addDays(anchor, dir);
  if (mode === 'week') return addDays(anchor, dir * 7);
  return addMonths(anchor, dir);
}

export function rangeLabel(mode: PeriodMode, start: string, end: string): string {
  const fmt = (value: string) => {
    const { year, month, day } = parseYmd(value);
    return new Date(Date.UTC(year, month - 1, day, 12)).toLocaleDateString('ar-EG', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Africa/Cairo',
    });
  };
  if (mode === 'day') return fmt(start);
  return `${fmt(start)} — ${fmt(end)}`;
}

export function formatClock(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('ar-EG', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Cairo',
  });
}

export function toneClasses(tone: ReturnType<typeof resolutionStatusTone>): string {
  if (tone === 'success') return 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]';
  if (tone === 'warning') return 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]';
  if (tone === 'danger') return 'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] text-[var(--dawaa-status-danger-text)]';
  if (tone === 'info') return 'border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] text-[var(--dawaa-status-info-text)]';
  return 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-input)] text-[var(--dawaa-theme-muted)]';
}
