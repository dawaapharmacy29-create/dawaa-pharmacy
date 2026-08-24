import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const rlsPath = path.join(
  process.cwd(),
  'supabase/migrations/20260824150000_harden_customer_requests_rls_v2.sql'
);
const ceilingPath = path.join(
  process.cwd(),
  'supabase/migrations/20260824151000_align_customer_request_permission_ceiling_v1.sql'
);

const read = (file: string) => fs.readFileSync(file, 'utf8');

describe('customer requests DB authorization', () => {
  it('removes broad client writes and requires canonical branch permission checks', () => {
    expect(fs.existsSync(rlsPath)).toBe(true);
    const sql = read(rlsPath);

    expect(sql).toContain("dawaa_can_access_customer_request_branch('view_customer_requests', branch)");
    expect(sql).toContain("dawaa_can_access_customer_request_branch('manage_customer_requests', branch)");
    expect(sql).toContain('dawaa_current_staff_account_id_strict() is not null');
    expect(sql).not.toMatch(/create policy[\s\S]{0,220}customer_requests[\s\S]{0,220}(using|with check)\s*\(\s*true\s*\)/i);
  });

  it('keeps customer request events append-only for clients', () => {
    const sql = read(rlsPath);
    const eventPolicySection = sql.slice(sql.indexOf('-- Audit events are append-only'));

    expect(eventPolicySection).toContain('customer_request_events_scoped_select');
    expect(eventPolicySection).toContain('customer_request_events_scoped_insert');
    expect(eventPolicySection).not.toMatch(/create policy customer_request_events[^\n]*update/i);
    expect(eventPolicySection).not.toMatch(/create policy customer_request_events[^\n]*delete/i);
  });

  it('matches the canonical Customer Request role ceiling and honors explicit restrictions', () => {
    expect(fs.existsSync(ceilingPath)).toBe(true);
    const sql = read(ceilingPath);

    for (const role of [
      'general_manager',
      'executive_manager',
      'branches_manager',
      'branch_manager',
      'customer_service_manager',
      'pharmacist',
      'customer_service',
    ]) {
      expect(sql).toContain(`'${role}'`);
    }
    expect(sql).toContain("p_permission not in ('view_customer_requests','manage_customer_requests')");
    expect(sql).toContain('v_account_permissions->>p_permission');
    expect(sql).toContain('v_override->>p_permission');
  });
});
