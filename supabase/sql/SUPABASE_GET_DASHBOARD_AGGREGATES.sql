-- Example RPC to pre-aggregate dashboard metrics between two dates.
-- Adjust table/column names to match your schema if necessary.

create or replace function public.get_dashboard_aggregates(p_start date, p_end date, p_branch text default null)
returns table(day date, total_sales numeric, invoices_count bigint)
language plpgsql
as $$
begin
  return query
  select
    date_trunc('day', coalesce(i.created_at, now()))::date as day,
    coalesce(sum(i.total)::numeric, 0) as total_sales,
    count(i.*) as invoices_count
  from invoices i
  where (p_branch is null or i.branch = p_branch)
    and i.created_at >= p_start::timestamp
    and i.created_at < (p_end::timestamp + interval '1 day')
  group by 1
  order by 1;
end;
$$;

-- To call from client:
-- select * from public.get_dashboard_aggregates('2026-01-01','2026-06-30', null);
