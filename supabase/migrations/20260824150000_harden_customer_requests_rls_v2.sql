-- Harden Customer Requests and their audit events for the app's custom staff auth flow.
-- Sensitive actions use canonical permissions; role remains data-scope context only.

create or replace function public.dawaa_customer_request_branch_key(p_branch text)
returns text
language sql
immutable
set search_path = public, pg_catalog
as $$
  select case
    when lower(trim(coalesce(p_branch,''))) in ('فرع شكري','شكري','shokry','shoukry') then 'shokry'
    when lower(trim(coalesce(p_branch,''))) in ('فرع الشامي','الشامي','الشامى','elshamy','el-shamy','alshamy') then 'elshamy'
    when trim(coalesce(p_branch,'')) = '' then null
    else lower(trim(p_branch))
  end
$$;

create or replace function public.dawaa_can_access_customer_request_branch(
  p_permission text,
  p_branch text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor_id uuid;
  v_role text;
  v_branch text;
begin
  v_actor_id := public.dawaa_current_staff_account_id_strict();
  if v_actor_id is null then return false; end if;
  if not public.user_has_permission(v_actor_id, p_permission) then return false; end if;

  select lower(trim(coalesce(sa.role,''))), sa.branch
    into v_role, v_branch
  from public.staff_accounts sa
  where sa.id = v_actor_id
    and coalesce(sa.active,false)
    and coalesce(sa.can_login,false)
  limit 1;

  if not found then return false; end if;
  if v_role in ('general_manager','executive_manager','branches_manager','admin') then return true; end if;

  return public.dawaa_customer_request_branch_key(v_branch) is not null
    and public.dawaa_customer_request_branch_key(v_branch) = public.dawaa_customer_request_branch_key(p_branch);
end;
$$;

alter table public.customer_requests enable row level security;
alter table public.customer_request_events enable row level security;

drop policy if exists customer_requests_admin_all on public.customer_requests;
drop policy if exists customer_requests_auth_insert on public.customer_requests;
drop policy if exists customer_requests_insert_anon_internal on public.customer_requests;
drop policy if exists customer_requests_insert_authenticated on public.customer_requests;
drop policy if exists customer_requests_auth_select on public.customer_requests;
drop policy if exists customer_requests_select_anon_internal on public.customer_requests;
drop policy if exists customer_requests_select_authenticated on public.customer_requests;
drop policy if exists customer_requests_auth_update on public.customer_requests;
drop policy if exists customer_requests_update_anon_internal on public.customer_requests;
drop policy if exists customer_requests_update_authenticated on public.customer_requests;

create policy customer_requests_scoped_select
on public.customer_requests
for select
to anon, authenticated
using (public.dawaa_can_access_customer_request_branch('view_customer_requests', branch));

create policy customer_requests_scoped_insert
on public.customer_requests
for insert
to anon, authenticated
with check (public.dawaa_can_access_customer_request_branch('manage_customer_requests', branch));

create policy customer_requests_scoped_update
on public.customer_requests
for update
to anon, authenticated
using (public.dawaa_can_access_customer_request_branch('manage_customer_requests', branch))
with check (public.dawaa_can_access_customer_request_branch('manage_customer_requests', branch));

-- Audit events are append-only from client code.
drop policy if exists customer_request_events_admin_all on public.customer_request_events;
drop policy if exists customer_request_events_auth_insert on public.customer_request_events;
drop policy if exists customer_request_events_insert_anon_internal on public.customer_request_events;
drop policy if exists customer_request_events_auth_select on public.customer_request_events;
drop policy if exists customer_request_events_select_anon_internal on public.customer_request_events;
drop policy if exists customer_request_events_auth_update on public.customer_request_events;
drop policy if exists customer_request_events_update_anon_internal on public.customer_request_events;

create policy customer_request_events_scoped_select
on public.customer_request_events
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.customer_requests cr
    where cr.id = customer_request_events.request_id
      and public.dawaa_can_access_customer_request_branch('view_customer_requests', cr.branch)
  )
);

create policy customer_request_events_scoped_insert
on public.customer_request_events
for insert
to anon, authenticated
with check (
  public.dawaa_current_staff_account_id_strict() is not null
  and exists (
    select 1
    from public.customer_requests cr
    where cr.id = customer_request_events.request_id
      and public.dawaa_can_access_customer_request_branch('manage_customer_requests', cr.branch)
  )
);

-- Deliberately no client UPDATE/DELETE policy for the audit stream.
revoke all on function public.dawaa_customer_request_branch_key(text) from public;
grant execute on function public.dawaa_customer_request_branch_key(text) to anon, authenticated, service_role;
revoke all on function public.dawaa_can_access_customer_request_branch(text,text) from public;
grant execute on function public.dawaa_can_access_customer_request_branch(text,text) to anon, authenticated, service_role;
