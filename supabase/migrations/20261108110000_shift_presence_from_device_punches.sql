-- مين كان في الشيفت بقى من البصمات الفعلية بس (طلب المالك 2026-11-07):
--   * الفرع هو جهاز البصمة نفسه، مش فرع الموظف في سجل الحضور: هبه محمد بصمت على جهاز الشامي وكانت بتظهر في شكري.
--   * مفيش جدول خالص: اللي مابصمش مش بيظهر، حتى لو على الجدول أو في إجازة.
--   * بصمة يدوية من غير سجل جهاز بتتحسب على فرع الموظف.
--   * اللي بصمته على الجهاز وملوش يوم حضور (د وائل ود/ علا، وأي بصمة لسه ماترحلتش) بيتحسب من سجل الجهاز نفسه.
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

-- Device punches with no attendance day covering them: staff outside attendance (د وائل, د/ علا) and punches not
-- promoted yet. Consecutive punches less than 12 hours apart are one span. Punch types are unreliable on these
-- devices, so a type only decides whether a lone punch is an arrival or a departure.
create or replace function public.dawaa_unsummarized_punch_spans_v1(p_from timestamptz, p_to timestamptz)
returns table(staff_id uuid, first_in timestamptz, last_out timestamptz, branches text[])
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  with free as (
    select b.staff_id, b.punch_time, b.punch_type, b.branch
    from public.biometric_attendance_logs b
    where b.staff_id is not null and b.punch_time >= p_from and b.punch_time < p_to
      and not exists (
        select 1 from public.attendance_daily_summary a
        where a.staff_id = b.staff_id
          and (a.first_in is not null or a.last_out is not null)
          and a.attendance_date between (b.punch_time at time zone 'Africa/Cairo')::date - 1
                                    and (b.punch_time at time zone 'Africa/Cairo')::date + 1
          and b.punch_time between coalesce(a.first_in, a.last_out - interval '16 hours') - interval '5 minutes'
                               and coalesce(a.last_out, a.first_in + interval '16 hours') + interval '5 minutes'
      )
  ),
  marked as (
    select f.*, case when lag(f.punch_time) over w is null
                       or f.punch_time - lag(f.punch_time) over w >= interval '12 hours' then 1 else 0 end as starts
    from free f
    window w as (partition by f.staff_id order by f.punch_time)
  ),
  grouped as (
    select m.*, sum(m.starts) over (partition by m.staff_id order by m.punch_time) as span_no
    from marked m
  )
  select g.staff_id,
         case when count(*) = 1 and max(g.punch_type) = 'check_out' then null else min(g.punch_time) end,
         case when count(*) = 1 then case when max(g.punch_type) = 'check_out' then max(g.punch_time) end
              else max(g.punch_time) end,
         coalesce(array_agg(distinct g.branch) filter (where g.branch is not null), '{}'::text[])
  from grouped g
  group by g.staff_id, g.span_no;
$function$;

revoke all on function public.dawaa_unsummarized_punch_spans_v1(timestamptz, timestamptz) from public, anon, authenticated;

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
    from (
      select r.staff_id, r.attendance_date, r.branch, r.first_in, r.last_out, r.scheduled_end_at,
             public.dawaa_attendance_punch_branches_v1(r.staff_id, r.first_in, r.last_out) as branches
      from public.attendance_daily_summary r
      where (r.first_in is not null or r.last_out is not null)
        and r.attendance_date between (p_close_at at time zone 'Africa/Cairo')::date - 1
                                  and (p_close_at at time zone 'Africa/Cairo')::date
      union all
      select u.staff_id, (coalesce(u.first_in, u.last_out) at time zone 'Africa/Cairo')::date, null, u.first_in, u.last_out,
             null, u.branches
      from public.dawaa_unsummarized_punch_spans_v1(p_close_at - interval '36 hours', p_close_at + interval '1 hour') u
    ) a
    join public.staff s on s.id = a.staff_id
    cross join lateral (
      select case
        when lower(btrim(coalesce(s.role, ''))) in ('مدير فرع', 'branch_manager', 'مدير المشتريات', 'مديرة الفروع') then 'manager'
        when lower(btrim(coalesce(s.role, ''))) in ('assistant', 'مساعد صيدلي', 'مساعد') then 'assistant'
        when lower(btrim(coalesce(s.role, ''))) in ('صيدلاني', 'pharmacist') then 'doctor'
      end as kind,
      case
        when lower(btrim(coalesce(s.role, ''))) in ('صيدلاني', 'pharmacist') then 0
        when lower(btrim(coalesce(s.role, ''))) in ('assistant', 'مساعد صيدلي', 'مساعد') then 1
        else 2
      end as kind_order
    ) k
    where k.kind is not null
      and (p_branch = any(a.branches) or (cardinality(a.branches) = 0 and a.branch = p_branch))
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
      'home_branch', coalesce(a.branch, s.branch), 'branches', a.branches,
      'first_in', a.first_in, 'last_out', a.last_out, 'scheduled_end', a.scheduled_end_at
    ) order by coalesce(a.first_in, a.last_out)), '[]'::jsonb)
    into v_rows
  from (
    select r.staff_id, r.attendance_date, r.branch, r.first_in, r.last_out, r.scheduled_end_at,
           public.dawaa_attendance_punch_branches_v1(r.staff_id, r.first_in, r.last_out) as branches
    from public.attendance_daily_summary r
    where r.attendance_date between p_from and p_to
      and (r.first_in is not null or r.last_out is not null)
    union all
    select u.staff_id, (coalesce(u.first_in, u.last_out) at time zone 'Africa/Cairo')::date, null, u.first_in, u.last_out,
           null, u.branches
    from public.dawaa_unsummarized_punch_spans_v1(
      (p_from::timestamp at time zone 'Africa/Cairo'), ((p_to + 1)::timestamp at time zone 'Africa/Cairo')) u
  ) a
  join public.staff s on s.id = a.staff_id
  cross join lateral (
    select case
      when lower(btrim(coalesce(s.role, ''))) in ('مدير فرع', 'branch_manager', 'مدير المشتريات', 'مديرة الفروع') then 'manager'
      when lower(btrim(coalesce(s.role, ''))) in ('assistant', 'مساعد صيدلي', 'مساعد') then 'assistant'
      when lower(btrim(coalesce(s.role, ''))) in ('صيدلاني', 'pharmacist') then 'doctor'
    end as kind
  ) k;
  return v_rows;
end;
$function$;

revoke all on function public.shift_presence_intervals_v1(date, date) from public;
-- The site's staff session runs as anon; the actor check above is the gate (see 20261105240000).
grant execute on function public.shift_presence_intervals_v1(date, date) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
