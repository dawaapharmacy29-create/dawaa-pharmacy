-- Cross-branch event list. Final replay-safe definition.
CREATE OR REPLACE FUNCTION public.list_cross_branch_biometric_events_v1(p_start date, p_end date, p_branch text DEFAULT NULL::text, p_limit integer DEFAULT 250)
 RETURNS TABLE(staff_id uuid, staff_name text, role text, home_branch text, punch_branch text, biometric_user_id text, punch_time timestamp with time zone, punch_type text, device_id text, provider text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_actor public.staff_accounts%rowtype;
begin
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>45 then
    raise exception 'invalid_cross_branch_range' using errcode='22023';
  end if;

  select * into v_actor
  from public.staff_accounts sa
  where sa.id=public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active,false)=true
    and coalesce(sa.can_login,false)=true;
  if not found then
    raise exception 'active staff actor required' using errcode='42501';
  end if;

  return query
  select
    s.id,
    s.name,
    s.role,
    s.branch,
    public.dawaa_biometric_source_branch_v1(b.raw_payload,b.branch),
    b.biometric_user_id,
    public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time),
    b.punch_type,
    b.device_id::text,
    b.provider
  from public.biometric_attendance_logs b
  join public.staff s on s.id=b.staff_id
  where (public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time)
          at time zone 'Africa/Cairo')::date between p_start and p_end
    and nullif(trim(s.branch),'') is not null
    and nullif(trim(public.dawaa_biometric_source_branch_v1(b.raw_payload,b.branch)),'') is not null
    and trim(public.dawaa_biometric_source_branch_v1(b.raw_payload,b.branch))<>trim(s.branch)
    and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or trim(s.branch)=trim(p_branch))
    and public.dawaa_can_read_staff_attendance_log(s.id,s.branch)
  order by public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time) desc,s.name
  limit greatest(1,least(coalesce(p_limit,250),1000));
end;
$function$


revoke all on function public.list_cross_branch_biometric_events_v1(date,date,text,integer) from public;
grant execute on function public.list_cross_branch_biometric_events_v1(date,date,text,integer) to anon,authenticated,service_role;
