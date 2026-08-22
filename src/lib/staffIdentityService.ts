import { normalizeBranchName } from '@/lib/branch';
import { normalizeRole } from '@/lib/permissionMatrix';
import { readStaffDirectory } from '@/lib/readModels/staffDirectoryReadModel';
import type { StaffSalesSummary } from '@/lib/dashboardSummaryService';

export type StaffIdentityRow = {
  id: string | null;
  name: string | null;
  branch: string | null;
  role: string | null;
  active: boolean;
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

export function normalizeStaffName(value: unknown) {
  return text(value)
    .replace(/[\u064b-\u065f]/g, '')
    .replace(/[\u0623\u0625\u0622]/g, '\u0627')
    .replace(/\u0624/g, '\u0648')
    .replace(/\u0626/g, '\u064a')
    .replace(/\u0649/g, '\u064a')
    .replace(/\u0629/g, '\u0647')
    .replace(/^(?:\u062f\.?|\u062f\/|\u062f\u0643\u062a\u0648\u0631|dr\.?|doctor)\s*/i, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function uniqueIdentities(rows: StaffIdentityRow[]) {
  const map = new Map<string, StaffIdentityRow>();
  for (const row of rows.filter(Boolean)) {
    const key = row.id || `${normalizeStaffName(row.name)}|${normalizeBranchName(row.branch) || ''}|${row.role || ''}`;
    if (!map.has(key)) map.set(key, row);
  }
  return [...map.values()];
}

export async function fetchStaffIdentityRows(): Promise<StaffIdentityRow[]> {
  const rows = await readStaffDirectory();
  return rows.map(({ id, name, branch, role, active }) => ({ id, name, branch, role, active }));
}

export function findStaffIdentityForSalesRow(
  row: StaffSalesSummary,
  staffRows: StaffIdentityRow[]
) {
  if (!row) return null;
  const sellerName = row.sellerName || '';
  const normalized = normalizeStaffName(sellerName);
  const branch = normalizeBranchName(row.branch);
  if (!normalized) return null;

  const salesStaffRows = staffRows.filter(Boolean).filter(isSalesIdentityRole);
  const sameBranch = uniqueIdentities(
    salesStaffRows.filter(
      (staff) =>
        normalizeStaffName(staff.name) === normalized &&
        (!branch || !staff.branch || staff.branch === branch || staff.branch === 'كل الفروع')
    )
  );
  if (sameBranch.length === 1) return sameBranch[0];
  if (sameBranch.length > 1) {
    const pharmacist = sameBranch.find((staff) =>
      /صيد|دكتور|doctor|pharmacist/i.test(staff.role || '')
    );
    return pharmacist || sameBranch[0];
  }

  const anyBranch = uniqueIdentities(
    salesStaffRows.filter((staff) => normalizeStaffName(staff.name) === normalized)
  );
  if (anyBranch.length === 1) return anyBranch[0];
  return null;
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
