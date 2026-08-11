alter table public.customer_requests
  add column if not exists primary_responsible_id uuid,
  add column if not exists primary_responsible_name text,
  add column if not exists primary_responsible_role text;

create or replace function public.resolve_active_branch_manager(p_branch text)
returns table(manager_staff_id uuid, manager_name text)
language sql
stable
security definer
set search_path = public
as $$
  select
    case when sa.staff_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then sa.staff_id::uuid else null end,
    coalesce(nullif(trim(sa.staff_name),''), nullif(trim(sa.name),''), nullif(trim(sa.username),''))
  from public.staff_accounts sa
  where coalesce(sa.active,false) = true
    and coalesce(sa.is_active,true) = true
    and sa.role = 'branch_manager'
    and sa.branch = p_branch
  order by sa.updated_at desc nulls last, sa.created_at desc nulls last
  limit 1
$$;

create or replace function public.assign_customer_request_primary_branch_manager()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_manager_id uuid;
  v_manager_name text;
begin
  if new.branch is null or btrim(new.branch) = '' then
    return new;
  end if;

  select manager_staff_id, manager_name
    into v_manager_id, v_manager_name
  from public.resolve_active_branch_manager(new.branch)
  limit 1;

  if v_manager_name is not null then
    new.primary_responsible_id := v_manager_id;
    new.primary_responsible_name := v_manager_name;
    new.primary_responsible_role := 'مدير الفرع';
  end if;

  return new;
end
$$;

drop trigger if exists trg_customer_request_primary_branch_manager on public.customer_requests;
create trigger trg_customer_request_primary_branch_manager
before insert or update of branch on public.customer_requests
for each row execute function public.assign_customer_request_primary_branch_manager();

with managers as (
  select distinct on (sa.branch)
    sa.branch,
    case when sa.staff_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then sa.staff_id::uuid else null end as manager_staff_id,
    coalesce(nullif(trim(sa.staff_name),''), nullif(trim(sa.name),''), nullif(trim(sa.username),'')) as manager_name
  from public.staff_accounts sa
  where coalesce(sa.active,false) = true
    and coalesce(sa.is_active,true) = true
    and sa.role = 'branch_manager'
    and sa.branch is not null
  order by sa.branch, sa.updated_at desc nulls last, sa.created_at desc nulls last
)
update public.customer_requests cr
set primary_responsible_id = m.manager_staff_id,
    primary_responsible_name = m.manager_name,
    primary_responsible_role = 'مدير الفرع'
from managers m
where cr.branch = m.branch
  and m.manager_name is not null
  and (cr.primary_responsible_name is distinct from m.manager_name
       or cr.primary_responsible_id is distinct from m.manager_staff_id
       or cr.primary_responsible_role is distinct from 'مدير الفرع');

create index if not exists idx_customer_requests_primary_responsible
  on public.customer_requests(primary_responsible_id);
