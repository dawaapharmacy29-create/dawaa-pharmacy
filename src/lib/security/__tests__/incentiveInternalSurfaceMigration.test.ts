import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath =
  'supabase/migrations/20260825230000_harden_incentive_internal_surfaces_v1.sql';

function sql() {
  return readFileSync(migrationPath, 'utf8').toLowerCase();
}

describe('incentive internal surface hardening', () => {
  it('keeps policy, event, catalog, backup and staging tables server-internal', () => {
    const source = sql();

    for (const table of [
      'notification_type_catalog',
      'staff_incentive_tiers',
      'customer_request_incentive_policy',
      'customer_request_incentive_events',
      'conversation_sales_reviews_backup_20260821_policy_recalc',
      'employee_transactions_backup_20260821_policy_recalc',
      'sales_invoices_reconcile_stage_20260819',
      'sales_invoices_snapshot_before_recovery_20260821',
      'customer_service_top50_cache',
    ]) {
      expect(source).toContain(`'${table}'`);
    }

    expect(source).toContain(
      "revoke all on table public.%i from public, anon, authenticated"
    );
  });

  it('resolves the cycle inside actor-scoped RPC bodies', () => {
    const source = sql();

    expect(source).toMatch(/calculate_staff_incentive_egp\([\s\S]*p_month_cycle text default null/);
    expect(source).toMatch(/get_doctor_pillar_breakdown\([\s\S]*p_month_cycle text default null/);
    expect(source).toContain(
      'dawaa_can_read_employee_transaction(p_staff_id, s.branch)'
    );
    expect(source).not.toMatch(
      /p_month_cycle text default public\.dawaa_current_points_cycle_label_v1\(\)/
    );
  });

  it('does not expose the internal cycle helper to client roles', () => {
    const source = sql();

    expect(source).toContain(
      'revoke all on function public.dawaa_current_points_cycle_label_v1()'
    );
    expect(source).toContain('from public, anon, authenticated');
  });
});
