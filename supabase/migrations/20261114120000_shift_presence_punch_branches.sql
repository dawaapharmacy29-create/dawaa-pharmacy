-- مين كان موجود وقت تسليم الشيفت (طلب المالك 2026-11-14: «اللي هينسى تسليم الشيفت هيتعمله خصم»):
--   كل فترة حضور بقت ترجع بصماتها نفسها بوقت وجهاز كل بصمة، عشان اللي بصم في فرع وبعدين في التاني
--   (د/ عمر ١٠/١١: شكري ٦:١٦م ثم الشامي ٢:٥٢ص) يتحسب في الفرع اللي كان فيه ساعة التسليم بس، مش في الاتنين.
-- إضافة حقل بس (punches)؛ باقي الحقول زي ما هي. القراءة بس: مفيش تعديل على الحضور ولا المرتب ولا التسليمات.

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
      'first_in', a.first_in, 'last_out', a.last_out, 'scheduled_end', a.scheduled_end_at,
      'punches', p.punches
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
  ) k
  -- The device punches inside the span (same window as dawaa_attendance_punch_branches_v1), oldest first.
  cross join lateral (
    select coalesce(jsonb_agg(jsonb_build_object('at', b.punch_time, 'branch', b.branch) order by b.punch_time),
                    '[]'::jsonb) as punches
    from public.biometric_attendance_logs b
    where b.staff_id = a.staff_id
      and b.branch is not null
      and b.punch_time between coalesce(a.first_in, a.last_out - interval '16 hours') - interval '5 minutes'
                           and coalesce(a.last_out, a.first_in + interval '16 hours') + interval '5 minutes'
  ) p;
  return v_rows;
end;
$function$;
