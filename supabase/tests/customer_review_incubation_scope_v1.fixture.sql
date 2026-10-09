create role anon nologin;
create role authenticated nologin;

create schema auth;
create function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

create table public.staff_accounts (
  id uuid primary key,
  staff_name text,
  name text,
  role text not null,
  branch text,
  permissions jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  can_login boolean not null default true
);

create function public.dawaa_current_staff_account_id_strict() returns uuid
language sql stable security definer set search_path = public, auth, pg_catalog
as $$
  select sa.id
  from public.staff_accounts sa
  where sa.id = auth.uid() and sa.active and sa.can_login
$$;

create function public.dawaa_current_actor_can(required_permissions text[]) returns boolean
language sql stable security definer set search_path = public, auth, pg_catalog
as $$
  select exists (
    select 1
    from public.staff_accounts sa
    where sa.id = public.dawaa_current_staff_account_id_strict()
      and (
        sa.role in ('admin', 'general_manager')
        or exists (
          select 1 from unnest(required_permissions) permission_key
          where coalesce((sa.permissions ->> permission_key)::boolean, false)
        )
      )
  )
$$;

create function public.dawaa_customer_request_branch_key(p_branch text) returns text
language sql immutable set search_path = public, pg_catalog
as $$
  select case
    when lower(trim(coalesce(p_branch,''))) in ('فرع شكري','شكري','shokry','shoukry') then 'shokry'
    when lower(trim(coalesce(p_branch,''))) in ('فرع الشامي','الشامي','الشامى','elshamy','el-shamy','alshamy') then 'elshamy'
    when trim(coalesce(p_branch,'')) = '' then null
    else lower(trim(p_branch))
  end
$$;

create function public.dawaa_current_customer_core_scope_v2(p_permissions text[]) returns text
language sql stable security definer set search_path = public, auth, pg_catalog
as $$
  select case
    when public.dawaa_current_staff_account_id_strict() is null
      or not public.dawaa_current_actor_can(p_permissions) then 'NONE'
    when sa.role in ('admin', 'general_manager', 'executive_manager', 'branches_manager') then 'ALL'
    when public.dawaa_customer_request_branch_key(sa.branch) = 'shokry' then 'فرع شكري'
    when public.dawaa_customer_request_branch_key(sa.branch) = 'elshamy' then 'فرع الشامي'
    else 'NONE'
  end
  from public.staff_accounts sa
  where sa.id = public.dawaa_current_staff_account_id_strict()
$$;

grant execute on function public.dawaa_current_staff_account_id_strict() to anon, authenticated;
grant execute on function public.dawaa_current_actor_can(text[]) to anon, authenticated;
grant execute on function public.dawaa_customer_request_branch_key(text) to anon, authenticated;
grant execute on function public.dawaa_current_customer_core_scope_v2(text[]) to anon, authenticated;

create table public.customers (
  id uuid primary key,
  customer_code text,
  name text,
  branch text,
  updated_at timestamptz not null default now()
);

