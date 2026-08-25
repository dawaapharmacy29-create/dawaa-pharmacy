import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath =
  'supabase/migrations/20260826030000_enforce_public_view_invoker_boundary_v1.sql';

function sql() {
  return readFileSync(migrationPath, 'utf8').toLowerCase();
}

describe('public view invoker boundary migration', () => {
  it('converts every existing public view to caller privileges', () => {
    const source = sql();

    expect(source).toContain("n.nspname = 'public'");
    expect(source).toContain("c.relkind = 'v'");
    expect(source).toContain("array['security_invoker=true']");
    expect(source).toContain('alter view %s set (security_invoker=true)');
  });

  it('closes internal diagnostics instead of granting their private dependencies', () => {
    const source = sql();

    for (const view of [
      'dawaa_customer_phone_quality_summary_v2',
      'notification_delivery_health_v1',
      'dawaa_data_health_customer_metrics_mismatch_v1',
    ]) {
      expect(source).toContain(`revoke all on table public.${view}`);
    }
    expect(source).toContain('from public, anon, authenticated');
  });

  it('keeps the application payroll projection usable through the same boundary', () => {
    expect(sql()).toContain(
      'grant select on table public.dawaa_staff_payroll_summary_v13 to anon'
    );
  });

  it('fails closed when any public view remains owner-privileged', () => {
    const source = sql();

    expect(source).toContain(
      "raise exception 'public view security_invoker boundary is incomplete'"
    );
  });
});
