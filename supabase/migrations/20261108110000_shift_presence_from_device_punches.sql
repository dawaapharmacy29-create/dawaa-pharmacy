-- مين كان في الشيفت بقى من البصمات الفعلية بس (طلب المالك 2026-11-07):
--   * الفرع هو جهاز البصمة نفسه، مش فرع الموظف في سجل الحضور: هبه محمد بصمت على جهاز الشامي وكانت بتظهر في شكري.
--   * مفيش جدول خالص: اللي مابصمش مش بيظهر، حتى لو على الجدول أو في إجازة.
--   * بصمة يدوية من غير سجل جهاز بتتحسب على فرع الموظف.
-- القراءة بس: مفيش تعديل على الحضور ولا المرتب ولا التسليمات.

-- The branches whose device saw this attendance span. Empty for a manual punch with no device log.
create or replace function public.dawaa_attendance_punch_branches_v1(
  p_staff_id uuid, p_first_in timestamptz, p_last_out timestamptz)
returns text[]
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select coalesce(array_agg(distinct b.branch) filter (where b.branch is not null), '{}'::text[])
  from public.biometric_attendance_logs b
  where b.staff_id = p_staff_id
    and b.punch_time between coalesce(p_first_in, p_last_out - interval '16 hours') - interval '5 minutes'
                         and coalesce(p_last_out, p_first_in + interval '16 hours') + interval '5 minutes';
$function$;

revoke all on function public.dawaa_attendance_punch_branches_v1(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- The list in the GM daily review: same signature, only real punches on this branch's device.
create or replace function public.shift_on_duty_doctors_v1(p_branch text, p_close_at timestamptz)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object('staff_id', x.staff_id, 'name', x.name, 'role', x.role,
           'kind', x.kind, 'source', 'punch', 'first_in', x.first_in, 'last_out', x.last_out)
           order by x.kind_order, x.start_at), '[]'::jsonb)
  from (
    select distinct on (a.staff_id) a.staff_id, btrim(s.name) as name, s.role, k.kind, k.kind_order,
           a.first_in, a.last_out, coalesce(a.first_in, a.last_out) as start_at
    from public.attendance_daily_summary a
    join public.staff s on s.id = a.staff_id
    cross join lateral (
      select case
        when lower(btrim(coalesce(s.role, ''))) in ('مدير فرع', 'branch_manager') then 'manager'
        when lower(btrim(coalesce(s.role, ''))) in ('assistant', 'مساعد صيدلي', 'مساعد') then 'assistant'
        when lower(btrim(coalesce(s.role, ''))) in ('صيدلاني', 'pharmacist') then 'doctor'
      end as kind,
      case
        when lower(btrim(coalesce(s.role, ''))) in ('صيدلاني', 'pharmacist') then 0
        when lower(btrim(coalesce(s.role, ''))) in ('assistant', 'مساعد صيدلي', 'مساعد') then 1
        else 2
      end as kind_order
    ) k
    cross join lateral (
      select public.dawaa_attendance_punch_branches_v1(a.staff_id, a.first_in, a.last_out) as branches
    ) d
    where k.kind is not null
      and (a.first_in is not null or a.last_out is not null)
      and (p_branch = any(d.branches) or (cardinality(d.branches) = 0 and a.branch = p_branch))
      and a.attendance_date between (p_close_at at time zone 'Africa/Cairo')::date - 1
                                and (p_close_at at time zone 'Africa/Cairo')::date
      and coalesce(a.first_in, a.last_out) <= p_close_at - interval '1 hour'
      and coalesce(a.last_out, a.scheduled_end_at, a.first_in + interval '12 hours') >= p_close_at - interval '1 hour'
    order by a.staff_id, a.attendance_date desc
  ) x;
$function$;

-- Every attendance span with a punch in the range, for the shift handovers page to match against each shift's real window.
create or replace function public.shift_presence_intervals_v1(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_rows jsonb;
begin
  perform public.gm_daily_review_actor_v1();
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'invalid_range' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'staff_id', a.staff_id, 'name', btrim(s.name), 'kind', k.kind, 'date', a.attendance_date,
      'home_branch', a.branch, 'branches', d.branches,
      'first_in', a.first_in, 'last_out', a.last_out, 'scheduled_end', a.scheduled_end_at
    ) order by a.first_in), '[]'::jsonb)
    into v_rows
  from public.attendance_daily_summary a
  join public.staff s on s.id = a.staff_id
  cross join lateral (
    select case
      when lower(btrim(coalesce(s.role, ''))) in ('مدير فرع', 'branch_manager') then 'manager'
      when lower(btrim(coalesce(s.role, ''))) in ('assistant', 'مساعد صيدلي', 'مساعد') then 'assistant'
      when lower(btrim(coalesce(s.role, ''))) in ('صيدلاني', 'pharmacist') then 'doctor'
    end as kind
  ) k
  cross join lateral (
    select public.dawaa_attendance_punch_branches_v1(a.staff_id, a.first_in, a.last_out) as branches
  ) d
  where a.attendance_date between p_from and p_to
    and (a.first_in is not null or a.last_out is not null);
  return v_rows;
end;
$function$;

revoke all on function public.shift_presence_intervals_v1(date, date) from public;
-- The site's staff session runs as anon; the actor check above is the gate (see 20261105240000).
grant execute on function public.shift_presence_intervals_v1(date, date) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
