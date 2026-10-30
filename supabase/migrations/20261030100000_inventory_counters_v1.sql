-- Inventory counters v1 (owner decision 2026-10-30).
-- Only the named inventory counters take part in the weekly count, each for their branch or for every
-- branch. The branch manager and top management keep planning and reviewing (scope 'manage'); counting
-- and reading move from "any assistant/pharmacist of the branch" to the counters list.

create table if not exists public.inventory_counters (
  staff_account_id uuid primary key references public.staff_accounts(id),
  branch_scope text not null check (branch_scope in ('shokry', 'elshamy', 'ALL')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now()
);

alter table public.inventory_counters enable row level security;
revoke all on public.inventory_counters from anon, authenticated;

-- Seed: the counters named by the owner (accounts that exist today). Missing accounts are skipped.
insert into public.inventory_counters (staff_account_id, branch_scope)
select v.id, v.scope
from (values
  ('1692e0f2-8265-4770-89c2-0028c19895b5'::uuid, 'shokry'),   -- ا عبد الحميد
  ('d8513d63-aa80-43c8-8d45-0fbf652d00f2'::uuid, 'shokry'),   -- حبيبة تامر
  ('bd3f49c8-5532-46eb-909d-3450d43ba03f'::uuid, 'elshamy'),  -- د هدي
  ('ced3cd1a-07b6-4b09-952c-b15ff5247f6d'::uuid, 'elshamy'),  -- يوسف عصام
  ('4d8a2d9f-1771-4556-88ab-2a656d8fb006'::uuid, 'elshamy'),  -- محمد عمر
  ('ccf7b7e7-0912-4d54-8f94-5c6c02ebc48f'::uuid, 'ALL'),      -- هبه محمد
  ('3ce8b0bd-6bc2-4d33-948d-9bb55933e650'::uuid, 'ALL'),      -- محمد عبد الرحمن
  ('b7fb5ef3-dab7-4621-8896-63c73f2aeba7'::uuid, 'ALL'),      -- هاجر
  ('09666943-7fea-4661-80cc-ae87e70b196d'::uuid, 'ALL')       -- نور
) as v(id, scope)
where exists (select 1 from public.staff_accounts sa where sa.id = v.id)
on conflict (staff_account_id) do nothing;

-- 'count': a named active counter of that branch (or every branch), or anyone who may manage it.
create or replace function public.inventory_count_actor_scope_v1(p_action text)
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select case p_action
    when 'manage' then public.dawaa_current_operational_write_scope_v1(array['manage_inventory'], array['branch_manager'])
    when 'count' then coalesce(
      (select case when bool_or(c.branch_scope = 'ALL') then 'ALL' else min(c.branch_scope) end
       from public.inventory_counters c
       join public.staff_accounts sa on sa.id = c.staff_account_id
       where c.staff_account_id = public.dawaa_current_staff_account_id_strict()
         and c.active and coalesce(sa.active, false) and coalesce(sa.can_login, false)),
      'NONE')
    else 'NONE'
  end;
$function$;

create or replace function public.inventory_count_actor_allows_branch_v1(p_action text, p_branch text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select case
    when p_action = 'count' and public.inventory_count_actor_allows_branch_v1('manage', p_branch) then true
    when public.inventory_count_actor_scope_v1(p_action) = 'ALL' then true
    when public.inventory_count_actor_scope_v1(p_action) = 'NONE' then false
    else public.inventory_count_actor_scope_v1(p_action) = public.dawaa_customer_request_branch_key(p_branch)
  end;
$function$;

-- The counters list, for the page: who counts which branch (managers see all; a counter sees the list too).
create or replace function public.list_inventory_counters_v1()
returns table (staff_account_id uuid, name text, branch_scope text, active boolean, can_login boolean)
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select c.staff_account_id, sa.name, c.branch_scope, c.active, coalesce(sa.active, false) and coalesce(sa.can_login, false)
  from public.inventory_counters c
  join public.staff_accounts sa on sa.id = c.staff_account_id
  where public.inventory_count_actor_scope_v1('manage') <> 'NONE' or public.inventory_count_actor_scope_v1('count') <> 'NONE'
  order by c.branch_scope, sa.name;
$function$;

-- Top management adds, moves or removes a counter.
create or replace function public.set_inventory_counter_v1(p_staff_account_id uuid, p_branch_scope text, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := public.dawaa_current_staff_account_id_strict();
begin
  if v_actor is null or public.inventory_count_actor_scope_v1('manage') <> 'ALL' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_branch_scope not in ('shokry', 'elshamy', 'ALL') then raise exception 'invalid_branch_scope'; end if;
  if not exists (select 1 from public.staff_accounts where id = p_staff_account_id) then raise exception 'staff_not_found'; end if;
  insert into public.inventory_counters (staff_account_id, branch_scope, active, created_by)
  values (p_staff_account_id, p_branch_scope, coalesce(p_active, true), v_actor)
  on conflict (staff_account_id) do update
    set branch_scope = excluded.branch_scope, active = excluded.active, updated_at = now();
  return jsonb_build_object('staff_account_id', p_staff_account_id, 'branch_scope', p_branch_scope, 'active', coalesce(p_active, true));
end;
$function$;

revoke all on function public.list_inventory_counters_v1() from public;
revoke all on function public.set_inventory_counter_v1(uuid, text, boolean) from public;
grant execute on function public.list_inventory_counters_v1() to anon, authenticated;
grant execute on function public.set_inventory_counter_v1(uuid, text, boolean) to anon, authenticated;
