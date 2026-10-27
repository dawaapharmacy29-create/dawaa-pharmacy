-- Customer requests: evaluate the reader's branch scope once per query, not per row.
--
-- Production (2026-10-27): customer_requests_scoped_select called
-- dawaa_can_access_customer_request_branch('view_customer_requests', branch) for every
-- row. That SECURITY DEFINER plpgsql function resolves the session actor, checks the
-- permission (2 queries) and reads the staff account on each call. With 1,253 rows the
-- policy alone cost >= 548 ms even without a session; the request-center summary RPC
-- (SECURITY INVOKER, all rows through RLS) averaged 1,134 ms / max 5,174 ms in
-- pg_stat_statements, but 56 ms when RLS is bypassed.
--
-- The new function performs the SAME checks in the SAME order and returns the scope
-- instead of a per-row answer:
--   NULL               -> no access (no actor / no permission / inactive account)
--   '__all_branches__' -> global roles
--   branch key         -> own branch only (NULL when the account has no branch key)
-- Policies compare each row's branch key with that scope, wrapped in (select ...) so
-- PostgreSQL evaluates it once per statement (initplan). Visible rows are identical:
-- the old per-row result was true exactly when scope = '__all_branches__' or
-- key(row.branch) = scope (key(v_branch) not null and equal).
-- Insert policies and dawaa_can_access_customer_request_branch are unchanged.

create or replace function public.dawaa_customer_request_read_scope_v1(p_permission text)
returns text
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor_id uuid;
  v_role text;
  v_branch text;
begin
  v_actor_id := public.dawaa_current_staff_account_id_strict();
  if v_actor_id is null then return null; end if;
  if not public.dawaa_customer_request_permission_allowed(v_actor_id, p_permission) then return null; end if;

  select lower(trim(coalesce(sa.role,''))), sa.branch
    into v_role, v_branch
  from public.staff_accounts sa
  where sa.id = v_actor_id
    and coalesce(sa.active,false)
    and coalesce(sa.can_login,false)
  limit 1;

  if not found then return null; end if;
  if v_role in ('general_manager','executive_manager','branches_manager','admin') then return '__all_branches__'; end if;

  return public.dawaa_customer_request_branch_key(v_branch);
end;
$function$;

revoke all on function public.dawaa_customer_request_read_scope_v1(text) from public;
grant execute on function public.dawaa_customer_request_read_scope_v1(text) to anon, authenticated, service_role;

drop policy if exists customer_requests_scoped_select on public.customer_requests;
create policy customer_requests_scoped_select on public.customer_requests
  for select to anon, authenticated
  using (
    (select public.dawaa_customer_request_read_scope_v1('view_customer_requests')) = '__all_branches__'
    or public.dawaa_customer_request_branch_key(branch)
       = (select public.dawaa_customer_request_read_scope_v1('view_customer_requests'))
  );

drop policy if exists customer_request_events_scoped_select on public.customer_request_events;
create policy customer_request_events_scoped_select on public.customer_request_events
  for select to anon, authenticated
  using (
    exists (
      select 1
      from public.customer_requests cr
      where cr.id = customer_request_events.request_id
        and (
          (select public.dawaa_customer_request_read_scope_v1('view_customer_requests')) = '__all_branches__'
          or public.dawaa_customer_request_branch_key(cr.branch)
             = (select public.dawaa_customer_request_read_scope_v1('view_customer_requests'))
        )
    )
  );

comment on function public.dawaa_customer_request_read_scope_v1(text) is
  'Reader scope for customer requests (NULL | __all_branches__ | branch key); same checks as dawaa_can_access_customer_request_branch, evaluated once per statement in RLS.';
