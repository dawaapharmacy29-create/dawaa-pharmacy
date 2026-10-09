create table if not exists public.delivery_payroll_policy_versions (
  id uuid primary key default gen_random_uuid(),
  policy_code text not null unique,
  effective_from date not null,
  effective_to date,
  min_attended_days integer not null default 26 check (min_attended_days >= 1),
  committed_credit_minutes_per_day integer not null default 5 check (committed_credit_minutes_per_day >= 0),
  regular_credit_minutes_per_day integer not null default 30 check (regular_credit_minutes_per_day >= committed_credit_minutes_per_day),
  old_tenure_days integer not null default 365 check (old_tenure_days >= 1),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

create table if not exists public.delivery_payroll_rate_bands (
  id uuid primary key default gen_random_uuid(),
  policy_version_id uuid not null references public.delivery_payroll_policy_versions(id) on delete restrict,
  discipline_band text not null check (discipline_band in ('committed','regular','low')),
  tenure_band text not null check (tenure_band in ('old','new')),
  display_name text not null,
  hourly_rate numeric(12,4),
  order_rate numeric(12,4),
  trip_rate numeric(12,4),
  monthly_incentive_cap numeric(12,2),
  quarterly_incentive_cap numeric(12,2),
  configured boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(policy_version_id,discipline_band,tenure_band),
  check (hourly_rate is null or hourly_rate >= 0),
  check (order_rate is null or order_rate >= 0),
  check (trip_rate is null or trip_rate >= 0),
  check (monthly_incentive_cap is null or monthly_incentive_cap >= 0),
  check (quarterly_incentive_cap is null or quarterly_incentive_cap >= 0)
);

create table if not exists public.delivery_payroll_staff_overrides (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete restrict,
  effective_from date not null,
  effective_to date,
  payroll_eligible boolean,
  tenure_band text check (tenure_band is null or tenure_band in ('old','new')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

create index if not exists idx_delivery_payroll_staff_overrides_staff_date
  on public.delivery_payroll_staff_overrides(staff_id,effective_from,effective_to);
create index if not exists idx_delivery_payroll_rate_bands_policy
  on public.delivery_payroll_rate_bands(policy_version_id,discipline_band,tenure_band);

alter table public.delivery_payroll_policy_versions enable row level security;
alter table public.delivery_payroll_rate_bands enable row level security;
alter table public.delivery_payroll_staff_overrides enable row level security;

insert into public.delivery_payroll_policy_versions(
  policy_code,effective_from,min_attended_days,
  committed_credit_minutes_per_day,regular_credit_minutes_per_day,
  old_tenure_days,active,notes
)
values(
  'delivery_salary_v1',date '2026-09-26',26,5,30,365,true,
  'نظام رواتب الدليفري: التصنيف يعتمد على مجموع تأخير الدخول + الخروج المبكر خلال دورة 26→25. الملتزم حتى 5 دقائق لكل يوم حضور، العادي حتى 30 دقيقة لكل يوم حضور، والمنخفض فوق ذلك. يشترط 26 يوم حضور فأكثر.'
)
on conflict (policy_code) do update set
  min_attended_days=excluded.min_attended_days,
  committed_credit_minutes_per_day=excluded.committed_credit_minutes_per_day,
  regular_credit_minutes_per_day=excluded.regular_credit_minutes_per_day,
  old_tenure_days=excluded.old_tenure_days,
  notes=excluded.notes,
  active=true,
  updated_at=now();

with p as (
  select id from public.delivery_payroll_policy_versions where policy_code='delivery_salary_v1'
), seed(discipline_band,tenure_band,display_name,hourly_rate,order_rate,trip_rate,monthly_cap,quarterly_cap,configured,notes) as (
  values
    ('committed','old','ملتزم قديم',23.00,10.00,4.00,1000.00,750.00,true,'قديم + ملتزم في الحضور والانصراف'),
    ('committed','new','ملتزم جديد',21.50,8.00,4.00,750.00,750.00,true,'أقل من سنة + ملتزم في الحضور والانصراف'),
    ('regular','old','عادي قديم',21.50,8.00,4.00,750.00,750.00,true,'قديم وتجاوز كريديت الملتزم ولم يتجاوز كريديت العادي'),
    ('regular','new','عادي جديد',19.25,6.00,3.00,500.00,500.00,true,'جديد وتجاوز كريديت الملتزم ولم يتجاوز كريديت العادي'),
    ('low','old','منخفض قديم',null,null,null,null,null,false,'القيم المالية لم تحدد بعد؛ ممنوع التخمين'),
    ('low','new','منخفض جديد',null,null,null,null,null,false,'القيم المالية لم تحدد بعد؛ ممنوع التخمين')
)
insert into public.delivery_payroll_rate_bands(
  policy_version_id,discipline_band,tenure_band,display_name,
  hourly_rate,order_rate,trip_rate,monthly_incentive_cap,quarterly_incentive_cap,configured,notes
)
select p.id,s.discipline_band,s.tenure_band,s.display_name,s.hourly_rate,s.order_rate,s.trip_rate,s.monthly_cap,s.quarterly_cap,s.configured,s.notes
from p cross join seed s
on conflict (policy_version_id,discipline_band,tenure_band) do update set
  display_name=excluded.display_name,
  hourly_rate=excluded.hourly_rate,
  order_rate=excluded.order_rate,
  trip_rate=excluded.trip_rate,
  monthly_incentive_cap=excluded.monthly_incentive_cap,
  quarterly_incentive_cap=excluded.quarterly_incentive_cap,
  configured=excluded.configured,
  notes=excluded.notes,
  updated_at=now();

-- Current explicit tenure truth supplied by management. Do not infer historical join dates.
with seed(name,branch,eligible,tenure,note) as (
  values
    ('احمد وجيه','فرع الشامي',true,'old','تصنيف إداري مؤكد: دليفري قديم'),
    ('عم محمد سالم','فرع شكري',true,'old','تصنيف إداري مؤكد: دليفري قديم'),
    ('محمد الالفي','فرع الشامي',true,'new','تصنيف إداري مؤكد: دليفري جديد أقل من سنة'),
    ('محمد الديب','فرع الشامي',true,'new','تصنيف إداري مؤكد: دليفري جديد أقل من سنة'),
    ('محمود','فرع الشامي',true,'new','تصنيف إداري مؤكد: دليفري جديد أقل من سنة'),
    ('اسلام السبع','فرع شكري',true,'new','تصنيف إداري مؤكد: دليفري جديد أقل من سنة'),
    ('حسين','فرع شكري',true,'new','تصنيف إداري مؤكد: دليفري جديد أقل من سنة'),
    ('يوسف عيد','فرع شكري',true,'new','تصنيف إداري مؤكد: دليفري جديد أقل من سنة'),
    ('يوسف عصام','فرع الشامي',false,null,'موجود في delivery_staff لكن وظيفته الأساسية مساعد صيدلي؛ مستبعد من نظام راتب الدليفري حتى اعتماد إداري صريح')
), resolved as (
  select s.id as staff_id,seed.eligible,seed.tenure,seed.note
  from seed join public.staff s on trim(s.name)=seed.name and trim(s.branch)=seed.branch
)
insert into public.delivery_payroll_staff_overrides(staff_id,effective_from,payroll_eligible,tenure_band,note)
select r.staff_id,date '2026-09-26',r.eligible,r.tenure,r.note
from resolved r
where not exists (
  select 1 from public.delivery_payroll_staff_overrides o
  where o.staff_id=r.staff_id and o.effective_from=date '2026-09-26' and o.effective_to is null
);

create or replace function public.dawaa_delivery_discipline_evidence_v1(
  p_staff_id uuid,
  p_month_cycle text
)
returns table(
  attendance_date date,
  attendance_status text,
  resolution_status text,
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,
  first_in timestamptz,
  last_out timestamptz,
  candidate_hours numeric,
  attended boolean,
  late_minutes integer,
  early_leave_minutes integer,
  permission_exempt boolean,
  discipline_minutes integer,
  review_required boolean,
  approval_note text
)
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_start date;
  v_end date;
  v_as_of date;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_delivery_discipline_input' using errcode='22023';
  end if;

  select b.cycle_start,b.cycle_end into v_start,v_end
  from public.dawaa_pay_cycle_bounds_v1(to_date(p_month_cycle||'-25','YYYY-MM-DD')) b;
  v_as_of:=least(v_end,(now() at time zone 'Africa/Cairo')::date);

  return query
  select
    a.attendance_date,
    a.status,
    a.resolution_status,
    a.scheduled_start_at,
    a.scheduled_end_at,
    a.first_in,
    a.last_out,
    coalesce(a.candidate_hours,0),
    (
      a.status='approved'
      and coalesce(a.candidate_hours,0)>0
      and coalesce(a.resolution_status,'') not in (
        'off_day','approved_time_off','approved_time_off_permission',
        'approved_leave','approved_absence_permission','absence_review'
      )
    ) as attended,
    greatest(coalesce(a.late_minutes,0),0)::integer,
    greatest(coalesce(a.early_leave_minutes,0),0)::integer,
    (
      coalesce(a.time_off_request_id is not null,false)
      or coalesce((a.resolution_snapshot->>'permission_attached')::boolean,false)
      or coalesce(a.resolution_status,'') in ('on_time_with_permission','approved_time_off_permission','approved_absence_permission')
    ) as permission_exempt,
    case
      when a.status<>'approved' or coalesce(a.candidate_hours,0)<=0 then 0
      when coalesce(a.time_off_request_id is not null,false)
        or coalesce((a.resolution_snapshot->>'permission_attached')::boolean,false)
        or coalesce(a.resolution_status,'') in ('on_time_with_permission','approved_time_off_permission','approved_absence_permission')
        then 0
      else greatest(coalesce(a.late_minutes,0),0)+greatest(coalesce(a.early_leave_minutes,0),0)
    end::integer as discipline_minutes,
    coalesce(a.review_required,true),
    a.approval_note
  from public.attendance_daily_summary a
  where a.staff_id=p_staff_id
    and a.attendance_date between v_start and v_as_of
  order by a.attendance_date;
end;
$function$;

create or replace function public.dawaa_delivery_payroll_classification_v1(
  p_staff_id uuid,
  p_month_cycle text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_start date; v_end date; v_as_of date;
  v_staff public.staff%rowtype;
  v_policy public.delivery_payroll_policy_versions%rowtype;
  v_override public.delivery_payroll_staff_overrides%rowtype;
  v_rate public.delivery_payroll_rate_bands%rowtype;
  v_eligible boolean:=false;
  v_tenure text; v_tenure_source text;
  v_attended integer:=0; v_pending integer:=0; v_approved_days integer:=0;
  v_late integer:=0; v_early integer:=0; v_discipline integer:=0; v_excused integer:=0;
  v_committed_credit integer:=0; v_regular_credit integer:=0;
  v_band text; v_band_ar text; v_status text;
  v_cycle_closed boolean:=false; v_provisional boolean:=true; v_finalizable boolean:=false;
  v_eval_multiplier numeric:=null;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_delivery_payroll_classification_input' using errcode='22023';
  end if;

  select * into v_staff from public.staff where id=p_staff_id;
  if not found then raise exception 'delivery_staff_not_found' using errcode='22023'; end if;

  select b.cycle_start,b.cycle_end into v_start,v_end
  from public.dawaa_pay_cycle_bounds_v1(to_date(p_month_cycle||'-25','YYYY-MM-DD')) b;
  v_as_of:=least(v_end,(now() at time zone 'Africa/Cairo')::date);
  v_cycle_closed:=((now() at time zone 'Africa/Cairo')::date>v_end);

  select * into v_policy
  from public.delivery_payroll_policy_versions p
  where p.active=true and p.effective_from<=v_start and (p.effective_to is null or p.effective_to>=v_start)
  order by p.effective_from desc,p.created_at desc
  limit 1;
  if not found then
    return jsonb_build_object('staff_id',p_staff_id,'month_cycle',p_month_cycle,'status','policy_not_configured');
  end if;

  select * into v_override
  from public.delivery_payroll_staff_overrides o
  where o.staff_id=p_staff_id and o.effective_from<=v_end and (o.effective_to is null or o.effective_to>=v_start)
  order by o.effective_from desc,o.created_at desc
  limit 1;

  if found and v_override.payroll_eligible is not null then
    v_eligible:=v_override.payroll_eligible;
  else
    v_eligible:=(
      lower(trim(coalesce(v_staff.role,''))) in ('delivery','توصيل','مندوب','مندوب توصيل')
      or lower(trim(coalesce(v_staff.type,''))) in ('delivery','توصيل')
    );
  end if;

  if not v_eligible then
    return jsonb_build_object(
      'schema','dawaa_delivery_payroll_classification_v1',
      'staff_id',p_staff_id,'staff_name',v_staff.name,'branch',v_staff.branch,
      'month_cycle',p_month_cycle,'cycle_start',v_start,'cycle_end',v_end,
      'status','not_delivery_payroll','payroll_eligible',false
    );
  end if;

  if v_override.tenure_band in ('old','new') then
    v_tenure:=v_override.tenure_band;
    v_tenure_source:='management_override';
  elsif v_staff.join_date is not null then
    if (v_end-v_staff.join_date)>=v_policy.old_tenure_days then v_tenure:='old'; else v_tenure:='new'; end if;
    v_tenure_source:='staff_join_date';
  else
    v_tenure:='new';
    v_tenure_source:='fallback_new_missing_join_date';
  end if;

  select
    count(*) filter(where e.attended)::integer,
    count(*) filter(where e.attendance_status='approved')::integer,
    count(*) filter(where e.attendance_status='pending_review' or e.review_required)::integer,
    coalesce(sum(e.late_minutes) filter(where e.attended),0)::integer,
    coalesce(sum(e.early_leave_minutes) filter(where e.attended),0)::integer,
    coalesce(sum(e.discipline_minutes) filter(where e.attended),0)::integer,
    coalesce(sum((e.late_minutes+e.early_leave_minutes)-e.discipline_minutes) filter(where e.attended),0)::integer
  into v_attended,v_approved_days,v_pending,v_late,v_early,v_discipline,v_excused
  from public.dawaa_delivery_discipline_evidence_v1(p_staff_id,p_month_cycle) e;

  v_committed_credit:=v_attended*v_policy.committed_credit_minutes_per_day;
  v_regular_credit:=v_attended*v_policy.regular_credit_minutes_per_day;

  if v_attended < v_policy.min_attended_days then
    v_band:=null;
    v_band_ar:='غير مؤهل بعد';
    v_status:='insufficient_attendance_days';
  elsif v_discipline<=v_committed_credit then
    v_band:='committed'; v_band_ar:='ملتزم'; v_status:='classified';
  elsif v_discipline<=v_regular_credit then
    v_band:='regular'; v_band_ar:='عادي'; v_status:='classified';
  else
    v_band:='low'; v_band_ar:='منخفض'; v_status:='classified';
  end if;

  if v_band is not null then
    select * into v_rate
    from public.delivery_payroll_rate_bands r
    where r.policy_version_id=v_policy.id and r.discipline_band=v_band and r.tenure_band=v_tenure
    limit 1;
    if not found or not coalesce(v_rate.configured,false) then
      v_status:='rate_unconfigured';
    end if;
  end if;

  select m.multiplier_pct into v_eval_multiplier
  from public.staff_evaluation_incentive_multipliers m
  where m.staff_id=p_staff_id and m.month_cycle=p_month_cycle
  order by m.updated_at desc
  limit 1;

  v_provisional:=not v_cycle_closed or v_pending>0;
  v_finalizable:=v_cycle_closed and v_pending=0 and v_attended>=v_policy.min_attended_days
    and v_band is not null and coalesce(v_rate.configured,false);

  return jsonb_build_object(
    'schema','dawaa_delivery_payroll_classification_v1',
    'policy_code',v_policy.policy_code,
    'staff_id',p_staff_id,'staff_name',v_staff.name,'branch',v_staff.branch,
    'payroll_eligible',true,
    'month_cycle',p_month_cycle,'cycle_start',v_start,'cycle_end',v_end,'as_of_date',v_as_of,
    'cycle_closed',v_cycle_closed,'provisional',v_provisional,'finalizable',v_finalizable,
    'attendance',jsonb_build_object(
      'minimum_attended_days',v_policy.min_attended_days,
      'attended_days',v_attended,
      'approved_days_seen',v_approved_days,
      'pending_review_days',v_pending
    ),
    'discipline',jsonb_build_object(
      'late_minutes',v_late,
      'early_leave_minutes',v_early,
      'raw_deviation_minutes',v_late+v_early,
      'excused_permission_minutes',v_excused,
      'classification_minutes',v_discipline,
      'committed_credit_minutes',v_committed_credit,
      'regular_credit_minutes',v_regular_credit,
      'committed_credit_per_attended_day',v_policy.committed_credit_minutes_per_day,
      'regular_credit_per_attended_day',v_policy.regular_credit_minutes_per_day,
      'rule','classification_minutes = late arrival + early departure after approved permission exemptions; penalty multipliers do not inflate discipline minutes'
    ),
    'classification',jsonb_build_object(
      'status',v_status,
      'discipline_band',v_band,
      'discipline_band_ar',v_band_ar,
      'tenure_band',v_tenure,
      'tenure_band_ar',case v_tenure when 'old' then 'قديم' else 'جديد' end,
      'tenure_source',v_tenure_source,
      'display_name',case when v_band is null then null else coalesce(v_rate.display_name,v_band_ar||' '||case v_tenure when 'old' then 'قديم' else 'جديد' end) end
    ),
    'rates',jsonb_build_object(
      'configured',coalesce(v_rate.configured,false),
      'hourly_rate',v_rate.hourly_rate,
      'order_rate',v_rate.order_rate,
      'trip_rate',v_rate.trip_rate,
      'monthly_incentive_cap',v_rate.monthly_incentive_cap,
      'quarterly_incentive_cap',v_rate.quarterly_incentive_cap,
      'monthly_evaluation_multiplier_pct',v_eval_multiplier,
      'trip_payment_ready',false,
      'trip_payment_blocker','canonical_trip_source_not_configured'
    )
  );
end;
$function$;

create or replace function public.dawaa_delivery_payroll_matrix_v1()
returns table(
  discipline_band text,
  tenure_band text,
  display_name text,
  hourly_rate numeric,
  order_rate numeric,
  trip_rate numeric,
  monthly_incentive_cap numeric,
  quarterly_incentive_cap numeric,
  configured boolean
)
language sql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
  select r.discipline_band,r.tenure_band,r.display_name,r.hourly_rate,r.order_rate,r.trip_rate,
         r.monthly_incentive_cap,r.quarterly_incentive_cap,r.configured
  from public.delivery_payroll_rate_bands r
  join public.delivery_payroll_policy_versions p on p.id=r.policy_version_id
  where p.active=true
  order by case r.discipline_band when 'committed' then 1 when 'regular' then 2 else 3 end,
           case r.tenure_band when 'old' then 1 else 2 end;
$function$;

-- Shadow/internal only until low-tier rates and canonical trip evidence are configured.
revoke all on table public.delivery_payroll_policy_versions from public;
revoke all on table public.delivery_payroll_rate_bands from public;
revoke all on table public.delivery_payroll_staff_overrides from public;
revoke all on function public.dawaa_delivery_discipline_evidence_v1(uuid,text) from public;
revoke all on function public.dawaa_delivery_payroll_classification_v1(uuid,text) from public;
revoke all on function public.dawaa_delivery_payroll_matrix_v1() from public;
revoke all on function public.dawaa_delivery_discipline_evidence_v1(uuid,text) from anon,authenticated;
revoke all on function public.dawaa_delivery_payroll_classification_v1(uuid,text) from anon,authenticated;
revoke all on function public.dawaa_delivery_payroll_matrix_v1() from anon,authenticated;