-- Canonical report read boundary. RLS remains the row-scope authority.

create or replace function public.get_employee_transactions_for_cycle_v1(
  p_start date,
  p_end date
)
returns setof public.employee_transactions
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select et.*
  from public.employee_transactions et
  where et.transaction_date between p_start and p_end
  order by et.created_at desc, et.id desc
$$;

revoke all on function public.get_employee_transactions_for_cycle_v1(date,date) from public;
grant execute on function public.get_employee_transactions_for_cycle_v1(date,date)
  to anon, authenticated;
