-- Preserve the existing service-role caller when client identity headers are no longer trusted.
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

grant execute on function public.import_base44_purchase_invoices_v1(jsonb) to service_role;

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
  v_guarded constant text := $q$  -- Client callers must present a verified staff identity.
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
    return;
  end if;
  if (length(v_def) - length(replace(v_def, v_checks, ''))) / length(v_checks) <> 1 then
    raise exception 'service actor compatibility: staff check block not found exactly once in %', v_sig;
  end if;
  execute replace(v_def, v_checks, v_guarded);
end $$;
