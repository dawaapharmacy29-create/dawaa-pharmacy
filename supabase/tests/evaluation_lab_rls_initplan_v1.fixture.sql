-- Synthetic isolated fixture (no production IDs): the two tables with their current policies and
create role anon;
create role authenticated;
-- actor functions driven by test settings.
create table public.staff_accounts(id uuid primary key, branch text);
create table public.purchase_invoices(id uuid primary key, branch text, entered_by_staff_id uuid, invoice_date date);
create table public.sales_invoice_items_v21(id uuid primary key, branch text);

create function public.dawaa_actor_is_top_management_v1() returns boolean language sql stable
  as $$ select coalesce(current_setting('test.top', true), '') = 'yes' $$;
create function public.dawaa_current_actor_can(p text[]) returns boolean language sql stable
  as $$ select coalesce(current_setting('test.can', true), '') = any(p) $$;
create function public.dawaa_current_staff_subject_uuid_v1() returns uuid language sql stable
  as $$ select nullif(current_setting('test.subject', true), '')::uuid $$;
create function public.dawaa_current_staff_account_id_strict() returns uuid language sql stable
  as $$ select nullif(current_setting('test.actor', true), '')::uuid $$;
create function public.dawaa_current_sales_invoice_scope_v1(p text[]) returns text language sql stable
  as $$ select coalesce(nullif(current_setting('test.scope', true), ''), 'NONE') $$;

insert into public.staff_accounts values
  ('00000000-0000-4000-8000-000000000002', 'فرع شكري'),
  ('00000000-0000-4000-8000-000000000004', 'فرع الشامي');
insert into public.purchase_invoices values
  ('10000000-0000-4000-8000-000000000001', 'فرع شكري', null, current_date),
  ('10000000-0000-4000-8000-000000000002', 'فرع الشامي', null, current_date),
  ('10000000-0000-4000-8000-000000000003', 'فرع الشامي', '00000000-0000-4000-8000-0000000000aa', current_date);
insert into public.sales_invoice_items_v21 values
  ('20000000-0000-4000-8000-000000000001', 'فرع شكري'),
  ('20000000-0000-4000-8000-000000000002', 'فرع الشامي');

alter table public.purchase_invoices enable row level security;
alter table public.sales_invoice_items_v21 enable row level security;
create policy purchase_invoices_select on public.purchase_invoices for select using (
  dawaa_actor_is_top_management_v1() or dawaa_current_actor_can(array['manage_purchases', 'view_purchases'])
  or entered_by_staff_id = dawaa_current_staff_subject_uuid_v1()
  or exists (select 1 from staff_accounts a where a.id = dawaa_current_staff_account_id_strict()
    and lower(btrim(coalesce(a.branch, ''))) = lower(btrim(coalesce(purchase_invoices.branch, '')))));
create policy sales_invoice_items_v21_select on public.sales_invoice_items_v21 for select using (
  dawaa_current_sales_invoice_scope_v1(array['view_sales']) = 'ALL' or branch = dawaa_current_sales_invoice_scope_v1(array['view_sales']));
grant select on public.purchase_invoices, public.sales_invoice_items_v21, public.staff_accounts to anon;
