-- Customer points is a single protected domain:
-- scoped reads, command-only writes, and request-derived actor identity.

create or replace function public.dawaa_can_access_customer_points_branch_v1(
  p_permissions text[],
  p_branch text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  v_actor_id uuid;
  v_role text;
  v_branch text;
begin
  v_actor_id := public.dawaa_current_staff_account_id_strict();
  if v_actor_id is null or not public.dawaa_current_actor_can(p_permissions) then
    return false;
  end if;

  select lower(trim(coalesce(sa.role, ''))), sa.branch
    into v_role, v_branch
  from public.staff_accounts sa
  where sa.id = v_actor_id
    and coalesce(sa.active, false)
    and coalesce(sa.can_login, false)
  limit 1;

  if not found then return false; end if;
  if v_role in ('general_manager', 'executive_manager', 'branches_manager', 'admin') then
    return true;
  end if;

  return public.dawaa_customer_request_branch_key(v_branch) is not null
    and public.dawaa_customer_request_branch_key(v_branch)
      = public.dawaa_customer_request_branch_key(p_branch);
end;
$$;

create or replace function public.dawaa_current_points_actor_v1()
returns table(actor_id text, actor_name text)
language sql
stable
security definer
set search_path = public, auth, pg_catalog
as $$
  select sa.id::text, coalesce(nullif(trim(sa.staff_name), ''), nullif(trim(sa.name), ''), nullif(trim(sa.username), ''), sa.id::text)
  from public.staff_accounts sa
  where sa.id = public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active, false)
    and coalesce(sa.can_login, false)
  limit 1
$$;

alter table public.customer_points_ledger enable row level security;
alter table public.customer_points_approval_requests enable row level security;
alter table public.customer_loyalty_settings enable row level security;

drop policy if exists customer_points_ledger_select on public.customer_points_ledger;
create policy customer_points_ledger_scoped_select
on public.customer_points_ledger for select to anon, authenticated
using (public.dawaa_can_access_customer_points_branch_v1(array['view_points','manage_points','approve_points'], branch));

drop policy if exists customer_points_approval_requests_select on public.customer_points_approval_requests;
create policy customer_points_approval_requests_scoped_select
on public.customer_points_approval_requests for select to anon, authenticated
using (public.dawaa_can_access_customer_points_branch_v1(array['view_points','manage_points','approve_points'], branch));

drop policy if exists customer_loyalty_settings_select on public.customer_loyalty_settings;
create policy customer_loyalty_settings_scoped_select
on public.customer_loyalty_settings for select to anon, authenticated
using (public.dawaa_can_access_customer_points_branch_v1(array['view_points','manage_points','approve_points'], branch));

-- Tables are read-only to the client. Mutations must use the commands below.
revoke insert, update, delete, truncate on public.customer_points_ledger from anon, authenticated;
revoke insert, update, delete, truncate on public.customer_points_approval_requests from anon, authenticated;
revoke insert, update, delete, truncate on public.customer_loyalty_settings from anon, authenticated;

alter function public.insert_customer_points_ledger(jsonb)
  rename to insert_customer_points_ledger_internal_v1;
alter function public.upsert_customer_loyalty_setting(jsonb)
  rename to upsert_customer_loyalty_setting_internal_v1;
alter function public.calculate_customer_loyalty_cycle(uuid,date,date,numeric,text,text)
  rename to calculate_customer_loyalty_cycle_internal_v1;
alter function public.run_due_customer_loyalty_cycles(text,text)
  rename to run_due_customer_loyalty_cycles_internal_v1;
alter function public.submit_customer_loyalty_approval(uuid,date,date,numeric,text,text,text)
  rename to submit_customer_loyalty_approval_internal_v1;
alter function public.review_customer_loyalty_approval(uuid,text,text,text)
  rename to review_customer_loyalty_approval_internal_v1;

revoke all on function public.insert_customer_points_ledger_internal_v1(jsonb) from public, anon, authenticated;
revoke all on function public.upsert_customer_loyalty_setting_internal_v1(jsonb) from public, anon, authenticated;
revoke all on function public.calculate_customer_loyalty_cycle_internal_v1(uuid,date,date,numeric,text,text) from public, anon, authenticated;
revoke all on function public.run_due_customer_loyalty_cycles_internal_v1(text,text) from public, anon, authenticated;
revoke all on function public.submit_customer_loyalty_approval_internal_v1(uuid,date,date,numeric,text,text,text) from public, anon, authenticated;
revoke all on function public.review_customer_loyalty_approval_internal_v1(uuid,text,text,text) from public, anon, authenticated;

create function public.insert_customer_points_ledger(p_payload jsonb)
returns public.customer_points_ledger
language plpgsql security definer
set search_path = public, auth, pg_catalog
as $$
declare v_actor record; v_payload jsonb; v_branch text;
begin
  v_branch := p_payload->>'branch';
  if not public.dawaa_can_access_customer_points_branch_v1(array['manage_points'], v_branch) then
    raise exception 'ليس لديك صلاحية إضافة نقاط لهذا الفرع.';
  end if;
  select * into v_actor from public.dawaa_current_points_actor_v1();
  v_payload := coalesce(p_payload, '{}'::jsonb)
    || jsonb_build_object('created_by', v_actor.actor_id, 'created_by_name', v_actor.actor_name);
  return public.insert_customer_points_ledger_internal_v1(v_payload);
end;
$$;

