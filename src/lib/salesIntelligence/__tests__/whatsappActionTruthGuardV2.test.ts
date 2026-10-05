import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  'supabase/migrations/20261005141000_whatsapp_action_truth_guard_v2.sql',
  'utf8'
);

describe('WhatsApp action truth guard V2', () => {
  it('downgrades browser-created customer requests to proposals', () => {
    expect(source).toContain("if new.action_type='customer_request' then");
    expect(source).toContain("new.status := 'proposed'");
    expect(source).toContain('new.auto_eligible := false');
  });

  it('keeps action identity and execution truth command-owned', () => {
    expect(source).toContain('whatsapp_action_identity_is_system_owned');
    expect(source).toContain('whatsapp_action_execution_truth_is_command_owned');
    expect(source).toContain('new.target_id is distinct from old.target_id');
    expect(source).toContain('new.recovered_invoice_id is distinct from old.recovered_invoice_id');
    expect(source).toContain('new.completed_at is distinct from old.completed_at');
    expect(source).toContain('new.outcome_note is distinct from old.outcome_note');
  });

  it('freezes every customer-request value used by materialization after approval', () => {
    expect(source).toContain('approved_customer_request_action_is_immutable_for_client');
    expect(source).toContain('new.confidence is distinct from old.confidence');
    expect(source).toContain('new.quantity is distinct from old.quantity');
    expect(source).toContain('new.due_at is distinct from old.due_at');
    expect(source).toContain('new.payload is distinct from old.payload');
  });

  it('requires canonical source identity and canonical product identity at approval', () => {
    expect(source).toContain('dawaa_approve_whatsapp_customer_request_action_v2');
    expect(source).toContain('customer_request_action_source_not_canonical');
    expect(source).toContain('customer_request_action_customer_mismatch');
    expect(source).toContain('customer_request_action_staff_mismatch');
    expect(source).toContain('customer_request_action_branch_mismatch');
    expect(source).toContain('customer_request_action_product_identity_mismatch');
    expect(source).toContain("'approvalSource','human_review_v2'");
  });

  it('moves legacy materialization behind a guarded public wrapper', () => {
    expect(source).toContain('dawaa_materialize_whatsapp_action_core_v2');
    expect(source).toContain('whatsapp_action_execute_permission_denied');
    expect(source).toContain('customer_request_materialization_permission_denied');
    expect(source).toContain('customer_request_requires_explicit_approval');
    expect(source).toContain("coalesce(v_action.payload->>'approvalSource','')<>'human_review_v2'");
  });
});
