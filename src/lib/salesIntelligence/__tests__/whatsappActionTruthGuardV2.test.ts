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
  });

  it('requires explicit guarded approval before a customer request becomes ready', () => {
    expect(source).toContain('dawaa_approve_whatsapp_customer_request_action_v2');
    expect(source).toContain('customer_request_action_canonical_identity_required');
    expect(source).toContain('customer_request_action_source_not_canonical');
    expect(source).toContain('customer_request_action_confidence_too_low');
    expect(source).toContain("'approvalSource','human_review_v2'");
  });
});
