-- Delivery Payroll Current Cutover V1
-- Canonical payroll attendance + delivery activity bridge + delivery-specific classification/finalization.
-- This migration is intentionally idempotent because the feature was shadow-built before repository cutover.

create extension if not exists pgcrypto;

create table if not exists public.delivery_payroll_policy_versions (
  id uuid primary key default gen_random_uuid(),
  policy_code text not null unique,
  effective_from date not null,
  effective_to date,
  min_attended_days integer not null default 26 check (min_attended_days >= 1),
  committed_credit_minutes_per_day integer not null default 5 check (committed_credit_minutes_per_day >= 0),
  regular_credit_minutes_per_day integer not null default 30,
  old_tenure_days integer not null default 365 check (old_tenure_days >= 1),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (regular_credit_minutes_per_day >= committed_credit_minutes_per_day),
  check (effective_to is null or effective_to >= effective_from)
);

create table if not exists public.delivery_payroll_rate_bands (
  id uuid primary key default gen_random_uuid(),
  policy_version_id uuid not null references public.delivery_payroll_policy_versions(id) on delete restrict,
  discipline_band text not null check (discipline_band in ('committed','regular','low')),
  tenure_band text not null check (tenure_band in ('old','new')),
  display_name text not null,
  hourly_rate numeric check (hourly_rate is null or hourly_rate >= 0),
  order_rate numeric check (order_rate is null or order_rate >= 0),
  trip_rate numeric check (trip_rate is null or trip_rate >= 0),
  monthly_incentive_cap numeric check (monthly_incentive_cap is null or monthly_incentive_cap >= 0),
  quarterly_incentive_cap numeric check (quarterly_incentive_cap is null or quarterly_incentive_cap >= 0),
  configured boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (policy_version_id,discipline_band,tenure_band)
);

create index if not exists idx_delivery_payroll_rate_bands_policy
  on public.delivery_payroll_rate_bands(policy_version_id,discipline_band,tenure_band);

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

create table if not exists public.delivery_payroll_identity_map_v1 (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id),
  delivery_project_ref text not null default 'qlugjplnnkjzxcbhwopg',
  rider_id uuid not null,
  rider_name_snapshot text,
  rider_branch_snapshot text,
  mapping_status text not null default 'approved' check (mapping_status in ('approved','pending','blocked')),
  active boolean not null default true,
  confidence text not null default 'high' check (confidence in ('high','medium','low')),
  identity_warning text,
  source text not null default 'management_verified_crosswalk',
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(staff_id,rider_id,effective_from),
  check (effective_to is null or effective_to >= effective_from)
);

create unique index if not exists ux_delivery_payroll_identity_active_rider_v1
  on public.delivery_payroll_identity_map_v1(rider_id)
  where active=true and mapping_status='approved' and effective_to is null;
create unique index if not exists ux_delivery_payroll_identity_active_staff_v1
  on public.delivery_payroll_identity_map_v1(staff_id)
  where active=true and mapping_status='approved' and effective_to is null;

create table if not exists public.delivery_payroll_activity_snapshots_v1 (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id),
  rider_id uuid not null,
  month_cycle text not null check (month_cycle ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  cycle_start date not null,
  cycle_end date not null,
  orders_total integer not null default 0 check (orders_total >= 0),
  orders_counted integer not null default 0 check (orders_counted >= 0),
  orders_x1 integer not null default 0 check (orders_x1 >= 0),
  orders_x1_5 integer not null default 0 check (orders_x1_5 >= 0),
  orders_pending integer not null default 0 check (orders_pending >= 0),
  orders_failed integer not null default 0 check (orders_failed >= 0),
  orders_excluded integer not null default 0 check (orders_excluded >= 0),
  orders_duplicates integer not null default 0 check (orders_duplicates >= 0),
  trips_total integer not null default 0 check (trips_total >= 0),
  trips_approved integer not null default 0 check (trips_approved >= 0),
  trip_weighted_units numeric not null default 0 check (trip_weighted_units >= 0),
  trips_pending integer not null default 0 check (trips_pending >= 0),
  trips_rejected integer not null default 0 check (trips_rejected >= 0),
  trips_duplicates integer not null default 0 check (trips_duplicates >= 0),
  ready_for_final boolean not null default false,
  source_project_ref text not null default 'qlugjplnnkjzxcbhwopg',
  source_schema text not null default 'delivery_payroll_activity_export_v1',
  source_generated_at timestamptz,
  snapshot_fingerprint text not null,
  payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  app_attendance_days integer not null default 0,
  app_attendance_minutes integer not null default 0,
  app_attendance_open_shifts integer not null default 0,
  app_attendance_review_shifts integer not null default 0,
  unique(staff_id,month_cycle),
  unique(rider_id,month_cycle),
  check (orders_x1+orders_x1_5=orders_counted),
  check (orders_counted<=orders_total),
  check (trips_approved<=trips_total)
);

