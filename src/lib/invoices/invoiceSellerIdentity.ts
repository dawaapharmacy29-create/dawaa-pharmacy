/** A schema-cache miss must never silently strip canonical seller attribution. */
export function mustPreserveInvoiceStaffId(table: string, column: string): boolean {
  return table === 'sales_invoices' && column === 'staff_id';
}

// Seller identity is decided only by resolveStaffDirectoryName (staffIdentityResolver),
// through resolveStaffNamesToStaffIds; this module keeps the persistence guard. Re-imports
// never write staff_id on existing rows (see invoiceImporter), so ownership is never moved.
