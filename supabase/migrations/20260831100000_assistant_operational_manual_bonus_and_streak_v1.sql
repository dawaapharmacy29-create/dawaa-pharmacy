-- توسيع مصادر النقاط اللي تدخل في لوحة المقارنة الشهرية عشان تشمل المكافآت
-- اليدوية ومكافأة الالتزام، مش بس عمليات المشتريات/خدمة العملاء العادية.
create or replace function public.get_assistant_operational_leaderboard_v1()
returns table (
  staff_id uuid,
  staff_name text,
  branch text,
  total_points numeric
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  if public.dawaa_current_staff_account_id_strict() is null then
    raise exception using errcode = '42501', message = 'active staff actor required';
  end if;

  return query
    select s.id, s.name, s.branch, coalesce(sum(et.points), 0) as total_points
    from public.assistant_operational_eligible_staff e
    join public.staff s on s.id = e.staff_id
    left join public.employee_transactions et
      on et.staff_id = s.id
     and et.source in ('assistant_operational_log', 'assistant_operational_manual_bonus', 'assistant_operational_streak_bonus')
     and et.status = 'active'
     and et.month_cycle = public.dawaa_current_points_cycle_label_v1()
    group by s.id, s.name, s.branch
    order by total_points desc;
end;
$function$;

-- مكافأة تميز مفاجئة — بيديها مدير الإدارة (أي حساب معاه صلاحية manage_incentives،
-- زي صفحة اعتماد الحوافز بالظبط) لفرد واحد من الثلاثة بأي رقم نقاط يحدده هو وقت الاعتماد.
create or replace function public.grant_assistant_operational_bonus_v1(
  p_staff_id uuid,
  p_points numeric,
  p_reason text default 'مكافأة تميز مفاجئة'
) returns public.employee_transactions
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_account public.staff_accounts%rowtype;
  v_staff record;
  v_month_cycle text;
  v_row public.employee_transactions%rowtype;
begin
  select * into v_account
  from public.staff_accounts
  where id = public.dawaa_current_staff_account_id_strict()
    and coalesce(active, false) and coalesce(can_login, false);
  if not found then raise exception using errcode = '42501', message = 'active staff actor required'; end if;

  if not public.user_has_permission(v_account.id, 'manage_incentives') then
    raise exception using errcode = '42501', message = 'manage_incentives permission required';
  end if;

  if p_points is null or p_points <= 0 then
    raise exception using errcode = '22023', message = 'bonus points must be positive';
  end if;

  if not exists (select 1 from public.assistant_operational_eligible_staff where staff_id = p_staff_id) then
    raise exception using errcode = '22023', message = 'staff member not eligible for assistant operational bonuses';
  end if;

  select id, name, branch into v_staff from public.staff where id = p_staff_id;
  v_month_cycle := public.dawaa_current_points_cycle_label_v1();

  insert into public.employee_transactions (
    staff_id, employee_id, employee_name, type, title, reason, amount, points, points_delta,
    source, source_id, transaction_date, created_at, description, month_cycle, branch,
    status, category, employee_visible, created_by
  ) values (
    v_staff.id, v_staff.id, v_staff.name, 'reward', coalesce(nullif(trim(p_reason), ''), 'مكافأة تميز مفاجئة'),
    coalesce(nullif(trim(p_reason), ''), 'مكافأة تميز مفاجئة'), 0, p_points, p_points,
    'assistant_operational_manual_bonus', gen_random_uuid(), current_date, now(),
    coalesce(nullif(trim(p_reason), ''), 'مكافأة تميز مفاجئة'), v_month_cycle, v_staff.branch,
    'active', 'مكافأة تميز فردية', true,
    coalesce(nullif(trim(v_account.staff_name), ''), nullif(trim(v_account.name), ''), v_account.username)
  ) returning * into v_row;

  return v_row;
end;
$function$;
revoke all on function public.grant_assistant_operational_bonus_v1(uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.grant_assistant_operational_bonus_v1(uuid, numeric, text) to anon, authenticated;

-- نفس المكافأة بس للتلاتة مع بعض دفعة واحدة (مكافأة فريق).
create or replace function public.grant_assistant_operational_team_bonus_v1(
  p_points numeric,
  p_reason text default 'مكافأة تميز — الفريق كله'
) returns setof public.employee_transactions
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_account public.staff_accounts%rowtype;
  v_staff record;
  v_month_cycle text;
  v_row public.employee_transactions%rowtype;
begin
  select * into v_account
  from public.staff_accounts
  where id = public.dawaa_current_staff_account_id_strict()
    and coalesce(active, false) and coalesce(can_login, false);
  if not found then raise exception using errcode = '42501', message = 'active staff actor required'; end if;

  if not public.user_has_permission(v_account.id, 'manage_incentives') then
    raise exception using errcode = '42501', message = 'manage_incentives permission required';
  end if;

  if p_points is null or p_points <= 0 then
    raise exception using errcode = '22023', message = 'bonus points must be positive';
  end if;

  v_month_cycle := public.dawaa_current_points_cycle_label_v1();

  for v_staff in
    select s.id, s.name, s.branch
    from public.assistant_operational_eligible_staff e
    join public.staff s on s.id = e.staff_id
  loop
    insert into public.employee_transactions (
      staff_id, employee_id, employee_name, type, title, reason, amount, points, points_delta,
      source, source_id, transaction_date, created_at, description, month_cycle, branch,
      status, category, employee_visible, created_by
    ) values (
      v_staff.id, v_staff.id, v_staff.name, 'reward', coalesce(nullif(trim(p_reason), ''), 'مكافأة تميز — الفريق كله'),
      coalesce(nullif(trim(p_reason), ''), 'مكافأة تميز — الفريق كله'), 0, p_points, p_points,
      'assistant_operational_manual_bonus', gen_random_uuid(), current_date, now(),
      coalesce(nullif(trim(p_reason), ''), 'مكافأة تميز — الفريق كله'), v_month_cycle, v_staff.branch,
      'active', 'مكافأة تميز جماعية', true,
      coalesce(nullif(trim(v_account.staff_name), ''), nullif(trim(v_account.name), ''), v_account.username)
    ) returning * into v_row;
    return next v_row;
  end loop;
  return;
end;
$function$;
revoke all on function public.grant_assistant_operational_team_bonus_v1(numeric, text) from public, anon, authenticated;
grant execute on function public.grant_assistant_operational_team_bonus_v1(numeric, text) to anon, authenticated;

-- مكافأة الالتزام: ٢٥ نقطة كل ٦ أيام عمل حقيقيين متتالية (حسب جدول شيفت كل
-- واحدة الفعلي — يوم الإجازة بيتحدد من shift_schedules مش بافتراض ثابت).
-- عداد مستمر لكل موظفة عشان الالتزام يتراكم صح عبر التشغيلات، ومفيش تكرار
-- لنفس اليوم مرتين.
create table if not exists public.assistant_operational_streak_state (
  staff_id uuid primary key references public.staff(id),
  streak_count integer not null default 0,
  last_counted_date date,
  updated_at timestamptz not null default now()
);
alter table public.assistant_operational_streak_state enable row level security;
revoke all on table public.assistant_operational_streak_state from public, anon, authenticated;

create or replace function public.settle_assistant_operational_streak_bonus()
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_staff record;
  v_streak integer;
  v_last_counted date;
  v_cursor date;
  v_yesterday date := (now() at time zone 'Africa/Cairo')::date - 1;
  v_day_ar text;
  v_schedule record;
  v_has_attendance boolean;
  v_month_cycle text;
begin
  for v_staff in
    select e.staff_id, s.name, s.branch
    from public.assistant_operational_eligible_staff e
    join public.staff s on s.id = e.staff_id
  loop
    select streak_count, last_counted_date into v_streak, v_last_counted
    from public.assistant_operational_streak_state
    where staff_id = v_staff.staff_id;

    if not found then
      v_streak := 0;
      v_last_counted := v_yesterday - 60;
      insert into public.assistant_operational_streak_state (staff_id, streak_count, last_counted_date)
      values (v_staff.staff_id, 0, v_last_counted)
      on conflict (staff_id) do nothing;
    end if;

    v_cursor := coalesce(v_last_counted, v_yesterday - 60) + 1;

    while v_cursor <= v_yesterday loop
      v_day_ar := case extract(dow from v_cursor)::int
        when 0 then 'الأحد' when 1 then 'الاثنين' when 2 then 'الثلاثاء'
        when 3 then 'الأربعاء' when 4 then 'الخميس' when 5 then 'الجمعة' else 'السبت' end;

      select ss.* into v_schedule
      from public.shift_schedules ss
      where ss.staff_id = v_staff.staff_id and trim(coalesce(ss.day_name, '')) = v_day_ar
      order by ss.updated_at desc nulls last, ss.created_at desc nulls last, ss.id desc
      limit 1;

      if not found or coalesce(v_schedule.is_off, false) or coalesce(v_schedule.is_day_off, false) then
        -- مفيش جدول لليوم ده أو هو يوم إجازتها الحقيقي — يتخطى من غير ما يكسر العداد
        v_cursor := v_cursor + 1;
        continue;
      end if;

      select exists(
        select 1 from public.attendance_daily_summary a
        where a.staff_id = v_staff.staff_id and a.attendance_date = v_cursor
          and a.status = 'approved' and a.first_in is not null
      ) into v_has_attendance;

      if v_has_attendance then
        v_streak := v_streak + 1;
        if v_streak >= 6 then
          v_month_cycle := public.dawaa_current_points_cycle_label_v1();
          insert into public.employee_transactions (
            staff_id, employee_id, employee_name, type, title, reason, amount, points, points_delta,
            source, source_id, transaction_date, created_at, description, month_cycle, branch,
            status, category, employee_visible, created_by
          ) values (
            v_staff.staff_id, v_staff.staff_id, v_staff.name, 'reward', 'مكافأة التزام (٦ أيام عمل حقيقيين متتالية)',
            'مكافأة التزام (٦ أيام عمل حقيقيين متتالية)', 0, 25, 25,
            'assistant_operational_streak_bonus', gen_random_uuid(), current_date, now(),
            'التزام ٦ أيام عمل حقيقيين متتالية حتى ' || v_cursor::text,
            v_month_cycle, v_staff.branch, 'active', 'مكافأة الالتزام', true, 'system_streak_cron'
          );
          v_streak := 0;
        end if;
      else
        v_streak := 0;
      end if;

      v_cursor := v_cursor + 1;
    end loop;

    update public.assistant_operational_streak_state
    set streak_count = v_streak, last_counted_date = v_yesterday, updated_at = now()
    where staff_id = v_staff.staff_id;
  end loop;
end;
$function$;
revoke all on function public.settle_assistant_operational_streak_bonus() from public, anon, authenticated;
grant execute on function public.settle_assistant_operational_streak_bonus() to service_role;

select cron.schedule(
  'dawaa-settle-assistant-operational-streak',
  '0 5 * * *',
  $cron$select public.settle_assistant_operational_streak_bonus();$cron$
);

notify pgrst, 'reload schema';
