// Deterministic order of the Release Candidate migrations, by real dependency (it coincides with
// timestamp order; `after` names the migrations each one needs). Each entry carries what it changes,
// whether it mutates data, lock risk, how to reverse it, and the post-apply assertions that
// scripts/staging/run-fresh-staging.mjs checks after applying it.
const fn = (signature) => ({ name: `function ${signature}`, sql: `select to_regprocedure('public.${signature}') is not null`, expect: 't' });
const trigger = (name, table) => ({ name: `trigger ${name} on ${table}`, sql: `select count(*) from pg_trigger where tgname='${name}' and tgrelid='public.${table}'::regclass`, expect: '1' });
const noTrigger = (name, table) => ({ name: `no trigger ${name}`, sql: `select count(*) from pg_trigger where tgname='${name}' and tgrelid='public.${table}'::regclass`, expect: '0' });
const index = (name) => ({ name: `index ${name}`, sql: `select count(*) from pg_indexes where schemaname='public' and indexname='${name}'`, expect: '1' });
const noClientExecute = (signature) => ({
  name: `no anon/authenticated EXECUTE on ${signature}`,
  sql: `select has_function_privilege('anon','public.${signature}','execute') or has_function_privilege('authenticated','public.${signature}','execute')`,
  expect: 'f',
});
const clientExecute = (signature) => ({ name: `authenticated EXECUTE on ${signature}`, sql: `select has_function_privilege('authenticated','public.${signature}','execute')`, expect: 't' });
const rls = (table) => ({ name: `RLS on ${table}`, sql: `select relrowsecurity from pg_class where oid='public.${table}'::regclass`, expect: 't' });
const policy = (name, table) => ({ name: `policy ${name}`, sql: `select count(*) from pg_policies where schemaname='public' and tablename='${table}' and policyname='${name}'`, expect: '1' });
const sql = (name, query, expect) => ({ name, sql: query, expect });

