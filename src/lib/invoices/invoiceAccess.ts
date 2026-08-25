import { hasAnyPermission, hasPermission } from '@/lib/core/permissionSystem';
import { canViewAllBranches } from '@/lib/security/userDataScope';

type InvoiceUser = {
  username?: string | null;
  name?: string | null;
  role?: string | null;
  permissions?: Record<string, boolean> | null;
} | null | undefined;

export function canAccessInvoiceImportPage(user: InvoiceUser) {
  return hasAnyPermission(user, ['view_invoice_import', 'import_sales_invoices']);
}

export function canDeleteInvoiceImportBatch(user: InvoiceUser) {
  return canViewAllBranches(user) && hasPermission(user, 'import_sales_invoices');
}

export function canManageInvoiceImportBatches(user: InvoiceUser) {
  return hasPermission(user, 'import_sales_invoices');
}
