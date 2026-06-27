/**
 * Active staff filtering — supports `active`, `is_active`, and Arabic status fields.
 * Does not delete inactive rows; use includeInactive only on admin/archive views.
 */

export type StaffActiveRow = {
  id?: string | null;
  staff_id?: string | null;
  active?: boolean | null;
  is_active?: boolean | null;
  status?: string | null;
  deleted_at?: string | null;
  is_deleted?: boolean | null;
};

const INACTIVE_STATUSES = new Set([
  'معطل',
  'غير نشط',
  'inactive',
  'archived',
  'disabled',
  'deleted',
]);

/** Client-side check: row counts as active staff for lists and selectors. */
export function staffRowIsActive(row: StaffActiveRow | null | undefined): boolean {
  if (!row) return false;
  if (row.deleted_at || row.is_deleted === true) return false;
  if (row.is_active === false || row.active === false) return false;
  const status = String(row.status || '')
    .trim()
    .toLowerCase();
  if (status && INACTIVE_STATUSES.has(status)) return false;
  if (status && (status === 'نشط' || status === 'active')) return true;
  if (row.is_active === true || row.active === true) return true;
  if (row.is_active == null && row.active == null && !status) return true;
  if (!status && row.is_active !== false && row.active !== false) return true;
  return false;
}

export function staffRowVisibleInSchedule(row: { visible_in_schedule?: boolean | null } | null | undefined): boolean {
  if (!row) return true;
  return row.visible_in_schedule !== false;
}

/** Supabase filter descriptor for useSupabaseQuery. */
export function isActiveStaffFilter(): Array<{ column: string; operator: string; value: unknown }> {
  return [{ column: 'active', operator: 'eq', value: true }];
}

/** Filter an in-memory staff array to active rows only. */
export function filterActiveStaffRows<T extends StaffActiveRow>(rows: T[] | null | undefined): T[] {
  return (rows || []).filter((row) => staffRowIsActive(row));
}
