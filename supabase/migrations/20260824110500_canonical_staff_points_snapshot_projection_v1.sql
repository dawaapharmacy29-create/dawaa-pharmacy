-- Canonical staff points snapshot projection v1
-- employee_transactions is the ledger source of truth.
-- staff.points is retained only as a compatibility snapshot and may not diverge from the ledger.

create or replace function public.dawaa_current_points_cycle_label_v1()
returns text
language sql
stable
set search_path = public, pg_catalog
as $$
  select case
    when extract(day from (now() at time zone 'Africa/Cairo')) >= 26
      then to_char(((now() at time zone 'Africa/Cairo')::date + interval '1 month')::date, 'YYYY-MM')
    else to_char((now() at time zone 'Africa/Cairo')::date, 'YYYY-MM')
  end
$$;

create or replace function public.dawaa_refresh_staff_points_snapshot_v1(p_staff_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_max numeric := 500;
  v_delta numeric := 0;
  v_next numeric := 500;
  v_cycle text;
begin
  if p_staff_id is null then return null; end if;

  select greatest(500::numeric, coalesce(s.max_points, 500)::numeric)
    into v_max
  from public.staff s
  where s.id = p_staff_id;

  if not found then return null; end if;

  v_cycle := public.dawaa_current_points_cycle_label_v1();

  select coalesce(sum(
    case
      when coalesce(et.points_delta, 0) <> 0 then et.points_delta
      when lower(coalesce(et.type, '')) in ('penalty','deduction','خصم','جزاء') then -abs(coalesce(et.points,0))
      when lower(coalesce(et.type, '')) in ('reward','bonus','مكافأة') then abs(coalesce(et.points,0))
      else coalesce(et.points,0)
    end
  ), 0)
  into v_delta
  from public.employee_transactions et
  where coalesce(et.staff_id, et.employee_id) = p_staff_id
    and et.month_cycle = v_cycle
    and lower(coalesce(et.status, 'active')) in ('active','approved');

  v_next := greatest(0::numeric, least(v_max, round(500::numeric + v_delta)));

  update public.staff
  set points = v_next
  where id = p_staff_id
    and coalesce(points, 500)::numeric is distinct from v_next;

  return v_next;
end;
$$;

create or replace function public.dawaa_employee_transaction_points_snapshot_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_old_staff uuid;
  v_new_staff uuid;
begin
  if tg_op <> 'INSERT' then v_old_staff := coalesce(old.staff_id, old.employee_id); end if;
  if tg_op <> 'DELETE' then v_new_staff := coalesce(new.staff_id, new.employee_id); end if;

  if v_old_staff is not null then
    perform public.dawaa_refresh_staff_points_snapshot_v1(v_old_staff);
  end if;
  if v_new_staff is not null and v_new_staff is distinct from v_old_staff then
    perform public.dawaa_refresh_staff_points_snapshot_v1(v_new_staff);
  elsif tg_op = 'INSERT' and v_new_staff is not null then
    perform public.dawaa_refresh_staff_points_snapshot_v1(v_new_staff);
  elsif tg_op = 'UPDATE' and v_new_staff is not null then
    perform public.dawaa_refresh_staff_points_snapshot_v1(v_new_staff);
  end if;

  return coalesce(new, old);
end;
$$;

create or replace function public.dawaa_guard_staff_points_snapshot_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_max numeric := greatest(500::numeric, coalesce(new.max_points,500)::numeric);
  v_delta numeric := 0;
  v_cycle text;
begin
  if new.points is not distinct from old.points then return new; end if;

  v_cycle := public.dawaa_current_points_cycle_label_v1();

  select coalesce(sum(
    case
      when coalesce(et.points_delta, 0) <> 0 then et.points_delta
      when lower(coalesce(et.type, '')) in ('penalty','deduction','خصم','جزاء') then -abs(coalesce(et.points,0))
      when lower(coalesce(et.type, '')) in ('reward','bonus','مكافأة') then abs(coalesce(et.points,0))
      else coalesce(et.points,0)
    end
  ), 0)
  into v_delta
  from public.employee_transactions et
  where coalesce(et.staff_id, et.employee_id) = new.id
    and et.month_cycle = v_cycle
    and lower(coalesce(et.status, 'active')) in ('active','approved');

  new.points := greatest(0::numeric, least(v_max, round(500::numeric + v_delta)));
  return new;
end;
$$;

drop trigger if exists trg_employee_transactions_refresh_staff_points_v1 on public.employee_transactions;
create trigger trg_employee_transactions_refresh_staff_points_v1
after insert or update or delete on public.employee_transactions
for each row execute function public.dawaa_employee_transaction_points_snapshot_trigger_v1();

drop trigger if exists trg_staff_points_snapshot_guard_v1 on public.staff;
create trigger trg_staff_points_snapshot_guard_v1
before update of points on public.staff
for each row execute function public.dawaa_guard_staff_points_snapshot_v1();

revoke all on function public.dawaa_refresh_staff_points_snapshot_v1(uuid) from public, anon, authenticated;
revoke all on function public.dawaa_current_points_cycle_label_v1() from public, anon, authenticated;
revoke all on function public.dawaa_guard_staff_points_snapshot_v1() from public, anon, authenticated;
grant execute on function public.dawaa_refresh_staff_points_snapshot_v1(uuid) to service_role;
grant execute on function public.dawaa_current_points_cycle_label_v1() to service_role;
grant execute on function public.dawaa_guard_staff_points_snapshot_v1() to service_role;

-- Reconcile existing active compatibility snapshots once.
do $$
declare r record;
begin
  for r in select id from public.staff where coalesce(active, true) = true loop
    perform public.dawaa_refresh_staff_points_snapshot_v1(r.id);
  end loop;
end $$;
