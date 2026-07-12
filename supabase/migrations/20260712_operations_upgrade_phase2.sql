-- Phase 2 foundation: accounts, leave approvals, cleaning, audit and analytics helpers.
-- All objects are additive and idempotent.

create table if not exists public.operations_activity_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  actor_staff_id uuid,
  actor_name text,
  actor_role text,
  branch text,
  action_type text not null,
  entity_type text,
  entity_id text,
  page_path text,
  summary text,
  old_values jsonb,
  new_values jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists operations_activity_log_created_idx
  on public.operations_activity_log(created_at desc);
create index if not exists operations_activity_log_branch_idx
  on public.operations_activity_log(branch, created_at desc);
create index if not exists operations_activity_log_actor_idx
  on public.operations_activity_log(actor_staff_id, created_at desc);

create or replace function public.log_operations_activity(
  p_action_type text,
  p_entity_type text default null,
  p_entity_id text default null,
  p_summary text default null,
  p_actor_user_id uuid default null,
  p_actor_staff_id uuid default null,
  p_actor_name text default null,
  p_actor_role text default null,
  p_branch text default null,
  p_page_path text default null,
  p_old_values jsonb default null,
  p_new_values jsonb default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.operations_activity_log(
    actor_user_id, actor_staff_id, actor_name, actor_role, branch,
    action_type, entity_type, entity_id, page_path, summary,
    old_values, new_values, metadata
  ) values (
    p_actor_user_id, p_actor_staff_id, p_actor_name, p_actor_role, p_branch,
    p_action_type, p_entity_type, p_entity_id, p_page_path, p_summary,
    p_old_values, p_new_values, coalesce(p_metadata, '{}'::jsonb)
  ) returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.log_operations_activity(
  text,text,text,text,uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb
) to authenticated;

alter table public.operations_activity_log enable row level security;
drop policy if exists operations_activity_log_read on public.operations_activity_log;
create policy operations_activity_log_read
  on public.operations_activity_log for select to authenticated using (true);

grant select on public.operations_activity_log to authenticated;

create table if not exists public.staff_leave_requests (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid,
  staff_name text not null,
  branch text not null,
  leave_type text not null,
  start_date date not null,
  end_date date not null,
  days_count numeric(6,2) not null default 1,
  reason text,
  deduction_type text not null default 'without_deduction',
  annual_balance_impact numeric(6,2) not null default 0,
  status text not null default 'pending',
  requested_by uuid,
  requested_at timestamptz not null default now(),
  reviewed_by uuid,
  reviewed_by_name text,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_leave_requests_status_check check (status in ('pending','approved','rejected','returned')),
  constraint staff_leave_requests_deduction_check check (deduction_type in ('without_deduction','salary_deduction','annual_balance')),
  constraint staff_leave_requests_dates_check check (end_date >= start_date)
);

create index if not exists staff_leave_requests_staff_cycle_idx
  on public.staff_leave_requests(staff_id, start_date, end_date);
create index if not exists staff_leave_requests_branch_status_idx
  on public.staff_leave_requests(branch, status, start_date desc);

create or replace function public.review_staff_leave_request(
  p_leave_id uuid,
  p_status text,
  p_reviewer_id uuid,
  p_reviewer_name text,
  p_review_note text default null,
  p_deduction_type text default null,
  p_annual_balance_impact numeric default null
)
returns public.staff_leave_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.staff_leave_requests;
begin
  if p_status not in ('approved','rejected','returned') then
    raise exception 'invalid leave status';
  end if;
  update public.staff_leave_requests
  set status = p_status,
      reviewed_by = p_reviewer_id,
      reviewed_by_name = p_reviewer_name,
      reviewed_at = now(),
      review_note = p_review_note,
      deduction_type = coalesce(p_deduction_type, deduction_type),
      annual_balance_impact = coalesce(p_annual_balance_impact, annual_balance_impact),
      updated_at = now()
  where id = p_leave_id
  returning * into v_row;
  if v_row.id is null then raise exception 'leave request not found'; end if;
  perform public.log_operations_activity(
    'leave_review', 'staff_leave_request', p_leave_id::text,
    format('Leave request changed to %s', p_status),
    null, p_reviewer_id, p_reviewer_name, null, v_row.branch,
    '/time-off', null, to_jsonb(v_row), jsonb_build_object('status', p_status)
  );
  return v_row;
end;
$$;

grant select, insert, update on public.staff_leave_requests to authenticated;
grant execute on function public.review_staff_leave_request(uuid,text,uuid,text,text,text,numeric) to authenticated;
alter table public.staff_leave_requests enable row level security;
drop policy if exists staff_leave_requests_read on public.staff_leave_requests;
create policy staff_leave_requests_read on public.staff_leave_requests for select to authenticated using (true);
drop policy if exists staff_leave_requests_insert on public.staff_leave_requests;
create policy staff_leave_requests_insert on public.staff_leave_requests for insert to authenticated with check (true);

create table if not exists public.branch_cleaning_checklists (
  id uuid primary key default gen_random_uuid(),
  checklist_date date not null,
  branch text not null,
  shift_name text not null default 'daily',
  item_key text not null,
  item_label text not null,
  status text not null default 'pending',
  completed_by uuid,
  completed_by_name text,
  completed_at timestamptz,
  approved_by uuid,
  approved_by_name text,
  approved_at timestamptz,
  evidence_url text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint branch_cleaning_status_check check (status in ('pending','completed','approved','needs_rework'))
);

create unique index if not exists branch_cleaning_unique_item_day
  on public.branch_cleaning_checklists(checklist_date, branch, shift_name, item_key);
create index if not exists branch_cleaning_branch_date_idx
  on public.branch_cleaning_checklists(branch, checklist_date desc);

create or replace function public.create_branch_cleaning_checklist(
  p_branch text,
  p_date date default current_date,
  p_shift_name text default 'daily'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.branch_cleaning_checklists(checklist_date, branch, shift_name, item_key, item_label)
  values
    (p_date, trim(p_branch), p_shift_name, 'floors', 'الأرضيات'),
    (p_date, trim(p_branch), p_shift_name, 'shelves', 'الأرفف'),
    (p_date, trim(p_branch), p_shift_name, 'fridges', 'الثلاجات'),
    (p_date, trim(p_branch), p_shift_name, 'customer_area', 'منطقة العميل'),
    (p_date, trim(p_branch), p_shift_name, 'storefront', 'واجهة الصيدلية'),
    (p_date, trim(p_branch), p_shift_name, 'warehouse', 'المخزن'),
    (p_date, trim(p_branch), p_shift_name, 'bathroom', 'الحمام'),
    (p_date, trim(p_branch), p_shift_name, 'waste', 'التخلص من المخلفات')
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant select, insert, update on public.branch_cleaning_checklists to authenticated;
grant execute on function public.create_branch_cleaning_checklist(text,date,text) to authenticated;
alter table public.branch_cleaning_checklists enable row level security;
drop policy if exists branch_cleaning_checklists_read on public.branch_cleaning_checklists;
create policy branch_cleaning_checklists_read on public.branch_cleaning_checklists for select to authenticated using (true);

-- Safe account listing RPC. Uses jsonb extraction so optional columns do not break the function.
create or replace function public.list_staff_accounts_safe()
returns table(
  account_id uuid,
  staff_id uuid,
  username text,
  display_name text,
  role text,
  branch text,
  active boolean,
  can_login boolean,
  last_login_at timestamptz,
  permissions jsonb,
  raw_account jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regclass('public.staff_accounts') is null then
    return;
  end if;
  return query execute $q$
    select
      nullif(a->>'id','')::uuid,
      nullif(a->>'staff_id','')::uuid,
      coalesce(a->>'username',''),
      coalesce(a->>'name', a->>'staff_name', a->>'display_name', ''),
      coalesce(a->>'role', a->>'staff_role', ''),
      coalesce(a->>'branch', ''),
      coalesce(nullif(a->>'active','')::boolean, nullif(a->>'is_active','')::boolean, true),
      coalesce(nullif(a->>'can_login','')::boolean, true),
      nullif(a->>'last_login_at','')::timestamptz,
      coalesce(a->'permissions', '{}'::jsonb),
      a
    from (select to_jsonb(sa) a from public.staff_accounts sa) s
  $q$;
end;
$$;

grant execute on function public.list_staff_accounts_safe() to authenticated;

-- Customer metrics compatibility view. Created only when customers exists.
do $$
begin
  if to_regclass('public.customers') is not null then
    execute 'drop view if exists public.customer_metrics';
    execute $view$
      create view public.customer_metrics as
      select
        c.id,
        c.customer_code,
        c.name,
        c.phone,
        c.mobile,
        c.address,
        c.area,
        c.branch,
        c.total_spent,
        c.invoices_count,
        c.avg_monthly,
        c.avg_invoice,
        c.avg_daily,
        c.first_purchase,
        c.last_purchase,
        c.last_order_date,
        c.segment,
        c.status,
        c.is_active,
        c.created_at,
        c.updated_at
      from public.customers c
    $view$;
  end if;
end $$;

-- Common performance indexes, created only when source tables/columns exist.
do $$
begin
  if to_regclass('public.sales_invoices') is not null then
    begin execute 'create index if not exists sales_invoices_invoice_date_idx on public.sales_invoices(invoice_date)'; exception when undefined_column then null; end;
    begin execute 'create index if not exists sales_invoices_branch_idx on public.sales_invoices(branch)'; exception when undefined_column then null; end;
    begin execute 'create index if not exists sales_invoices_customer_id_idx on public.sales_invoices(customer_id)'; exception when undefined_column then null; end;
    begin execute 'create index if not exists sales_invoices_staff_id_idx on public.sales_invoices(staff_id)'; exception when undefined_column then null; end;
    begin execute 'create index if not exists sales_invoices_invoice_number_idx on public.sales_invoices(invoice_number)'; exception when undefined_column then null; end;
  end if;
end $$;
