import { normalizeBranchName } from '@/lib/branch';
import { normalizeDoctorName } from '@/lib/staff/staffIdentityResolver';
import type { StaffDirectoryIdentity } from '@/lib/readModels/staffDirectoryReadModel';

/** A schema-cache miss must never silently strip canonical seller attribution. */
export function mustPreserveInvoiceStaffId(table: string, column: string): boolean {
  return table === 'sales_invoices' && column === 'staff_id';
}

/** Re-imports must not erase or silently reassign an already credited invoice. */
export function retainExistingInvoiceStaffId(existing: string | null | undefined, proposed: string | null | undefined): string | null {
  return existing || proposed || null;
}

/** Invoice import is allowed to credit only one active canonical employee. */
export function resolveInvoiceSellerIdentity(
  sellerName: string,
  invoiceBranch: string,
  directory: StaffDirectoryIdentity[]
): string | null {
  const normalized = normalizeDoctorName(sellerName);
  if (!normalized) return null;

  const candidates = new Map<string, StaffDirectoryIdentity>();
  for (const row of directory) {
    if (!row.id || !row.active || (row.status && !['active', 'نشط'].includes(row.status.toLowerCase()))) continue;
    if (normalizeDoctorName(row.name) !== normalized) continue;
    if (row.source === 'alias') {
      if (!candidates.has(row.id)) candidates.set(row.id, row);
    } else {
      candidates.set(row.id, row);
    }
  }

  if (candidates.size === 1) return [...candidates.keys()][0];
  if (candidates.size === 0) return null;

  // The invoice branch is evidence for disambiguation, never a rewrite of its branch.
  const branch = normalizeBranchName(invoiceBranch);
  const sameBranch = [...candidates.values()].filter((row) => normalizeBranchName(row.branch) === branch);
  return sameBranch.length === 1 ? sameBranch[0].id : null;
}
