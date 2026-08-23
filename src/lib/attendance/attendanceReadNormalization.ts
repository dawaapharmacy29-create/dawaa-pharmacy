export type NormalizedAttendanceRow = {
  staff_id?: string | null;
  staff_name?: string | null;
  status?: string | null;
  date?: string | null;
  attendance_date?: string | null;
  check_in?: string | null;
  check_out?: string | null;
  first_in?: string | null;
  last_out?: string | null;
  source?: 'legacy' | 'modern';
  [key: string]: unknown;
};

export type ModernAttendanceLogRow = {
  staff_id?: string | null;
  staff_name?: string | null;
  shift_date?: string | null;
  attendance_type?: string | null;
  status?: string | null;
  recorded_at?: string | null;
  created_at?: string | null;
};

function timestampValue(value?: string | null) {
  if (!value) return Number.NaN;
  return Date.parse(value);
}

function earlier(current?: string | null, candidate?: string | null) {
  if (!candidate) return current || null;
  if (!current) return candidate;
  const currentTime = timestampValue(current);
  const candidateTime = timestampValue(candidate);
  if (Number.isNaN(currentTime)) return candidate;
  if (Number.isNaN(candidateTime)) return current;
  return candidateTime < currentTime ? candidate : current;
}

function later(current?: string | null, candidate?: string | null) {
  if (!candidate) return current || null;
  if (!current) return candidate;
  const currentTime = timestampValue(current);
  const candidateTime = timestampValue(candidate);
  if (Number.isNaN(currentTime)) return candidate;
  if (Number.isNaN(candidateTime)) return current;
  return candidateTime > currentTime ? candidate : current;
}

function timePart(value?: string | null) {
  if (!value) return null;
  const isoTime = value.match(/T(\d{2}:\d{2}:\d{2})/);
  if (isoTime) return isoTime[1];
  const plainTime = value.match(/^(\d{2}:\d{2}:\d{2})/);
  return plainTime ? plainTime[1] : null;
}

/**
 * Convert accepted punch-level attendance logs into one row per subject/day.
 * Rejected and manual-review attempts are deliberately excluded from confirmed attendance.
 */
export function normalizeAcceptedAttendanceLogs(
  rows: ModernAttendanceLogRow[]
): NormalizedAttendanceRow[] {
  const byDate = new Map<string, NormalizedAttendanceRow>();

  for (const log of rows) {
    if (String(log.status || '').toLowerCase() !== 'accepted') continue;
    const date = String(log.shift_date || '').slice(0, 10);
    if (!date) continue;

    const recorded = log.recorded_at || log.created_at || null;
    const current = byDate.get(date) || {
      staff_id: log.staff_id || null,
      staff_name: log.staff_name || null,
      status: 'present',
      date,
      attendance_date: date,
      check_in: null,
      check_out: null,
      first_in: null,
      last_out: null,
      source: 'modern' as const,
    };

    if (log.attendance_type === 'check_in') {
      current.first_in = earlier(current.first_in, recorded);
      current.check_in = timePart(current.first_in);
    } else if (log.attendance_type === 'check_out') {
      current.last_out = later(current.last_out, recorded);
      current.check_out = timePart(current.last_out);
    }

    current.staff_id = current.staff_id || log.staff_id || null;
    current.staff_name = current.staff_name || log.staff_name || null;
    byDate.set(date, current);
  }

  return [...byDate.values()].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
}

/**
 * Merge legacy daily rows with normalized modern rows for one requested subject.
 * Modern data wins when both sources contain the same calendar day.
 */
export function mergeAttendanceRowsForSubject(
  legacyRows: NormalizedAttendanceRow[],
  modernRows: NormalizedAttendanceRow[]
): NormalizedAttendanceRow[] {
  const byDate = new Map<string, NormalizedAttendanceRow>();

  for (const row of legacyRows) {
    const date = String(row.attendance_date || row.date || '').slice(0, 10);
    if (!date) continue;
    byDate.set(date, {
      ...row,
      date,
      attendance_date: String(row.attendance_date || date).slice(0, 10),
      source: 'legacy',
    });
  }

  for (const row of modernRows) {
    const date = String(row.attendance_date || row.date || '').slice(0, 10);
    if (!date) continue;
    byDate.set(date, { ...row, date, attendance_date: date, source: 'modern' });
  }

  return [...byDate.values()].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
}
