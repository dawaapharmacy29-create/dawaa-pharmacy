/**
 * Clock values from weekly schedules are PostgreSQL TIME strings, not ISO dates.
 * Use a direct 12-hour conversion to avoid invalid Date("09:00:00") output.
 * Biometric event timestamps are full instants and must be shown in Cairo time.
 */
export function formatEmployeeProfileClock(value?: string | null): string {
  if (!value) return '—';
  const text = String(value).trim();
  const clock = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(text);
  if (clock) {
    const h = Number(clock[1]);
    const minute = Number(clock[2]);
    if (h >= 0 && h <= 23 && minute >= 0 && minute <= 59) {
      return `${h % 12 || 12}:${String(minute).padStart(2,'0')} ${h < 12 ? 'ص' : 'م'}`;
    }
    return '—';
  }
  const instant = new Date(text);
  if (Number.isNaN(instant.getTime())) return '—';
  return instant.toLocaleTimeString('ar-EG', {
    hour: '2-digit',minute: '2-digit',timeZone: 'Africa/Cairo',
  });
}
