// Canonical Cairo wall-clock boundary. Every Cairo-time conversion in the app goes through the
// single offset reader and the single wall-clock → instant core below, so a UTC server, a Cairo
// browser and any other machine timezone produce the same instants.
const CAIRO_TZ = 'Africa/Cairo';

const cairoPartsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: CAIRO_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** Cairo offset from UTC (ms) in effect at an instant. */
function cairoOffsetAt(instantMs: number): number {
  const parts = Object.fromEntries(
    cairoPartsFormat.formatToParts(new Date(instantMs)).map((part) => [part.type, part.value])
  ) as Record<string, string>;
  const wallAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return wallAsUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * The instant of a Cairo wall-clock reading, independent of the machine timezone. Component
 * overflow behaves like the Date constructor (month 13 → next year). DST follows the ECMAScript
 * local-time rules, so a machine set to Africa/Cairo gets exactly what `new Date(y, m - 1, d, …)`
 * returns there: an ambiguous fall-back time resolves to the earlier instant and a skipped
 * spring-forward time moves forward by the gap.
 */
export function cairoWallClockToDate(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0
): Date | null {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  if (!Number.isFinite(wallAsUtc)) return null;
  const offsetBefore = cairoOffsetAt(wallAsUtc - 24 * 3600_000);
  const offsetAfter = cairoOffsetAt(wallAsUtc + 24 * 3600_000);
  const valid = [...new Set([offsetBefore, offsetAfter])]
    .map((offset) => wallAsUtc - offset)
    .filter((candidate) => wallAsUtc - cairoOffsetAt(candidate) === candidate)
    .sort((a, b) => a - b);
  const instant = valid.length ? valid[0] : wallAsUtc - offsetBefore;
  const date = new Date(instant);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Entry point kept for callers of the #510 API: the same canonical conversion, returning an
 * Invalid Date (never null) for unusable components and accepting milliseconds.
 */
export function cairoWallTimeDate(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0
): Date {
  const instant = cairoWallClockToDate(year, month, day, hour, minute, second);
  return instant ? new Date(instant.getTime() + millisecond) : new Date(NaN);
}

/**
 * First (or, with `end`, last) millisecond of a Cairo calendar day. The end boundary is the
 * instant before the next Cairo midnight, so on the October fall-back day it still covers the
 * repeated hour.
 */
export function cairoDateBoundaryIso(dateText: string, end = false) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
  if (!m) throw new Error('Invalid Cairo date boundary');
  if (!end) return cairoWallTimeDate(+m[1], +m[2], +m[3]).toISOString();
  return new Date(cairoWallTimeDate(+m[1], +m[2], +m[3] + 1).getTime() - 1).toISOString();
}

const cairoDayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: CAIRO_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
/** Cairo calendar day (YYYY-MM-DD) of a timestamp; a plain date string is returned as-is. Null when unparseable. */
export function cairoDayOf(value: unknown): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : cairoDayFormat.format(d);
}

/** Cairo wall-clock reading of an instant (month is 1-12), independent of the machine timezone. */
export function cairoWallClockParts(date: Date) {
  const local = new Date(date.getTime() + cairoOffsetAt(date.getTime()));
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    second: local.getUTCSeconds(),
  };
}

/** Cairo calendar parts of an instant (month is 1-12), independent of the machine timezone. */
export function cairoCalendarParts(date: Date): { year: number; month: number; day: number } {
  const { year, month, day } = cairoWallClockParts(date);
  return { year, month, day };
}
