-- Keep staff.points in sync with approved point_records for the active 26-25 cycle.

create or replace function public.current_points_cycle_start()
returns date
language sql
stable
as $$
  select case
    when extract(day from current_date) >= 26
      then (date_trunc('month', current_date)::date + 25)
    else ((date_trunc('month', current_date)::date - interval '1 month')::date + 25)
  end;
$$;

create or replace function public.current_points_cycle_end()
returns date
language sql
stable
as $$
  select (public.current_points_cycle_start() + interval '1 month' - interval '1 day')::date;
$$;

create or replace function public.point_record_signed_delta(
  p_type text,
  p_points numeric,
  p_points_delta numeric
)
returns numeric
language sql
immutable
as $$
  select case
    when coalesce(p_points_delta, 0) <> 0 then p_points_delta
    when coalesce(p_type, '') in ('bonus', 'مكافأة') then abs(coalesce(p_points, 0))
    when coalesce(p_type, '') in ('deduction', 'خصم') then -abs(coalesce(p_points, 0))
    else coalesce(p_points, 0)
  end;
$$;

create or replace function public.sync_staff_points_balance(
  p_staff_id text,
  p_staff_name text default null,
  p_branch text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid;
  v_staff_name text;
  v_branch text;
  v_max_points numeric;
  v_next_points numeric;
begin
  select s.id, s.name, s.branch, coalesce(s.max_points, 500)
  into v_staff_id, v_staff_name, v_branch, v_max_points
  from public.staff s
  where (p_staff_id is not null and s.id::text = p_staff_id)
     or (
       p_staff_name is not null
       and trim(s.name) = trim(p_staff_name)
       and (p_branch is null or trim(coalesce(s.branch, '')) = trim(coalesce(p_branch, '')))
     )
  order by case when p_staff_id is not null and s.id::text = p_staff_id then 0 else 1 end
  limit 1;

  if v_staff_id is null then
    return;
  end if;

  select greatest(
    0,
    least(
      v_max_points,
      500 + coalesce(sum(public.point_record_signed_delta(pr.type, pr.points, pr.points_delta)), 0)
    )
  )
  into v_next_points
  from public.point_records pr
  where coalesce(pr.status, 'approved') = 'approved'
    and (
      pr.employee_id = v_staff_id::text
      or trim(coalesce(pr.employee_name, '')) = trim(coalesce(v_staff_name, ''))
    )
    and (
      pr.month_cycle is null
      or pr.month_cycle = to_char(public.current_points_cycle_end(), 'YYYY-MM')
    )
    and (
      pr.created_at is null
      or pr.created_at::date between public.current_points_cycle_start() and public.current_points_cycle_end()
    );

  update public.staff
  set points = round(v_next_points)
  where id = v_staff_id;
end;
$$;

create or replace function public.sync_staff_points_balance_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.sync_staff_points_balance(new.employee_id, new.employee_name, new.branch);
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    perform public.sync_staff_points_balance(old.employee_id, old.employee_name, old.branch);
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_sync_staff_points_balance on public.point_records;
create trigger trg_sync_staff_points_balance
after insert or update or delete on public.point_records
for each row execute function public.sync_staff_points_balance_trigger();

-- One-time repair for existing approved records in the current cycle.
do $$
declare
  r record;
begin
  for r in
    select distinct employee_id, employee_name, branch
    from public.point_records
  loop
    perform public.sync_staff_points_balance(r.employee_id, r.employee_name, r.branch);
  end loop;
end $$;
