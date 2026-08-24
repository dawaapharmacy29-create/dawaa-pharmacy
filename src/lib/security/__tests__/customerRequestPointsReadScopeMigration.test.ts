import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260824143000_scope_customer_request_points_reads_v2.sql'
);

function migrationSource() {
  return fs.readFileSync(migrationPath, 'utf8');
}

describe('customer request doctor-points read authorization', () => {
  it('requires the canonical active staff actor and view_points permission', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const sql = migrationSource();

    expect(sql).toContain('dawaa_current_staff_account_id_strict()');
    expect(sql).toContain("user_has_permission(v_actor_id, 'view_points')");
    expect(sql).toContain('dawaa_can_read_customer_request_doctor_points');
  });

  it('keeps self, branch-management, and global-management scopes explicit', () => {
    const sql = migrationSource();

    expect(sql).toContain("('general_manager','executive_manager','branches_manager','admin')");
    expect(sql).toContain("('branch_manager','customer_service_manager','shift_supervisor_morning','shift_supervisor_evening')");
    expect(sql).toContain('v_actor_staff_id = p_staff_id');
    expect(sql).toContain('lower(v_target_branch) = lower(v_actor_branch)');
  });

  it('scopes summary, preview, events, and leaderboard instead of trusting arbitrary ids', () => {
    const sql = migrationSource();

    expect(sql).toMatch(/get_customer_request_doctor_incentive_preview[\s\S]*dawaa_can_read_customer_request_doctor_points\(p_staff_id\)/);
    expect(sql).toMatch(/get_customer_request_doctor_points_summary[\s\S]*dawaa_can_read_customer_request_doctor_points\(p_staff_id\)/);
    expect(sql).toMatch(/get_customer_request_incentive_events[\s\S]*dawaa_can_read_customer_request_doctor_points\(e\.staff_id\)/);
    expect(sql).toMatch(/get_customer_request_doctor_points_leaderboard[\s\S]*lower\(trim\(s\.branch\)\) = lower\(v_actor_branch\)/);
  });
});
