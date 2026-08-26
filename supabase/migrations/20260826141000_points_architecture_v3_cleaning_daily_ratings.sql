-- Points Architecture V3 - daily cleaning quality ratings.
-- One daily manager rating -> one canonical employee transaction -> monthly points truth.

create table if not exists public.cleaning_daily_ratings (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  branch text not null,
  rating_date date not null default current_date,
  stars smallint not null check (stars between 1 and 5),
  score_pct numeric(5,2) not null check (score_pct between 0 and 100),
  points_delta numeric not null default 0,
  month_cycle text not null,
  manager_note text,
  rated_by text,
  rated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_id, rating_date)
);

create index if not exists cleaning_daily_ratings_staff_cycle_idx
  on public.cleaning_daily_ratings (staff_id, month_cycle, rating_date desc);
create index if not exists cleaning_daily_ratings_branch_date_idx
  on public.cleaning_daily_ratings (branch, rating_date desc);
create index if not exists employee_transactions_truth_lookup_v3_idx
  on public.employee_transactions (staff_id, month_cycle, source, source_id, status);
create unique index if not exists employee_transactions_cleaning_daily_rating_once_v1
  on public.employee_transactions (staff_id, month_cycle, source, source_id)
  where source = 'cleaning_daily_star_rating' and source_id is not null and status in ('active','approved','pending');

alter table public.cleaning_daily_ratings enable row level security;

create or replace function public.dawaa_points_cycle_label_for_date_v3(p_date date)
returns text
language sql
immutable
set search_path = public, pg_catalog
as $$
  select to_char(
    case
      when extract(day from p_date)::int >= 26
        then (date_trunc('month', p_date::timestamp) + interval '1 month')
      else date_trunc('month', p_date::timestamp)
    end,
    'YYYY-MM'
  );
$$;

create or replace function public.dawaa_cleaning_star_points_v1(p_stars integer)
returns numeric
language sql
immutable
as $$
  select case p_stars
    when 5 then 5::numeric
    when 4 then 2::numeric
    when 3 then 0::numeric
    when 2 then -5::numeric
    when 1 then -10::numeric
    else null::numeric
  end;
$$;

comment on function public.dawaa_cleaning_star_points_v1(integer) is
  'Daily cleaning quality policy: 5 stars +5, 4 stars +2, 3 stars 0, 2 stars -5, 1 star -10. Stored as a snapshot in employee_transactions.';

create or replace function public.dawaa_is_cleaning_role_v1(p_role text)
returns boolean
language sql
immutable
as $$
  select lower(trim(coalesce(p_role,''))) in ('cleaning','cleaner','cleaning_supervisor')
    or coalesce(p_role,'') ilike '%نظاف%';
$$;

