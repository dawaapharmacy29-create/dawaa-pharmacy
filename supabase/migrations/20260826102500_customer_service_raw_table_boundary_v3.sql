create or replace function public.dawaa_can_read_customer_service_branch_v1(p_branch text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth, pg_catalog
as $function$
declare
  a public.staff_accounts;
  v_id uuid;
  v_role text;
  v_branch text;
begin
  v_id := public.dawaa_current_staff_account_id_strict();
  if v_id is null then return false; end if;

  select * into a
  from public.staff_accounts
  where id = v_id
    and coalesce(active,false)
    and coalesce(can_login,false);
  if not found then return false; end if;

  v_role := lower(trim(coalesce(a.role,a.staff_role,'')));
  v_branch := nullif(trim(coalesce(a.branch,'')), '');

  if v_role in ('admin','owner','general_manager','executive_manager','branches_manager','manager') then
    return true;
  end if;

  return v_branch is not null
    and nullif(trim(coalesce(p_branch,'')), '') is not null
    and v_branch = trim(p_branch);
end
$function$;

revoke all on function public.dawaa_can_read_customer_service_branch_v1(text) from public;
grant execute on function public.dawaa_can_read_customer_service_branch_v1(text) to anon, authenticated, service_role;

alter table public.daily_followups enable row level security;
drop policy if exists daily_followups_delete_identified on public.daily_followups;
drop policy if exists daily_followups_insert_app on public.daily_followups;
drop policy if exists daily_followups_select_app on public.daily_followups;
drop policy if exists daily_followups_update_app on public.daily_followups;

create policy daily_followups_branch_select_v3
on public.daily_followups
for select
to anon, authenticated
using (public.dawaa_can_read_customer_service_branch_v1(branch));

revoke insert, update, delete on table public.daily_followups from anon, authenticated;
grant select on table public.daily_followups to anon, authenticated;

alter table public.customer_followup_events enable row level security;
drop policy if exists customer_followup_events_staff_select on public.customer_followup_events;
create policy customer_followup_events_branch_select_v3
on public.customer_followup_events
for select
to anon, authenticated
using (
  public.dawaa_can_read_customer_service_branch_v1(branch)
  or exists (
    select 1
    from public.daily_followups f
    where f.id::text = customer_followup_events.followup_id::text
      and public.dawaa_can_read_customer_service_branch_v1(f.branch)
  )
);
grant select on table public.customer_followup_events to anon, authenticated;

select pg_notify('pgrst','reload schema');