create table if not exists public.delivery_payroll_sync_audit_v1 (
  id uuid primary key default gen_random_uuid(),
  batch_id text not null,
  month_cycle text not null,
  source_project_ref text not null default 'qlugjplnnkjzxcbhwopg',
  received_rows integer not null default 0,
  accepted_rows integer not null default 0,
  rejected_rows integer not null default 0,
  rejected_details jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.delivery_payroll_bridge_config_v1 (
  source_project_ref text primary key,
  secret_sha256 text not null,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.delivery_payroll_policy_versions enable row level security;
alter table public.delivery_payroll_rate_bands enable row level security;
alter table public.delivery_payroll_staff_overrides enable row level security;
alter table public.delivery_payroll_identity_map_v1 enable row level security;
alter table public.delivery_payroll_activity_snapshots_v1 enable row level security;
alter table public.delivery_payroll_sync_audit_v1 enable row level security;
alter table public.delivery_payroll_bridge_config_v1 enable row level security;

revoke all on table public.delivery_payroll_policy_versions from public,anon,authenticated;
revoke all on table public.delivery_payroll_rate_bands from public,anon,authenticated;
revoke all on table public.delivery_payroll_staff_overrides from public,anon,authenticated;
revoke all on table public.delivery_payroll_identity_map_v1 from public,anon,authenticated;
revoke all on table public.delivery_payroll_activity_snapshots_v1 from public,anon,authenticated;
revoke all on table public.delivery_payroll_sync_audit_v1 from public,anon,authenticated;
revoke all on table public.delivery_payroll_bridge_config_v1 from public,anon,authenticated;
grant all on table public.delivery_payroll_policy_versions to service_role;
grant all on table public.delivery_payroll_rate_bands to service_role;
grant all on table public.delivery_payroll_staff_overrides to service_role;
grant all on table public.delivery_payroll_identity_map_v1 to service_role;
grant all on table public.delivery_payroll_activity_snapshots_v1 to service_role;
grant all on table public.delivery_payroll_sync_audit_v1 to service_role;
grant all on table public.delivery_payroll_bridge_config_v1 to service_role;

insert into public.delivery_payroll_policy_versions(
  policy_code,effective_from,effective_to,min_attended_days,committed_credit_minutes_per_day,
  regular_credit_minutes_per_day,old_tenure_days,active,notes,updated_at
) values (
  'delivery_salary_v1','2026-09-26',null,26,5,30,365,true,
  'نظام رواتب الدليفري: التصنيف يعتمد على مجموع تأخير الدخول + الخروج المبكر خلال دورة 26→25. الملتزم حتى 5 دقائق لكل يوم حضور، العادي حتى 30 دقيقة لكل يوم حضور، والمنخفض فوق ذلك. يشترط 26 يوم حضور فأكثر.',now()
)
on conflict(policy_code) do update set
  effective_from=excluded.effective_from,effective_to=excluded.effective_to,
  min_attended_days=excluded.min_attended_days,
  committed_credit_minutes_per_day=excluded.committed_credit_minutes_per_day,
  regular_credit_minutes_per_day=excluded.regular_credit_minutes_per_day,
  old_tenure_days=excluded.old_tenure_days,active=excluded.active,notes=excluded.notes,updated_at=now();

with p as (select id from public.delivery_payroll_policy_versions where policy_code='delivery_salary_v1')
insert into public.delivery_payroll_rate_bands(
  policy_version_id,discipline_band,tenure_band,display_name,hourly_rate,order_rate,trip_rate,
  monthly_incentive_cap,quarterly_incentive_cap,configured,notes,updated_at
)
select p.id,v.discipline_band,v.tenure_band,v.display_name,v.hourly_rate,v.order_rate,v.trip_rate,
       v.monthly_cap,v.quarterly_cap,true,v.notes,now()
from p cross join (values
  ('committed','old','ملتزم قديم',23::numeric,10::numeric,4::numeric,1000::numeric,750::numeric,'قديم + ملتزم في الحضور والانصراف'),
  ('committed','new','ملتزم جديد',21.5::numeric,8::numeric,4::numeric,750::numeric,750::numeric,'أقل من سنة + ملتزم في الحضور والانصراف'),
  ('regular','old','عادي قديم',21.5::numeric,8::numeric,4::numeric,750::numeric,750::numeric,'قديم وتجاوز كريديت الملتزم ولم يتجاوز كريديت العادي'),
  ('regular','new','عادي جديد',19.25::numeric,6::numeric,3::numeric,500::numeric,500::numeric,'جديد وتجاوز كريديت الملتزم ولم يتجاوز كريديت العادي'),
  ('low','old','منخفض قديم',19.25::numeric,6::numeric,3::numeric,500::numeric,500::numeric,'منخفض قديم — معتمد إداريًا: 19.25/ساعة، 6/أوردر، 3/مشوار، 500 شهري، 500 ربع سنوي'),
  ('low','new','منخفض جديد',17.5::numeric,4::numeric,3::numeric,300::numeric,300::numeric,'منخفض جديد — معتمد إداريًا: 17.5/ساعة، 4/أوردر، 3/مشوار، 300 شهري، 300 ربع سنوي')
) as v(discipline_band,tenure_band,display_name,hourly_rate,order_rate,trip_rate,monthly_cap,quarterly_cap,notes)
on conflict(policy_version_id,discipline_band,tenure_band) do update set
  display_name=excluded.display_name,hourly_rate=excluded.hourly_rate,order_rate=excluded.order_rate,
  trip_rate=excluded.trip_rate,monthly_incentive_cap=excluded.monthly_incentive_cap,
  quarterly_incentive_cap=excluded.quarterly_incentive_cap,configured=true,notes=excluded.notes,updated_at=now();

create or replace function public.dawaa_staff_uses_delivery_finance_v1(p_staff_id uuid)
returns boolean language sql stable security definer set search_path to 'public','pg_catalog' as $$
  select exists(
    select 1 from public.staff s
    where s.id=p_staff_id and (
      lower(trim(coalesce(s.role,''))) in ('delivery','توصيل','مندوب','مندوب توصيل')
      or lower(trim(coalesce(s.type,''))) in ('delivery','توصيل')
      or exists(
        select 1 from public.staff_accounts sa where sa.staff_id=s.id::text and (
          lower(trim(coalesce(sa.role,'')))='delivery'
          or lower(trim(coalesce(sa.staff_role,''))) in ('delivery','توصيل','مندوب','مندوب توصيل')
          or lower(trim(coalesce(sa.job_title,''))) in ('delivery','توصيل','مندوب','مندوب توصيل')
        )
      )
    )
  );
$$;

create or replace function public.dawaa_can_manage_payroll_staff_id_v1(p_staff_id uuid)
returns boolean language plpgsql stable security definer set search_path to 'public','pg_catalog' as $$
declare v_actor_id uuid; v_actor_role text; v_actor_branch text; v_target_branch text; v_permissions jsonb;
begin
  if p_staff_id is null then return false; end if;
  v_actor_id:=public.dawaa_current_staff_account_id_strict();
  if v_actor_id is null then return false; end if;
  select lower(trim(coalesce(role,''))),nullif(trim(coalesce(branch,'')),'') into v_actor_role,v_actor_branch
  from public.staff_accounts where id=v_actor_id and coalesce(active,false) and coalesce(can_login,false) limit 1;
  if v_actor_role is null then return false; end if;
  v_permissions:=public.get_user_permissions(v_actor_id);
  if coalesce((v_permissions->>'manage_payroll')::boolean,false) is not true then return false; end if;
  if v_actor_role in ('general_manager','executive_manager','branches_manager','admin','manager') then return true; end if;
  if v_actor_role<>'branch_manager' then return false; end if;
  select nullif(trim(coalesce(branch,'')),'') into v_target_branch from public.staff where id=p_staff_id limit 1;
  return v_target_branch is not null and v_actor_branch is not null and v_target_branch=v_actor_branch;
end;$$;

create or replace function public.dawaa_delivery_discipline_band_v1(p_attended_days integer,p_discipline_minutes integer,p_policy_date date default null)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_catalog' as $$
declare
  v_policy public.delivery_payroll_policy_versions%rowtype;
  v_date date:=coalesce(p_policy_date,(now() at time zone 'Africa/Cairo')::date);
  v_committed integer; v_regular integer; v_band text; v_band_ar text; v_status text;
begin
  if p_attended_days is null or p_attended_days<0 or p_discipline_minutes is null or p_discipline_minutes<0 then
    raise exception 'invalid_delivery_discipline_metrics' using errcode='22023';
  end if;
  select * into v_policy from public.delivery_payroll_policy_versions p
  where p.active=true and p.effective_from<=v_date and (p.effective_to is null or p.effective_to>=v_date)
  order by p.effective_from desc,p.created_at desc limit 1;
  if not found then return jsonb_build_object('status','policy_not_configured'); end if;
  v_committed:=p_attended_days*v_policy.committed_credit_minutes_per_day;
  v_regular:=p_attended_days*v_policy.regular_credit_minutes_per_day;
  if p_attended_days<v_policy.min_attended_days then v_status:='insufficient_attendance_days'; v_band:=null; v_band_ar:='غير مؤهل بعد';
  elsif p_discipline_minutes<=v_committed then v_status:='classified'; v_band:='committed'; v_band_ar:='ملتزم';
  elsif p_discipline_minutes<=v_regular then v_status:='classified'; v_band:='regular'; v_band_ar:='عادي';
  else v_status:='classified'; v_band:='low'; v_band_ar:='منخفض'; end if;
  return jsonb_build_object('status',v_status,'attended_days',p_attended_days,'discipline_minutes',p_discipline_minutes,
    'minimum_attended_days',v_policy.min_attended_days,'committed_credit_minutes',v_committed,'regular_credit_minutes',v_regular,
    'discipline_band',v_band,'discipline_band_ar',v_band_ar);
end;$$;

create or replace function public.dawaa_delivery_discipline_evidence_v1(p_staff_id uuid,p_month_cycle text)
returns table(attendance_date date,attendance_status text,resolution_status text,scheduled_start_at timestamptz,scheduled_end_at timestamptz,first_in timestamptz,last_out timestamptz,candidate_hours numeric,attended boolean,late_minutes integer,early_leave_minutes integer,permission_exempt boolean,discipline_minutes integer,review_required boolean,approval_note text)
language plpgsql stable security definer set search_path to 'public','pg_catalog' as $$
declare v_start date; v_end date; v_as_of date;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid_delivery_discipline_input' using errcode='22023'; end if;
  select b.cycle_start,b.cycle_end into v_start,v_end from public.dawaa_pay_cycle_bounds_v1(to_date(p_month_cycle||'-25','YYYY-MM-DD')) b;
  v_as_of:=least(v_end,(now() at time zone 'Africa/Cairo')::date);
  return query
  select a.attendance_date,a.status,a.resolution_status,a.scheduled_start_at,a.scheduled_end_at,a.first_in,a.last_out,
    coalesce(a.candidate_hours,0),
    (a.status='approved' and coalesce(a.candidate_hours,0)>0 and coalesce(a.resolution_status,'') not in ('off_day','approved_time_off','approved_time_off_permission','approved_leave','approved_absence_permission','absence_review')),
    greatest(coalesce(a.late_minutes,0),0)::integer,greatest(coalesce(a.early_leave_minutes,0),0)::integer,
    (coalesce(a.time_off_request_id is not null,false) or coalesce((a.resolution_snapshot->>'permission_attached')::boolean,false) or coalesce(a.resolution_status,'') in ('on_time_with_permission','approved_time_off_permission','approved_absence_permission')),
    case when a.status<>'approved' or coalesce(a.candidate_hours,0)<=0 then 0
      when coalesce(a.time_off_request_id is not null,false) or coalesce((a.resolution_snapshot->>'permission_attached')::boolean,false) or coalesce(a.resolution_status,'') in ('on_time_with_permission','approved_time_off_permission','approved_absence_permission') then 0
      else greatest(coalesce(a.late_minutes,0),0)+greatest(coalesce(a.early_leave_minutes,0),0) end::integer,
    coalesce(a.review_required,true),a.approval_note
  from public.attendance_daily_summary a
  where a.staff_id=p_staff_id and a.attendance_date between v_start and v_as_of order by a.attendance_date;
end;$$;

create or replace function public.dawaa_delivery_payroll_classification_v1(p_staff_id uuid,p_month_cycle text)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_catalog' as $$
declare
  v_start date; v_end date; v_as_of date; v_staff public.staff%rowtype; v_policy public.delivery_payroll_policy_versions%rowtype;
  v_override public.delivery_payroll_staff_overrides%rowtype; v_rate public.delivery_payroll_rate_bands%rowtype;
  v_eligible boolean:=false; v_tenure text; v_tenure_source text; v_attended integer:=0; v_pending integer:=0; v_approved_days integer:=0;
  v_late integer:=0; v_early integer:=0; v_discipline integer:=0; v_excused integer:=0; v_band_result jsonb;
  v_committed_credit integer:=0; v_regular_credit integer:=0; v_band text; v_band_ar text; v_status text;
  v_cycle_closed boolean:=false; v_provisional boolean:=true; v_finalizable boolean:=false; v_eval_multiplier numeric:=null;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid_delivery_payroll_classification_input' using errcode='22023'; end if;
  select * into v_staff from public.staff where id=p_staff_id; if not found then raise exception 'delivery_staff_not_found' using errcode='22023'; end if;
  select b.cycle_start,b.cycle_end into v_start,v_end from public.dawaa_pay_cycle_bounds_v1(to_date(p_month_cycle||'-25','YYYY-MM-DD')) b;
  v_as_of:=least(v_end,(now() at time zone 'Africa/Cairo')::date); v_cycle_closed:=((now() at time zone 'Africa/Cairo')::date>v_end);
  select * into v_policy from public.delivery_payroll_policy_versions p where p.active=true and p.effective_from<=v_start and (p.effective_to is null or p.effective_to>=v_start) order by p.effective_from desc,p.created_at desc limit 1;
  if not found then return jsonb_build_object('staff_id',p_staff_id,'month_cycle',p_month_cycle,'status','policy_not_configured'); end if;
  select * into v_override from public.delivery_payroll_staff_overrides o where o.staff_id=p_staff_id and o.effective_from<=v_end and (o.effective_to is null or o.effective_to>=v_start) order by o.effective_from desc,o.created_at desc limit 1;
  if found and v_override.payroll_eligible is not null then v_eligible:=v_override.payroll_eligible;
  else v_eligible:=(lower(trim(coalesce(v_staff.role,''))) in ('delivery','توصيل','مندوب','مندوب توصيل') or lower(trim(coalesce(v_staff.type,''))) in ('delivery','توصيل')); end if;
  if not v_eligible then return jsonb_build_object('schema','dawaa_delivery_payroll_classification_v1','staff_id',p_staff_id,'staff_name',v_staff.name,'branch',v_staff.branch,'month_cycle',p_month_cycle,'cycle_start',v_start,'cycle_end',v_end,'status','not_delivery_payroll','payroll_eligible',false); end if;
  if v_override.tenure_band in ('old','new') then v_tenure:=v_override.tenure_band; v_tenure_source:='management_override';
  elsif v_staff.join_date is not null then if (v_end-v_staff.join_date)>=v_policy.old_tenure_days then v_tenure:='old'; else v_tenure:='new'; end if; v_tenure_source:='staff_join_date';
  else v_tenure:='new'; v_tenure_source:='fallback_new_missing_join_date'; end if;
  select count(*) filter(where e.attended)::integer,count(*) filter(where e.attendance_status='approved')::integer,
    count(*) filter(where e.attendance_status='pending_review' or e.review_required)::integer,
    coalesce(sum(e.late_minutes) filter(where e.attended),0)::integer,coalesce(sum(e.early_leave_minutes) filter(where e.attended),0)::integer,
    coalesce(sum(e.discipline_minutes) filter(where e.attended),0)::integer,
    coalesce(sum((e.late_minutes+e.early_leave_minutes)-e.discipline_minutes) filter(where e.attended),0)::integer
  into v_attended,v_approved_days,v_pending,v_late,v_early,v_discipline,v_excused from public.dawaa_delivery_discipline_evidence_v1(p_staff_id,p_month_cycle) e;
  v_band_result:=public.dawaa_delivery_discipline_band_v1(v_attended,v_discipline,v_start); v_status:=v_band_result->>'status';
  v_band:=nullif(v_band_result->>'discipline_band',''); v_band_ar:=v_band_result->>'discipline_band_ar';
  v_committed_credit:=coalesce((v_band_result->>'committed_credit_minutes')::integer,0); v_regular_credit:=coalesce((v_band_result->>'regular_credit_minutes')::integer,0);
  if v_band is not null then select * into v_rate from public.delivery_payroll_rate_bands r where r.policy_version_id=v_policy.id and r.discipline_band=v_band and r.tenure_band=v_tenure limit 1; if not found or not coalesce(v_rate.configured,false) then v_status:='rate_unconfigured'; end if; end if;
  select m.multiplier_pct into v_eval_multiplier from public.staff_evaluation_incentive_multipliers m where m.staff_id=p_staff_id and m.month_cycle=p_month_cycle order by m.updated_at desc limit 1;
  v_provisional:=not v_cycle_closed or v_pending>0;
  v_finalizable:=v_cycle_closed and v_pending=0 and v_attended>=v_policy.min_attended_days and v_band is not null and coalesce(v_rate.configured,false);
  return jsonb_build_object('schema','dawaa_delivery_payroll_classification_v1','policy_code',v_policy.policy_code,
    'staff_id',p_staff_id,'staff_name',v_staff.name,'branch',v_staff.branch,'payroll_eligible',true,'month_cycle',p_month_cycle,'cycle_start',v_start,'cycle_end',v_end,'as_of_date',v_as_of,
    'cycle_closed',v_cycle_closed,'provisional',v_provisional,'finalizable',v_finalizable,
    'attendance',jsonb_build_object('minimum_attended_days',v_policy.min_attended_days,'attended_days',v_attended,'approved_days_seen',v_approved_days,'pending_review_days',v_pending),
    'discipline',jsonb_build_object('late_minutes',v_late,'early_leave_minutes',v_early,'raw_deviation_minutes',v_late+v_early,'excused_permission_minutes',v_excused,'classification_minutes',v_discipline,'committed_credit_minutes',v_committed_credit,'regular_credit_minutes',v_regular_credit,'committed_credit_per_attended_day',v_policy.committed_credit_minutes_per_day,'regular_credit_per_attended_day',v_policy.regular_credit_minutes_per_day,'rule','classification_minutes = late arrival + early departure after approved permission exemptions; penalty multipliers do not inflate discipline minutes'),
    'classification',jsonb_build_object('status',v_status,'discipline_band',v_band,'discipline_band_ar',v_band_ar,'tenure_band',v_tenure,'tenure_band_ar',case v_tenure when 'old' then 'قديم' else 'جديد' end,'tenure_source',v_tenure_source,'display_name',case when v_band is null then null else coalesce(v_rate.display_name,v_band_ar||' '||case v_tenure when 'old' then 'قديم' else 'جديد' end) end),
    'rates',jsonb_build_object('configured',coalesce(v_rate.configured,false),'hourly_rate',v_rate.hourly_rate,'order_rate',v_rate.order_rate,'trip_rate',v_rate.trip_rate,'monthly_incentive_cap',v_rate.monthly_incentive_cap,'quarterly_incentive_cap',v_rate.quarterly_incentive_cap,'monthly_evaluation_multiplier_pct',v_eval_multiplier,'trip_payment_ready',false,'trip_payment_blocker','canonical_trip_source_not_configured'));
end;$$;

create or replace function public.dawaa_delivery_payroll_matrix_v1()
returns table(discipline_band text,tenure_band text,display_name text,hourly_rate numeric,order_rate numeric,trip_rate numeric,monthly_incentive_cap numeric,quarterly_incentive_cap numeric,configured boolean)
language sql stable security definer set search_path to 'public','pg_catalog' as $$
  select r.discipline_band,r.tenure_band,r.display_name,r.hourly_rate,r.order_rate,r.trip_rate,r.monthly_incentive_cap,r.quarterly_incentive_cap,r.configured
  from public.delivery_payroll_rate_bands r join public.delivery_payroll_policy_versions p on p.id=r.policy_version_id
  where p.active=true order by case r.discipline_band when 'committed' then 1 when 'regular' then 2 else 3 end,case r.tenure_band when 'old' then 1 else 2 end;
$$;

create or replace function public.dawaa_overtime_multiplier_from_approval_v1(p_approval_id uuid)
returns numeric language sql stable security definer set search_path to 'public','pg_catalog' as $$
  select public.dawaa_overtime_multiplier_from_approval_v1(o.decision_evidence_snapshot,o.decision_note)
  from public.staff_overtime_approvals o where o.id=p_approval_id limit 1;
$$;

create or replace function public.dawaa_delivery_hours_truth_v1(p_staff_id uuid,p_month_cycle text)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_catalog' as $$
declare
  v_start date; v_end date; v_as_of date; v_payable numeric:=0; v_actual numeric:=0; v_days int:=0; v_pending_days int:=0;
  v_ot_hours numeric:=0; v_ot_amount numeric:=0; v_pending_ot numeric:=0; v_unresolved_ot int:=0; v_rate numeric:=0; v_class jsonb;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid_delivery_hours_truth_input' using errcode='22023'; end if;
  select cycle_start,cycle_end into v_start,v_end from public.dawaa_pay_cycle_bounds_v1(to_date(p_month_cycle||'-25','YYYY-MM-DD')); v_as_of:=least(v_end,(now() at time zone 'Africa/Cairo')::date);
  v_class:=public.dawaa_delivery_payroll_classification_v1(p_staff_id,p_month_cycle); v_rate:=coalesce(nullif(v_class->'rates'->>'hourly_rate','')::numeric,0);
  with approved0 as (
    select a.*,
      case when a.scheduled_start_at is not null and a.scheduled_end_at is not null then greatest(extract(epoch from(a.scheduled_end_at-a.scheduled_start_at))/3600.0,0) else null end scheduled_hours,
      case when a.scheduled_start_at is not null and a.scheduled_end_at is not null and a.first_in is not null and a.last_out is not null then greatest(extract(epoch from(least(a.last_out,a.scheduled_end_at)-greatest(a.first_in,a.scheduled_start_at)))/3600.0,0) else coalesce(a.candidate_hours,0) end bounded_hours,
      coalesce((select nullif((x.new_value->>'deduction_minutes')::numeric,0) from public.attendance_manual_actions_audit x where x.target_id=a.id and x.action_type='deduction_adjustment' and x.new_value?'deduction_minutes' order by x.created_at desc limit 1),0) manual_deduction_minutes
    from public.attendance_daily_summary a where a.staff_id=p_staff_id and a.attendance_date between v_start and v_as_of and a.status='approved'
  ), approved as (
    select q.*,case
      when coalesce(q.candidate_hours,0)<=0 or coalesce(q.resolution_status,'') in ('off_day','approved_time_off','approved_time_off_permission','approved_leave','approved_absence_permission','absence_review') then 0
      when q.scheduled_hours is null or q.scheduled_hours<=0 then coalesce(q.candidate_hours,0)
      when q.manual_deduction_minutes>0 then greatest(q.scheduled_hours-(q.manual_deduction_minutes/60.0),0)
      when coalesce(q.resolution_status,'') in ('on_time','on_time_with_permission','approved_late','approved_schedule_change','approved_early_leave','approved_actual_hours_only') or lower(coalesce(q.approval_note,'')) like '%بدون خصم%' or lower(coalesce(q.approval_note,'')) like '%بإذن%' then least(q.scheduled_hours,case when coalesce(q.resolution_status,'')='approved_actual_hours_only' then coalesce(q.candidate_hours,0) else q.scheduled_hours end)
      else least(q.scheduled_hours,q.bounded_hours) end payable_hours from approved0 q
  )
  select count(*) filter(where coalesce(candidate_hours,0)>0 and coalesce(resolution_status,'') not in ('off_day','approved_time_off','approved_time_off_permission','approved_leave','approved_absence_permission','absence_review'))::int,
    round(coalesce(sum(candidate_hours) filter(where coalesce(candidate_hours,0)>0 and coalesce(resolution_status,'') not in ('off_day','approved_time_off','approved_time_off_permission','approved_leave','approved_absence_permission','absence_review')),0),2),
    round(coalesce(sum(payable_hours),0),2) into v_days,v_actual,v_payable from approved;
  select count(*)::int into v_pending_days from public.attendance_daily_summary a where a.staff_id=p_staff_id and a.attendance_date between v_start and v_as_of and (a.status='pending_review' or coalesce(a.review_required,false)=true);
  with ot as (
    select o.*,public.dawaa_overtime_multiplier_from_approval_v1(o.decision_evidence_snapshot,o.decision_note) mult,
      coalesce(nullif(o.decision_evidence_snapshot->>'overtime_minutes','')::numeric/60.0,o.overtime_hours,0) hours_truth
    from public.staff_overtime_approvals o where o.staff_id=p_staff_id and o.attendance_date between v_start and v_end
  )
  select round(coalesce(sum(hours_truth) filter(where status='approved' and mult is not null),0),2),
    round(coalesce(sum(hours_truth*v_rate*mult) filter(where status='approved' and mult is not null),0),2),
    round(coalesce(sum(hours_truth) filter(where status='pending'),0),2),count(*) filter(where status='approved' and mult is null)::int
  into v_ot_hours,v_ot_amount,v_pending_ot,v_unresolved_ot from ot;
  return jsonb_build_object('schema','dawaa_delivery_hours_truth_v1','staff_id',p_staff_id,'month_cycle',p_month_cycle,'cycle_start',v_start,'cycle_end',v_end,
    'actual_worked_days',v_days,'actual_worked_hours',v_actual,'base_payable_hours',v_payable,'pending_attendance_days',v_pending_days,
    'approved_overtime_hours_resolved',v_ot_hours,'approved_overtime_amount_dynamic',v_ot_amount,'pending_overtime_hours',v_pending_ot,
    'approved_overtime_missing_multiplier_count',v_unresolved_ot,'hourly_rate_from_delivery_classification',v_rate,
    'rule','base hours use approved attendance decisions; overtime uses final delivery hourly rate x approved multiplier; unresolved multiplier blocks finalization');
end;$$;

create or replace function public.ingest_delivery_payroll_activity_v1(p_batch_id text,p_month_cycle text,p_cycle_start date,p_cycle_end date,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_catalog' as $$
declare
  v_expected_start date; v_expected_end date; v_row jsonb; v_map public.delivery_payroll_identity_map_v1%rowtype;
  v_received int:=0; v_accepted int:=0; v_rejected int:=0; v_rejected_details jsonb:='[]'::jsonb; v_rider_id uuid;
  v_orders_total int; v_orders_counted int; v_orders_x1 int; v_orders_x15 int; v_orders_pending int; v_orders_failed int; v_orders_excluded int; v_orders_duplicates int;
  v_trips_total int; v_trips_approved int; v_trips_pending int; v_trips_rejected int; v_trips_duplicates int; v_trip_units numeric;
  v_att_days int; v_att_minutes int; v_att_open int; v_att_review int; v_ready boolean; v_fingerprint text;
begin
  if current_user not in ('service_role','postgres') then raise exception 'delivery_payroll_ingest_forbidden' using errcode='42501'; end if;
  if coalesce(trim(p_batch_id),'')='' or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' or jsonb_typeof(p_rows)<>'array' then raise exception 'invalid_delivery_payroll_ingest_input' using errcode='22023'; end if;
  select cycle_start,cycle_end into v_expected_start,v_expected_end from public.dawaa_pay_cycle_bounds_v1(to_date(p_month_cycle||'-25','YYYY-MM-DD'));
  if p_cycle_start is distinct from v_expected_start or p_cycle_end is distinct from v_expected_end then raise exception 'delivery_payroll_cycle_bounds_mismatch' using errcode='22023'; end if;
  v_received:=jsonb_array_length(p_rows);
  for v_row in select value from jsonb_array_elements(p_rows) loop
    begin
      v_rider_id:=nullif(v_row->>'rider_id','')::uuid; if v_rider_id is null then raise exception 'rider_id_missing'; end if;
      select * into v_map from public.delivery_payroll_identity_map_v1 m where m.rider_id=v_rider_id and m.active=true and m.mapping_status='approved' and m.effective_from<=p_cycle_end and (m.effective_to is null or m.effective_to>=p_cycle_start) order by m.effective_from desc,m.created_at desc limit 1;
      if not found then raise exception 'unmapped_rider'; end if;
      v_orders_total:=greatest(coalesce((v_row->>'orders_total')::int,0),0); v_orders_counted:=greatest(coalesce((v_row->>'orders_counted')::int,0),0);
      v_orders_x1:=greatest(coalesce((v_row->>'orders_x1')::int,0),0); v_orders_x15:=greatest(coalesce((v_row->>'orders_x1_5')::int,0),0);
      v_orders_pending:=greatest(coalesce((v_row->>'orders_pending')::int,0),0); v_orders_failed:=greatest(coalesce((v_row->>'orders_failed')::int,0),0);
      v_orders_excluded:=greatest(coalesce((v_row->>'orders_excluded')::int,0),0); v_orders_duplicates:=greatest(coalesce((v_row->>'orders_duplicates')::int,0),0);
      v_trips_total:=greatest(coalesce((v_row->>'trips_total')::int,0),0); v_trips_approved:=greatest(coalesce((v_row->>'trips_approved')::int,0),0);
      v_trip_units:=greatest(coalesce((v_row->>'trip_weighted_units')::numeric,0),0); v_trips_pending:=greatest(coalesce((v_row->>'trips_pending')::int,0),0);
      v_trips_rejected:=greatest(coalesce((v_row->>'trips_rejected')::int,0),0); v_trips_duplicates:=greatest(coalesce((v_row->>'trips_duplicates')::int,0),0);
      v_att_days:=greatest(coalesce((v_row->>'app_attendance_days')::int,0),0); v_att_minutes:=greatest(coalesce((v_row->>'app_attendance_minutes')::int,0),0);
      v_att_open:=greatest(coalesce((v_row->>'app_attendance_open_shifts')::int,0),0); v_att_review:=greatest(coalesce((v_row->>'app_attendance_review_shifts')::int,0),0);
      if v_orders_x1+v_orders_x15<>v_orders_counted then raise exception 'order_partition_mismatch'; end if;
      if v_orders_counted>v_orders_total then raise exception 'counted_orders_gt_total'; end if;
      if v_trips_approved>v_trips_total then raise exception 'approved_trips_gt_total'; end if;
      v_ready:=coalesce((v_row->>'ready_for_final')::boolean,false) and v_orders_pending=0 and v_trips_pending=0;
      v_fingerprint:=md5(v_row::text||'|'||p_month_cycle||'|'||v_map.staff_id::text);
      insert into public.delivery_payroll_activity_snapshots_v1(staff_id,rider_id,month_cycle,cycle_start,cycle_end,orders_total,orders_counted,orders_x1,orders_x1_5,orders_pending,orders_failed,orders_excluded,orders_duplicates,trips_total,trips_approved,trip_weighted_units,trips_pending,trips_rejected,trips_duplicates,app_attendance_days,app_attendance_minutes,app_attendance_open_shifts,app_attendance_review_shifts,ready_for_final,source_schema,source_generated_at,snapshot_fingerprint,payload,synced_at,updated_at)
      values(v_map.staff_id,v_rider_id,p_month_cycle,p_cycle_start,p_cycle_end,v_orders_total,v_orders_counted,v_orders_x1,v_orders_x15,v_orders_pending,v_orders_failed,v_orders_excluded,v_orders_duplicates,v_trips_total,v_trips_approved,v_trip_units,v_trips_pending,v_trips_rejected,v_trips_duplicates,v_att_days,v_att_minutes,v_att_open,v_att_review,v_ready,'delivery_payroll_activity_export_v2',now(),v_fingerprint,v_row,now(),now())
      on conflict(staff_id,month_cycle) do update set rider_id=excluded.rider_id,cycle_start=excluded.cycle_start,cycle_end=excluded.cycle_end,orders_total=excluded.orders_total,orders_counted=excluded.orders_counted,orders_x1=excluded.orders_x1,orders_x1_5=excluded.orders_x1_5,orders_pending=excluded.orders_pending,orders_failed=excluded.orders_failed,orders_excluded=excluded.orders_excluded,orders_duplicates=excluded.orders_duplicates,trips_total=excluded.trips_total,trips_approved=excluded.trips_approved,trip_weighted_units=excluded.trip_weighted_units,trips_pending=excluded.trips_pending,trips_rejected=excluded.trips_rejected,trips_duplicates=excluded.trips_duplicates,app_attendance_days=excluded.app_attendance_days,app_attendance_minutes=excluded.app_attendance_minutes,app_attendance_open_shifts=excluded.app_attendance_open_shifts,app_attendance_review_shifts=excluded.app_attendance_review_shifts,ready_for_final=excluded.ready_for_final,source_schema=excluded.source_schema,source_generated_at=excluded.source_generated_at,snapshot_fingerprint=excluded.snapshot_fingerprint,payload=excluded.payload,synced_at=now(),updated_at=now();
      v_accepted:=v_accepted+1;
    exception when others then
      v_rejected:=v_rejected+1; v_rejected_details:=v_rejected_details||jsonb_build_array(jsonb_build_object('rider_id',v_row->>'rider_id','rider_name',v_row->>'rider_name','error',sqlerrm));
    end;
  end loop;
  insert into public.delivery_payroll_sync_audit_v1(batch_id,month_cycle,received_rows,accepted_rows,rejected_rows,rejected_details) values(p_batch_id,p_month_cycle,v_received,v_accepted,v_rejected,v_rejected_details);
  return jsonb_build_object('batch_id',p_batch_id,'month_cycle',p_month_cycle,'received',v_received,'accepted',v_accepted,'rejected',v_rejected,'rejected_details',v_rejected_details);
end;$$;

create or replace function public.delivery_employment_directives_v1(p_rider_ids uuid[])
returns jsonb language sql stable security definer set search_path to 'public','pg_catalog' as $$
  select coalesce(jsonb_agg(jsonb_build_object('rider_id',m.rider_id,'staff_id',s.id,'staff_name',s.name,'staff_branch',s.branch,'employment_active',(coalesce(s.active,true)=true and coalesce(s.is_active,true)=true and lower(coalesce(s.status,'active')) not in ('inactive','terminated','left','resigned'))) order by s.branch,s.name),'[]'::jsonb)
  from public.delivery_payroll_identity_map_v1 m join public.staff s on s.id=m.staff_id
  where m.active=true and m.mapping_status='approved' and m.rider_id=any(coalesce(p_rider_ids,'{}'::uuid[]));
$$;

create or replace function public.dawaa_delivery_financial_preview_v1(p_staff_id uuid,p_month_cycle text)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_catalog' as $$
declare
  v_class jsonb; v_hours jsonb; v_snap public.delivery_payroll_activity_snapshots_v1%rowtype; v_map public.delivery_payroll_identity_map_v1%rowtype;
  v_start date; v_end date; v_cycle_closed boolean; v_rate numeric:=0; v_order_rate numeric:=0; v_trip_rate numeric:=0; v_month_cap numeric:=0; v_quarter_cap numeric:=0;
  v_base_hours numeric:=0; v_base_pay numeric:=0; v_ot numeric:=0; v_order_pay numeric:=0; v_trip_pay numeric:=0; v_eval_pct numeric:=null; v_monthly_incentive numeric:=0;
  v_blockers jsonb:='[]'::jsonb; v_warnings jsonb:='[]'::jsonb; v_ready boolean:=false;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid_delivery_financial_preview_input' using errcode='22023'; end if;
  select cycle_start,cycle_end into v_start,v_end from public.dawaa_pay_cycle_bounds_v1(to_date(p_month_cycle||'-25','YYYY-MM-DD')); v_cycle_closed:=((now() at time zone 'Africa/Cairo')::date>v_end);
  v_class:=public.dawaa_delivery_payroll_classification_v1(p_staff_id,p_month_cycle);
  if coalesce((v_class->>'payroll_eligible')::boolean,false) is not true then return jsonb_build_object('schema','dawaa_delivery_financial_preview_v1','staff_id',p_staff_id,'month_cycle',p_month_cycle,'payroll_eligible',false,'ready_for_final',false,'blockers',jsonb_build_array(jsonb_build_object('code','not_delivery_payroll'))); end if;
  select * into v_map from public.delivery_payroll_identity_map_v1 m where m.staff_id=p_staff_id and m.active=true and m.mapping_status='approved' and m.effective_from<=v_end and (m.effective_to is null or m.effective_to>=v_start) order by m.effective_from desc,m.created_at desc limit 1;
  if not found then v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','delivery_identity_mapping_missing','label','لا يوجد ربط معتمد بين موظف المرتبات ومندوب تطبيق الدليفري'));
  elsif v_map.identity_warning is not null then v_warnings:=v_warnings||jsonb_build_array(jsonb_build_object('code','delivery_identity_warning','detail',v_map.identity_warning)); end if;
  select * into v_snap from public.delivery_payroll_activity_snapshots_v1 s where s.staff_id=p_staff_id and s.month_cycle=p_month_cycle limit 1;
  if not found then v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','delivery_activity_snapshot_missing','label','لا توجد لقطة معتمدة للأوردرات والمشاوير من تطبيق الدليفري'));
  else if not v_snap.ready_for_final then v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','delivery_activity_pending_review','label','يوجد أوردرات أو مشاوير لم تُحسم بعد','orders_pending',v_snap.orders_pending,'trips_pending',v_snap.trips_pending)); end if;
    if v_cycle_closed and v_snap.synced_at::date<=v_end then v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','delivery_snapshot_not_post_cycle','label','لقطة الدليفري لم تُحدّث بعد إغلاق الدورة')); end if; end if;
  if coalesce((v_class->>'finalizable')::boolean,false) is not true then v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','delivery_classification_not_final','label','تصنيف الملتزم/العادي/المنخفض لم يصبح نهائيًا','classification_status',v_class->'classification'->>'status')); end if;
  v_rate:=coalesce(nullif(v_class->'rates'->>'hourly_rate','')::numeric,0); v_order_rate:=coalesce(nullif(v_class->'rates'->>'order_rate','')::numeric,0); v_trip_rate:=coalesce(nullif(v_class->'rates'->>'trip_rate','')::numeric,0); v_month_cap:=coalesce(nullif(v_class->'rates'->>'monthly_incentive_cap','')::numeric,0); v_quarter_cap:=coalesce(nullif(v_class->'rates'->>'quarterly_incentive_cap','')::numeric,0);
  v_hours:=public.dawaa_delivery_hours_truth_v1(p_staff_id,p_month_cycle); v_base_hours:=coalesce((v_hours->>'base_payable_hours')::numeric,0); v_base_pay:=round(v_base_hours*v_rate,2); v_ot:=coalesce((v_hours->>'approved_overtime_amount_dynamic')::numeric,0);
  if coalesce((v_hours->>'pending_attendance_days')::int,0)>0 then v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','delivery_attendance_pending','count',(v_hours->>'pending_attendance_days')::int)); end if;
  if coalesce((v_hours->>'pending_overtime_hours')::numeric,0)>0 then v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','delivery_overtime_pending','hours',(v_hours->>'pending_overtime_hours')::numeric)); end if;
  if coalesce((v_hours->>'approved_overtime_missing_multiplier_count')::int,0)>0 then v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','delivery_overtime_multiplier_missing','count',(v_hours->>'approved_overtime_missing_multiplier_count')::int)); end if;
  if v_snap.id is not null then v_order_pay:=round(v_snap.orders_x1*v_order_rate+v_snap.orders_x1_5*v_order_rate*1.5,2); v_trip_pay:=round(v_snap.trip_weighted_units*v_trip_rate,2); end if;
  select m.multiplier_pct into v_eval_pct from public.staff_evaluation_incentive_multipliers m where m.staff_id=p_staff_id and m.month_cycle=p_month_cycle order by m.updated_at desc limit 1;
  if v_eval_pct is null then v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','delivery_monthly_evaluation_missing','label','التقييم الشهري المطلوب لحافز الدليفري غير معتمد'));
  else v_monthly_incentive:=round(v_month_cap*least(100,greatest(0,v_eval_pct))/100.0,2); end if;
  if not v_cycle_closed then v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','cycle_not_closed','cycle_end',v_end)); end if;
  v_ready:=v_cycle_closed and jsonb_array_length(v_blockers)=0;
  return jsonb_build_object('schema','dawaa_delivery_financial_preview_v1','staff_id',p_staff_id,'month_cycle',p_month_cycle,'cycle_start',v_start,'cycle_end',v_end,'cycle_closed',v_cycle_closed,
    'payroll_eligible',true,'classification',v_class,'attendance_hours',v_hours,
    'delivery_activity',case when v_snap.id is null then null else jsonb_build_object('rider_id',v_snap.rider_id,'orders_total',v_snap.orders_total,'orders_counted',v_snap.orders_counted,'orders_x1',v_snap.orders_x1,'orders_x1_5',v_snap.orders_x1_5,'orders_pending',v_snap.orders_pending,'trips_total',v_snap.trips_total,'trips_approved',v_snap.trips_approved,'trip_weighted_units',v_snap.trip_weighted_units,'trips_pending',v_snap.trips_pending,'ready_for_final',v_snap.ready_for_final,'synced_at',v_snap.synced_at) end,
    'rates',jsonb_build_object('hourly_rate',v_rate,'order_rate',v_order_rate,'trip_rate',v_trip_rate,'monthly_incentive_cap',v_month_cap,'quarterly_incentive_cap',v_quarter_cap),
    'earnings_preview',jsonb_build_object('base_hours',v_base_hours,'base_pay',v_base_pay,'approved_overtime',v_ot,'order_pay',v_order_pay,'trip_pay',v_trip_pay,'monthly_evaluation_pct',v_eval_pct,'monthly_incentive',v_monthly_incentive,'quarterly_incentive',0,'gross_before_manual_adjustments',round(v_base_pay+v_ot+v_order_pay+v_trip_pay+v_monthly_incentive,2)),
    'quarterly_incentive_status','not_wired_until_quarterly_evaluation_source_is_defined','ready_for_final',v_ready,'blockers',v_blockers,'warnings',v_warnings,
    'rule','delivery app supplies approved/countable activity only; payroll supplies classification and rates; no delivery-app compensation rate is trusted for final payroll');
end;$$;

create or replace function public.dawaa_delivery_financial_preview_v2(p_staff_id uuid,p_month_cycle text)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_catalog' as $$
declare
  j jsonb; v_snap public.delivery_payroll_activity_snapshots_v1%rowtype; v_hours jsonb; v_has_snapshot boolean:=false; v_bridge_ready boolean:=false; v_payroll_days int:=0;
  v_warnings jsonb:='[]'::jsonb; v_blockers jsonb:='[]'::jsonb; v_join date; v_start date; v_end date; v_min_days int:=26; v_max_possible int:=0;
begin
  j:=public.dawaa_delivery_financial_preview_v1(p_staff_id,p_month_cycle); select * into v_snap from public.delivery_payroll_activity_snapshots_v1 s where s.staff_id=p_staff_id and s.month_cycle=p_month_cycle limit 1;
  v_has_snapshot:=found; v_bridge_ready:=v_has_snapshot; v_hours:=public.dawaa_delivery_hours_truth_v1(p_staff_id,p_month_cycle); v_payroll_days:=coalesce((v_hours->>'actual_worked_days')::int,0);
  v_warnings:=coalesce(j->'warnings','[]'::jsonb); v_blockers:=coalesce(j->'blockers','[]'::jsonb); v_start:=nullif(j->>'cycle_start','')::date; v_end:=nullif(j->>'cycle_end','')::date;
  v_min_days:=coalesce((j->'classification'->'attendance'->>'minimum_attended_days')::int,26); select s.join_date into v_join from public.staff s where s.id=p_staff_id;
  if v_has_snapshot then
    if v_snap.app_attendance_open_shifts>0 then v_warnings:=v_warnings||jsonb_build_array(jsonb_build_object('code','delivery_app_open_attendance','count',v_snap.app_attendance_open_shifts)); end if;
    if v_snap.app_attendance_review_shifts>0 then v_warnings:=v_warnings||jsonb_build_array(jsonb_build_object('code','delivery_app_attendance_review','count',v_snap.app_attendance_review_shifts)); end if;
    if v_snap.app_attendance_days>0 and v_payroll_days<>v_snap.app_attendance_days then v_warnings:=v_warnings||jsonb_build_array(jsonb_build_object('code','attendance_source_day_mismatch','payroll_days',v_payroll_days,'delivery_app_days',v_snap.app_attendance_days));
    elsif v_snap.app_attendance_days=0 and v_payroll_days>0 then v_warnings:=v_warnings||jsonb_build_array(jsonb_build_object('code','delivery_app_attendance_missing_but_payroll_present','payroll_days',v_payroll_days)); end if;
    if v_snap.app_attendance_days=0 and v_payroll_days=0 and (v_snap.orders_total>0 or v_snap.trips_total>0) then v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','delivery_activity_without_attendance_evidence','orders_total',v_snap.orders_total,'trips_total',v_snap.trips_total)); end if;
  end if;
  if v_join is not null and v_start is not null and v_end is not null and v_join>v_start and v_join<=v_end then
    select count(*)::int into v_max_possible from generate_series(v_join::timestamp,v_end::timestamp,interval '1 day') g left join lateral public.attendance_schedule_for_date_v1(p_staff_id,g::date) s on true where coalesce(s.is_off,false)=false and coalesce(s.is_day_off,false)=false and s.shift_start is not null and s.shift_end is not null;
    if v_max_possible<v_min_days then v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','delivery_partial_cycle_policy_required','label','الموظف بدأ أثناء الدورة ولا يمكنه الوصول للحد الأدنى 26 يوم؛ يلزم قرار سياسة للراتب الجزئي قبل الإقفال','join_date',v_join,'maximum_possible_attended_days',v_max_possible,'minimum_attended_days',v_min_days)); end if;
  end if;
  j:=jsonb_set(j,'{schema}',to_jsonb('dawaa_delivery_financial_preview_v2'::text),true);
  j:=jsonb_set(j,'{classification,rates,trip_payment_ready}',to_jsonb(v_bridge_ready),true);
  j:=jsonb_set(j,'{classification,rates,trip_payment_blocker}',case when v_bridge_ready then 'null'::jsonb else to_jsonb('delivery_activity_snapshot_missing'::text) end,true);
  j:=jsonb_set(j,'{warnings}',v_warnings,true); j:=jsonb_set(j,'{blockers}',v_blockers,true); j:=jsonb_set(j,'{ready_for_final}',to_jsonb(coalesce((j->>'ready_for_final')::boolean,false) and jsonb_array_length(v_blockers)=0),true);
  j:=j||jsonb_build_object('activity_bridge_ready',v_bridge_ready,'activity_bridge_source','delivery_payroll_activity_snapshots_v1','partial_cycle_context',jsonb_build_object('join_date',v_join,'maximum_possible_attended_days',v_max_possible,'minimum_attended_days',v_min_days),
    'delivery_attendance_evidence',case when not v_has_snapshot then null else jsonb_build_object('source','delivery_attendance','used_for_payroll',false,'payroll_is_canonical',true,'app_attendance_days',v_snap.app_attendance_days,'app_attendance_minutes',v_snap.app_attendance_minutes,'app_open_shifts',v_snap.app_attendance_open_shifts,'app_review_shifts',v_snap.app_attendance_review_shifts,'payroll_worked_days',v_payroll_days) end);
  return j;
end;$$;

create or replace function public.delivery_payroll_sync_health_v1(p_month_cycle text default null)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_catalog' as $$
declare
  v_cycle text; v_start date; v_end date; v_last public.delivery_payroll_sync_audit_v1%rowtype; v_expected int:=0; v_mapped int:=0; v_covered int:=0; v_missing int:=0; v_stale int:=0; v_mapping_warnings int:=0; v_total_snapshots int:=0;
  v_missing_staff jsonb:='[]'::jsonb; v_warning_staff jsonb:='[]'::jsonb;
begin
  if p_month_cycle is null then select month_cycle,cycle_start,cycle_end into v_cycle,v_start,v_end from public.dawaa_pay_cycle_bounds_v1(null);
  else if p_month_cycle !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid_month_cycle'; end if; v_cycle:=p_month_cycle; select cycle_start,cycle_end into v_start,v_end from public.dawaa_pay_cycle_bounds_v1(to_date(v_cycle||'-25','YYYY-MM-DD')); end if;
  select * into v_last from public.delivery_payroll_sync_audit_v1 a where a.month_cycle=v_cycle order by a.created_at desc limit 1;
  select count(*)::int into v_total_snapshots from public.delivery_payroll_activity_snapshots_v1 where month_cycle=v_cycle;
  with expected as (
    select s.id,s.name,s.branch from public.staff s
    left join lateral(select o.payroll_eligible from public.delivery_payroll_staff_overrides o where o.staff_id=s.id and o.effective_from<=v_end and (o.effective_to is null or o.effective_to>=v_start) order by o.effective_from desc,o.created_at desc limit 1)ov on true
    where coalesce(s.active,true)=true and coalesce(s.is_active,true)=true and lower(coalesce(s.status,'active')) not in ('inactive','deleted','disabled','terminated','left','resigned')
      and coalesce(ov.payroll_eligible,lower(trim(coalesce(s.role,''))) in ('delivery','توصيل','مندوب','مندوب توصيل') or lower(trim(coalesce(s.type,''))) in ('delivery','توصيل'))=true
  ), state as (
    select e.*,m.rider_id,m.identity_warning,m.confidence,s.synced_at,(m.rider_id is not null) mapped,(s.staff_id is not null) covered,(s.staff_id is not null and s.synced_at<now()-interval '90 minutes') stale
    from expected e
    left join lateral(select x.rider_id,x.identity_warning,x.confidence from public.delivery_payroll_identity_map_v1 x where x.staff_id=e.id and x.active=true and x.mapping_status='approved' and x.effective_from<=v_end and (x.effective_to is null or x.effective_to>=v_start) order by x.effective_from desc,x.created_at desc limit 1)m on true
    left join public.delivery_payroll_activity_snapshots_v1 s on s.staff_id=e.id and s.month_cycle=v_cycle
  )
  select count(*)::int,count(*) filter(where mapped)::int,count(*) filter(where covered)::int,count(*) filter(where not covered)::int,count(*) filter(where stale)::int,count(*) filter(where identity_warning is not null)::int,
    coalesce(jsonb_agg(jsonb_build_object('staff_id',id,'staff_name',name,'branch',branch,'mapped',mapped,'rider_id',rider_id)) filter(where not covered),'[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('staff_id',id,'staff_name',name,'branch',branch,'warning',identity_warning,'confidence',confidence)) filter(where identity_warning is not null),'[]'::jsonb)
  into v_expected,v_mapped,v_covered,v_missing,v_stale,v_mapping_warnings,v_missing_staff,v_warning_staff from state;
  return jsonb_build_object('schema','delivery_payroll_sync_health_v1','month_cycle',v_cycle,'cycle_start',v_start,'cycle_end',v_end,'last_sync_at',v_last.created_at,
    'transport_recent',case when v_last.id is null then false else v_last.created_at>=now()-interval '90 minutes' end,'last_received_rows',coalesce(v_last.received_rows,0),'last_accepted_rows',coalesce(v_last.accepted_rows,0),'last_rejected_rows',coalesce(v_last.rejected_rows,0),'last_rejected_details',coalesce(v_last.rejected_details,'[]'::jsonb),
    'expected_active_delivery_payroll_staff',v_expected,'mapped_active_staff',v_mapped,'covered_active_staff',v_covered,'missing_active_snapshot_count',v_missing,'stale_active_snapshot_count',v_stale,'total_snapshot_rows_including_historical',v_total_snapshots,'identity_mapping_warning_count',v_mapping_warnings,'missing_active_staff',v_missing_staff,'active_identity_warnings',v_warning_staff,
    'healthy',v_last.id is not null and v_last.created_at>=now()-interval '90 minutes' and v_mapped=v_expected and v_missing=0 and v_stale=0,
    'note','coverage is evaluated only against active payroll-eligible delivery staff; rejected external/unmapped riders stay visible but do not enter payroll automatically');
end;$$;

create or replace function public.payroll_finalization_gate_v2(p_staff_id uuid,p_month_cycle text)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_catalog' as $$
declare
  v_class jsonb; v_delivery jsonb; v_base jsonb; v_is_delivery boolean:=false; v_blockers jsonb:='[]'::jsonb; v_warnings jsonb:='[]'::jsonb; v_start date; v_end date;
  v_financial_drift int:=0; v_mapping_warning text; v_mapping_conf text;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid_payroll_finalization_v2_input' using errcode='22023'; end if;
  begin v_class:=public.dawaa_delivery_payroll_classification_v1(p_staff_id,p_month_cycle); v_is_delivery:=coalesce((v_class->>'payroll_eligible')::boolean,false); exception when others then v_is_delivery:=false; end;
  if not v_is_delivery then v_base:=public.payroll_finalization_gate_v1(p_staff_id,p_month_cycle); return v_base||jsonb_build_object('schema','payroll_finalization_gate_v2','delivery_gate_applied',false,'route','standard_v1'); end if;
  if not public.dawaa_can_manage_payroll_staff_id_v1(p_staff_id) then raise exception 'not_authorized_for_delivery_payroll_finalization' using errcode='42501'; end if;
  select cycle_start,cycle_end into v_start,v_end from public.dawaa_pay_cycle_bounds_v1(to_date(p_month_cycle||'-25','YYYY-MM-DD')); v_delivery:=public.dawaa_delivery_financial_preview_v2(p_staff_id,p_month_cycle);
  v_blockers:=coalesce(v_delivery->'blockers','[]'::jsonb); v_warnings:=coalesce(v_delivery->'warnings','[]'::jsonb);
  begin v_financial_drift:=public.attendance_resolution_financial_drift_count_v1(p_staff_id,v_start,v_end); exception when others then v_financial_drift:=0; end;
  if v_financial_drift>0 then v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','delivery_attendance_financial_drift','label','يوجد اختلاف مالي بين Resolution الحالية وإعادة البناء','count',v_financial_drift)); end if;
  select m.identity_warning,m.confidence into v_mapping_warning,v_mapping_conf from public.delivery_payroll_identity_map_v1 m where m.staff_id=p_staff_id and m.active=true and m.mapping_status='approved' and m.effective_from<=v_end and (m.effective_to is null or m.effective_to>=v_start) order by m.effective_from desc,m.created_at desc limit 1;
  if v_mapping_warning is not null then v_warnings:=v_warnings||jsonb_build_array(jsonb_build_object('code','delivery_identity_warning','label',v_mapping_warning,'confidence',v_mapping_conf)); end if;
  return jsonb_build_object('schema','payroll_finalization_gate_v2','delivery_gate_applied',true,'route','delivery_v2','staff_id',p_staff_id,'month_cycle',p_month_cycle,'cycle_start',v_start,'cycle_end',v_end,
    'attendance_gate',jsonb_build_object('engine',public.dawaa_delivery_hours_truth_v1(p_staff_id,p_month_cycle),'ready',coalesce((v_delivery->>'ready_for_final')::boolean,false)),
    'payroll_components',coalesce(v_delivery->'earnings_preview','{}'::jsonb),'delivery_gate',v_delivery,'blockers',v_blockers,'warnings',v_warnings,
    'ready',jsonb_array_length(v_blockers)=0 and coalesce((v_delivery->>'ready_for_final')::boolean,false),'generated_at',now());
end;$$;

create or replace function public.payroll_finalization_gate_current_v1(p_staff_id uuid,p_month_cycle text)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_catalog' as $$
declare v_class jsonb; v_is_delivery boolean:=false;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid_payroll_finalization_current_input' using errcode='22023'; end if;
  begin v_class:=public.dawaa_delivery_payroll_classification_v1(p_staff_id,p_month_cycle); v_is_delivery:=coalesce((v_class->>'payroll_eligible')::boolean,false); exception when others then v_is_delivery:=false; end;
  if v_is_delivery then return public.payroll_finalization_gate_v2(p_staff_id,p_month_cycle)||jsonb_build_object('schema','payroll_finalization_gate_current_v1','route','delivery_v2'); end if;
  return public.payroll_finalization_gate_v1(p_staff_id,p_month_cycle)||jsonb_build_object('schema','payroll_finalization_gate_current_v1','route','standard_v1');
end;$$;

create or replace function public.employee_payroll_financial_composition_v3(p_staff_id uuid,p_month_cycle text)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_catalog' as $$
declare
  v_class jsonb; v_delivery jsonb; v_gate jsonb; v_existing jsonb; v_is_delivery boolean:=false; v_finalized public.payroll_finalized_snapshots_v2%rowtype; v_frozen jsonb:='{}'::jsonb;
  v_base numeric:=0; v_ot numeric:=0; v_orders numeric:=0; v_trips numeric:=0; v_monthly numeric:=0; v_quarterly numeric:=0; v_manual_earnings numeric:=0; v_manual_deductions numeric:=0; v_manual_adjustment numeric:=0; v_entries jsonb:='[]'::jsonb; v_preview numeric:=0;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid_payroll_financial_composition_v3_input' using errcode='22023'; end if;
  begin v_class:=public.dawaa_delivery_payroll_classification_v1(p_staff_id,p_month_cycle); v_is_delivery:=coalesce((v_class->>'payroll_eligible')::boolean,false); exception when others then v_is_delivery:=false; end;
  if not v_is_delivery then v_existing:=public.employee_payroll_financial_composition_v2(p_staff_id,p_month_cycle); return v_existing||jsonb_build_object('schema','employee_payroll_financial_composition_v3','delivery_mode',false,'route','standard_v2'); end if;
  if not public.dawaa_can_manage_payroll_staff_id_v1(p_staff_id) then raise exception 'not_authorized_for_delivery_payroll_financial_composition' using errcode='42501'; end if;
  select * into v_finalized from public.payroll_finalized_snapshots_v2 f where f.staff_id=p_staff_id and f.month_cycle=p_month_cycle limit 1;
  if found then v_frozen:=coalesce(v_finalized.payload->'financial_composition',v_finalized.payload->'employee_statement'->'financial','{}'::jsonb); if v_frozen<>'{}'::jsonb then return v_frozen||jsonb_build_object('schema','employee_payroll_financial_composition_v3','delivery_mode','frozen_existing_snapshot','frozen',true,'final_snapshot_id',v_finalized.id,'snapshot_fingerprint',v_finalized.snapshot_fingerprint,'finalized_at',v_finalized.finalized_at); end if; end if;
  v_delivery:=public.dawaa_delivery_financial_preview_v2(p_staff_id,p_month_cycle); v_gate:=public.payroll_finalization_gate_v2(p_staff_id,p_month_cycle);
  v_base:=coalesce((v_delivery->'earnings_preview'->>'base_pay')::numeric,0); v_ot:=coalesce((v_delivery->'earnings_preview'->>'approved_overtime')::numeric,0); v_orders:=coalesce((v_delivery->'earnings_preview'->>'order_pay')::numeric,0); v_trips:=coalesce((v_delivery->'earnings_preview'->>'trip_pay')::numeric,0); v_monthly:=coalesce((v_delivery->'earnings_preview'->>'monthly_incentive')::numeric,0); v_quarterly:=coalesce((v_delivery->'earnings_preview'->>'quarterly_incentive')::numeric,0);
  select coalesce(sum(e.signed_amount) filter(where e.entry_kind='earning'),0),coalesce(-sum(e.signed_amount) filter(where e.entry_kind='deduction'),0),coalesce(sum(e.signed_amount) filter(where e.entry_kind='adjustment'),0),coalesce(jsonb_agg(to_jsonb(e) order by e.created_at,e.id),'[]'::jsonb)
  into v_manual_earnings,v_manual_deductions,v_manual_adjustment,v_entries from public.staff_payroll_manual_entries_v1 e where e.staff_id=p_staff_id and e.month_cycle=p_month_cycle;
  v_preview:=round(v_base+v_ot+v_orders+v_trips+v_monthly+v_quarterly+v_manual_earnings+v_manual_adjustment-v_manual_deductions,2);
  return jsonb_build_object('schema','employee_payroll_financial_composition_v3','staff_id',p_staff_id,'month_cycle',p_month_cycle,'delivery_mode',true,'route','delivery_v3','source_mode','delivery_canonical_shadow_v2','ready_for_finalization',coalesce((v_gate->>'ready')::boolean,false),'delivery_classification',v_class,'delivery_activity',v_delivery->'delivery_activity',
    'earnings',jsonb_build_object('base_salary',v_base,'approved_overtime',v_ot,'approved_countable_orders',v_orders,'approved_countable_trips',v_trips,'monthly_delivery_incentive',v_monthly,'quarterly_delivery_incentive',v_quarterly,'manual_other_earnings',v_manual_earnings),
    'adjustments',jsonb_build_object('manual_adjustment',v_manual_adjustment,'manual_deductions_total',v_manual_deductions),'manual_ledger',jsonb_build_object('entries',v_entries,'earnings_total',v_manual_earnings,'deductions_total',v_manual_deductions,'adjustments_total',v_manual_adjustment),
    'preview_net_salary',v_preview,'display_net_salary',v_preview,'frozen',false,'blockers',coalesce(v_gate->'blockers','[]'::jsonb),'warnings',coalesce(v_gate->'warnings','[]'::jsonb),'delivery_preview',v_delivery,
    'double_count_guard',jsonb_build_object('generic_automated_incentives_excluded',true,'delivery_app_compensation_rates_ignored',true,'rule','delivery payroll uses canonical payroll attendance + approved delivery activity + delivery classification matrix; generic incentives are excluded'),'generated_at',now());
end;$$;

create or replace function public.employee_payroll_financial_composition_compat_v1(p_staff_id uuid,p_month_cycle text)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_catalog' as $$
declare
  v_old jsonb; v_new jsonb; v_is_delivery boolean:=false; v_order numeric:=0; v_trip numeric:=0; v_monthly numeric:=0; v_quarterly numeric:=0; v_delivery_auto numeric:=0;
  v_base numeric:=0; v_ot numeric:=0; v_manual numeric:=0; v_preview numeric:=0; v_manual_adjustment numeric:=0; v_deductions numeric:=0; v_expiry numeric:=0; v_branch numeric:=0; v_individual numeric:=0; v_other numeric:=0;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid_payroll_financial_compat_input' using errcode='22023'; end if;
  begin v_is_delivery:=coalesce((public.dawaa_delivery_payroll_classification_v1(p_staff_id,p_month_cycle)->>'payroll_eligible')::boolean,false); exception when others then v_is_delivery:=false; end;
  if not v_is_delivery then v_old:=public.employee_payroll_financial_composition_v2(p_staff_id,p_month_cycle); return v_old||jsonb_build_object('delivery_mode',false,'compat_adapter','standard_v2_passthrough'); end if;
  v_new:=public.employee_payroll_financial_composition_v3(p_staff_id,p_month_cycle); if coalesce((v_new->>'frozen')::boolean,false) then return v_new||jsonb_build_object('compat_adapter','preserve_frozen_delivery_snapshot'); end if;
  v_base:=coalesce((v_new->'earnings'->>'base_salary')::numeric,0); v_ot:=coalesce((v_new->'earnings'->>'approved_overtime')::numeric,0); v_order:=coalesce((v_new->'earnings'->>'approved_countable_orders')::numeric,0); v_trip:=coalesce((v_new->'earnings'->>'approved_countable_trips')::numeric,0); v_monthly:=coalesce((v_new->'earnings'->>'monthly_delivery_incentive')::numeric,0); v_quarterly:=coalesce((v_new->'earnings'->>'quarterly_delivery_incentive')::numeric,0); v_manual:=coalesce((v_new->'earnings'->>'manual_other_earnings')::numeric,0); v_delivery_auto:=round(v_order+v_trip+v_monthly+v_quarterly,2); v_preview:=coalesce((v_new->>'preview_net_salary')::numeric,0);
  select coalesce(sum(-e.signed_amount) filter(where e.entry_kind='deduction'),0),coalesce(sum(-e.signed_amount) filter(where e.entry_kind='deduction' and e.category='expiry_shortage'),0),coalesce(sum(-e.signed_amount) filter(where e.entry_kind='deduction' and e.category='branch_general'),0),coalesce(sum(-e.signed_amount) filter(where e.entry_kind='deduction' and e.category='individual'),0),coalesce(sum(-e.signed_amount) filter(where e.entry_kind='deduction' and e.category not in ('expiry_shortage','branch_general','individual')),0),coalesce(sum(e.signed_amount) filter(where e.entry_kind='adjustment'),0)
  into v_deductions,v_expiry,v_branch,v_individual,v_other,v_manual_adjustment from public.staff_payroll_manual_entries_v1 e where e.staff_id=p_staff_id and e.month_cycle=p_month_cycle;
  return jsonb_build_object('schema','employee_payroll_financial_composition_v2','staff_id',p_staff_id,'month_cycle',p_month_cycle,'ready_for_finalization',coalesce((v_new->>'ready_for_finalization')::boolean,false),'source_mode','canonical_manual_ledger_v1',
    'earnings',jsonb_build_object('base_salary',v_base,'automated_incentives_total',v_delivery_auto,'performance_incentive_included_in_automated_total',v_monthly,'target_bonus_included_in_automated_total',0,'followup_bonus_included_in_automated_total',0,'customer_request_bonus_included_in_automated_total',0,'branch_star_bonus_included_in_automated_total',0,'list_incentive',0,'approved_overtime',v_ot,'manual_other_incentives',v_manual),
    'adjustments',jsonb_build_object('manual_adjustment',v_manual_adjustment,'deductions_total',v_deductions,'expiry_shortage_deduction',v_expiry,'branch_general_deduction',v_branch,'individual_deduction',v_individual,'other_deduction',v_other),
    'manual_ledger',coalesce(v_new->'manual_ledger','{}'::jsonb),'preview_net_salary',v_preview,'frozen',false,'frozen_net_salary',null,'display_net_salary',v_preview,
    'double_count_guard',jsonb_build_object('monthly_incentive_component_reference_only',v_monthly,'generic_automated_incentives_excluded',true,'delivery_app_compensation_rates_ignored',true,'rule','delivery operational earnings + delivery incentives are represented once inside automated_incentives_total for V2 UI/PDF compatibility; detailed components are in delivery_breakdown'),
    'blockers',coalesce(v_new->'blockers','[]'::jsonb),'warnings',coalesce(v_new->'warnings','[]'::jsonb),'delivery_mode',true,
    'delivery_breakdown',jsonb_build_object('base_salary',v_base,'order_pay',v_order,'trip_pay',v_trip,'monthly_incentive',v_monthly,'quarterly_incentive',v_quarterly,'approved_overtime',v_ot,'operational_and_incentive_total',v_delivery_auto,'classification',v_new->'delivery_classification','activity',v_new->'delivery_activity','preview',v_new->'delivery_preview'),'generated_at',now());
end;$$;

create or replace function public.employee_payroll_financial_composition_current_v1(p_staff_id uuid,p_month_cycle text)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_catalog' as $$
declare v_delivery boolean:=false; v_class jsonb;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid_payroll_financial_current_input' using errcode='22023'; end if;
  begin v_class:=public.dawaa_delivery_payroll_classification_v1(p_staff_id,p_month_cycle); v_delivery:=coalesce((v_class->>'payroll_eligible')::boolean,false); exception when others then v_delivery:=false; end;
  if v_delivery then return public.employee_payroll_financial_composition_compat_v1(p_staff_id,p_month_cycle)||jsonb_build_object('current_route','delivery_v3_compat'); end if;
  return public.employee_payroll_financial_composition_v2(p_staff_id,p_month_cycle)||jsonb_build_object('current_route','standard_v2');
end;$$;

-- Delivery transparency keeps the standard output contract, but replaces engine, OT amount and delivery incentives with delivery truth.
create or replace function public.employee_payroll_transparency_v2(p_staff_id uuid,p_month_cycle text)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_catalog' as $$
declare
  v_class jsonb; v_is_delivery boolean:=false; v_name text; v_branch text; v_username text; v_start date; v_end date; v_gate jsonb; v_hours jsonb; v_preview jsonb; v_engine jsonb; v_components jsonb; v_incentives jsonb;
  v_attendance jsonb:='[]'::jsonb; v_attendance_summary jsonb:='{}'::jsonb; v_time_off jsonb:='[]'::jsonb; v_time_off_rollup jsonb:='[]'::jsonb; v_missing jsonb:='[]'::jsonb; v_missing_summary jsonb:='{}'::jsonb;
  v_overtime jsonb:='[]'::jsonb; v_overtime_summary jsonb:='{}'::jsonb; v_transactions jsonb:='[]'::jsonb; v_transaction_rollup jsonb:='[]'::jsonb; v_transaction_summary jsonb:='{}'::jsonb;
  v_rate numeric:=0; v_monthly numeric:=0; v_order numeric:=0; v_trip numeric:=0; v_quarterly numeric:=0;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid_payroll_transparency_v2_input' using errcode='22023'; end if;
  begin v_class:=public.dawaa_delivery_payroll_classification_v1(p_staff_id,p_month_cycle); v_is_delivery:=coalesce((v_class->>'payroll_eligible')::boolean,false); exception when others then v_is_delivery:=false; end;
  if not v_is_delivery then return public.employee_payroll_transparency_v1(p_staff_id,p_month_cycle)||jsonb_build_object('schema','employee_payroll_transparency_v2','delivery_mode',false); end if;
  if not public.dawaa_can_manage_payroll_staff_id_v1(p_staff_id) then raise exception 'not_authorized_for_delivery_payroll_transparency' using errcode='42501'; end if;
  select s.name,s.branch,coalesce(nullif(s.username,''),sa.username,s.name) into v_name,v_branch,v_username from public.staff s left join lateral(select username from public.staff_accounts x where x.staff_id=s.id::text order by coalesce(x.active,true) desc,x.created_at desc nulls last limit 1) sa on true where s.id=p_staff_id;
  if v_name is null then raise exception 'delivery_staff_not_found' using errcode='22023'; end if;
  select cycle_start,cycle_end into v_start,v_end from public.dawaa_pay_cycle_bounds_v1(to_date(p_month_cycle||'-25','YYYY-MM-DD'));
  v_gate:=public.payroll_finalization_gate_v2(p_staff_id,p_month_cycle); v_hours:=public.dawaa_delivery_hours_truth_v1(p_staff_id,p_month_cycle); v_preview:=public.dawaa_delivery_financial_preview_v2(p_staff_id,p_month_cycle); v_class:=coalesce(v_preview->'classification',v_class);
  v_rate:=coalesce(nullif(v_class->'rates'->>'hourly_rate','')::numeric,0); v_order:=coalesce((v_preview->'earnings_preview'->>'order_pay')::numeric,0); v_trip:=coalesce((v_preview->'earnings_preview'->>'trip_pay')::numeric,0); v_monthly:=coalesce((v_preview->'earnings_preview'->>'monthly_incentive')::numeric,0); v_quarterly:=coalesce((v_preview->'earnings_preview'->>'quarterly_incentive')::numeric,0);
  v_engine:=jsonb_build_object('engine_version','delivery_v3','staff_id',p_staff_id,'month_cycle',p_month_cycle,'cycle_start',v_start,'cycle_end',v_end,'cycle_closed',((now() at time zone 'Africa/Cairo')::date>v_end),'salary_calculation_mode','delivery_classification_v1','monthly_reference_rate',null,'true_hourly_rate',v_rate,'actual_worked_days',coalesce((v_hours->>'actual_worked_days')::int,0),'actual_worked_hours',coalesce((v_hours->>'actual_worked_hours')::numeric,0),'base_payable_hours',coalesce((v_hours->>'base_payable_hours')::numeric,0),'base_salary_computed',coalesce((v_preview->'earnings_preview'->>'base_pay')::numeric,0),'approved_overtime_hours',coalesce((v_hours->>'approved_overtime_hours_resolved')::numeric,0),'approved_overtime_amount',coalesce((v_hours->>'approved_overtime_amount_dynamic')::numeric,0),'pending_overtime_hours',coalesce((v_hours->>'pending_overtime_hours')::numeric,0),'pending_review_days',coalesce((v_hours->>'pending_attendance_days')::int,0),'ready_for_final',coalesce((v_preview->>'ready_for_final')::boolean,false),'rule','delivery payroll uses canonical approved attendance; app attendance is evidence only; overtime is separate');
  v_components:=jsonb_build_object('base_salary_component',coalesce((v_preview->'earnings_preview'->>'base_pay')::numeric,0),'monthly_incentive_component',v_monthly,'delivery_order_component',v_order,'delivery_trip_component',v_trip,'quarterly_delivery_incentive_component',v_quarterly,'identity_branch_mismatch',false,'source','delivery_financial_preview_v2');
  v_incentives:=jsonb_build_object('profile_configured',coalesce((v_class->'rates'->>'configured')::boolean,false),'performance_source','delivery_monthly_evaluation','points_incentive_egp',0,'competition_bonus_egp',0,'manager_evaluation_incentive_egp',v_monthly,'performance_incentive_egp',v_monthly,'target_bonus_egp',0,'followup_threshold_bonus_egp',0,'customer_request_threshold_bonus_egp',0,'branch_star_bonus_egp',0,'delivery_order_pay_egp',v_order,'delivery_trip_pay_egp',v_trip,'delivery_quarterly_incentive_egp',v_quarterly,'automated_incentives_total_egp',round(v_order+v_trip+v_monthly+v_quarterly,2),'monthly_evaluation_multiplier_pct',nullif(v_class->'rates'->>'monthly_evaluation_multiplier_pct','')::numeric,'monthly_incentive_cap',nullif(v_class->'rates'->>'monthly_incentive_cap','')::numeric,'quarterly_incentive_cap',nullif(v_class->'rates'->>'quarterly_incentive_cap','')::numeric);
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'date',a.attendance_date,'branch',a.branch,'status',a.status,'resolution_status',a.resolution_status,'resolution_version',a.resolution_version,'scheduled_start_at',a.scheduled_start_at,'scheduled_end_at',a.scheduled_end_at,'first_in',a.first_in,'last_out',a.last_out,'candidate_hours',coalesce(a.candidate_hours,0),'payroll_eligible_hours',a.payroll_eligible_hours,'late_minutes',coalesce(a.late_minutes,0),'early_leave_minutes',coalesce(a.early_leave_minutes,0),'missing_punch',coalesce(a.missing_punch,false),'time_off_request_id',a.time_off_request_id,'approved_at',a.approved_at,'approved_by_name',a.approved_by_name,'approval_note',a.approval_note) order by a.attendance_date),'[]'::jsonb) into v_attendance from public.attendance_daily_summary a where a.staff_id=p_staff_id and a.attendance_date between v_start and v_end;
  select jsonb_build_object('days_total',count(*),'approved_days',count(*) filter(where a.status='approved'),'pending_review_days',count(*) filter(where a.status='pending_review'),'worked_days',count(*) filter(where a.status='approved' and coalesce(a.candidate_hours,0)>0 and coalesce(a.resolution_status,'') not in ('off_day','approved_time_off','approved_time_off_permission','approved_leave','approved_absence_permission','absence_review')),'absence_days',count(*) filter(where a.resolution_status='absence_review'),'approved_time_off_days',count(*) filter(where a.resolution_status in ('approved_time_off','approved_time_off_permission','approved_leave','approved_absence_permission')),'off_days',count(*) filter(where a.resolution_status='off_day'),'worked_on_off_days',count(*) filter(where a.resolution_status='worked_on_off'),'candidate_hours',round(coalesce(sum(a.candidate_hours),0),2),'payroll_eligible_hours',round(coalesce(sum(a.payroll_eligible_hours),0),2),'late_minutes',coalesce(sum(a.late_minutes),0),'early_leave_minutes',coalesce(sum(a.early_leave_minutes),0),'missing_punch_days',count(*) filter(where coalesce(a.missing_punch,false))) into v_attendance_summary from public.attendance_daily_summary a where a.staff_id=p_staff_id and a.attendance_date between v_start and v_end;
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'kind',r.request_kind,'label',r.request_label,'status',r.status,'start_date',r.start_date,'end_date',r.end_date,'start_time',r.start_time,'end_time',r.end_time,'duration_minutes',r.duration_minutes,'reason',r.reason,'decided_at',r.decided_at,'decided_by_name',r.decided_by_name,'decision_note',r.decision_note,'source',r.source) order by r.start_date,r.created_at),'[]'::jsonb) into v_time_off from public.staff_time_off_requests r where r.staff_id=p_staff_id and r.end_date>=v_start and r.start_date<=v_end;
  select coalesce(jsonb_agg(jsonb_build_object('kind',x.request_kind,'status',x.status,'requests',x.requests,'duration_minutes',x.duration_minutes) order by x.request_kind,x.status),'[]'::jsonb) into v_time_off_rollup from (select r.request_kind,r.status,count(*)::int requests,coalesce(sum(r.duration_minutes),0)::bigint duration_minutes from public.staff_time_off_requests r where r.staff_id=p_staff_id and r.end_date>=v_start and r.start_date<=v_end group by r.request_kind,r.status)x;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'date',i.attendance_date,'missing_type',i.missing_type,'occurrence_no',i.occurrence_no,'allowance_limit',i.allowance_limit,'penalty_eligible',i.penalty_eligible,'penalty_amount',i.penalty_amount,'deduction_applied',i.deduction_transaction_id is not null,'deduction_transaction_id',i.deduction_transaction_id,'manual_punch_id',i.manual_punch_id,'reason',i.reason,'actor_name',i.actor_name) order by i.attendance_date,i.created_at),'[]'::jsonb) into v_missing from public.attendance_missing_punch_incidents i where i.staff_id=p_staff_id and i.attendance_date between v_start and v_end;
  select jsonb_build_object('incidents',count(*),'free_allowance_used',count(*) filter(where i.occurrence_no<=i.allowance_limit),'penalty_eligible_incidents',count(*) filter(where i.penalty_eligible),'deductions_applied',count(*) filter(where i.deduction_transaction_id is not null),'deduction_amount',round(coalesce(sum(i.penalty_amount) filter(where i.deduction_transaction_id is not null),0),2)) into v_missing_summary from public.attendance_missing_punch_incidents i where i.staff_id=p_staff_id and i.attendance_date between v_start and v_end;
  select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'date',o.attendance_date,'branch',o.branch,'status',o.status,'overtime_hours',coalesce(o.overtime_hours,0),'hourly_rate',case when o.status='approved' then v_rate else o.hourly_rate end,'overtime_amount',case when o.status='approved' then round(coalesce(o.overtime_hours,0)*v_rate*coalesce(public.dawaa_overtime_multiplier_from_approval_v1(o.id),0),2) else o.overtime_amount end,'stored_overtime_amount',o.overtime_amount,'multiplier',case when o.status='approved' then public.dawaa_overtime_multiplier_from_approval_v1(o.id) else null end,'decided_at',o.decided_at,'decided_by_name',o.decided_by_name,'decision_note',o.decision_note,'evidence_version',o.decision_evidence_version,'source_resolution_id',o.source_resolution_id) order by o.attendance_date,o.created_at),'[]'::jsonb) into v_overtime from public.staff_overtime_approvals o where o.staff_id=p_staff_id and o.attendance_date between v_start and v_end;
  select jsonb_build_object('detected_cases',count(*),'detected_hours',round(coalesce(sum(o.overtime_hours),0),2),'approved_cases',count(*) filter(where o.status='approved'),'approved_hours',round(coalesce(sum(o.overtime_hours) filter(where o.status='approved'),0),2),'approved_amount',coalesce((v_hours->>'approved_overtime_amount_dynamic')::numeric,0),'pending_cases',count(*) filter(where o.status='pending'),'pending_hours',round(coalesce(sum(o.overtime_hours) filter(where o.status='pending'),0),2),'rejected_cases',count(*) filter(where o.status='rejected'),'rejected_hours',round(coalesce(sum(o.overtime_hours) filter(where o.status='rejected'),0),2)) into v_overtime_summary from public.staff_overtime_approvals o where o.staff_id=p_staff_id and o.attendance_date between v_start and v_end;
  select coalesce(jsonb_agg(jsonb_build_object('id',et.id,'date',et.transaction_date,'type',et.type,'status',et.status,'source',et.source,'source_id',et.source_id,'title',et.title,'reason',coalesce(et.display_reason,et.clean_reason,et.reason),'amount',coalesce(et.amount,0),'points',coalesce(et.final_points,et.points_delta,et.points,0),'category',et.category,'employee_visible',coalesce(et.employee_visible,true),'approved_at',et.approved_at,'approved_by_name',et.approved_by_name,'metadata',coalesce(et.metadata,'{}'::jsonb)) order by et.transaction_date,et.created_at),'[]'::jsonb) into v_transactions from public.employee_transactions et where et.staff_id=p_staff_id and et.month_cycle=p_month_cycle;
  select coalesce(jsonb_agg(jsonb_build_object('type',x.type,'status',x.status,'source',x.source,'rows',x.rows,'amount',x.amount,'points',x.points) order by x.type,x.status,x.source),'[]'::jsonb) into v_transaction_rollup from (select et.type,et.status,et.source,count(*)::int rows,round(coalesce(sum(et.amount),0),2) amount,round(coalesce(sum(coalesce(et.final_points,et.points_delta,et.points,0)),0),2) points from public.employee_transactions et where et.staff_id=p_staff_id and et.month_cycle=p_month_cycle group by et.type,et.status,et.source)x;
  select jsonb_build_object('rows',count(*),'active_or_approved_rows',count(*) filter(where et.status in ('active','approved')),'pending_rows',count(*) filter(where et.status='pending'),'cancelled_rows',count(*) filter(where et.status='cancelled'),'active_or_approved_amount',round(coalesce(sum(et.amount) filter(where et.status in ('active','approved')),0),2),'pending_amount',round(coalesce(sum(et.amount) filter(where et.status='pending'),0),2),'active_or_approved_points',round(coalesce(sum(coalesce(et.final_points,et.points_delta,et.points,0)) filter(where et.status in ('active','approved')),0),2),'pending_points',round(coalesce(sum(coalesce(et.final_points,et.points_delta,et.points,0)) filter(where et.status='pending'),0),2)) into v_transaction_summary from public.employee_transactions et where et.staff_id=p_staff_id and et.month_cycle=p_month_cycle;
  return jsonb_build_object('schema','employee_payroll_transparency_v2','delivery_mode',true,'staff',jsonb_build_object('id',p_staff_id,'username',v_username,'name',v_name,'branch',v_branch),'cycle',jsonb_build_object('month_cycle',p_month_cycle,'start',v_start,'end',v_end),'finalization',jsonb_build_object('ready',coalesce((v_gate->>'ready')::boolean,false),'blockers',coalesce(v_gate->'blockers','[]'::jsonb),'warnings',coalesce(v_gate->'warnings','[]'::jsonb)),'payroll_engine',v_engine,'payroll_components',v_components,'attendance',jsonb_build_object('summary',coalesce(v_attendance_summary,'{}'::jsonb),'days',v_attendance),'time_off',jsonb_build_object('rollup',v_time_off_rollup,'requests',v_time_off),'missing_punch',jsonb_build_object('summary',coalesce(v_missing_summary,'{}'::jsonb),'incidents',v_missing),'overtime',jsonb_build_object('summary',coalesce(v_overtime_summary,'{}'::jsonb),'cases',v_overtime),'transactions',jsonb_build_object('summary',coalesce(v_transaction_summary,'{}'::jsonb),'rollup',v_transaction_rollup,'items',v_transactions),'incentives',v_incentives,'delivery_classification',v_class,'delivery_preview',v_preview,'generated_at',now());
