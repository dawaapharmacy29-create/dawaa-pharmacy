create or replace function public.dawaa_attendance_review_triage_v1(
  p_resolution_status text,
  p_preview jsonb
)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select case
    when coalesce((p_preview->>'finalizable')::boolean,false)=false then 'waiting'
    when coalesce((p_preview->>'system_resolvable')::boolean,false)=true then 'auto'
    when coalesce(p_resolution_status,'') in (
      'absence_review','missing_checkin','missing_checkout','early_leave_review',
      'worked_on_off','time_off_with_events'
    ) then 'manager'
    when coalesce(p_resolution_status,'')='needs_event_review'
      and coalesce((p_preview->>'accepted_events')::int,0)<2 then 'manager'
    else 'system_repair'
  end
$$;

revoke all on function public.dawaa_attendance_review_triage_v1(text,jsonb)
from public, anon, authenticated;
grant execute on function public.dawaa_attendance_review_triage_v1(text,jsonb)
to service_role;