create or replace function public.get_cleaning_daily_rating_cards_v1(
  p_rating_date date default current_date,
  p_branch text default null
)
returns table(
  staff_id uuid,
  staff_name text,
  staff_role text,
  branch text,
  rating_id uuid,
  stars integer,
  score_pct numeric,
  points_delta numeric,
  manager_note text,
  rated_by_name text,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_role text := lower(trim(coalesce(public.employee_operating_actor_role(),'')));
  v_actor_branch text := nullif(trim(coalesce(public.employee_operating_actor_branch(),'')), '');
  v_branch text := nullif(trim(coalesce(p_branch,'')), '');
  v_global boolean := v_role in ('general_manager','admin','executive_manager','branches_manager');
begin
  if not (v_global or v_role = 'branch_manager') then
    raise exception 'not_authorized';
  end if;

  if not v_global then
    if v_actor_branch is null then raise exception 'manager_branch_missing'; end if;
    if v_branch is not null and v_branch is distinct from v_actor_branch then
      raise exception 'not_authorized_for_branch';
    end if;
    v_branch := v_actor_branch;
  end if;

  return query
  select
    s.id,
    s.name,
    s.role,
    s.branch,
    r.id,
    r.stars::integer,
    r.score_pct,
    r.points_delta,
    r.manager_note,
    r.rated_by_name,
    r.updated_at
  from public.staff s
  left join public.cleaning_daily_ratings r
    on r.staff_id = s.id
   and r.rating_date = coalesce(p_rating_date, current_date)
  where public.dawaa_is_cleaning_role_v1(s.role)
    and coalesce(s.active, s.is_active, true)
    and coalesce(s.status, 'active') not in ('inactive','deleted','disabled')
    and (v_branch is null or s.branch = v_branch)
  order by s.branch, s.name;
end;
$$;

create or replace function public.rate_cleaning_staff_day_v1(
  p_staff_id uuid,
  p_stars integer,
  p_manager_note text default null,
  p_rating_date date default current_date
)
returns public.cleaning_daily_ratings
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_role text := lower(trim(coalesce(public.employee_operating_actor_role(),'')));
  v_actor_branch text := nullif(trim(coalesce(public.employee_operating_actor_branch(),'')), '');
  v_global boolean := v_role in ('general_manager','admin','executive_manager','branches_manager');
  v_staff public.staff%rowtype;
  v_rating public.cleaning_daily_ratings%rowtype;
  v_points numeric;
  v_cycle text;
  v_actor_id text := public.employee_operating_actor_id();
  v_actor_name text;
  v_existing_tx uuid;
begin
  if p_stars < 1 or p_stars > 5 then
    raise exception 'stars_must_be_between_1_and_5';
  end if;
  if not (v_global or v_role = 'branch_manager') then
    raise exception 'not_authorized';
  end if;

  select * into v_staff from public.staff where id = p_staff_id;
  if not found or not public.dawaa_is_cleaning_role_v1(v_staff.role) then
    raise exception 'cleaning_staff_not_found';
  end if;
  if not v_global and coalesce(v_staff.branch,'') is distinct from coalesce(v_actor_branch,'') then
    raise exception 'not_authorized_for_branch';
  end if;

  select coalesce(sa.name, sa.staff_name, sa.username)
    into v_actor_name
  from public.staff_accounts sa
  where sa.id::text = v_actor_id
  limit 1;

  v_points := public.dawaa_cleaning_star_points_v1(p_stars);
  v_cycle := public.dawaa_points_cycle_label_for_date_v3(coalesce(p_rating_date, current_date));

  insert into public.cleaning_daily_ratings (
    staff_id, branch, rating_date, stars, score_pct, points_delta, month_cycle,
    manager_note, rated_by, rated_by_name
  ) values (
    p_staff_id, v_staff.branch, coalesce(p_rating_date,current_date), p_stars,
    p_stars * 20, v_points, v_cycle,
    nullif(trim(coalesce(p_manager_note,'')),''), v_actor_id, v_actor_name
  )
  on conflict (staff_id, rating_date) do update
  set stars = excluded.stars,
      score_pct = excluded.score_pct,
      points_delta = excluded.points_delta,
      month_cycle = excluded.month_cycle,
      manager_note = excluded.manager_note,
      rated_by = excluded.rated_by,
      rated_by_name = excluded.rated_by_name,
      branch = excluded.branch,
      updated_at = now()
  returning * into v_rating;

  select et.id into v_existing_tx
  from public.employee_transactions et
  where et.staff_id = p_staff_id
    and et.month_cycle = v_cycle
    and et.source = 'cleaning_daily_star_rating'
    and et.source_id = v_rating.id
    and et.status in ('active','approved','pending')
  order by et.updated_at desc nulls last, et.created_at desc nulls last
  limit 1;

  if v_existing_tx is null then
    insert into public.employee_transactions (
      staff_id, employee_id, employee_name, type, title, reason, description,
      amount, points, points_delta, final_points, source, source_id,
      transaction_date, month_cycle, branch, status, category,
      created_by, created_by_name, approved_by, approved_by_name, approved_at,
      employee_visible, metadata
    ) values (
      p_staff_id, p_staff_id, v_staff.name,
      case when v_points < 0 then 'penalty' else 'reward' end,
      'تقييم النظافة اليومي بالنجوم',
      format('تقييم يومي: %s/5 نجوم (%s%%)', p_stars, p_stars * 20),
      nullif(trim(coalesce(p_manager_note,'')),''),
      0, abs(v_points), v_points, v_points,
      'cleaning_daily_star_rating', v_rating.id,
      coalesce(p_rating_date,current_date), v_cycle, v_staff.branch, 'active',
      'النظافة والتشغيل', v_actor_id, v_actor_name, v_actor_id, v_actor_name, now(),
      true,
      jsonb_build_object(
        'engine_version', 3,
        'policy_version', 1,
        'stars', p_stars,
        'score_pct', p_stars * 20,
        'rating_date', coalesce(p_rating_date,current_date),
        'rule_code', 'CLEAN-DAILY-STAR-V1'
      )
    );
  else
    update public.employee_transactions
    set type = case when v_points < 0 then 'penalty' else 'reward' end,
        points = abs(v_points),
        points_delta = v_points,
        final_points = v_points,
        reason = format('تقييم يومي: %s/5 نجوم (%s%%)', p_stars, p_stars * 20),
        description = nullif(trim(coalesce(p_manager_note,'')),''),
        transaction_date = coalesce(p_rating_date,current_date),
        branch = v_staff.branch,
        status = 'active',
        category = 'النظافة والتشغيل',
        approved_by = v_actor_id,
        approved_by_name = v_actor_name,
        approved_at = now(),
        updated_at = now(),
        metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
          'engine_version', 3,
          'policy_version', 1,
          'stars', p_stars,
          'score_pct', p_stars * 20,
          'rating_date', coalesce(p_rating_date,current_date),
          'rule_code', 'CLEAN-DAILY-STAR-V1'
        )
    where id = v_existing_tx;
  end if;

  return v_rating;
