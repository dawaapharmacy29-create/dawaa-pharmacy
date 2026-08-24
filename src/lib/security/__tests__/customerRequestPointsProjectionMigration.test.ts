import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260824144500_fix_customer_request_doctor_points_projection_v2.sql'
);

function sql() {
  return fs.readFileSync(migrationPath, 'utf8');
}

describe('customer request doctor-points projection v2', () => {
  it('uses the same canonical registrar resolver as settlement', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const source = sql();

    expect(source).toContain('resolve_customer_request_registrar_staff_id(cr)');
    expect(source).not.toMatch(/cr\.doctor_id\s+as\s+staff_id/i);
  });

  it('filters eligible requests through identity, tier, and effective policy', () => {
    const source = sql();

    for (const token of [
      "nullif(trim(coalesce(cr.customer_id,'')), '') is not null",
      "nullif(trim(coalesce(cr.customer_code,'')), '') is not null",
      "nullif(trim(coalesce(cr.medicine_name,'')), '') is not null",
      "nullif(trim(coalesce(cr.product_code,'')), '') is not null",
      'not coalesce(cr.sync_conflict,false)',
      "sit.tier_key in ('senior_doctor','mid_doctor','assistant')",
      'p.effective_from <= rc.registered_at',
    ]) {
      expect(source).toContain(token);
    }
  });

  it('derives achieved requests only from the already-eligible request set', () => {
    const source = sql();

    expect(source).toMatch(/from request_eligible re[\s\S]*count\(\*\) as eligible_registered_requests[\s\S]*count\(\*\) filter \([\s\S]*available[\s\S]*\) as achieved_requests/i);
    expect(source).not.toMatch(/count\(\*\) filter \([\s\S]{0,250}cr\.doctor_id is not null[\s\S]{0,100}\) as achieved_requests/i);
  });

  it('keeps awarded point totals sourced from incentive events and raw view internal', () => {
    const source = sql();

    expect(source).toContain('from public.customer_request_incentive_events e');
    expect(source).toContain("count(*) filter (where e.event_key='request_registered')");
    expect(source).toContain("count(*) filter (where e.event_key='request_achieved')");
    expect(source).toContain('revoke all on table public.customer_request_doctor_points_summary_v1 from public, anon, authenticated');
    expect(source).toContain('grant select on table public.customer_request_doctor_points_summary_v1 to service_role');
  });
});
