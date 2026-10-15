-- Fixture for 20261015150000_whatsapp_customer_cases_v22_initplan_v1 (applied after 20261015140000).
\ir rls_actor_scope_initplan_v1.fixture.sql

create table public.whatsapp_review_sources (id uuid primary key, staff_id uuid, branch text);
create table public.whatsapp_customer_cases_v22 (id integer primary key, root_source_id uuid);
alter table public.whatsapp_customer_cases_v22 enable row level security;
grant select on public.whatsapp_review_sources, public.whatsapp_customer_cases_v22 to anon, authenticated;

-- Production policy (2026-10-15) before the migration.
create policy whatsapp_customer_cases_v22_select on public.whatsapp_customer_cases_v22 for select using (
  exists (
    select 1 from public.whatsapp_review_sources s
    where s.id = whatsapp_customer_cases_v22.root_source_id
      and public.dawaa_can_read_conversation_review_row_v2(public.dawaa_current_staff_account_id_strict(), s.staff_id, null::uuid, s.branch, null::uuid)
  )
);

create function public.test_oracle_whatsapp_customer_cases_v22() returns int[] language sql stable security definer set search_path to 'public'
as $$
  select coalesce(array_agg(c.id order by c.id), '{}')
  from public.whatsapp_customer_cases_v22 c
  where exists (
    select 1 from public.whatsapp_review_sources s
    where s.id = c.root_source_id
      and public.dawaa_can_read_conversation_review_row_v2(public.dawaa_current_staff_account_id_strict(), s.staff_id, null::uuid, s.branch, null::uuid)
  )
$$;
grant execute on function public.test_oracle_whatsapp_customer_cases_v22() to anon, authenticated;

insert into public.whatsapp_review_sources (id, staff_id, branch) values
  ('f0000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002', 'فرع شكري'),
  ('f0000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000006', 'شكري '),
  ('f0000000-0000-4000-8000-000000000003', null, 'الشامى'),
  ('f0000000-0000-4000-8000-000000000004', null, null),
  ('f0000000-0000-4000-8000-000000000005', '50000000-0000-4000-8000-000000000005', 'elshamy'),
  ('f0000000-0000-4000-8000-000000000006', '50000000-0000-4000-8000-000000000099', 'المخزن');
insert into public.whatsapp_customer_cases_v22 (id, root_source_id) values
  (1, 'f0000000-0000-4000-8000-000000000001'), (2, 'f0000000-0000-4000-8000-000000000002'),
  (3, 'f0000000-0000-4000-8000-000000000003'), (4, 'f0000000-0000-4000-8000-000000000004'),
  (5, 'f0000000-0000-4000-8000-000000000005'), (6, 'f0000000-0000-4000-8000-000000000006'),
  (7, null), (8, 'f0000000-0000-4000-8000-0000000000ff');