export const RC_MIGRATIONS = [
  {
    order: 1, file: '20261005123000_sales_intelligence_truth_boundary_v2.sql', after: [],
    objects: 'retires 5 legacy client writers (EXECUTE to service_role only); SI sale-truth and product-opportunity guard triggers; invoice-item reconcile trigger; review supersede trigger; view conversation_sales_reviews_canonical_v2; CHECK on whatsapp_sales_opportunities_v17.current_stage',
    mutatesData: 'no (DDL only; the CHECK constraint validates existing rows)',
    lockRisk: 'medium: ADD CONSTRAINT CHECK scans whatsapp_sales_opportunities_v17 under ACCESS EXCLUSIVE; triggers take brief SHARE ROW EXCLUSIVE locks',
    reversal: 'restore the previous trigger set and grants from the Production catalog snapshot; drop the new triggers, view and constraint',
    assertions: [
      noClientExecute('create_or_link_customer_followup(jsonb)'),
      trigger('whatsapp_case_sale_truth_guard_v2', 'whatsapp_customer_cases_v22'),
      trigger('whatsapp_product_opportunity_truth_guard_v22', 'whatsapp_sales_opportunities_v17'),
      trigger('sales_invoice_item_product_reconcile_v22', 'sales_invoice_items_v21'),
      trigger('conversation_review_supersede_legacy_v2', 'conversation_sales_reviews'),
      sql('view conversation_sales_reviews_canonical_v2', `select to_regclass('public.conversation_sales_reviews_canonical_v2') is not null`, 't'),
    ],
  },
  {
    order: 2, file: '20261005124500_automatic_review_writer_guard_v2.sql', after: [],
    objects: 'automatic conversation-review writer guard function and trigger',
    mutatesData: 'no', lockRisk: 'low: one CREATE TRIGGER on conversation_sales_reviews',
    reversal: 'drop trigger automatic_conversation_review_writer_guard_v2 and its function',
    assertions: [fn('dawaa_guard_automatic_conversation_review_writer_v2()')],
  },
  {
    order: 3, file: '20261005131000_followup_writer_surface_hardening_v2.sql', after: [],
    objects: 'dawaa_current_followup_actor_v2; renames correct/merge/transfer/import writers to *_legacy_* (service-only) and installs session-bound wrappers; revokes client EXECUTE on 9 maintenance functions',
    mutatesData: 'no', lockRisk: 'none (catalog only)',
    reversal: 'drop the wrappers and rename the *_legacy_* bodies back; re-grant the previous EXECUTE list',
    rerunnable: false,
    assertions: [
      fn('dawaa_current_followup_actor_v2(text)'),
      fn('transfer_customer_followup_branch_legacy_v1(text,text,text,text,text)'),
      noClientExecute('transfer_customer_followup_branch_legacy_v1(text,text,text,text,text)'),
      clientExecute('transfer_customer_followup_branch_v1(text,text,text,text,text)'),
      noClientExecute('repair_customer_followup_duplicates_and_branches()'),
    ],
  },
  {
    order: 4, file: '20261005133000_monthly_evidence_canonical_reads_v2.sql', after: [1],
    objects: 'dawaa_monthly_evaluation_server_evidence_v5 reads canonical reviews',
    mutatesData: 'HISTORICAL DML: two one-time UPDATEs of conversation_sales_reviews.is_current. EXCLUDED from staging (scripts/staging/historical-dml.mjs) and must never be replayed',
    lockRisk: 'none for the DDL part',
    reversal: 'restore the previous function body (20260930155500)',
    assertions: [fn('dawaa_monthly_evaluation_server_evidence_v5(uuid,date)')],
  },
  {
    order: 5, file: '20261005134500_customer_followup_request_writer_guard_v2.sql', after: [],
    objects: 'renames dawaa_create_customer_followup_request_v1 to *_legacy_v1 and installs a guarded v1',
    mutatesData: 'no', lockRisk: 'none (catalog only)', rerunnable: false,
    reversal: 'drop the new v1 and rename the legacy body back',
    assertions: [fn('dawaa_create_customer_followup_request_legacy_v1(jsonb)'), noClientExecute('dawaa_create_customer_followup_request_legacy_v1(jsonb)')],
  },
  {
    order: 6, file: '20261005135500_automatic_review_guard_order_v2.sql', after: [2],
    objects: 'moves the review writer guard to zzzz_ so it runs last',
    mutatesData: 'no', lockRisk: 'low: trigger drop/create on conversation_sales_reviews',
    reversal: 'recreate automatic_conversation_review_writer_guard_v2 and drop the zzzz_ trigger',
    assertions: [
      trigger('zzzz_automatic_conversation_review_writer_guard_v2', 'conversation_sales_reviews'),
      noTrigger('automatic_conversation_review_writer_guard_v2', 'conversation_sales_reviews'),
    ],
  },
  {
    order: 7, file: '20261005141000_whatsapp_action_truth_guard_v2.sql', after: [],
    objects: 'action truth guard trigger; approve-customer-request command; materialize v1 becomes a session-bound wrapper over the service-only core_v2',
    mutatesData: 'HISTORICAL DML: one-time UPDATE demoting ready customer_request actions to proposed. EXCLUDED from staging and must never be replayed',
    lockRisk: 'low: one CREATE TRIGGER on whatsapp_conversation_actions',
    reversal: 'drop the guard trigger and the approve command; restore the previous materialize ACL',
    assertions: [
      trigger('whatsapp_conversation_action_truth_guard_v2', 'whatsapp_conversation_actions'),
      fn('dawaa_materialize_whatsapp_action_v1(uuid)'),
      noClientExecute('dawaa_materialize_whatsapp_action_core_v2(uuid)'),
    ],
  },
  {
    order: 8, file: '20261005150000_monthly_evidence_attendance_type_fix_v2.sql', after: [4],
    objects: 'dawaa_monthly_evaluation_server_evidence_v5 attendance type fix', mutatesData: 'no', lockRisk: 'none',
    reversal: 'restore the order-4 body', assertions: [fn('dawaa_monthly_evaluation_server_evidence_v5(uuid,date)')],
  },
  {
    order: 9, file: '20261005153000_public_rls_surface_hardening_v2.sql', after: [],
    objects: 'RLS on notification_sla_policies (with an authenticated read policy), sales_import_bridge_tokens_20260908, task_activity_log',
    mutatesData: 'no', lockRisk: 'low: ALTER TABLE ENABLE RLS takes a brief ACCESS EXCLUSIVE lock per table',
    reversal: 'disable RLS on the three tables and drop the policy',
    assertions: [rls('notification_sla_policies'), rls('sales_import_bridge_tokens_20260908'), rls('task_activity_log'),
      policy('notification_sla_policies_authenticated_read_v2', 'notification_sla_policies')],
  },
  {
    order: 10, file: '20261005170000_conversation_review_points_staff_session_v1.sql', after: [],
    objects: 'record_conversation_review_points_v1 bound to the staff session', mutatesData: 'no', lockRisk: 'none',
    reversal: 'restore the previous body', assertions: [fn('record_conversation_review_points_v1(text,uuid)')],
  },
  {
    order: 11, file: '20261008073930_whatsapp_story_events_update_policy_v16.sql', after: [],
    objects: 'UPDATE policy on whatsapp_customer_story_events', mutatesData: 'no', lockRisk: 'low: CREATE POLICY',
    reversal: 'drop policy whatsapp_customer_story_events_update_v16 (recorded applied in Production; do not replay there)',
    assertions: [policy('whatsapp_customer_story_events_update_v16', 'whatsapp_customer_story_events')],
  },
  {
    order: 12, file: '20261008104059_whatsapp_evidence_journey_link_staff_session_v1.sql', after: [],
    objects: 'dawaa_link_whatsapp_evidence_journey_session_v1 staff-session command', mutatesData: 'no (the command body writes when called)', lockRisk: 'none',
    reversal: 'drop the function (recorded applied in Production; do not replay there)',
    assertions: [fn('dawaa_link_whatsapp_evidence_journey_session_v1(text,uuid,uuid,uuid[])')],
  },
  {
    order: 13, file: '20261008160000_conversation_review_manager_correction_versioning_v1.sql', after: [1, 2, 6, 10],
    objects: 'correction lineage columns + CHECK on conversation_sales_reviews; rebuilds 3 unique indexes and adds 4; freeze trigger; case lifecycle trigger; correction command; official/canonical views',
    mutatesData: 'no row writes; ALTER TABLE adds columns',
    lockRisk: 'HIGH: ADD CONSTRAINT validates every row and the index rebuilds are not CONCURRENTLY, so writes to conversation_sales_reviews block for the build; run off-hours after the duplicate pre-check',
    reversal: 'drop the new indexes/triggers/views/command, recreate the 3 previous unique indexes, drop the added columns only if unused',
    assertions: [
      index('conversation_sales_reviews_one_current_case_uk'), index('conversation_sales_reviews_supersedes_uk'),
      trigger('zzzzz_conversation_review_superseded_freeze_v1', 'conversation_sales_reviews'),
      fn('dawaa_correct_conversation_review_session_v1(text,uuid,uuid,text,jsonb)'),
    ],
  },
  {
    order: 14, file: '20261009100000_customer_followup_linked_retry_lineage_v1.sql', after: [],
    objects: 'find_or_create_open_customer_followup replay scope from event lineage; replay lookup index',
    mutatesData: 'no', lockRisk: 'medium: CREATE INDEX (not CONCURRENTLY) on customer_service_followup_events blocks writes while it builds',
    reversal: 'restore the captured previous body (followup-core-live-definitions.json); drop the index',
    assertions: [index('customer_service_followup_events_client_request_replay_idx'), noClientExecute('find_or_create_open_customer_followup(text,text,text,text,text,text,text,text,text,date,text,text,text,text)')],
  },
  {
    order: 15, file: '20261009103000_preserve_conversation_followup_branch_v1.sql', after: [],
    objects: 'conversation lineage predicate; customer branch sync skips conversation follow-ups; 2 lineage indexes',
    mutatesData: 'no', lockRisk: 'medium: two CREATE INDEX (not CONCURRENTLY) block writes to the two tables while they build',
    reversal: 'restore the captured sync body (branch-sync-live-definition.json); drop the predicate and indexes',
    assertions: [fn('dawaa_followup_has_conversation_lineage_v1(text)'), index('whatsapp_actions_followup_target_lineage_idx'),
      noClientExecute('dawaa_followup_has_conversation_lineage_v1(text)')],
  },
  {
    order: 16, file: '20261009130016_whatsapp_operation_attribution_session_v1.sql', after: [7],
    objects: 'customer attribution command for an operation; auto-followup identity trigger WHEN clause',
    mutatesData: 'no', lockRisk: 'low: trigger replace on whatsapp_auto_followup_requests',
    reversal: 'restore the previous trigger WHEN; drop the command',
    assertions: [fn('dawaa_correct_whatsapp_operation_attribution_session_v1(text,text,uuid,text,uuid,jsonb,uuid)')],
  },
  {
    order: 17, file: '20261009170000_followup_branch_provenance_guard_v1.sql', after: [3, 15],
    objects: 'source-owned branch rule: 3 helpers, guard trigger function, transfer/correct/repair/merge bodies, 2 zzz_ backstop triggers',
    mutatesData: 'no', lockRisk: 'low: two CREATE TRIGGER (daily_followups, customer_service_daily_queue_items)',
    reversal: 'drop the two triggers and the helpers; CREATE OR REPLACE the previous bodies (order 3, 20260721, 20260720, 20260726232000)',
    assertions: [
      trigger('zzz_daily_followups_conversation_branch_guard_v1', 'daily_followups'),
      trigger('zzz_queue_items_conversation_branch_guard_v1', 'customer_service_daily_queue_items'),
      noClientExecute('dawaa_followup_branch_change_allowed_v1(text,text)'),
    ],
  },
  {
    order: 18, file: '20261009180000_customer_followup_one_open_case_contract_a_v1.sql', after: [14],
    objects: 'contract A: find_or_create, exceptional create and duplicate listing key on customer + branch',
    mutatesData: 'no', lockRisk: 'none (function bodies only)',
    reversal: 'CREATE OR REPLACE the order-14 find_or_create body, the 20260719 exceptional body and the 20260720 listing body',
    assertions: [
      sql('find_or_create has no request_type lookup', `select position('= v_case_type' in prosrc) = 0 from pg_proc where oid='public.find_or_create_open_customer_followup(text,text,text,text,text,text,text,text,text,date,text,text,text,text)'::regprocedure`, 't'),
      clientExecute('dawaa_create_exceptional_followup_v2(text,text,text,text,text,text,text,text,text,text,text,text,text)'),
      index('daily_followups_one_open_case_per_customer_branch_uidx'),
    ],
  },
];
