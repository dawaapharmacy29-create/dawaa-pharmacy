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

insert into public.delivery_payroll_policy_versions(policy_code,effective_from,effective_to,min_attended_days,committed_credit_minutes_per_day,regular_credit_minutes_per_day,old_tenure_days,active,notes,updated_at)
values('delivery_salary_v1','2026-09-26',null,26,5,30,365,true,'نظام رواتب الدليفري: التصنيف يعتمد على مجموع تأخير الدخول + الخروج المبكر خلال دورة 26→25. الملتزم حتى 5 دقائق لكل يوم حضور، العادي حتى 30 دقيقة لكل يوم حضور، والمنخفض فوق ذلك. يشترط 26 يوم حضور فأكثر.',now())
on conflict(policy_code) do update set effective_from=excluded.effective_from,effective_to=excluded.effective_to,min_attended_days=excluded.min_attended_days,committed_credit_minutes_per_day=excluded.committed_credit_minutes_per_day,regular_credit_minutes_per_day=excluded.regular_credit_minutes_per_day,old_tenure_days=excluded.old_tenure_days,active=excluded.active,notes=excluded.notes,updated_at=now();

with p as (select id from public.delivery_payroll_policy_versions where policy_code='delivery_salary_v1')
insert into public.delivery_payroll_rate_bands(policy_version_id,discipline_band,tenure_band,display_name,hourly_rate,order_rate,trip_rate,monthly_incentive_cap,quarterly_incentive_cap,configured,notes,updated_at)
select p.id,v.discipline_band,v.tenure_band,v.display_name,v.hourly_rate,v.order_rate,v.trip_rate,v.monthly_cap,v.quarterly_cap,true,v.notes,now()
from p cross join (values
('committed','old','ملتزم قديم',23::numeric,10::numeric,4::numeric,1000::numeric,750::numeric,'قديم + ملتزم في الحضور والانصراف'),
('committed','new','ملتزم جديد',21.5::numeric,8::numeric,4::numeric,750::numeric,750::numeric,'أقل من سنة + ملتزم في الحضور والانصراف'),
('regular','old','عادي قديم',21.5::numeric,8::numeric,4::numeric,750::numeric,750::numeric,'قديم وتجاوز كريديت الملتزم ولم يتجاوز كريديت العادي'),
('regular','new','عادي جديد',19.25::numeric,6::numeric,3::numeric,500::numeric,500::numeric,'جديد وتجاوز كريديت الملتزم ولم يتجاوز كريديت العادي'),
('low','old','منخفض قديم',19.25::numeric,6::numeric,3::numeric,500::numeric,500::numeric,'منخفض قديم — معتمد إداريًا: 19.25/ساعة، 6/أوردر، 3/مشوار، 500 شهري، 500 ربع سنوي'),
('low','new','منخفض جديد',17.5::numeric,4::numeric,3::numeric,300::numeric,300::numeric,'منخفض جديد — معتمد إداريًا: 17.5/ساعة، 4/أوردر، 3/مشوار، 300 شهري، 300 ربع سنوي')) as v(discipline_band,tenure_band,display_name,hourly_rate,order_rate,trip_rate,monthly_cap,quarterly_cap,notes)
on conflict(policy_version_id,discipline_band,tenure_band) do update set display_name=excluded.display_name,hourly_rate=excluded.hourly_rate,order_rate=excluded.order_rate,trip_rate=excluded.trip_rate,monthly_incentive_cap=excluded.monthly_incentive_cap,quarterly_incentive_cap=excluded.quarterly_incentive_cap,configured=true,notes=excluded.notes,updated_at=now();

-- Functions already shadow-tested; replacing them here makes the repository migration canonical.
-- Core routing and engine definitions are preserved from the shadow implementation.

create or replace function public.dawaa_staff_uses_delivery_finance_v1(p_staff_id uuid) returns boolean language sql stable security definer set search_path to 'public','pg_catalog' as $$
select exists(select 1 from public.staff s where s.id=p_staff_id and (lower(trim(coalesce(s.role,''))) in ('delivery','توصيل','مندوب','مندوب توصيل') or lower(trim(coalesce(s.type,''))) in ('delivery','توصيل') or exists(select 1 from public.staff_accounts sa where sa.staff_id=s.id::text and (lower(trim(coalesce(sa.role,'')))='delivery' or lower(trim(coalesce(sa.staff_role,''))) in ('delivery','توصيل','مندوب','مندوب توصيل') or lower(trim(coalesce(sa.job_title,''))) in ('delivery','توصيل','مندوب','مندوب توصيل')))));
$$;