create function public.upsert_customer_loyalty_setting(p_payload jsonb)
returns public.customer_loyalty_settings
language plpgsql security definer
set search_path = public, auth, pg_catalog
as $$
declare v_actor record; v_payload jsonb; v_branch text;
begin
  v_branch := p_payload->>'branch';
  if not public.dawaa_can_access_customer_points_branch_v1(array['manage_points'], v_branch) then
    raise exception 'ليس لديك صلاحية إدارة نقاط هذا الفرع.';
  end if;
  select * into v_actor from public.dawaa_current_points_actor_v1();
  v_payload := coalesce(p_payload, '{}'::jsonb)
    || jsonb_build_object('created_by', v_actor.actor_id, 'created_by_name', v_actor.actor_name);
  return public.upsert_customer_loyalty_setting_internal_v1(v_payload);
end;
$$;

create function public.calculate_customer_loyalty_cycle(
  p_setting_id uuid, p_period_start date default null, p_period_end date default null,
  p_manual_purchase_total numeric default null, p_actor_id text default null, p_actor_name text default null
)
returns public.customer_points_ledger
language plpgsql security definer
set search_path = public, auth, pg_catalog
as $$
declare v_actor record; v_branch text;
begin
  select branch into v_branch from public.customer_loyalty_settings where id = p_setting_id;
  if not public.dawaa_can_access_customer_points_branch_v1(array['manage_points'], v_branch) then
    raise exception 'ليس لديك صلاحية احتساب نقاط هذا الفرع.';
  end if;
  select * into v_actor from public.dawaa_current_points_actor_v1();
  return public.calculate_customer_loyalty_cycle_internal_v1(
    p_setting_id, p_period_start, p_period_end, p_manual_purchase_total, v_actor.actor_id, v_actor.actor_name
  );
end;
$$;

create function public.run_due_customer_loyalty_cycles(p_actor_id text default null, p_actor_name text default 'النظام')
returns jsonb
language plpgsql security definer
set search_path = public, auth, pg_catalog
as $$
declare v_actor record; v_role text;
begin
  select a.*, lower(trim(coalesce(sa.role,''))) as role into v_actor
  from public.dawaa_current_points_actor_v1() a
  join public.staff_accounts sa on sa.id::text = a.actor_id;
  if v_actor.actor_id is null or not public.dawaa_current_actor_can(array['approve_points'])
     or v_actor.role not in ('general_manager','executive_manager','branches_manager','admin') then
    raise exception 'تشغيل دورات النقاط المجمعة متاح للإدارة المخولة فقط.';
  end if;
  return public.run_due_customer_loyalty_cycles_internal_v1(v_actor.actor_id, v_actor.actor_name);
end;
$$;

create function public.submit_customer_loyalty_approval(
  p_setting_id uuid, p_period_start date, p_period_end date,
  p_manual_purchase_total numeric default null, p_request_notes text default null,
  p_actor_id text default null, p_actor_name text default null
)
returns public.customer_points_approval_requests
language plpgsql security definer
set search_path = public, auth, pg_catalog
as $$
declare v_actor record; v_branch text;
begin
  select branch into v_branch from public.customer_loyalty_settings where id = p_setting_id;
  if not public.dawaa_can_access_customer_points_branch_v1(array['manage_points'], v_branch) then
    raise exception 'ليس لديك صلاحية إنشاء طلب نقاط لهذا الفرع.';
  end if;
  select * into v_actor from public.dawaa_current_points_actor_v1();
  return public.submit_customer_loyalty_approval_internal_v1(
    p_setting_id,p_period_start,p_period_end,p_manual_purchase_total,p_request_notes,v_actor.actor_id,v_actor.actor_name
  );
end;
$$;

create function public.review_customer_loyalty_approval(
  p_request_id uuid, p_decision text, p_review_notes text default null, p_actor_id text default null
)
returns public.customer_points_approval_requests
language plpgsql security definer
set search_path = public, auth, pg_catalog
as $$
declare v_actor record; v_branch text;
begin
  select branch into v_branch from public.customer_points_approval_requests where id = p_request_id;
  if not public.dawaa_can_access_customer_points_branch_v1(array['approve_points'], v_branch) then
    raise exception 'ليس لديك صلاحية اعتماد نقاط هذا الفرع.';
  end if;
  select * into v_actor from public.dawaa_current_points_actor_v1();
  return public.review_customer_loyalty_approval_internal_v1(p_request_id,p_decision,p_review_notes,v_actor.actor_id);
end;
$$;

revoke all on function public.dawaa_can_access_customer_points_branch_v1(text[],text) from public;
grant execute on function public.dawaa_can_access_customer_points_branch_v1(text[],text) to anon, authenticated, service_role;
revoke all on function public.dawaa_current_points_actor_v1() from public, anon, authenticated;
grant execute on function public.dawaa_current_points_actor_v1() to service_role;

revoke all on function public.insert_customer_points_ledger(jsonb) from public;
revoke all on function public.upsert_customer_loyalty_setting(jsonb) from public;
revoke all on function public.calculate_customer_loyalty_cycle(uuid,date,date,numeric,text,text) from public;
revoke all on function public.run_due_customer_loyalty_cycles(text,text) from public;
revoke all on function public.submit_customer_loyalty_approval(uuid,date,date,numeric,text,text,text) from public;
revoke all on function public.review_customer_loyalty_approval(uuid,text,text,text) from public;
grant execute on function public.insert_customer_points_ledger(jsonb) to anon, authenticated, service_role;
grant execute on function public.upsert_customer_loyalty_setting(jsonb) to anon, authenticated, service_role;
grant execute on function public.calculate_customer_loyalty_cycle(uuid,date,date,numeric,text,text) to anon, authenticated, service_role;
grant execute on function public.run_due_customer_loyalty_cycles(text,text) to anon, authenticated, service_role;
grant execute on function public.submit_customer_loyalty_approval(uuid,date,date,numeric,text,text,text) to anon, authenticated, service_role;
grant execute on function public.review_customer_loyalty_approval(uuid,text,text,text) to anon, authenticated, service_role;
