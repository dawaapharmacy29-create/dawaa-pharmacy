-- Synthetic isolated fixture; no production IDs or connections.
create role anon;
create role authenticated;
create role service_role;
create table public.staff_accounts(id uuid primary key, name text, role text, branch text, active boolean, can_login boolean);
-- Production tables as they are today (empty), with the open policies the migration replaces.
create table public.inventory_count_sessions(id uuid primary key default gen_random_uuid(), title text, branch text,
 count_type text, alphabet_from text, alphabet_to text, responsible_staff_id uuid, responsible_staff_name text,
 due_date date, status text, notes text, created_by uuid, created_at timestamptz, updated_at timestamptz,
 closed_at timestamptz, reviewer_staff_id uuid, reviewer_staff_name text, created_by_name text);
create table public.inventory_count_items(id uuid primary key default gen_random_uuid(), session_id uuid
 references public.inventory_count_sessions(id), item_name text, expected_qty numeric, actual_qty numeric,
 difference numeric, reason text, action text, notes text, created_at timestamptz, updated_at timestamptz,
 expiry_date date, unit_price numeric, reviewed_qty numeric, reviewed_expiry_date date, review_result text);
create table public.inventory_count_events(id uuid primary key default gen_random_uuid(), session_id uuid,
 event_type text, description text, staff_id uuid, staff_name text, created_at timestamptz);
alter table public.inventory_count_sessions enable row level security;
alter table public.inventory_count_items enable row level security;
create policy inventory_count_items_update_app on public.inventory_count_items for update to anon, authenticated using (true) with check (true);
create policy inventory_count_sessions_select_app on public.inventory_count_sessions for select to anon, authenticated using (true);
grant all on public.inventory_count_sessions, public.inventory_count_items, public.inventory_count_events to anon, authenticated;

-- Synthetic equivalents of the Production identity and scope helpers.
create function public.dawaa_customer_request_branch_key(p text) returns text language sql immutable as $$
  select case when p ilike '%شكري%' or p ilike '%shokry%' then 'shokry'
              when p ilike '%الشامي%' or p ilike '%elshamy%' then 'elshamy' end $$;
create function public.dawaa_current_staff_account_id_strict() returns uuid language sql stable as $$
  select nullif(current_setting('test.actor', true), '')::uuid $$;
create function public.dawaa_current_operational_write_scope_v1(p_permissions text[], p_branch_roles text[] default '{}',
  p_all text[] default '{}') returns text language sql stable as $$
  select coalesce((select case
    when a.role in ('general_manager', 'branches_manager', 'procurement_manager') then 'ALL'
    when a.role = any(p_branch_roles) then public.dawaa_customer_request_branch_key(a.branch)
    else 'NONE' end
  from public.staff_accounts a where a.id = public.dawaa_current_staff_account_id_strict() and a.active and a.can_login), 'NONE') $$;
grant execute on all functions in schema public to anon, authenticated;

insert into public.staff_accounts values
  ('00000000-0000-4000-8000-000000000001', 'مدير عام', 'general_manager', null, true, true),
  ('00000000-0000-4000-8000-000000000002', 'مدير شكري', 'branch_manager', 'فرع شكري', true, true),
  ('00000000-0000-4000-8000-000000000003', 'مساعد شكري', 'assistant', 'فرع شكري', true, true),
  ('00000000-0000-4000-8000-000000000004', 'مساعد الشامي', 'assistant', 'فرع الشامي', true, true),
  ('00000000-0000-4000-8000-000000000005', 'دليفري', 'delivery', 'فرع شكري', true, true);
