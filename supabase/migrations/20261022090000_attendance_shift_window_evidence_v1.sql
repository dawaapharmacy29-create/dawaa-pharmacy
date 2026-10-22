-- Narrow ambiguity to the dated schedule window, including legitimate overnight exits.
-- Unknown schedules fail closed using the original broad interval.
create or replace function public.attendance_uncertain_raw_punch_for_day_v1(p_staff_id uuid,p_date date)
returns boolean language sql stable security definer set search_path to 'public','pg_catalog' as $fn$
 with sch as (
   select shift_start,shift_end,is_off,is_day_off
   from public.attendance_schedule_for_date_v1(p_staff_id,p_date)
 ), window_bounds as (
   select case when shift_start is not null and shift_end is not null
                  and not coalesce(is_off,false) and not coalesce(is_day_off,false)
         then (p_date::timestamp+shift_start) at time zone 'Africa/Cairo' - interval '4 hours'
         else ((p_date-1)::timestamp at time zone 'Africa/Cairo') end as lower_bound,
          case when shift_start is not null and shift_end is not null
                  and not coalesce(is_off,false) and not coalesce(is_day_off,false)
         then ((p_date+case when shift_end<=shift_start then 1 else 0 end)::timestamp+shift_end)
                    at time zone 'Africa/Cairo' + interval '6 hours'
         else ((p_date+2)::timestamp at time zone 'Africa/Cairo') end as upper_bound
   from (select 1) seed left join sch on true
 )
 select exists(select 1 from public.biometric_attendance_logs b
   left join public.biometric_semantic_decisions d on d.biometric_log_id=b.id
   cross join window_bounds w
   where (b.staff_id=p_staff_id or d.staff_id=p_staff_id)
     and public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time)>=w.lower_bound
     and public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time)<w.upper_bound
     and (d.biometric_log_id is null or coalesce(d.decision,'review')<>'accepted'
          or coalesce(d.confidence,0)<0.75
          or coalesce(d.reason,'')='no_matching_schedule_fallback_to_raw')
 );
$fn$;

-- Require a complete watermark through the scheduled shift end plus safety margin.
-- Missing/ambiguous schedules retain the broad fail-closed fallback.
create or replace function public.attendance_sync_proven_for_day_v1(p_staff_id uuid,p_date date)
returns boolean language sql stable security definer set search_path to 'public','pg_catalog' as $fn$
 with sch as (
 select shift_start,shift_end,is_off,is_day_off
 from public.attendance_schedule_for_date_v1(p_staff_id,p_date)
 ), bounds as (
 select case when shift_start is not null and shift_end is not null
                   and not coalesce(is_off,false) and not coalesce(is_day_off,false)
     then (((p_date+case when shift_end<=shift_start then 1 else 0 end)::timestamp+shift_end)
             at time zone 'Africa/Cairo')+interval '6 hours'
     else (((p_date+2)::timestamp) at time zone 'Africa/Cairo') end as required_until
 from (select 1) seed left join sch on true
 )
 select coalesce(public.attendance_branch_sync_complete_through_v1(s.branch)>=b.required_until,false)
 from public.staff s cross join bounds b where s.id=p_staff_id;
$fn$;
notify pgrst,'reload schema';
