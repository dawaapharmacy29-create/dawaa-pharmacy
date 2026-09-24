-- An excluded terminal code must not reappear after the bridge resends history.
-- A missing scope entry retains the existing ingestion behavior.
create or replace function public.dawaa_skip_excluded_biometric_insert_v1()
returns trigger language plpgsql security definer
set search_path to 'public','pg_catalog' as $$
begin
  if exists (
    select 1 from public.biometric_employee_scope s
    where s.provider=new.provider and s.biometric_user_id=new.biometric_user_id
      and s.in_scope=false
  ) then
    return null;
  end if;
  return new;
end;
$$;
revoke execute on function public.dawaa_skip_excluded_biometric_insert_v1() from public,anon,authenticated;

drop trigger if exists trg_skip_excluded_biometric_insert_v1 on public.biometric_attendance_logs;
create trigger trg_skip_excluded_biometric_insert_v1
before insert on public.biometric_attendance_logs
for each row execute function public.dawaa_skip_excluded_biometric_insert_v1();