end;$$;

create or replace function public.employee_payroll_transparency_current_v1(p_staff_id uuid,p_month_cycle text)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_catalog' as $$
declare v_delivery boolean:=false; v_class jsonb;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid_payroll_transparency_current_input' using errcode='22023'; end if;
  begin v_class:=public.dawaa_delivery_payroll_classification_v1(p_staff_id,p_month_cycle); v_delivery:=coalesce((v_class->>'payroll_eligible')::boolean,false); exception when others then v_delivery:=false; end;
  if v_delivery then return public.employee_payroll_transparency_v2(p_staff_id,p_month_cycle)||jsonb_build_object('current_route','delivery_v2'); end if;
  return public.employee_payroll_transparency_v1(p_staff_id,p_month_cycle)||jsonb_build_object('current_route','standard_v1');
end;$$;

create or replace function public.employee_payroll_statement_v2(p_staff_id uuid,p_month_cycle text)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_catalog' as $$
declare
  v_class jsonb; v_delivery boolean:=false; v_finalized public.payroll_finalized_snapshots_v2%rowtype; v_frozen jsonb; t jsonb; f jsonb; k jsonb; v_start date; v_end date; v_start_leave jsonb; v_end_leave jsonb; v_leave jsonb;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid_employee_payroll_statement_v2_input' using errcode='22023'; end if;
  begin v_class:=public.dawaa_delivery_payroll_classification_v1(p_staff_id,p_month_cycle); v_delivery:=coalesce((v_class->>'payroll_eligible')::boolean,false); exception when others then v_delivery:=false; end;
  if not v_delivery then return public.employee_payroll_statement_v1(p_staff_id,p_month_cycle)||jsonb_build_object('schema','employee_payroll_statement_v2','route','standard_v1','delivery_mode',false); end if;
  if not public.dawaa_can_manage_payroll_staff_id_v1(p_staff_id) then raise exception 'not_authorized_for_delivery_payroll_statement_v2' using errcode='42501'; end if;
  select * into v_finalized from public.payroll_finalized_snapshots_v2 x where x.staff_id=p_staff_id and x.month_cycle=p_month_cycle limit 1;
  if found and coalesce(v_finalized.payload,'{}'::jsonb)?'employee_statement' then v_frozen:=coalesce(v_finalized.payload->'employee_statement','{}'::jsonb); return v_frozen||jsonb_build_object('schema','employee_payroll_statement_v2','statement_mode','finalized_snapshot_v2','route','frozen_existing_snapshot','delivery_mode',true,'generated_at',v_finalized.finalized_at); end if;
  t:=public.employee_payroll_transparency_v2(p_staff_id,p_month_cycle); f:=public.employee_payroll_financial_composition_compat_v1(p_staff_id,p_month_cycle);
  begin k:=public.employee_payroll_kpi_context_v1(p_staff_id,p_month_cycle); exception when others then k:=jsonb_build_object('schema','employee_payroll_kpi_context_v1','available',false,'reason','kpi_context_unavailable_for_delivery'); end;
  select cycle_start,cycle_end into v_start,v_end from public.dawaa_pay_cycle_bounds_v1(to_date(p_month_cycle||'-25','YYYY-MM-DD'));
  begin v_start_leave:=public.get_annual_leave_balance_v1(p_staff_id,extract(year from v_start)::int); exception when others then v_start_leave:=jsonb_build_object('year',extract(year from v_start)::int,'configured',false,'available',false,'reason','annual_leave_balance_unavailable'); end;
  if extract(year from v_end)::int=extract(year from v_start)::int then v_leave:=jsonb_build_object('cycle_spans_years',false,'balances',jsonb_build_array(v_start_leave));
  else begin v_end_leave:=public.get_annual_leave_balance_v1(p_staff_id,extract(year from v_end)::int); exception when others then v_end_leave:=jsonb_build_object('year',extract(year from v_end)::int,'configured',false,'available',false,'reason','annual_leave_balance_unavailable'); end; v_leave:=jsonb_build_object('cycle_spans_years',true,'balances',jsonb_build_array(v_start_leave,v_end_leave)); end if;
  return jsonb_build_object('schema','employee_payroll_statement_v2','statement_mode','live_preview','route','delivery_v3_compat','delivery_mode',true,'staff',t->'staff','cycle',t->'cycle','finalization',t->'finalization','payroll_engine',t->'payroll_engine','payroll_components',t->'payroll_components','attendance',t->'attendance','time_off',t->'time_off','annual_leave',v_leave,'missing_punch',t->'missing_punch','overtime',t->'overtime','transactions',t->'transactions','incentives',t->'incentives','financial',f,'kpi',k,'delivery_classification',t->'delivery_classification','delivery_preview',t->'delivery_preview',
    'statement_rules',jsonb_build_object('attendance','Payroll attendance_daily_summary is canonical; delivery app attendance is evidence only','overtime','approved overtime x final delivery hourly rate x approved multiplier; pending/rejected are disclosed but not paid','performance','delivery monthly incentive requires an approved evaluation multiplier; no evaluation means no automatic 100%','missing_punch','only an applied deduction transaction affects pay','annual_leave','balance is informational and comes from the annual leave ledger','net_salary','base hours + approved overtime + countable orders + approved trips + approved delivery incentive + manual ledger - deductions','finalization','finalization is blocked by unresolved attendance/overtime/orders/trips/evaluation/classification or cycle-open conditions'),'generated_at',now());
