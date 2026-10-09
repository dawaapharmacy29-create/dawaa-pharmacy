import { canonicalStaffRole } from '@/lib/staff/staffRoleCapabilities';

export type PerformanceScope = 'all' | 'branch' | 'warehouse' | 'delivery' | 'doctors' | 'assistants';

export type PerformanceScopeStaff = {
  id: string;
  role?: string | null;
  branch?: string | null;
};

function token(value: unknown) {
  return String(value || '').trim().toLowerCase().replace(/^فرع\s+/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

export function isWarehouseStaff(row: PerformanceScopeStaff): boolean {
  const role = canonicalStaffRole(row.role);
  return role === 'inventory_assistant' || /مخزن|warehouse/i.test(String(row.branch || '')) || /مخزن|warehouse/i.test(String(row.role || ''));
}

export function staffMatchesPerformanceScope(row: PerformanceScopeStaff, scope: PerformanceScope, branch?: string | null): boolean {
  if (scope === 'all') return true;
  const role = canonicalStaffRole(row.role);
  if (scope === 'doctors') return role === 'doctor';
  if (scope === 'delivery') return role === 'delivery';
  if (scope === 'assistants') return role === 'assistant';
  if (scope === 'warehouse') return isWarehouseStaff(row);
  if (scope === 'branch') return Boolean(token(branch)) && token(row.branch) === token(branch);
  return false;
}

export function filterPerformanceScope<T extends PerformanceScopeStaff>(rows: readonly T[], scope: PerformanceScope, branch?: string | null): T[] {
  return rows.filter((row) => staffMatchesPerformanceScope(row, scope, branch));
}
