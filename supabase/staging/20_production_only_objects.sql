-- STAGING BOOTSTRAP 20 — Production-only indexes and function signatures the RC migrations assume.
-- Every object is classified with its source. "stub" = the migrations only rename / revoke / grant /
-- comment it, so its signature must exist; its body is NOT exercised by the staging tests and raises if
-- called. Captured Production bodies (followup-core-live-definitions.json, branch-sync-live-definition.json)
-- and repository bodies are loaded by scripts/staging/run-fresh-staging.mjs, not copied here.

-- index | Production-only | daily_followups_one_open_case_per_customer_branch_uidx | Production has it on
-- (identity_key, branch) for open rows; the exact predicate is not in the repo (schema-drift.csv). The
-- broadest plausible open predicate is used, so staging is at least as strict as Production.
create unique index daily_followups_one_open_case_per_customer_branch_uidx
  on public.daily_followups (identity_key, branch)
  where identity_key is not null and completed_at is null and cancelled_at is null and archived_at is null;
-- index | repo 20260720_customer_followup_find_or_create_open_case.sql (also live)
create unique index daily_followups_client_request_id_uidx
  on public.daily_followups (client_request_id)
  where client_request_id is not null and btrim(client_request_id) <> '';
-- index | Production-only | the stable operation identity keys (names from schema-drift.csv; column is the key's name)
create unique index whatsapp_conversation_actions_followup_identity_uk on public.whatsapp_conversation_actions (followup_identity);
create unique index whatsapp_auto_followup_requests_followup_identity_uk on public.whatsapp_auto_followup_requests (followup_identity);
-- NOT reproduced (definition unknown, cannot be inferred safely): daily_followups_unique_customer_per_day_v14,
-- daily_followups_one_visible_open_case_uidx, daily_followups_import_fingerprint_uidx and the Production-only
-- daily_followups triggers (trg_daily_followups_identity_key, _dedupe, _guard_insert, validate_daily_followup_write).

-- function | stub | Production-only body (not in repo)
create function public.dawaa_reconcile_whatsapp_product_conversion_v21(p_item_id uuid) returns integer language plpgsql as $$ begin raise exception 'staging_stub_production_only_body'; end $$;
create function public.settle_monthly_narrative_evaluation(uuid) returns void language plpgsql as $$ begin raise exception 'staging_stub_production_only_body'; end $$;
create function public.apply_followup_incentive_points() returns trigger language plpgsql as $$ begin raise exception 'staging_stub_production_only_body'; end $$;
create function public.compute_followup_points(text) returns void language plpgsql as $$ begin raise exception 'staging_stub_production_only_body'; end $$;
create function public.dawaa_sync_whatsapp_action_evidence_v17() returns trigger language plpgsql as $$ begin raise exception 'staging_stub_production_only_body'; end $$;
create function public.dawaa_sync_whatsapp_invoice_evidence_v17() returns trigger language plpgsql as $$ begin raise exception 'staging_stub_production_only_body'; end $$;
create function public.flag_burst_followup_registrations() returns trigger language plpgsql as $$ begin raise exception 'staging_stub_production_only_body'; end $$;
create function public.import_customer_followup_results_v1(uuid, text, text, jsonb) returns jsonb language plpgsql as $$ begin raise exception 'staging_stub_production_only_body'; end $$;
create function public.import_customer_service_queue_results_v3(uuid, text, text, jsonb) returns jsonb language plpgsql as $$ begin raise exception 'staging_stub_production_only_body'; end $$;
create function public.dawaa_create_customer_followup_request_v1(jsonb) returns jsonb language plpgsql as $$ begin raise exception 'staging_stub_production_only_body'; end $$;
-- function | stub | repo body exists but is only revoked/renamed by the RC migrations (file named)
create function public.create_or_link_customer_followup(jsonb) returns jsonb language plpgsql as $$ begin raise exception 'staging_stub_repo_body_20260720_customer_followup_hardening_live'; end $$;
create function public.create_customer_request_canonical_v1(uuid, uuid, uuid, text, numeric, text, text, text, date, integer, text, text, text, text) returns jsonb language plpgsql as $$ begin raise exception 'staging_stub_repo_body_20260824140000'; end $$;
create function public.save_staff_monthly_evaluation_safe(uuid, jsonb) returns jsonb language plpgsql as $$ begin raise exception 'staging_stub_repo_body_20260827054500'; end $$;
create function public.settle_doctor_self_logged_followup(text) returns void language plpgsql as $$ begin raise exception 'staging_stub_repo_body_20260830204000'; end $$;
create function public.settle_followup_doctor_points(text, text) returns void language plpgsql as $$ begin raise exception 'staging_stub_repo_body_20260829220000'; end $$;
create function public.trg_monthly_narrative_evaluation_notify() returns trigger language plpgsql as $$ begin raise exception 'staging_stub_repo_body_20260829190000'; end $$;
create function public.import_customer_service_queue_results_v2(uuid, text, text, jsonb) returns jsonb language plpgsql as $$ begin raise exception 'staging_stub_repo_body_20260813024500'; end $$;
create function public.import_customer_service_queue_results_v4(uuid, text, text, jsonb) returns jsonb language plpgsql as $$ begin raise exception 'staging_stub_repo_body_20260814_customer_service_doctor_workbook_v4'; end $$;
