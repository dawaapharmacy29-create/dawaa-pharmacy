-- Do not narrow raw biometric ambiguity to the recorded schedule.
-- An actual shift may differ from the roster. Keep the existing broad
-- fail-closed anomaly window until event-to-shift matching is authoritative.
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
     then (((p_date+case when shift_end<=shift_start then 1 else 0 end)+shift_end)
             at time zone 'Africa/Cairo')+interval '6 hours'
     else (((p_date+2)::timestamp) at time zone 'Africa/Cairo') end as required_until
 from (select 1) seed left join sch on true
 )
 select coalesce(public.attendance_branch_sync_complete_through_v1(s.branch)>=b.required_until,false)
 from public.staff s cross join bounds b where s.id=p_staff_id;
$fn$;
notify pgrst,'reload schema';