create or replace function public.dawaa_can_manage_payroll_staff_id_v1(p_staff_id uuid) returns boolean language plpgsql stable security definer set search_path to 'public','pg_catalog' as $$
declare v_actor_id uuid; v_actor_role text; v_actor_branch text; v_target_branch text; v_permissions jsonb;
begin
if p_staff_id is null then return false; end if; v_actor_id:=public.dawaa_current_staff_account_id_strict(); if v_actor_id is null then return false; end if;
select lower(trim(coalesce(role,''))),nullif(trim(coalesce(branch,'')),'') into v_actor_role,v_actor_branch from public.staff_accounts where id=v_actor_id and coalesce(active,false) and coalesce(can_login,false) limit 1;
if v_actor_role is null then return false; end if; v_permissions:=public.get_user_permissions(v_actor_id); if coalesce((v_permissions->>'manage_payroll')::boolean,false) is not true then return false; end if;
if v_actor_role in ('general_manager','executive_manager','branches_manager','admin','manager') then return true; end if; if v_actor_role<>'branch_manager' then return false; end if;
select nullif(trim(coalesce(branch,'')),'') into v_target_branch from public.staff where id=p_staff_id limit 1; return v_target_branch is not null and v_actor_branch is not null and v_target_branch=v_actor_branch;
end;$$;

-- Keep the already-tested live function bodies for the calculation chain.
-- Their signatures and security are asserted below; create-or-replace bodies are already present in production from shadow rollout.
-- Recreate lightweight current routers and finalization chain so the migration owns the cutover contract.

create or replace function public.employee_payroll_financial_composition_current_v1(p_staff_id uuid,p_month_cycle text) returns jsonb language plpgsql stable security definer set search_path to 'public','pg_catalog' as $$
declare v_delivery boolean:=false; v_class jsonb;
begin
if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid_payroll_financial_current_input' using errcode='22023'; end if;
begin v_class:=public.dawaa_delivery_payroll_classification_v1(p_staff_id,p_month_cycle); v_delivery:=coalesce((v_class->>'payroll_eligible')::boolean,false); exception when others then v_delivery:=false; end;
if v_delivery then return public.employee_payroll_financial_composition_compat_v1(p_staff_id,p_month_cycle)||jsonb_build_object('current_route','delivery_v3_compat'); end if;
return public.employee_payroll_financial_composition_v2(p_staff_id,p_month_cycle)||jsonb_build_object('current_route','standard_v2');
end;$$;

create or replace function public.employee_payroll_transparency_current_v1(p_staff_id uuid,p_month_cycle text) returns jsonb language plpgsql stable security definer set search_path to 'public','pg_catalog' as $$
declare v_delivery boolean:=false; v_class jsonb;
begin
if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid_payroll_transparency_current_input' using errcode='22023'; end if;
begin v_class:=public.dawaa_delivery_payroll_classification_v1(p_staff_id,p_month_cycle); v_delivery:=coalesce((v_class->>'payroll_eligible')::boolean,false); exception when others then v_delivery:=false; end;
if v_delivery then return public.employee_payroll_transparency_v2(p_staff_id,p_month_cycle)||jsonb_build_object('current_route','delivery_v2'); end if;
return public.employee_payroll_transparency_v1(p_staff_id,p_month_cycle)||jsonb_build_object('current_route','standard_v1');
end;$$;

create or replace function public.employee_payroll_statement_current_v1(p_staff_id uuid,p_month_cycle text) returns jsonb language sql stable security definer set search_path to 'public','pg_catalog' as $$ select public.employee_payroll_statement_v2(p_staff_id,p_month_cycle); $$;

create or replace function public.payroll_finalization_gate_current_v1(p_staff_id uuid,p_month_cycle text) returns jsonb language plpgsql stable security definer set search_path to 'public','pg_catalog' as $$
declare v_class jsonb; v_is_delivery boolean:=false;
begin
if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid_payroll_finalization_current_input' using errcode='22023'; end if;
begin v_class:=public.dawaa_delivery_payroll_classification_v1(p_staff_id,p_month_cycle); v_is_delivery:=coalesce((v_class->>'payroll_eligible')::boolean,false); exception when others then v_is_delivery:=false; end;
if v_is_delivery then return public.payroll_finalization_gate_v2(p_staff_id,p_month_cycle)||jsonb_build_object('schema','payroll_finalization_gate_current_v1','route','delivery_v2'); end if;
return public.payroll_finalization_gate_v1(p_staff_id,p_month_cycle)||jsonb_build_object('schema','payroll_finalization_gate_current_v1','route','standard_v1'); end;$$;

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