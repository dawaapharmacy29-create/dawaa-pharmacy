-- Development branch only. Do not apply to production until attendance-intelligence-v2 review is complete.
-- Purpose: unify base schedule + approved/pending permissions + shift exceptions in one auditable context.

create or replace function public.attendance_effective_context_v1(
  p_date date,
  p_branch text default null
)
returns table (
  staff_id uuid,
  staff_name text,
  branch text,
  base_start time,
  base_end time,
  approved_time_off jsonb,
  pending_time_off jsonb,
  approved_exceptions jsonb,
  protection_status text,
  decision_notes jsonb
)
language sql
security invoker
set search_path = public
as $$
with base as (
  select distinct on (ss.staff_id)
    ss.staff_id,
    coalesce(ss.staff_name, src.staff_name) as staff_name,
    coalesce(ss.branch, src.branch) as branch,
    coalesce(ss.start_time, nullif(ss.shift_start, '')::time) as base_start,
    coalesce(ss.end_time, nullif(ss.shift_end, '')::time) as base_end
  from public.shift_schedules ss
  left join public.schedule_roster_current src on src.staff_id = ss.staff_id
  where (ss.shift_date = p_date or ss.date = p_date)
    and (p_branch is null or coalesce(ss.branch, src.branch) = p_branch)
  order by ss.staff_id, ss.updated_at desc nulls last, ss.created_at desc nulls last
),
time_off as (
  select
    r.staff_id,
    jsonb_agg(to_jsonb(r) order by r.created_at) filter (where lower(coalesce(r.status,'')) in ('approved','accepted','معتمد','مقبول')) as approved,
    jsonb_agg(to_jsonb(r) order by r.created_at) filter (where lower(coalesce(r.status,'')) in ('pending','pending_review','قيد المراجعة','انتظار المراجعة')) as pending
  from public.staff_time_off_requests r
  where p_date between r.start_date and r.end_date
  group by r.staff_id
),
exceptions as (
  select
    coalesce(nullif(e.staff_name,''), e.employee_name) as staff_name,
    jsonb_agg(to_jsonb(e) order by e.created_at) filter (where lower(coalesce(e.status,'')) in ('approved','accepted','معتمد','مقبول')) as approved
  from public.shift_exceptions e
  where e.date = p_date
    and (p_branch is null or e.branch is null or e.branch = p_branch)
  group by coalesce(nullif(e.staff_name,''), e.employee_name)
)
select
  b.staff_id,
  b.staff_name,
  b.branch,
  b.base_start,
  b.base_end,
  coalesce(t.approved, '[]'::jsonb) as approved_time_off,
  coalesce(t.pending, '[]'::jsonb) as pending_time_off,
  coalesce(x.approved, '[]'::jsonb) as approved_exceptions,
  case
    when jsonb_array_length(coalesce(t.pending, '[]'::jsonb)) > 0 then 'penalty_hold'
    when jsonb_array_length(coalesce(t.approved, '[]'::jsonb)) > 0 then 'approved_adjustment'
    when jsonb_array_length(coalesce(x.approved, '[]'::jsonb)) > 0 then 'approved_shift_exception'
    else 'base_schedule'
  end as protection_status,
  jsonb_build_array(
    jsonb_build_object('step', 1, 'label', 'base_schedule', 'start', b.base_start, 'end', b.base_end),
    jsonb_build_object('step', 2, 'label', 'approved_shift_exceptions', 'count', jsonb_array_length(coalesce(x.approved, '[]'::jsonb))),
    jsonb_build_object('step', 3, 'label', 'approved_time_off', 'count', jsonb_array_length(coalesce(t.approved, '[]'::jsonb))),
    jsonb_build_object('step', 4, 'label', 'pending_time_off', 'count', jsonb_array_length(coalesce(t.pending, '[]'::jsonb)))
  ) as decision_notes
from base b
left join time_off t on t.staff_id = b.staff_id
left join exceptions x on x.staff_name = b.staff_name;
$$;

comment on function public.attendance_effective_context_v1(date, text) is
'Attendance Intelligence V2: read-only effective context for schedule, approved/pending permissions and shift exceptions. Pending permissions must hold penalties until resolved.';
