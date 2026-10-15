do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;

create table public.staff_accounts (
  id uuid primary key,
  staff_id text,
  branch text,
  role text,
  active boolean not null default true,
  can_login boolean not null default true,
  name text,
  staff_name text,
  display_name text
);

create table public.whatsapp_review_sources (
  id uuid primary key,
  staff_id uuid,
  branch text,
  customer_id uuid,
  customer_code text,
  customer_phone text,
  matched_invoice_id uuid,
  invoice_link_confirmed boolean not null default false,
  invoice_link_confirmed_invoice_id text,
  invoice_link_confirmed_invoice_number text,
  invoice_link_confirmed_by text,
  invoice_link_confirmed_by_name text,
  invoice_link_confirmed_at timestamptz,
  invoice_link_confirmation_note text
);

create table public.sales_invoices (
  id text primary key,
  invoice_number text,
  invoice_no text,
  customer_id uuid,
  customer_code text,
  customer_phone text,
  whatsapp_phone text,
  branch text
);

create or replace function public.dawaa_current_staff_account_id_strict()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('test.actor_id', true), '')::uuid
$$;

create or replace function public.dawaa_current_actor_can(required_permissions text[])
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('test.can_edit_reviews', true), 'false') = 'true'
      or coalesce(current_setting('test.can_approve_reviews', true), 'false') = 'true'
      or coalesce(current_setting('test.can_manage_conversation_evaluations', true), 'false') = 'true'
$$;

create or replace function public.dawaa_actor_is_top_management_v1()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('test.top_management', true), 'false') = 'true'
$$;

create or replace function public.dawaa_customer_request_branch_key(value text)
returns text
language sql
immutable
as $$
  select nullif(lower(btrim(value)), '')
$$;

create or replace function public.normalize_customer_code_v2(value text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(translate(btrim(coalesce(value, '')), '٠١٢٣٤٥٦٧٨٩', '0123456789'), '\\s+', '', 'g'), '')
$$;

create or replace function public.dawaa_normalize_egyptian_mobile_v1(value text)
returns text
language sql
immutable
as $$
  select regexp_replace(coalesce(value, ''), '[^0-9]', '', 'g')
$$;

insert into public.staff_accounts (id, staff_id, branch, role, name, staff_name, display_name)
values
  ('10000000-0000-4000-8000-000000000001', 'staff-in-scope', 'فرع شكري', 'branch_manager', 'Actor Name', 'Verified Staff', 'Display Name'),
  ('10000000-0000-4000-8000-000000000002', 'staff-out-of-scope', 'فرع آخر', 'customer_service', 'Other Actor', 'Other Staff', 'Other Display');

insert into public.whatsapp_review_sources (id, staff_id, branch, customer_id, customer_code, customer_phone)
values
  ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'فرع شكري', '40000000-0000-4000-8000-000000000001', '2490', '01012345678'),
  ('20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 'فرع شكري', '40000000-0000-4000-8000-000000000001', '2490', '01012345678'),
  ('20000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000001', 'فرع شكري', '40000000-0000-4000-8000-000000000001', '2490', '01012345678'),
  ('20000000-0000-4000-8000-000000000004', null, null, '40000000-0000-4000-8000-000000000001', '2490', '01012345678');

insert into public.sales_invoices (id, invoice_number, invoice_no, customer_id, customer_code, customer_phone, branch)
values
  ('LOCAL-INVOICE-74880', '74880', '74880', '40000000-0000-4000-8000-000000000001', '2490', '01012345678', 'فرع شكري'),
  ('50000000-0000-4000-8000-000000000002', '74966', '74966', '40000000-0000-4000-8000-000000000001', '2490', '01012345678', 'فرع شكري'),
  ('50000000-0000-4000-8000-000000000003', '74967', '74967', '40000000-0000-4000-8000-000000000009', '9999', '01112345678', 'فرع شكري');