end;
$$;

create or replace function public.get_cleaning_cycle_rating_summary_v1(
  p_staff_id uuid,
  p_month_cycle text default null
)
returns table(
  staff_id uuid,
  month_cycle text,
  rated_days integer,
  five_star_days integer,
  avg_stars numeric,
  avg_score_pct numeric,
  total_star_points numeric,
  performance_band text
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_cycle text := coalesce(nullif(trim(coalesce(p_month_cycle,'')),''), public.dawaa_current_points_cycle_label_v1());
  v_self text := public.dawaa_current_staff_id_v1();
  v_role text := lower(trim(coalesce(public.employee_operating_actor_role(),'')));
  v_staff_branch text;
  v_actor_branch text := nullif(trim(coalesce(public.employee_operating_actor_branch(),'')), '');
  v_global boolean := v_role in ('general_manager','admin','executive_manager','branches_manager');
begin
  select branch into v_staff_branch from public.staff where id = p_staff_id;
  if not (
    p_staff_id::text = coalesce(v_self,'')
    or v_global
    or (v_role = 'branch_manager' and coalesce(v_staff_branch,'') = coalesce(v_actor_branch,''))
  ) then
    raise exception 'not_authorized';
  end if;

  return query
  select
    p_staff_id,
    v_cycle,
    count(*)::integer,
    count(*) filter (where r.stars = 5)::integer,
    round(avg(r.stars)::numeric, 2),
    round(avg(r.score_pct)::numeric, 1),
    coalesce(sum(r.points_delta),0)::numeric,
    case
      when avg(r.stars) >= 4.8 then 'استثنائي'
      when avg(r.stars) >= 4.5 then 'ممتاز'
      when avg(r.stars) >= 4.0 then 'جيد جدًا'
      when avg(r.stars) >= 3.5 then 'جيد'
      else 'يحتاج تحسين'
    end
  from public.cleaning_daily_ratings r
  where r.staff_id = p_staff_id
    and r.month_cycle = v_cycle;
end;
$$;

drop policy if exists cleaning_daily_ratings_read_v1 on public.cleaning_daily_ratings;
create policy cleaning_daily_ratings_read_v1
on public.cleaning_daily_ratings
for select
to anon, authenticated
using (
  staff_id::text = coalesce(public.dawaa_current_staff_id_v1(),'')
  or lower(trim(coalesce(public.employee_operating_actor_role(),''))) in ('general_manager','admin','executive_manager','branches_manager')
  or (
    lower(trim(coalesce(public.employee_operating_actor_role(),''))) = 'branch_manager'
    and coalesce(branch,'') = coalesce(public.employee_operating_actor_branch(),'')
  )
);

revoke all on public.cleaning_daily_ratings from anon, authenticated;
grant select on public.cleaning_daily_ratings to anon, authenticated;

revoke all on function public.get_cleaning_daily_rating_cards_v1(date,text) from public;
grant execute on function public.get_cleaning_daily_rating_cards_v1(date,text) to anon, authenticated;
revoke all on function public.rate_cleaning_staff_day_v1(uuid,integer,text,date) from public;
grant execute on function public.rate_cleaning_staff_day_v1(uuid,integer,text,date) to anon, authenticated;
revoke all on function public.get_cleaning_cycle_rating_summary_v1(uuid,text) from public;
grant execute on function public.get_cleaning_cycle_rating_summary_v1(uuid,text) to anon, authenticated;

comment on table public.cleaning_daily_ratings is
  'One manager rating per cleaning employee per day. Rating points are mirrored idempotently into employee_transactions and therefore flow through the canonical monthly points truth.';