end;$$;

create or replace function public.employee_payroll_statement_current_v1(p_staff_id uuid,p_month_cycle text)
returns jsonb language sql stable security definer set search_path to 'public','pg_catalog' as $$
  select public.employee_payroll_statement_v2(p_staff_id,p_month_cycle);
$$;

create or replace function public.payroll_final_snapshot_preview_v2(p_staff_id uuid,p_month_cycle text)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_catalog' as $$
declare v_class jsonb; v_delivery boolean:=false; v_gate jsonb; v_statement jsonb; v_financial jsonb; v_components jsonb; v_staff public.staff%rowtype; v_username text; v_snapshot jsonb; v_fp jsonb;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid_payroll_snapshot_preview_v2_input' using errcode='22023'; end if;
  begin v_class:=public.dawaa_delivery_payroll_classification_v1(p_staff_id,p_month_cycle); v_delivery:=coalesce((v_class->>'payroll_eligible')::boolean,false); exception when others then v_delivery:=false; end;
  if not v_delivery then return public.payroll_final_snapshot_preview_v1(p_staff_id,p_month_cycle)||jsonb_build_object('preview_route','standard_v1'); end if;
  if not public.dawaa_can_manage_payroll_staff_id_v1(p_staff_id) then raise exception 'not_authorized_for_delivery_payroll_snapshot_preview' using errcode='42501'; end if;
  select * into v_staff from public.staff where id=p_staff_id; if not found then raise exception 'staff_not_found' using errcode='22023'; end if;
  select coalesce(nullif(v_staff.username,''),(select sa.username from public.staff_accounts sa where sa.staff_id=p_staff_id::text order by coalesce(sa.active,true) desc,sa.created_at desc nulls last limit 1),v_staff.name) into v_username;
  v_gate:=public.payroll_finalization_gate_v2(p_staff_id,p_month_cycle); v_statement:=public.employee_payroll_statement_v2(p_staff_id,p_month_cycle); v_financial:=public.employee_payroll_financial_composition_compat_v1(p_staff_id,p_month_cycle); v_components:=coalesce(v_statement->'payroll_components','{}'::jsonb);
  v_snapshot:=jsonb_build_object('snapshot_schema','payroll_final_snapshot_v4_delivery_aware','snapshot_mode','preview_only','fingerprint_schema','deterministic_without_generated_at_v1','preview_route','delivery_v2','staff_id',p_staff_id,'staff_username',v_username,'staff_name',v_staff.name,'branch',v_staff.branch,'month_cycle',p_month_cycle,'cycle_start',v_gate->>'cycle_start','cycle_end',v_gate->>'cycle_end','finalization_ready',coalesce((v_gate->>'ready')::boolean,false),'attendance_truth',v_gate->'attendance_gate','policy_validation',coalesce(v_gate->'policy_validation','{}'::jsonb),'payroll_components',v_components,'financial_composition',v_financial,'employee_statement',v_statement,'delivery_classification',v_statement->'delivery_classification','delivery_preview',v_statement->'delivery_preview','blockers',coalesce(v_gate->'blockers','[]'::jsonb),'warnings',coalesce(v_gate->'warnings','[]'::jsonb),'generated_at',now());
  v_fp:=public.dawaa_jsonb_strip_generated_at_v1(v_snapshot); return v_snapshot||jsonb_build_object('snapshot_fingerprint',md5(v_fp::text));
