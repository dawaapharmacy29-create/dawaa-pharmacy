import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  'supabase/migrations/20261005134500_customer_followup_request_writer_guard_v2.sql',
  'utf8'
);

describe('customer follow-up request writer guard V2', () => {
  it('hides the legacy implementation and keeps the current RPC name as a guarded wrapper', () => {
    expect(source).toContain('rename to dawaa_create_customer_followup_request_legacy_v1');
    expect(source).toContain('dawaa_create_customer_followup_request_v1(p_payload jsonb)');
    expect(source).toContain('dawaa_current_followup_actor_v2(null)');
  });

  it('overwrites spoofable creator identity with the current actor', () => {
    expect(source).toContain("'created_by',v_actor.account_id::text");
    expect(source).toContain("'created_by_name',v_actor.actor_name");
    expect(source).toContain("'requested_by',v_actor.actor_name");
  });

  it('enforces branch scope for non-top-management actors', () => {
    expect(source).toContain('followup_branch_scope_denied');
    expect(source).toContain("v_effective_branch := v_actor.branch");
    expect(source).toContain('valid_followup_branch_required');
  });
});
