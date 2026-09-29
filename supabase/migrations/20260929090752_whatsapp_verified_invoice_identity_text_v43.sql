-- V43: align Customer Case verified invoice identity with canonical sales_invoices.id.
-- sales_invoices.id is TEXT (including historical non-UUID identities), so the Case truth field
-- must not narrow that identity to UUID. Preserve every dependent read model and the canonical
-- story trigger exactly while changing only the column type.

do $migration$
declare
  v_queue22 text;
  v_queue23 text;
  v_doctor_kpi text;
  v_service_kpi text;
  v_lost_detail text;
  v_doctor_cycle text;
  v_lost_reason text;
  v_rescue_queue text;
  v_trigger text;
begin
  select regexp_replace(pg_get_viewdef('public.whatsapp_customer_case_queue_v22'::regclass, true), ';[[:space:]]*$', '') into v_queue22;
  select regexp_replace(pg_get_viewdef('public.whatsapp_customer_case_queue_v23'::regclass, true), ';[[:space:]]*$', '') into v_queue23;
  select regexp_replace(pg_get_viewdef('public.whatsapp_case_doctor_kpis_v23'::regclass, true), ';[[:space:]]*$', '') into v_doctor_kpi;
  select regexp_replace(pg_get_viewdef('public.whatsapp_case_service_kpis_v23'::regclass, true), ';[[:space:]]*$', '') into v_service_kpi;
  select regexp_replace(pg_get_viewdef('public.whatsapp_lost_opportunity_detail_v24'::regclass, true), ';[[:space:]]*$', '') into v_lost_detail;
  select regexp_replace(pg_get_viewdef('public.whatsapp_doctor_lost_opportunity_cycle_v24'::regclass, true), ';[[:space:]]*$', '') into v_doctor_cycle;
  select regexp_replace(pg_get_viewdef('public.whatsapp_lost_reason_cycle_v24'::regclass, true), ';[[:space:]]*$', '') into v_lost_reason;
  select regexp_replace(pg_get_viewdef('public.whatsapp_rescue_queue_v24'::regclass, true), ';[[:space:]]*$', '') into v_rescue_queue;
  select pg_get_triggerdef(t.oid, true)
    into v_trigger
  from pg_trigger t
  join pg_class c on c.oid=t.tgrelid
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
    and c.relname='whatsapp_customer_cases_v22'
    and t.tgname='trg_whatsapp_story_canonical_purchase_v36'
    and not t.tgisinternal;

  execute 'drop view public.whatsapp_rescue_queue_v24';
  execute 'drop view public.whatsapp_lost_reason_cycle_v24';
  execute 'drop view public.whatsapp_doctor_lost_opportunity_cycle_v24';

  execute 'drop view public.whatsapp_lost_opportunity_detail_v24';
  execute 'drop view public.whatsapp_customer_case_queue_v23';
  execute 'drop view public.whatsapp_customer_case_queue_v22';
  execute 'drop view public.whatsapp_case_service_kpis_v23';
  execute 'drop view public.whatsapp_case_doctor_kpis_v23';

  execute 'drop trigger trg_whatsapp_story_canonical_purchase_v36 on public.whatsapp_customer_cases_v22';

  alter table public.whatsapp_customer_cases_v22
    alter column verified_invoice_id type text
    using verified_invoice_id::text;

  execute 'create view public.whatsapp_customer_case_queue_v22 with (security_invoker=true) as ' || v_queue22;
  execute 'create view public.whatsapp_customer_case_queue_v23 with (security_invoker=true) as ' || v_queue23;
  execute 'create view public.whatsapp_case_doctor_kpis_v23 with (security_invoker=true) as ' || v_doctor_kpi;
  execute 'create view public.whatsapp_case_service_kpis_v23 with (security_invoker=true) as ' || v_service_kpi;
  execute 'create view public.whatsapp_lost_opportunity_detail_v24 with (security_invoker=true) as ' || v_lost_detail;

  execute 'create view public.whatsapp_doctor_lost_opportunity_cycle_v24 with (security_invoker=true) as ' || v_doctor_cycle;
  execute 'create view public.whatsapp_lost_reason_cycle_v24 with (security_invoker=true) as ' || v_lost_reason;
  execute 'create view public.whatsapp_rescue_queue_v24 with (security_invoker=true) as ' || v_rescue_queue;

  execute v_trigger;

  grant all privileges on table public.whatsapp_customer_case_queue_v22 to anon, authenticated, service_role;
  grant all privileges on table public.whatsapp_customer_case_queue_v23 to anon, authenticated, service_role;
  grant all privileges on table public.whatsapp_case_doctor_kpis_v23 to anon, authenticated, service_role;
  grant all privileges on table public.whatsapp_case_service_kpis_v23 to anon, authenticated, service_role;
  grant all privileges on table public.whatsapp_lost_opportunity_detail_v24 to anon, authenticated, service_role;
  grant all privileges on table public.whatsapp_doctor_lost_opportunity_cycle_v24 to anon, authenticated, service_role;
  grant all privileges on table public.whatsapp_lost_reason_cycle_v24 to anon, authenticated, service_role;
  grant all privileges on table public.whatsapp_rescue_queue_v24 to anon, authenticated, service_role;
end
$migration$;
