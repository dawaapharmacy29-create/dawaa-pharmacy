-- Harden modern GPS/biometric attendance logs.
-- Identity canonicalization is enforced by the earlier BEFORE INSERT trigger.
-- This migration scopes reads and makes the client-facing log append-only.

create or replace function public.dawaa_can_read_staff_attendance_log(
  p_staff_id uuid,
  p_branch text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_account_id uuid;
  v_subject_id uuid;
  v_role text;
  v_branch text;
begin
  v_account_id := public.dawaa_current_staff_account_id_strict();
  if v_account_id is null then return false; end if;

  select lower(trim(sa.role)), trim(coalesce(sa.branch,''))
    into v_role, v_branch
  from public.staff_accounts sa
  where sa.id = v_account_id
    and sa.active = true
    and sa.can_login = true;

  if v_role is null then return false; end if;
  v_subject_id := public.dawaa_current_attendance_subject_id();

  if v_role in ('general_manager','executive_manager','branches_manager','admin') then
    return true;
  end if;

  if p_staff_id is not null and v_subject_id is not null and p_staff_id = v_subject_id then
    return true;
  end if;

  if v_role in ('branch_manager','shift_supervisor_morning','shift_supervisor_evening') then
    return nullif(v_branch,'') is not null
      and trim(coalesce(p_branch,'')) = v_branch;
  end if;

  return false;
end;
$$;

alter table public.staff_attendance_logs enable row level security;

-- Remove broad legacy policies before replacing them with explicit scoped rules.
drop policy if exists "staff_attendance_insert_authenticated" on public.staff_attendance_logs;
drop policy if exists "staff_attendance_logs_app_insert" on public.staff_attendance_logs;
drop policy if exists "staff_attendance_logs_app_read" on public.staff_attendance_logs;
drop policy if exists "staff_attendance_read_authenticated" on public.staff_attendance_logs;
drop policy if exists "staff_attendance_logs_insert_own" on public.staff_attendance_logs;
drop policy if exists "staff_attendance_logs_select_scoped" on public.staff_attendance_logs;

create policy "staff_attendance_logs_insert_own"
on public.staff_attendance_logs
for insert
to public
with check (
  public.dawaa_current_staff_account_id_strict() is not null
  and public.dawaa_current_attendance_subject_id() is not null
  and staff_id = public.dawaa_current_attendance_subject_id()
  and created_by = public.dawaa_current_staff_account_id_strict()
);

create policy "staff_attendance_logs_select_scoped"
on public.staff_attendance_logs
for select
to public
using (
  public.dawaa_can_read_staff_attendance_log(staff_id, branch_name)
);

-- Intentionally no UPDATE or DELETE client policies: attendance logs are append-only.
