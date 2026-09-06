-- Canonical time-off / leave foundation.
-- Production was applied through Supabase before this repository mirror was committed.
-- Legacy shift_exceptions remains for historical weekly-off/schedule compatibility only;
-- new permission/leave workflows use staff_time_off_requests and secured RPCs.

create table if not exists public.staff_time_off_requests (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete restrict,
  staff_name_snapshot text not null,
  branch_snapshot text,
  request_kind text not null check (request_kind in ('permission','annual_leave','sick_leave','exceptional_leave','approved_absence','shift_swap')),
  request_label text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  start_date date not null,
  end_date date not null,
  start_time time,
  end_time time,
  duration_minutes integer,
  reason text,
  requested_by text,
  requested_at timestamptz not null default now(),
  decided_by text,
  decided_by_name text,
  decided_at timestamptz,
  decision_note text,
  cancelled_by text,
  cancelled_at timestamptz,
  cancellation_reason text,
  policy_version text not null default 'attendance_timeoff_v1',
  source text not null default 'app',
  legacy_source text,
  legacy_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_time_off_date_range_chk check (end_date >= start_date),
  constraint staff_time_off_duration_chk check (duration_minutes is null or duration_minutes between 0 and 1440)
);
create unique index if not exists ux_staff_time_off_legacy_source_id on public.staff_time_off_requests(legacy_source,legacy_id) where legacy_source is not null and legacy_id is not null;
create index if not exists idx_staff_time_off_staff_dates on public.staff_time_off_requests(staff_id,start_date desc,end_date desc);
create index if not exists idx_staff_time_off_status_dates on public.staff_time_off_requests(status,start_date desc);
create index if not exists idx_staff_time_off_branch_dates on public.staff_time_off_requests(branch_snapshot,start_date desc);

