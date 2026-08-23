create or replace function public.dawaa_can_manage_branch_targets(p_actor_id uuid default null)
returns boolean
language plpgsql
stable security definer
set search_path to 'public','auth','pg_temp'
as $$
declare
  v_id uuid := coalesce(p_actor_id, public.dawaa_request_staff_id());
  v_role text;
  v_permissions jsonb;
begin
  if v_id is null then return false; end if;

  select lower(trim(coalesce(sa.role,''))), public.get_user_permissions(sa.id)
    into v_role, v_permissions
  from public.staff_accounts sa
  where sa.id = v_id
    and coalesce(sa.active,false) = true
    and coalesce(sa.can_login,false) = true
  limit 1;

  if not found then return false; end if;
  if v_role in ('general_manager','executive_manager','branches_manager','branch_manager') then return true; end if;
  return coalesce((v_permissions ->> 'manage_settings')::boolean,false);
end;
$$;

create or replace function public.set_branch_sales_target(p_branch_name text, p_target_amount numeric, p_actor_id uuid)
returns table(id uuid, branch_name text, cycle_start_day integer, target_amount numeric, active boolean, created_at timestamptz, updated_at timestamptz)
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_branch text := trim(coalesce(p_branch_name,''));
begin
  if v_branch not in ('فرع الشامي','فرع شكري') then raise exception 'فرع غير صحيح'; end if;
  if coalesce(p_target_amount,0) <= 0 then raise exception 'قيمة التارجت يجب أن تكون أكبر من صفر'; end if;
  if not public.dawaa_can_manage_branch_targets(p_actor_id) then raise exception 'ليس لديك صلاحية تعديل تارجت الفروع'; end if;

  insert into public.branch_sales_targets (branch_name,cycle_start_day,target_amount,active,created_at,updated_at)
  values (v_branch,26,p_target_amount,true,now(),now())
  on conflict (branch_name) do update set
    target_amount=excluded.target_amount,
    cycle_start_day=26,
    active=true,
    updated_at=now();

  return query
  select t.id,t.branch_name,t.cycle_start_day,t.target_amount,t.active,t.created_at,t.updated_at
  from public.branch_sales_targets t
  where t.branch_name=v_branch
  order by t.updated_at desc
  limit 1;
end;
$$;

drop policy if exists branch_sales_targets_insert_admin on public.branch_sales_targets;
drop policy if exists branch_sales_targets_update_admin on public.branch_sales_targets;

create policy branch_sales_targets_insert_admin
on public.branch_sales_targets
for insert
to anon, authenticated
with check (public.dawaa_can_manage_branch_targets(public.dawaa_request_staff_id()));

create policy branch_sales_targets_update_admin
on public.branch_sales_targets
for update
to anon, authenticated
using (public.dawaa_can_manage_branch_targets(public.dawaa_request_staff_id()))
with check (public.dawaa_can_manage_branch_targets(public.dawaa_request_staff_id()));
