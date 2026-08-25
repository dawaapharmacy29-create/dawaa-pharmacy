import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const migration = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/migrations/20260826013000_harden_sales_invoice_domain_v1.sql'),
  'utf8',
);
const optimizationMigration = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/migrations/20260826014500_optimize_sales_invoice_branch_rls_v1.sql'),
  'utf8',
);

describe('sales invoice domain hardening migration', () => {
  it('replaces all known open invoice policies', () => {
    expect(migration).toContain('drop policy if exists "Allow anon read sales invoices"');
    expect(migration).toContain('drop policy if exists sales_invoices_update_app');
    expect(migration).not.toMatch(/create policy[\s\S]{0,180}(using|with check) \(true\)/i);
  });

  it('scopes reads and imports by canonical permission and branch', () => {
    expect(migration).toContain('dawaa_current_sales_invoice_scope_v1');
    expect(migration).toContain("array['import_sales_invoices']");
    expect(migration).toContain('coalesce(branch, branch_name)');
    expect(migration).toContain("set search_path = ''");
  });

  it('migrates the legacy operational team into explicit permissions', () => {
    expect(migration).toContain('staff_permission_overrides');
    expect(migration).toContain("('view_invoice_import'),('import_sales_invoices')");
    expect(migration).toContain("sa.staff_name = 'د/ علياء'");
  });

  it('keeps the date-independent branch invoice identity invariant', () => {
    expect(migration).toContain('idx_sales_invoices_unique_branch_invoice_no');
    expect(migration).toContain('on public.sales_invoices(branch, invoice_no)');
    expect(migration).toContain('revoke truncate on public.sales_invoices');
  });

  it('uses the canonical indexed branch in optimized RLS predicates', () => {
    expect(optimizationMigration).toContain('or branch = (select public.dawaa_current_sales_invoice_scope_v1');
    expect(optimizationMigration).not.toMatch(/coalesce\s*\(\s*branch\s*,\s*branch_name\s*\)/i);
  });
});
