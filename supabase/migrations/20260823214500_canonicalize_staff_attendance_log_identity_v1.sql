create or replace function public.dawaa_current_attendance_subject_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_account_id uuid;
  v_staff_id text;
begin
  v_account_id := public.dawaa_current_staff_account_id_strict();
  if v_account_id is null then
    return null;
  end if;

  select nullif(trim(sa.staff_id), '')
    into v_staff_id
  from public.staff_accounts sa
  where sa.id = v_account_id
    and coalesce(sa.active, true) = true
    and coalesce(sa.can_login, true) = true;

  if v_staff_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return v_staff_id::uuid;
  end if;

  return v_account_id;
end;
$$;

revoke all on function public.dawaa_current_attendance_subject_id() from public;
grant execute on function public.dawaa_current_attendance_subject_id() to anon, authenticated;

create or replace function public.dawaa_normalize_staff_attendance_log_identity_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_account_id uuid;
  v_subject_id uuid;
  v_name text;
  v_role text;
  v_branch text;
begin
  v_account_id := public.dawaa_current_staff_account_id_strict();
  if v_account_id is null then
    return new;
  end if;

  v_subject_id := public.dawaa_current_attendance_subject_id();

  select sa.name, sa.role, sa.branch
    into v_name, v_role, v_branch
  from public.staff_accounts sa
  where sa.id = v_account_id;

  new.staff_id := v_subject_id;
  new.created_by := v_account_id;
  new.staff_name := coalesce(nullif(trim(v_name), ''), new.staff_name);
  new.role := coalesce(nullif(trim(v_role), ''), new.role);
  new.branch_name := coalesce(nullif(trim(v_branch), ''), new.branch_name);
  return new;
end;
$$;

drop trigger if exists trg_dawaa_normalize_staff_attendance_log_identity_v1 on public.staff_attendance_logs;
create trigger trg_dawaa_normalize_staff_attendance_log_identity_v1
before insert on public.staff_attendance_logs
for each row execute function public.dawaa_normalize_staff_attendance_log_identity_v1();

create or replace view public.staff_attendance_identity_health_v1 as
select
  l.id,
  l.recorded_at,
  l.shift_date,
  l.staff_name,
  l.branch_name,
  l.staff_id,
  l.created_by,
  case
    when l.staff_id is null then 'missing_subject_id'
    when exists (
      select 1 from public.staff_accounts sa
      where sa.active = true and sa.can_login = true
        and (
          sa.id = l.staff_id
          or (
            sa.staff_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            and sa.staff_id::uuid = l.staff_id
          )
        )
    ) then 'resolved'
    else 'unresolved_subject_id'
  end as identity_status
from public.staff_attendance_logs l;

comment on function public.dawaa_current_attendance_subject_id() is
  'Canonical attendance subject UUID: linked staff UUID when available, otherwise active staff account UUID for synthetic staff identifiers.';
comment on view public.staff_attendance_identity_health_v1 is
  'Read-only attendance identity health view. Does not mutate historical attendance rows.';
