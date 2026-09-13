import { resolutionStatusTone } from '@/lib/attendance/attendanceBreakdownService';

export type PeriodMode = 'day' | 'week' | 'month';

export function cairoToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonths(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function startOfWeek(date: string): string {
  // Egyptian week starts Saturday
  const d = new Date(`${date}T00:00:00`);
  const dow = d.getDay(); // 0=Sunday..6=Saturday
  const diff = (dow + 1) % 7; // days since last Saturday
  return addDays(date, -diff);
}

export function startOfMonth(date: string): string {
  // Pharmacy pay cycle: 26th of a month through the 25th of the next.
  const d = new Date(`${date}T00:00:00`);
  const day = d.getDate();
  const cycleStartMonth = day >= 26 ? d.getMonth() : d.getMonth() - 1;
  const start = new Date(d.getFullYear(), cycleStartMonth, 26);
  return start.toISOString().slice(0, 10);
}

export function endOfMonth(date: string): string {
  const start = new Date(`${startOfMonth(date)}T00:00:00`);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 25);
  return end.toISOString().slice(0, 10);
}

export function computeRange(mode: PeriodMode, anchor: string): { start: string; end: string } {
  if (mode === 'day') return { start: anchor, end: anchor };
  if (mode === 'week') { const s = startOfWeek(anchor); return { start: s, end: addDays(s, 6) }; }
  return { start: startOfMonth(anchor), end: endOfMonth(anchor) };
}

export function shiftAnchor(mode: PeriodMode, anchor: string, dir: 1 | -1): string {
  if (mode === 'day') return addDays(anchor, dir);
  if (mode === 'week') return addDays(anchor, dir * 7);
  return addMonths(anchor, dir);
}

export function rangeLabel(mode: PeriodMode, start: string, end: string): string {
  const fmt = (v: string) => new Date(`${v}T00:00:00`).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' });
  if (mode === 'day') return fmt(start);
  return `${fmt(start)} — ${fmt(end)}`;
}

export function formatClock(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Cairo' });
}

export function toneClasses(tone: ReturnType<typeof resolutionStatusTone>): string {
  if (tone === 'success') return 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]';
  if (tone === 'warning') return 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]';
  if (tone === 'danger') return 'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] text-[var(--dawaa-status-danger-text)]';
  if (tone === 'info') return 'border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] text-[var(--dawaa-status-info-text)]';
  return 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-input)] text-[var(--dawaa-theme-muted)]';
}
