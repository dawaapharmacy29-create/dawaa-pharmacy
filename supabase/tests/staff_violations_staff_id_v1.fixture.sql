-- Synthetic isolated fixture; reuses the violations fixture and links accounts to staff rows.
\ir staff_compliance_violations_v1.fixture.sql
alter table public.staff_accounts add column staff_id text;
update public.staff_accounts set staff_id = 'staff-row-003' where id = '00000000-0000-4000-8000-000000000003';
