CREATE OR REPLACE FUNCTION public.assign_biometric_staff_mapping_v3(p_provider text, p_biometric_user_id text, p_staff_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_result jsonb;
  v_day date;
  v_rebuilt integer:=0;
begin
  v_result:=public.assign_biometric_staff_mapping_v2(
    p_provider,p_biometric_user_id,p_staff_id
  );

  for v_day in
    select distinct sal.shift_date
    from public.staff_attendance_logs sal
    join public.biometric_attendance_logs bl
      on bl.id=sal.biometric_source_log_id
    where bl.provider=trim(p_provider)
      and bl.biometric_user_id=trim(p_biometric_user_id)
      and sal.staff_id=p_staff_id
      and sal.shift_date is not null
      and sal.shift_date between
        ((now() at time zone 'Africa/Cairo')::date-45)
        and (now() at time zone 'Africa/Cairo')::date
    order by sal.shift_date
  loop
    perform public.dawaa_materialize_attendance_day_internal_v2(p_staff_id,v_day);
    v_rebuilt:=v_rebuilt+1;
  end loop;

  return v_result || jsonb_build_object('attendance_days_rebuilt',v_rebuilt);
end;
$function$


CREATE OR REPLACE FUNCTION public.assign_biometric_staff_mapping_v1(p_provider text, p_biometric_user_id text, p_staff_account_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_staff_id uuid;
begin
  select trim(a.staff_id)::uuid into v_staff_id
  from public.staff_accounts a
  where a.id=p_staff_account_id
    and coalesce(a.active,a.is_active,true)=true
    and trim(coalesce(a.staff_id,'')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

  if v_staff_id is null then
    select s.id into v_staff_id
    from public.staff s
    where s.id=p_staff_account_id and coalesce(s.active,false)=true
    limit 1;
  end if;

  if v_staff_id is null then
    raise exception 'selected staff identity is not canonical';
  end if;

  return public.assign_biometric_staff_mapping_v3(
    p_provider,p_biometric_user_id,v_staff_id
  );
end;
$function$


grant execute on function public.assign_biometric_staff_mapping_v3(text,text,uuid)
  to anon,authenticated,service_role;
