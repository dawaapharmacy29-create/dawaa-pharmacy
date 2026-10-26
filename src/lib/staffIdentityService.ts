import { normalizeBranchName } from '@/lib/branch';
import { normalizeRole } from '@/lib/permissionMatrix';
import { readStaffDirectory, type StaffDirectoryIdentity } from '@/lib/readModels/staffDirectoryReadModel';
import { normalizeDoctorName, resolveStaffDirectoryName } from '@/lib/staff/staffIdentityResolver';
import type { StaffSalesSummary } from '@/lib/dashboardSummaryService';

export type StaffIdentityRow = {
  id: string | null;
  name: string | null;
  branch: string | null;
  role: string | null;
  active: boolean;
  source?: StaffDirectoryIdentity['source'];
  normalizedAlias?: string | null;
};

export type GroupedStaffSalesPerformance = {
  staffId: string | null;
  sellerName: string | null;
  displayName: string;
  normalizedName: string;
  branch: string | null;
  netTotal: number;
  invoicesCount: number;
  avgInvoice: number;
  uniqueCustomers: number;
  sourceRows: number;
  duplicateWarning: string | null;
};

function text(value: unknown) {
  return String(value ?? '').trim();
}

export function normalizeStaffName(value: unknown) { return normalizeDoctorName(value); }

export async function fetchStaffIdentityRows(): Promise<StaffIdentityRow[]> {
  const rows = await readStaffDirectory({ requireComplete: true });
  return rows.map(({ id, name, branch, role, active, source, normalizedAlias }) => ({ id, name, branch, role, active, source, normalizedAlias }));
}

export function findStaffIdentityForSalesRow(
  row: StaffSalesSummary,
  staffRows: StaffIdentityRow[]
) {
  if (!row) return null;
  const decision = resolveStaffDirectoryName(row.sellerName || '', staffRows.map(staff => ({
    ...staff, source: staff.source || 'staff', username: null, status: null,
  })));
  if (decision.status !== 'resolved' || !decision.staff || !isSalesIdentityRole(decision.staff)) return null;
  return staffRows.find(staff => staff.id === decision.staff!.id && (!staff.source || staff.source === 'staff')) || null;
}

function isSalesIdentityRole(staff: StaffIdentityRow) {
  if (staff.active === false) return false;
  const role = normalizeRole(staff.role);
  return !['delivery', 'cleaning_supervisor', 'inventory_assistant', 'assistant'].includes(role);
}

export function groupStaffSalesPerformance(
  rows: StaffSalesSummary[],
  staffRows: StaffIdentityRow[] = []
): GroupedStaffSalesPerformance[] {
  const groups = new Map<string, GroupedStaffSalesPerformance>();

  for (const row of rows.filter(Boolean)) {
    if (!row.sellerName) continue;
    const identity = findStaffIdentityForSalesRow(row, staffRows);
    const normalizedName = normalizeStaffName(identity?.name || row.sellerName);
    if (!normalizedName) continue;
    const branch = normalizeBranchName(row.branch || identity?.branch) || null;
    const key = identity?.id
      ? `id:${identity.id}:branch:${branch || 'all'}`
      : `name:${normalizedName}:branch:${branch || 'all'}`;
    const current = groups.get(key) || {
      staffId: identity?.id || null,
      sellerName: identity?.name || row.sellerName,
      displayName: identity?.name || row.sellerName || 'غير محدد',
      normalizedName,
      branch,
      netTotal: 0,
      invoicesCount: 0,
      avgInvoice: 0,
      uniqueCustomers: 0,
      sourceRows: 0,
      duplicateWarning: null,
    };
    current.netTotal += row.netTotal || 0;
    current.invoicesCount += row.invoicesCount || 0;
    current.uniqueCustomers += row.uniqueCustomers || 0;
    current.sourceRows += 1;
    if (current.sourceRows > 1) current.duplicateWarning = 'تم تجميع أكثر من صف لنفس الدكتور داخل نفس الفرع';
    groups.set(key, current);
  }

  return [...groups.values()]
    .map((row) => ({
      ...row,
      avgInvoice: row.invoicesCount ? row.netTotal / row.invoicesCount : 0,
    }))
    .sort((a, b) => b.netTotal - a.netTotal);
}

export function staffProfileRoute(staffId: string | null | undefined) {
  return staffId ? `/staff/${staffId}` : null;
}