end;$$;

create or replace function public.stage_payroll_final_snapshot_v2(p_staff_id uuid,p_month_cycle text,p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public','pg_catalog' as $$
declare v_actor public.staff_accounts%rowtype; v_preview jsonb; v_row public.payroll_final_snapshot_staging%rowtype; v_existing boolean:=false;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid_payroll_snapshot_stage_v2_input' using errcode='22023'; end if;
  select * into v_actor from public.staff_accounts where id=public.dawaa_current_staff_account_id_strict() and coalesce(active,false) and coalesce(can_login,false);
  if not found or not public.dawaa_current_actor_can(array['manage_payroll']) or not public.dawaa_can_manage_payroll_staff_id_v1(p_staff_id) then raise exception 'not_authorized_for_payroll_snapshot_stage_v2' using errcode='42501'; end if;
  v_preview:=public.payroll_final_snapshot_preview_v2(p_staff_id,p_month_cycle);
  select * into v_row from public.payroll_final_snapshot_staging where staff_id=p_staff_id and month_cycle=p_month_cycle and snapshot_fingerprint=v_preview->>'snapshot_fingerprint' order by created_at desc limit 1;
  if found then v_existing:=true; else insert into public.payroll_final_snapshot_staging(staff_id,staff_username,staff_name,branch,month_cycle,cycle_start,cycle_end,finalization_ready,snapshot_fingerprint,payload,note,created_by,created_by_name)
    values(p_staff_id,v_preview->>'staff_username',v_preview->>'staff_name',v_preview->>'branch',p_month_cycle,nullif(v_preview->>'cycle_start','')::date,nullif(v_preview->>'cycle_end','')::date,coalesce((v_preview->>'finalization_ready')::boolean,false),v_preview->>'snapshot_fingerprint',v_preview,nullif(trim(coalesce(p_note,'')),''),v_actor.id,coalesce(v_actor.name,v_actor.username)) returning * into v_row; end if;
  insert into public.payroll_snapshot_audit(snapshot_id,action,staff_id,month_cycle,snapshot_fingerprint,actor_id,actor_name,note,metadata)
  values(v_row.id,case when v_existing then 'reused_v2' else 'staged_v2' end,p_staff_id,p_month_cycle,v_row.snapshot_fingerprint,v_actor.id,coalesce(v_actor.name,v_actor.username),nullif(trim(coalesce(p_note,'')),''),jsonb_build_object('finalization_ready',v_row.finalization_ready,'snapshot_schema',v_preview->>'snapshot_schema','preview_route',v_preview->>'preview_route'));
  return jsonb_build_object('success',true,'existing',v_existing,'snapshot',to_jsonb(v_row));
end;$$;

create or replace function public.compare_payroll_final_snapshot_v2(p_snapshot_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_catalog' as $$
declare v_row public.payroll_final_snapshot_staging%rowtype; v_current jsonb;
begin
  select * into v_row from public.payroll_final_snapshot_staging where id=p_snapshot_id; if not found then raise exception 'snapshot_not_found' using errcode='22023'; end if;
  if not public.dawaa_current_actor_can(array['manage_payroll']) or not public.dawaa_can_manage_payroll_staff_id_v1(v_row.staff_id) then raise exception 'not_authorized_for_payroll_snapshot_compare_v2' using errcode='42501'; end if;
  v_current:=public.payroll_final_snapshot_preview_v2(v_row.staff_id,v_row.month_cycle);
  return jsonb_build_object('snapshot_id',v_row.id,'stored_fingerprint',v_row.snapshot_fingerprint,'current_fingerprint',v_current->>'snapshot_fingerprint','unchanged',v_row.snapshot_fingerprint=(v_current->>'snapshot_fingerprint'),'stored_ready',v_row.finalization_ready,'current_ready',coalesce((v_current->>'finalization_ready')::boolean,false),'stored_created_at',v_row.created_at,'current_generated_at',v_current->>'generated_at','stored_payload',v_row.payload,'current_payload',v_current);
end;$$;

create or replace function public.review_payroll_staged_snapshot_v2(p_snapshot_id uuid,p_decision text,p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public','pg_catalog' as $$
declare v_actor public.staff_accounts%rowtype; v_snapshot public.payroll_final_snapshot_staging%rowtype; v_decision text:=lower(trim(coalesce(p_decision,''))); v_compare jsonb; v_review public.payroll_snapshot_reviews%rowtype;
begin
  if p_snapshot_id is null or v_decision not in ('approved','rejected') then raise exception 'invalid_payroll_snapshot_review_v2_input' using errcode='22023'; end if;
  select * into v_actor from public.staff_accounts where id=public.dawaa_current_staff_account_id_strict() and coalesce(active,false) and coalesce(can_login,false);
  if not found or coalesce(v_actor.role,'') not in ('general_manager','executive_manager','branches_manager') or not public.dawaa_current_actor_can(array['manage_payroll']) then raise exception 'not_authorized_for_payroll_snapshot_review_v2' using errcode='42501'; end if;
  select * into v_snapshot from public.payroll_final_snapshot_staging where id=p_snapshot_id; if not found then raise exception 'snapshot_not_found' using errcode='22023'; end if;
  if not public.dawaa_can_manage_payroll_staff_id_v1(v_snapshot.staff_id) then raise exception 'not_authorized_for_payroll_snapshot_staff_v2' using errcode='42501'; end if;
  if v_snapshot.created_by is not null and v_snapshot.created_by=v_actor.id then raise exception 'snapshot_creator_cannot_review_own_snapshot' using errcode='42501'; end if;
  v_compare:=public.compare_payroll_final_snapshot_v2(p_snapshot_id);
  if v_decision='approved' then if coalesce(v_snapshot.finalization_ready,false) is not true then raise exception 'cannot_approve_blocked_snapshot' using errcode='22023'; end if; if coalesce((v_compare->>'unchanged')::boolean,false) is not true then raise exception 'cannot_approve_changed_snapshot' using errcode='22023'; end if; if coalesce((v_compare->>'current_ready')::boolean,false) is not true then raise exception 'cannot_approve_currently_blocked_snapshot' using errcode='22023'; end if; end if;
  insert into public.payroll_snapshot_reviews(snapshot_id,decision,reviewer_id,reviewer_name,reviewer_role,note,comparison) values(p_snapshot_id,v_decision,v_actor.id,coalesce(v_actor.name,v_actor.username),v_actor.role,nullif(trim(coalesce(p_note,'')),''),v_compare) returning * into v_review;
  return jsonb_build_object('success',true,'review',to_jsonb(v_review),'snapshot',to_jsonb(v_snapshot),'comparison',v_compare,'financial_effect','none','finalized',false,'paid',false,'review_route','v2');
end;$$;

create or replace function public.list_payroll_snapshot_reviews_v2(p_snapshot_id uuid,p_limit integer default 50)
returns setof public.payroll_snapshot_reviews language plpgsql stable security definer set search_path to 'public','pg_catalog' as $$
declare v_snapshot public.payroll_final_snapshot_staging%rowtype;
begin
  select * into v_snapshot from public.payroll_final_snapshot_staging where id=p_snapshot_id; if not found then raise exception 'snapshot_not_found' using errcode='22023'; end if;
  if not public.dawaa_current_actor_can(array['manage_payroll']) or not public.dawaa_can_manage_payroll_staff_id_v1(v_snapshot.staff_id) then raise exception 'not_authorized_for_payroll_snapshot_reviews_v2' using errcode='42501'; end if;
  return query select * from public.payroll_snapshot_reviews r where r.snapshot_id=p_snapshot_id order by r.created_at desc limit greatest(1,least(coalesce(p_limit,50),200));
end;$$;

create or replace function public.finalize_payroll_snapshot_v3(p_snapshot_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_catalog' as $$
declare
  v_actor public.staff_accounts%rowtype; v_snapshot public.payroll_final_snapshot_staging%rowtype; v_compare jsonb; v_review public.payroll_snapshot_reviews%rowtype;
  v_existing public.payroll_finalized_snapshots_v2%rowtype; v_final public.payroll_finalized_snapshots_v2%rowtype; v_class jsonb; v_delivery boolean:=false;
begin
  if p_snapshot_id is null then raise exception 'snapshot_id_required' using errcode='22023'; end if;
  select * into v_snapshot from public.payroll_final_snapshot_staging where id=p_snapshot_id; if not found then raise exception 'snapshot_not_found' using errcode='22023'; end if;
  begin v_class:=public.dawaa_delivery_payroll_classification_v1(v_snapshot.staff_id,v_snapshot.month_cycle); v_delivery:=coalesce((v_class->>'payroll_eligible')::boolean,false); exception when others then v_delivery:=false; end;
  if not v_delivery then return public.finalize_payroll_snapshot_v2(p_snapshot_id)||jsonb_build_object('finalize_route','standard_v2'); end if;
  select * into v_actor from public.staff_accounts where id=public.dawaa_current_staff_account_id_strict() and coalesce(active,false) and coalesce(can_login,false);
  if not found or coalesce(v_actor.role,'') not in ('general_manager','executive_manager') or not public.dawaa_current_actor_can(array['manage_payroll']) or not public.dawaa_can_manage_payroll_staff_id_v1(v_snapshot.staff_id) then raise exception 'not_authorized_for_delivery_payroll_finalization' using errcode='42501'; end if;
  select * into v_existing from public.payroll_finalized_snapshots_v2 where staff_id=v_snapshot.staff_id and month_cycle=v_snapshot.month_cycle;
  if found then if v_existing.snapshot_fingerprint=v_snapshot.snapshot_fingerprint then return jsonb_build_object('success',true,'existing',true,'finalized',to_jsonb(v_existing),'paid',false,'financial_effect','none','finalize_route','delivery_v3'); end if; raise exception 'payroll_cycle_already_finalized_with_different_snapshot' using errcode='55000'; end if;
  select * into v_review from public.payroll_snapshot_reviews where snapshot_id=p_snapshot_id order by created_at desc,id desc limit 1; if not found or v_review.decision<>'approved' then raise exception 'latest_snapshot_review_must_be_approved' using errcode='22023'; end if;
  v_compare:=public.compare_payroll_final_snapshot_v2(p_snapshot_id); if coalesce(v_snapshot.finalization_ready,false) is not true or coalesce((v_compare->>'unchanged')::boolean,false) is not true or coalesce((v_compare->>'current_ready')::boolean,false) is not true then raise exception 'snapshot_changed_or_blocked_before_finalization' using errcode='55000'; end if;
  insert into public.payroll_finalized_snapshots_v2(snapshot_id,staff_id,staff_username,staff_name,branch,month_cycle,cycle_start,cycle_end,snapshot_fingerprint,payload,finalized_by,finalized_by_name)
  values(v_snapshot.id,v_snapshot.staff_id,v_snapshot.staff_username,v_snapshot.staff_name,v_snapshot.branch,v_snapshot.month_cycle,v_snapshot.cycle_start,v_snapshot.cycle_end,v_snapshot.snapshot_fingerprint,v_snapshot.payload,v_actor.id,coalesce(v_actor.name,v_actor.username)) returning * into v_final;
  return jsonb_build_object('success',true,'existing',false,'finalized',to_jsonb(v_final),'review',to_jsonb(v_review),'comparison',v_compare,'paid',false,'financial_effect','none','finalize_route','delivery_v3');
end;$$;

-- Public current endpoints. Internal delivery functions remain service-role only.
revoke execute on function public.dawaa_staff_uses_delivery_finance_v1(uuid) from public,anon,authenticated;
revoke execute on function public.dawaa_can_manage_payroll_staff_id_v1(uuid) from public,anon,authenticated;
revoke execute on function public.dawaa_delivery_discipline_band_v1(integer,integer,date) from public,anon,authenticated;
revoke execute on function public.dawaa_delivery_discipline_evidence_v1(uuid,text) from public,anon,authenticated;
revoke execute on function public.dawaa_delivery_payroll_classification_v1(uuid,text) from public,anon,authenticated;
revoke execute on function public.dawaa_delivery_payroll_matrix_v1() from public,anon,authenticated;
revoke execute on function public.dawaa_delivery_hours_truth_v1(uuid,text) from public,anon,authenticated;
revoke execute on function public.dawaa_delivery_financial_preview_v1(uuid,text) from public,anon,authenticated;
revoke execute on function public.dawaa_delivery_financial_preview_v2(uuid,text) from public,anon,authenticated;
revoke execute on function public.delivery_payroll_sync_health_v1(text) from public,anon,authenticated;
revoke execute on function public.delivery_employment_directives_v1(uuid[]) from public,anon,authenticated;
revoke execute on function public.ingest_delivery_payroll_activity_v1(text,text,date,date,jsonb) from public,anon,authenticated;
revoke execute on function public.employee_payroll_financial_composition_v3(uuid,text) from public,anon,authenticated;
revoke execute on function public.employee_payroll_financial_composition_compat_v1(uuid,text) from public,anon,authenticated;
revoke execute on function public.employee_payroll_transparency_v2(uuid,text) from public,anon,authenticated;
revoke execute on function public.employee_payroll_statement_v2(uuid,text) from public,anon,authenticated;
revoke execute on function public.payroll_finalization_gate_v2(uuid,text) from public,anon,authenticated;

grant execute on function public.dawaa_staff_uses_delivery_finance_v1(uuid) to service_role;
grant execute on function public.dawaa_can_manage_payroll_staff_id_v1(uuid) to service_role;
grant execute on function public.dawaa_delivery_discipline_band_v1(integer,integer,date) to service_role;
grant execute on function public.dawaa_delivery_discipline_evidence_v1(uuid,text) to service_role;
grant execute on function public.dawaa_delivery_payroll_classification_v1(uuid,text) to service_role;
grant execute on function public.dawaa_delivery_payroll_matrix_v1() to service_role;
grant execute on function public.dawaa_delivery_hours_truth_v1(uuid,text) to service_role;
grant execute on function public.dawaa_delivery_financial_preview_v1(uuid,text) to service_role;
grant execute on function public.dawaa_delivery_financial_preview_v2(uuid,text) to service_role;
grant execute on function public.delivery_payroll_sync_health_v1(text) to service_role;
grant execute on function public.delivery_employment_directives_v1(uuid[]) to service_role;
grant execute on function public.ingest_delivery_payroll_activity_v1(text,text,date,date,jsonb) to service_role;
grant execute on function public.employee_payroll_financial_composition_v3(uuid,text) to service_role;
grant execute on function public.employee_payroll_financial_composition_compat_v1(uuid,text) to service_role;
grant execute on function public.employee_payroll_transparency_v2(uuid,text) to service_role;
grant execute on function public.employee_payroll_statement_v2(uuid,text) to service_role;
grant execute on function public.payroll_finalization_gate_v2(uuid,text) to service_role;

revoke execute on function public.employee_payroll_financial_composition_current_v1(uuid,text) from public,anon;
revoke execute on function public.employee_payroll_transparency_current_v1(uuid,text) from public,anon;
revoke execute on function public.employee_payroll_statement_current_v1(uuid,text) from public,anon;
revoke execute on function public.payroll_finalization_gate_current_v1(uuid,text) from public,anon;
revoke execute on function public.payroll_final_snapshot_preview_v2(uuid,text) from public,anon;
revoke execute on function public.stage_payroll_final_snapshot_v2(uuid,text,text) from public,anon;
revoke execute on function public.compare_payroll_final_snapshot_v2(uuid) from public,anon;
revoke execute on function public.review_payroll_staged_snapshot_v2(uuid,text,text) from public,anon;
revoke execute on function public.list_payroll_snapshot_reviews_v2(uuid,integer) from public,anon;
revoke execute on function public.finalize_payroll_snapshot_v3(uuid) from public,anon;

grant execute on function public.employee_payroll_financial_composition_current_v1(uuid,text) to authenticated,service_role;
grant execute on function public.employee_payroll_transparency_current_v1(uuid,text) to authenticated,service_role;
grant execute on function public.employee_payroll_statement_current_v1(uuid,text) to authenticated,service_role;
grant execute on function public.payroll_finalization_gate_current_v1(uuid,text) to authenticated,service_role;
grant execute on function public.payroll_final_snapshot_preview_v2(uuid,text) to authenticated,service_role;
grant execute on function public.stage_payroll_final_snapshot_v2(uuid,text,text) to authenticated,service_role;
grant execute on function public.compare_payroll_final_snapshot_v2(uuid) to authenticated,service_role;
grant execute on function public.review_payroll_staged_snapshot_v2(uuid,text,text) to authenticated,service_role;
grant execute on function public.list_payroll_snapshot_reviews_v2(uuid,integer) to authenticated,service_role;
grant execute on function public.finalize_payroll_snapshot_v3(uuid) to authenticated,service_role;