create table if not exists public.staff_time_off_audit (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.staff_time_off_requests(id) on delete restrict,
  staff_id uuid not null references public.staff(id) on delete restrict,
  action text not null,
  actor_id text,
  actor_name text,
  actor_role text,
  before_state jsonb,
  after_state jsonb,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists idx_staff_time_off_audit_request on public.staff_time_off_audit(request_id,created_at desc);
create index if not exists idx_staff_time_off_audit_staff on public.staff_time_off_audit(staff_id,created_at desc);

create table if not exists public.staff_leave_ledger (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete restrict,
  leave_year integer not null check (leave_year between 2020 and 2100),
  leave_type text not null default 'annual_leave',
  entry_type text not null check (entry_type in ('opening','entitlement','accrual','carry_forward','reserved','consumed','restore','adjustment','expired')),
  days_delta numeric(7,2) not null,
  request_id uuid references public.staff_time_off_requests(id) on delete restrict,
  policy_version text not null default 'annual_leave_v1',
  reason text,
  actor_id text,
  actor_name text,
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_staff_leave_ledger_staff_year on public.staff_leave_ledger(staff_id,leave_year,created_at);

create table if not exists public.attendance_policy_versions (
  id uuid primary key default gen_random_uuid(),
  policy_code text not null unique,
  effective_from date not null,
  effective_to date,
  active boolean not null default true,
  late_grace_minutes integer not null check (late_grace_minutes between 0 and 240),
  very_late_minutes integer not null check (very_late_minutes between 0 and 480),
  permission_limit_per_cycle integer not null check (permission_limit_per_cycle between 0 and 20),
  permission_max_minutes integer not null check (permission_max_minutes between 1 and 1440),
  weekly_off_allowance integer not null check (weekly_off_allowance between 0 and 10),
  authorized_absence_uncompensated_days numeric(5,2) not null check (authorized_absence_uncompensated_days>=0),
  unauthorized_absence_days numeric(5,2) not null check (unauthorized_absence_days>=0),
  annual_leave_entitlement_days numeric(6,2),
  notes text,
  created_at timestamptz not null default now()
);
create unique index if not exists ux_attendance_policy_one_active on public.attendance_policy_versions(active) where active;

insert into public.attendance_policy_versions(policy_code,effective_from,active,late_grace_minutes,very_late_minutes,permission_limit_per_cycle,permission_max_minutes,weekly_off_allowance,authorized_absence_uncompensated_days,unauthorized_absence_days,annual_leave_entitlement_days,notes)
values('attendance_policy_v1','2026-01-01',true,15,30,2,120,4,2,4,null,'Canonical attendance policy. Annual leave entitlement intentionally unset until approved by management.')
on conflict(policy_code) do update set
  late_grace_minutes=excluded.late_grace_minutes,
  very_late_minutes=excluded.very_late_minutes,
  permission_limit_per_cycle=excluded.permission_limit_per_cycle,
  permission_max_minutes=excluded.permission_max_minutes,
  weekly_off_allowance=excluded.weekly_off_allowance,
  authorized_absence_uncompensated_days=excluded.authorized_absence_uncompensated_days,
  unauthorized_absence_days=excluded.unauthorized_absence_days,
  notes=excluded.notes;

alter table public.staff_time_off_requests enable row level security;
alter table public.staff_time_off_audit enable row level security;
alter table public.staff_leave_ledger enable row level security;
revoke all on public.staff_time_off_requests from anon,authenticated;
revoke all on public.staff_time_off_audit from anon,authenticated;
revoke all on public.staff_leave_ledger from anon,authenticated;
revoke all on public.attendance_policy_versions from anon,authenticated;
grant all on public.staff_time_off_requests to service_role;
grant all on public.staff_time_off_audit to service_role;
grant all on public.staff_leave_ledger to service_role;
grant all on public.attendance_policy_versions to service_role;

create or replace function public.dawaa_can_manage_time_off_v1()
returns boolean language sql stable security definer set search_path='public','pg_catalog'
as $$ select public.dawaa_actor_is_top_management_v1() or public.dawaa_current_actor_can(array['manage_time_off','approve_leave_request']::text[]) $$;
revoke all on function public.dawaa_can_manage_time_off_v1() from public;
grant execute on function public.dawaa_can_manage_time_off_v1() to anon,authenticated,service_role;

create or replace function public.get_attendance_policy_v1(p_date date default ((now() at time zone 'Africa/Cairo')::date))
returns jsonb language sql stable security definer set search_path='public','pg_catalog'
as $$ select coalesce((select to_jsonb(p) from public.attendance_policy_versions p where p.active and p.effective_from<=p_date and (p.effective_to is null or p.effective_to>=p_date) order by p.effective_from desc limit 1),'{}'::jsonb) $$;
revoke all on function public.get_attendance_policy_v1(date) from public;
grant execute on function public.get_attendance_policy_v1(date) to anon,authenticated,service_role;

create or replace function public.list_staff_time_off_requests_v1(p_staff_id uuid default null,p_from date default null,p_to date default null,p_status text default null,p_limit integer default 200)
returns setof public.staff_time_off_requests language plpgsql stable security definer set search_path='public','pg_catalog'
as $$
declare v_self uuid:=public.dawaa_current_staff_subject_uuid_v1(); v_manage boolean:=public.dawaa_can_manage_time_off_v1();
begin
  if not v_manage and (v_self is null or (p_staff_id is not null and p_staff_id<>v_self)) then raise exception 'not_authorized_for_time_off' using errcode='42501'; end if;
  return query select r.* from public.staff_time_off_requests r
  where (case when v_manage then (p_staff_id is null or r.staff_id=p_staff_id) else r.staff_id=v_self end)
    and (p_from is null or r.end_date>=p_from) and (p_to is null or r.start_date<=p_to) and (p_status is null or r.status=p_status)
  order by r.start_date desc,r.created_at desc limit least(greatest(coalesce(p_limit,200),1),500);
end; $$;
revoke all on function public.list_staff_time_off_requests_v1(uuid,date,date,text,integer) from public;
grant execute on function public.list_staff_time_off_requests_v1(uuid,date,date,text,integer) to anon,authenticated,service_role;

create or replace function public.create_staff_time_off_request_v1(p_staff_id uuid,p_request_kind text,p_request_label text,p_start_date date,p_end_date date default null,p_start_time time default null,p_end_time time default null,p_duration_minutes integer default null,p_reason text default null)
returns public.staff_time_off_requests language plpgsql security definer set search_path='public','pg_catalog'
as $$
declare
  v_self uuid:=public.dawaa_current_staff_subject_uuid_v1(); v_manage boolean:=public.dawaa_can_manage_time_off_v1(); v_staff public.staff%rowtype; v_row public.staff_time_off_requests%rowtype;
  v_actor text:=public.employee_operating_actor_id(); v_actor_name text; v_actor_role text:=public.employee_operating_actor_role(); v_end date:=coalesce(p_end_date,p_start_date); v_duration integer:=p_duration_minutes;
begin
  if p_staff_id is null or p_start_date is null then raise exception 'time_off_identity_or_date_missing' using errcode='22023'; end if;
  if not v_manage and (v_self is null or p_staff_id<>v_self) then raise exception 'not_authorized_for_time_off' using errcode='42501'; end if;
  if p_request_kind not in ('permission','annual_leave','sick_leave','exceptional_leave','approved_absence','shift_swap') then raise exception 'invalid_time_off_kind' using errcode='22023'; end if;
  if v_end<p_start_date then raise exception 'invalid_time_off_date_range' using errcode='22023'; end if;
  if p_request_kind='permission' and v_duration is null and p_start_time is not null and p_end_time is not null then v_duration:=extract(epoch from ((p_start_date+p_end_time)-(p_start_date+p_start_time)))/60; if v_duration<0 then v_duration:=v_duration+1440; end if; end if;
  if p_request_kind='permission' and (v_duration is null or v_duration<=0) then raise exception 'permission_duration_required' using errcode='22023'; end if;
  if v_duration is not null and (v_duration<0 or v_duration>1440) then raise exception 'invalid_permission_duration' using errcode='22023'; end if;
  select * into v_staff from public.staff where id=p_staff_id; if not found then raise exception 'staff_not_found' using errcode='22023'; end if;
  select coalesce(sa.staff_name,sa.name,sa.username) into v_actor_name from public.staff_accounts sa where sa.id::text=v_actor limit 1;
  insert into public.staff_time_off_requests(staff_id,staff_name_snapshot,branch_snapshot,request_kind,request_label,status,start_date,end_date,start_time,end_time,duration_minutes,reason,requested_by,policy_version,source)
  values(v_staff.id,v_staff.name,v_staff.branch,p_request_kind,nullif(trim(coalesce(p_request_label,'')),''),'pending',p_start_date,v_end,p_start_time,p_end_time,v_duration,nullif(trim(coalesce(p_reason,'')),''),v_actor,'attendance_timeoff_v1','app') returning * into v_row;
  insert into public.staff_time_off_audit(request_id,staff_id,action,actor_id,actor_name,actor_role,after_state,reason) values(v_row.id,v_row.staff_id,'created',v_actor,v_actor_name,v_actor_role,to_jsonb(v_row),p_reason);
  return v_row;
end; $$;
revoke all on function public.create_staff_time_off_request_v1(uuid,text,text,date,date,time,time,integer,text) from public;
grant execute on function public.create_staff_time_off_request_v1(uuid,text,text,date,date,time,time,integer,text) to anon,authenticated,service_role;

create or replace function public.decide_staff_time_off_request_v1(p_request_id uuid,p_decision text,p_note text default null)
returns public.staff_time_off_requests language plpgsql security definer set search_path='public','pg_catalog'
as $$
declare v_before public.staff_time_off_requests%rowtype; v_after public.staff_time_off_requests%rowtype; v_actor text:=public.employee_operating_actor_id(); v_actor_name text; v_actor_role text:=public.employee_operating_actor_role(); v_days numeric;
begin
  if not public.dawaa_can_manage_time_off_v1() then raise exception 'not_authorized_for_time_off_decision' using errcode='42501'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'invalid_time_off_decision' using errcode='22023'; end if;
  select * into v_before from public.staff_time_off_requests where id=p_request_id for update; if not found then raise exception 'time_off_request_not_found' using errcode='22023'; end if; if v_before.status<>'pending' then return v_before; end if;
  select coalesce(sa.staff_name,sa.name,sa.username) into v_actor_name from public.staff_accounts sa where sa.id::text=v_actor limit 1;
  update public.staff_time_off_requests set status=p_decision,decided_by=v_actor,decided_by_name=v_actor_name,decided_at=now(),decision_note=nullif(trim(coalesce(p_note,'')),''),updated_at=now() where id=p_request_id returning * into v_after;
  insert into public.staff_time_off_audit(request_id,staff_id,action,actor_id,actor_name,actor_role,before_state,after_state,reason) values(v_after.id,v_after.staff_id,p_decision,v_actor,v_actor_name,v_actor_role,to_jsonb(v_before),to_jsonb(v_after),p_note);
  if v_after.request_kind='annual_leave' and p_decision='approved' then v_days:=(v_after.end_date-v_after.start_date)+1; insert into public.staff_leave_ledger(staff_id,leave_year,leave_type,entry_type,days_delta,request_id,policy_version,reason,actor_id,actor_name,idempotency_key) values(v_after.staff_id,extract(year from v_after.start_date)::int,'annual_leave','consumed',-v_days,v_after.id,'annual_leave_v1',coalesce(p_note,v_after.reason),v_actor,v_actor_name,'annual_leave_consumed:'||v_after.id::text) on conflict(idempotency_key) do nothing; end if;
  return v_after;
end; $$;
revoke all on function public.decide_staff_time_off_request_v1(uuid,text,text) from public;
grant execute on function public.decide_staff_time_off_request_v1(uuid,text,text) to anon,authenticated,service_role;

create or replace function public.cancel_staff_time_off_request_v1(p_request_id uuid,p_reason text)
returns public.staff_time_off_requests language plpgsql security definer set search_path='public','pg_catalog'
as $$
declare v_before public.staff_time_off_requests%rowtype; v_after public.staff_time_off_requests%rowtype; v_self uuid:=public.dawaa_current_staff_subject_uuid_v1(); v_actor text:=public.employee_operating_actor_id(); v_actor_name text; v_actor_role text:=public.employee_operating_actor_role(); v_days numeric;
begin
  select * into v_before from public.staff_time_off_requests where id=p_request_id for update; if not found then raise exception 'time_off_request_not_found' using errcode='22023'; end if;
  if not public.dawaa_can_manage_time_off_v1() and (v_self is null or v_before.staff_id<>v_self or v_before.status<>'pending') then raise exception 'not_authorized_for_time_off_cancel' using errcode='42501'; end if;
  if v_before.status='cancelled' then return v_before; end if;
  select coalesce(sa.staff_name,sa.name,sa.username) into v_actor_name from public.staff_accounts sa where sa.id::text=v_actor limit 1;
  update public.staff_time_off_requests set status='cancelled',cancelled_by=v_actor,cancelled_at=now(),cancellation_reason=nullif(trim(coalesce(p_reason,'')),''),updated_at=now() where id=p_request_id returning * into v_after;
  insert into public.staff_time_off_audit(request_id,staff_id,action,actor_id,actor_name,actor_role,before_state,after_state,reason) values(v_after.id,v_after.staff_id,'cancelled',v_actor,v_actor_name,v_actor_role,to_jsonb(v_before),to_jsonb(v_after),p_reason);
  if v_before.request_kind='annual_leave' and v_before.status='approved' then v_days:=(v_before.end_date-v_before.start_date)+1; insert into public.staff_leave_ledger(staff_id,leave_year,leave_type,entry_type,days_delta,request_id,policy_version,reason,actor_id,actor_name,idempotency_key) values(v_before.staff_id,extract(year from v_before.start_date)::int,'annual_leave','restore',v_days,v_before.id,'annual_leave_v1',p_reason,v_actor,v_actor_name,'annual_leave_restore:'||v_before.id::text) on conflict(idempotency_key) do nothing; end if;
  return v_after;
end; $$;
revoke all on function public.cancel_staff_time_off_request_v1(uuid,text) from public;
grant execute on function public.cancel_staff_time_off_request_v1(uuid,text) to anon,authenticated,service_role;

create or replace function public.get_permission_policy_status_v2(p_staff_id uuid,p_cycle_start date,p_cycle_end date)
returns jsonb language plpgsql stable security definer set search_path='public','pg_catalog'
as $$
declare v_self uuid:=public.dawaa_current_staff_subject_uuid_v1(); v_manage boolean:=public.dawaa_can_manage_time_off_v1(); v_count integer; v_minutes integer; v_over integer; v_policy jsonb:=public.get_attendance_policy_v1(p_cycle_end); v_limit integer:=coalesce((v_policy->>'permission_limit_per_cycle')::int,2); v_max integer:=coalesce((v_policy->>'permission_max_minutes')::int,120);
begin
  if not v_manage and (v_self is null or p_staff_id<>v_self) then raise exception 'not_authorized_for_permission_status' using errcode='42501'; end if;
  select count(*),coalesce(sum(duration_minutes),0),count(*) filter(where duration_minutes>v_max) into v_count,v_minutes,v_over from public.staff_time_off_requests where staff_id=p_staff_id and request_kind='permission' and status='approved' and start_date between p_cycle_start and p_cycle_end;
  return jsonb_build_object('staff_id',p_staff_id,'approved_permissions',v_count,'allowance',v_limit,'remaining',greatest(0,v_limit-v_count),'exceeded_count',greatest(0,v_count-v_limit),'total_minutes',v_minutes,'max_minutes_per_permission',v_max,'over_duration_count',v_over,'requires_manager_review',(v_count>v_limit or v_over>0),'policy_version',coalesce(v_policy->>'policy_code','attendance_policy_v1'));
end; $$;
revoke all on function public.get_permission_policy_status_v2(uuid,date,date) from public;
grant execute on function public.get_permission_policy_status_v2(uuid,date,date) to anon,authenticated,service_role;

create or replace function public.get_annual_leave_balance_v1(p_staff_id uuid,p_year integer)
returns jsonb language plpgsql stable security definer set search_path='public','pg_catalog'
as $$
declare v_self uuid:=public.dawaa_current_staff_subject_uuid_v1(); v_manage boolean:=public.dawaa_can_manage_time_off_v1(); v_balance numeric; v_used numeric; v_reserved numeric;
begin
  if not v_manage and (v_self is null or p_staff_id<>v_self) then raise exception 'not_authorized_for_leave_balance' using errcode='42501'; end if;
  select coalesce(sum(days_delta),0),coalesce(-sum(days_delta) filter(where entry_type='consumed'),0),coalesce(-sum(days_delta) filter(where entry_type='reserved'),0) into v_balance,v_used,v_reserved from public.staff_leave_ledger where staff_id=p_staff_id and leave_year=p_year and leave_type='annual_leave';
  return jsonb_build_object('staff_id',p_staff_id,'year',p_year,'balance',coalesce(v_balance,0),'used',coalesce(v_used,0),'reserved',coalesce(v_reserved,0),'policy_version','annual_leave_v1');
end; $$;
revoke all on function public.get_annual_leave_balance_v1(uuid,integer) from public;
grant execute on function public.get_annual_leave_balance_v1(uuid,integer) to anon,authenticated,service_role;

-- Import only historical non-weekly-off exceptions into the canonical domain.
with legacy as (
  select e.*,
    case when e.type ilike '%إذن%' then 'permission' when e.type ilike '%إجازة%' and coalesce(e.reason,'') ilike '%سنوي%' then 'annual_leave' when e.type ilike '%إجازة مرض%' then 'sick_leave' when e.type ilike '%إجازة%' then 'exceptional_leave' when e.type ilike '%تبديل%' then 'shift_swap' when e.type ilike '%غياب%' then 'approved_absence' else null end request_kind,
    coalesce((select s.id from public.staff s where lower(trim(s.name))=lower(trim(coalesce(e.staff_name,e.employee_name,''))) order by (s.branch=e.branch) desc,s.active desc nulls last limit 1),(select s2.id from public.staff_accounts sa join public.staff s2 on s2.id::text=sa.staff_id::text where lower(trim(coalesce(sa.staff_name,sa.name,sa.username,'')))=lower(trim(coalesce(e.staff_name,e.employee_name,''))) order by (sa.branch=e.branch) desc,coalesce(sa.active,true) desc limit 1)) canonical_staff_id
  from public.shift_exceptions e where coalesce(e.type,'')<>'weekly_off' and e.date is not null
), parsed as (
  select l.*,coalesce((regexp_match(coalesce(l.reason,''),'\[من ([0-9]{4}-[0-9]{2}-[0-9]{2}) إلى ([0-9]{4}-[0-9]{2}-[0-9]{2})\]'))[2]::date,l.date) parsed_end_date from legacy l
)
insert into public.staff_time_off_requests(staff_id,staff_name_snapshot,branch_snapshot,request_kind,request_label,status,start_date,end_date,start_time,end_time,duration_minutes,reason,policy_version,source,legacy_source,legacy_id,metadata,created_at,updated_at)
select p.canonical_staff_id,coalesce(s.name,p.staff_name,p.employee_name),coalesce(p.branch,s.branch),p.request_kind,p.type,case when p.status in ('approved','rejected','pending') then p.status else 'pending' end,p.date,p.parsed_end_date,case when coalesce(p.start_time,'')~'^([01][0-9]|2[0-3]):[0-5][0-9]' then p.start_time::time else null end,case when coalesce(p.end_time,'')~'^([01][0-9]|2[0-3]):[0-5][0-9]' then p.end_time::time else null end,p.duration_minutes,p.reason,'legacy_import_v1','legacy','shift_exceptions',p.id,jsonb_build_object('legacy_deduct_points',p.deduct_points,'legacy_deduction_points',p.deduction_points,'legacy_deduction_status',p.deduction_status,'legacy_source',p.source),p.created_at,p.updated_at
from parsed p join public.staff s on s.id=p.canonical_staff_id where p.request_kind is not null and p.canonical_staff_id is not null
on conflict(legacy_source,legacy_id) where legacy_source is not null and legacy_id is not null do nothing;
