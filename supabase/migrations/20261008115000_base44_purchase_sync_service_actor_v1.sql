-- Base44 purchase-invoice sync: machine path without a forged staff identity.
--
-- The base44-purchase-invoice-sync Edge Function (pg_cron, every 15 min) called
-- import_base44_purchase_invoices_v1 as `anon` with a constant `x-dawaa-user-id` (a real staff
-- account) only to satisfy the staff-actor checks. Migration 20261008120000 stops trusting that
-- header, which would make every sync fail with 'active staff actor required'.
--
-- Fix: the human staff checks apply to client requests (anon / authenticated). Server callers
-- (service_role, cron, migrations) skip them; service_role already bypasses RLS and can write
-- base44_purchase_invoice_sync directly, so no privilege is added. The Edge Function must call the
-- RPC with its service_role client (supabase/functions/base44-purchase-invoice-sync/index.ts).
--
-- Order: apply this migration, then deploy the Edge Function, then 20261008120000.
-- Until the Edge Function is redeployed, its anon + header call keeps working unchanged.
-- Rollback: supabase/sql/ROLLBACK_20261008_base44_purchase_sync_service_actor_v1.sql

-- Identical to the definition in 20261008120000 (that migration re-creates it unchanged).
create or replace function public.dawaa_request_context_is_client_v1()
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog'
as $function$
  with claims as (
    select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') as role
  )
  select c.role in ('anon', 'authenticated')
      or (session_user = 'authenticator' and c.role <> 'service_role')
  from claims c
$function$;
revoke all on function public.dawaa_request_context_is_client_v1() from public;
grant execute on function public.dawaa_request_context_is_client_v1() to anon, authenticated, service_role;

do $$
declare
  v_sig constant regprocedure := 'public.import_base44_purchase_invoices_v1(jsonb)'::regprocedure;
  v_def text := pg_get_functiondef('public.import_base44_purchase_invoices_v1(jsonb)'::regprocedure);
  v_checks constant text := $q$  select * into v_account
  from public.staff_accounts
  where id = public.dawaa_current_staff_account_id_strict()
    and coalesce(active, false) and coalesce(can_login, false);
  if not found then raise exception using errcode = '42501', message = 'active staff actor required'; end if;

  if not public.dawaa_is_customer_service_evaluator_v1(public.dawaa_current_staff_subject_uuid_v1(), lower(trim(coalesce(v_account.role, '')))) then
    raise exception using errcode = '42501', message = 'purchase invoice sync permission required';
  end if;
$q$;
  v_guarded constant text := $q$  -- Staff checks apply to client requests only; service_role/cron run as the system (base44 sync v1).
  if public.dawaa_request_context_is_client_v1() then
  select * into v_account
  from public.staff_accounts
  where id = public.dawaa_current_staff_account_id_strict()
    and coalesce(active, false) and coalesce(can_login, false);
  if not found then raise exception using errcode = '42501', message = 'active staff actor required'; end if;

  if not public.dawaa_is_customer_service_evaluator_v1(public.dawaa_current_staff_subject_uuid_v1(), lower(trim(coalesce(v_account.role, '')))) then
    raise exception using errcode = '42501', message = 'purchase invoice sync permission required';
  end if;
  end if;
$q$;
begin
  if position(v_guarded in v_def) > 0 then
    return; -- already applied
  end if;
  if (length(v_def) - length(replace(v_def, v_checks, ''))) / length(v_checks) <> 1 then
    raise exception 'base44 sync: staff check block not found exactly once in %', v_sig;
  end if;
  execute replace(v_def, v_checks, v_guarded);
end $$;