create table public.customer_data_review_queue (
  id uuid primary key,
  customer_id uuid,
  issue_type text not null,
  status text not null default 'pending',
  suggested_value jsonb not null default '{}'::jsonb,
  reviewed_by text,
  reviewed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.customer_data_change_log (
  id bigint generated always as identity primary key,
  customer_id uuid,
  customer_code text,
  operation text,
  before_data jsonb,
  after_data jsonb,
  reason text,
  changed_by text
);

create table public.customer_incubation_cases (
  id uuid primary key,
  branch text not null,
  customer_name text not null
);

create table public.customer_incubation_steps (
  id uuid primary key,
  case_id uuid not null references public.customer_incubation_cases(id),
  step_note text
);

alter table public.customers enable row level security;
create policy fixture_customer_branch_read on public.customers for select to authenticated
using (
  (select public.dawaa_current_customer_core_scope_v2(array['view_customer_incubation'])) = 'ALL'
  or public.dawaa_customer_request_branch_key(branch)
    = public.dawaa_customer_request_branch_key(
      (select sa.branch from public.staff_accounts sa where sa.id = auth.uid())
    )
);

create view public.dawaa_incubation_candidates_v1 as
select id, name as customer_name, branch
from public.customers;

create function public.review_customer_data_issue_v2(
  p_review_id uuid,
  p_decision text,
  p_reviewer text,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public, auth, pg_catalog
as $$
declare
  v_review public.customer_data_review_queue%rowtype;
  v_customer public.customers%rowtype;
  v_suggested_branch text;
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_reviewer text := nullif(btrim(coalesce(p_reviewer, '')), '');
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if v_decision not in ('approve', 'reject') then raise exception 'Unsupported review decision'; end if;
  if v_reviewer is null then raise exception 'Reviewer name is required'; end if;
  select * into v_review from public.customer_data_review_queue where id = p_review_id for update;
  if not found then raise exception 'Review item not found'; end if;
  if v_review.status <> 'pending' then raise exception 'Review item has already been processed'; end if;
  if v_decision = 'reject' then
    update public.customer_data_review_queue set status = 'rejected', reviewed_by = v_reviewer,
      reviewed_at = now(), updated_at = now()
    where id = p_review_id;
    return jsonb_build_object('ok', true, 'decision', 'reject', 'review_id', p_review_id);
  end if;
  if v_review.issue_type <> 'registered_branch_conflict' then
    raise exception 'This review type cannot update the customer automatically';
  end if;
  v_suggested_branch := nullif(btrim(v_review.suggested_value ->> 'suggested_branch'), '');
  if v_suggested_branch not in ('فرع شكري', 'فرع الشامي') then raise exception 'Suggested branch is invalid'; end if;
  if v_review.customer_id is null then raise exception 'Review item is not linked to a customer'; end if;
  select * into v_customer from public.customers where id = v_review.customer_id for update;
  if not found then raise exception 'Customer not found'; end if;
  insert into public.customer_data_change_log(customer_id, customer_code, operation, before_data, after_data, reason, changed_by)
  values (v_customer.id, v_customer.customer_code, 'approved_customer_branch_review',
    jsonb_build_object('branch', v_customer.branch),
    jsonb_build_object('branch', v_suggested_branch), coalesce(p_note, 'review'), v_reviewer);
  update public.customers set branch = v_suggested_branch, updated_at = now() where id = v_customer.id;
  update public.customer_data_review_queue set status = 'resolved', reviewed_by = v_reviewer,
    reviewed_at = now(), updated_at = now() where id = p_review_id;
  return jsonb_build_object('ok', true, 'decision', 'approve', 'review_id', p_review_id);
end;
$$;

grant execute on function public.review_customer_data_issue_v2(uuid, text, text, text) to authenticated;

insert into public.staff_accounts(id, staff_name, name, role, branch, permissions) values
  ('10000000-0000-4000-8000-000000000001', 'Ordinary', 'Ordinary', 'customer_service', 'فرع شكري', '{}'),
  ('10000000-0000-4000-8000-000000000002', 'Reviewer A', 'Reviewer A', 'branch_manager', 'فرع شكري',
    '{"edit_customer":true,"view_customer_incubation":true,"manage_customer_incubation":true}'),
  ('10000000-0000-4000-8000-000000000003', 'Reviewer B', 'Reviewer B', 'branch_manager', 'فرع الشامي',
    '{"edit_customer":true,"view_customer_incubation":true,"manage_customer_incubation":true}'),
  ('10000000-0000-4000-8000-000000000004', 'Admin', 'Admin', 'general_manager', null, '{}');

insert into public.customers(id, customer_code, name, branch) values
  ('20000000-0000-4000-8000-000000000001', 'C-A', 'Customer A', 'فرع شكري'),
  ('20000000-0000-4000-8000-000000000002', 'C-B', 'Customer B', 'فرع الشامي');
insert into public.customer_data_review_queue(id, customer_id, issue_type, suggested_value) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
    'registered_branch_conflict', '{"suggested_branch":"فرع الشامي"}'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002',
    'registered_branch_conflict', '{"suggested_branch":"فرع شكري"}');
insert into public.customer_incubation_cases(id, branch, customer_name) values
  ('40000000-0000-4000-8000-000000000001', 'فرع شكري', 'Customer A'),
  ('40000000-0000-4000-8000-000000000002', 'فرع الشامي', 'Customer B');
insert into public.customer_incubation_steps(id, case_id, step_note) values
  ('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'A step'),
  ('50000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', 'B step');

grant usage on schema public to anon, authenticated;
grant select on public.staff_accounts to authenticated;
grant select on public.customers, public.dawaa_incubation_candidates_v1 to authenticated;
grant select, insert, update on public.customer_data_review_queue, public.customer_data_change_log to authenticated;
grant select, insert, update on public.customer_incubation_cases to authenticated;
grant select, insert on public.customer_incubation_steps to authenticated;
