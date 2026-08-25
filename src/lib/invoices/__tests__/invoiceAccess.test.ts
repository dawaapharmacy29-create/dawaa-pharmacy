import { describe, expect, it } from 'vitest';
import {
  canAccessInvoiceImportPage,
  canDeleteInvoiceImportBatch,
  canManageInvoiceImportBatches,
} from '../invoiceAccess';

describe('invoice access', () => {
  it('uses permissions instead of names for page and import access', () => {
    const viewer = { role: 'executive_manager', permissions: { view_invoice_import: true, import_sales_invoices: false } };
    const importer = { role: 'branch_manager', permissions: { import_sales_invoices: true } };
    expect(canAccessInvoiceImportPage(viewer)).toBe(true);
    expect(canManageInvoiceImportBatches(viewer)).toBe(false);
    expect(canAccessInvoiceImportPage(importer)).toBe(true);
    expect(canManageInvoiceImportBatches(importer)).toBe(true);
  });

  it('does not grant access because a display name happens to match a former allowlist', () => {
    expect(canAccessInvoiceImportPage({ name: 'معاذ', role: 'pharmacist', permissions: {} })).toBe(false);
  });

  it('reserves destructive batch operations for global import managers', () => {
    expect(canDeleteInvoiceImportBatch({ role: 'branch_manager', permissions: { import_sales_invoices: true } })).toBe(false);
    expect(canDeleteInvoiceImportBatch({ role: 'branches_manager', permissions: { import_sales_invoices: true } })).toBe(true);
  });
});
