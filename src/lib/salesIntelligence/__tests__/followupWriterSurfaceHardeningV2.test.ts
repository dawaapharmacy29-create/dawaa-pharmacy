import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const followupMigration = readFileSync(
  'supabase/migrations/20261005131000_followup_writer_surface_hardening_v2.sql',
  'utf8'
);
const automaticReviewMigration = readFileSync(
  'supabase/migrations/20261005124500_automatic_review_writer_guard_v2.sql',
  'utf8'
);

function containsAll(text: string, snippets: string[]) {
  for (const snippet of snippets) expect(text).toContain(snippet);
}

describe('follow-up writer surface hardening V2', () => {
  it('binds operational follow-up mutations to the current logged-in actor', () => {
    containsAll(followupMigration, [
      'dawaa_current_followup_actor_v2',
      'dawaa_current_staff_account_id_strict()',
      'actor_mismatch_or_inactive_account',
      "trim(p_claimed_actor)=a.id::text",
      "trim(p_claimed_actor)=nullif(trim(coalesce(a.staff_id,'')),'')",
    ]);
  });

  it('keeps active RPC names but hides their legacy implementations', () => {
    containsAll(followupMigration, [
      'rename to correct_customer_followup_data_legacy_v1',
      'rename to merge_open_followup_duplicates_legacy_v1',
      'rename to transfer_customer_followup_branch_legacy_v1',
      'rename to import_customer_followup_results_legacy_v1',
      'rename to import_customer_service_queue_results_legacy_v4',
      'to anon,authenticated,service_role',
    ]);
  });

  it('enforces branch scope before correction, merge, and transfer', () => {
    containsAll(followupMigration, [
      'followup_branch_scope_denied',
      'cross_branch_duplicate_merge_denied',
      'followup_transfer_permission_denied',
      'dawaa_customer_request_branch_key(v_actor.branch)',
    ]);
  });

  it('removes direct browser access to maintenance and points writers', () => {
    containsAll(followupMigration, [
      'revoke all on function public.apply_followup_incentive_points()',
      'revoke all on function public.compute_followup_points(text)',
      'revoke all on function public.flag_burst_followup_registrations()',
      'revoke all on function public.repair_customer_followup_duplicates_and_branches()',
      'revoke all on function public.settle_doctor_self_logged_followup(text)',
      'revoke all on function public.settle_followup_doctor_points(text,text)',
      'revoke all on function public.dawaa_sync_whatsapp_action_evidence_v17()',
      'revoke all on function public.dawaa_sync_whatsapp_invoice_evidence_v17()',
    ]);
  });

  it('retires older queue import generations from client execution', () => {
    containsAll(followupMigration, [
      'revoke all on function public.import_customer_service_queue_results_v2(uuid,text,text,jsonb)',
      'revoke all on function public.import_customer_service_queue_results_v3(uuid,text,text,jsonb)',
    ]);
  });
});

describe('automatic review writer guard V2', () => {
  it('makes automatic evidence system-owned while preserving manager annotations', () => {
    containsAll(automaticReviewMigration, [
      'dawaa_guard_automatic_conversation_review_writer_v2',
      'automatic_conversation_review_is_system_owned',
      'automatic_conversation_review_evidence_is_immutable_for_client',
      "'manager_review_score'",
      "'manager_review_notes'",
      "'manager_reviewed_by'",
      "'manager_reviewed_at'",
    ]);
  });
});
