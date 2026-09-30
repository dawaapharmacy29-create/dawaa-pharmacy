const EXECUTOR_FIELDS = [
  'handled_by_staff_id',
  'assigned_to_staff_id',
  'assigned_staff_id',
  'staff_id',
] as const;

function normalizedId(value: unknown) {
  return String(value ?? '').trim();
}

/**
 * Canonical monthly-evaluation attribution for follow-ups.
 * requested_by_staff_id is intentionally excluded: it identifies the requester,
 * not the person who actually handled / owned execution.
 */
export function followupExecutorStaffId(row: Record<string, unknown>) {
  for (const field of EXECUTOR_FIELDS) {
    const value = normalizedId(row[field]);
    if (value) return value;
  }
  return '';
}

export function isFollowupExecutedBy(row: Record<string, unknown>, staffId: string) {
  const expected = normalizedId(staffId);
  return Boolean(expected) && followupExecutorStaffId(row) === expected;
}
