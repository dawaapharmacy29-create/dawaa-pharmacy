export interface PointsStaffIdentity {
  id: string;
  name: string;
  original_name?: string;
  display_name?: string;
}

export interface PointsIdentityRecord {
  staff_id?: string | null;
  employee_id?: string | null;
  employee_name?: string | null;
}

export function normalizePointsStaffName(value: string): string {
  return value.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه')
    .replace(/^(د|dr|doctor)\s*\/?\s*/i, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function buildUniquePointsStaffNames(staff: PointsStaffIdentity[]): Map<string, string> {
  const candidates = new Map<string, Set<string>>();
  for (const employee of staff) {
    for (const rawName of [employee.name, employee.original_name, employee.display_name]) {
      if (!rawName?.trim()) continue;
      const name = normalizePointsStaffName(rawName);
      if (!name) continue;
      if (!candidates.has(name)) candidates.set(name, new Set());
      candidates.get(name)!.add(employee.id);
    }
  }
  return new Map([...candidates].filter(([, ids]) => ids.size === 1).map(([name, ids]) => [name, [...ids][0]]));
}

/** Historical IDs are authoritative; an unknown/conflicting ID must never be replaced by a name match. */
export function resolvePointsStaffId(
  row: PointsIdentityRecord,
  validIds: Set<string>,
  uniqueNames: Map<string, string>
): string | null {
  const ids = [...new Set([row.staff_id, row.employee_id].map((id) => String(id || '').trim()).filter(Boolean))];
  if (ids.length > 1) return null;
  if (ids.length === 1) return validIds.has(ids[0]) ? ids[0] : null;
  return uniqueNames.get(normalizePointsStaffName(String(row.employee_name || ''))) || null;
}
