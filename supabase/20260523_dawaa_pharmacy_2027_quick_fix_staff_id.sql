-- Dawaa Pharmacy 2027 SQL Quick Fix
-- شغّل هذا أولاً إذا ظهر خطأ: column "staff_id" does not exist
alter table if exists public.employee_transactions add column if not exists staff_id uuid;
alter table if exists public.employee_transactions add column if not exists employee_name text;
alter table if exists public.employee_transactions add column if not exists status text default 'approved';

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='employee_transactions' and column_name='staff_id') then
    create index if not exists idx_employee_transactions_staff_id on public.employee_transactions(staff_id);
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='employee_transactions' and column_name='status') then
    create index if not exists idx_employee_transactions_status on public.employee_transactions(status);
  end if;
end $$;

notify pgrst, 'reload schema';
select 'Dawaa Pharmacy 2027 quick fix ready' as status;
