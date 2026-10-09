-- Isolated rehearsal — attendance materializer and payroll finalization surfaces touched by
-- 20261009070000 (materialize guard) and 20261009070500 (standard payroll finalize preview route).
-- Verbatim from production on 2026-10-09: materialize_attendance_range_v2 (md5 42216198…, unguarded),
-- dawaa_actor_is_top_management_v1 and finalize_payroll_snapshot_v2 (md5 6e7a0ac8…).
-- Stubs (not production code): the route-aware materializer (records its calls), the payroll scope helper,
-- the resolution fingerprint and both compare functions. The compare stubs encode the production defect:
-- v1 (preview_v1) never matches a snapshot staged from preview_v2 (payload has preview_route); v2 does.
set client_min_messages = warning;
set check_function_bodies = off;

alter table public.staff_accounts add column name text;

create table public.ops_materialize_calls (id bigserial primary key, p_start date, p_end date, p_branch text, at timestamptz default now());
revoke all on public.ops_materialize_calls from anon, authenticated;
create function public.dawaa_materialize_attendance_range_route_aware_v1(p_start date, p_end date, p_branch text default null)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_catalog' as $$
begin
  insert into public.ops_materialize_calls(p_start, p_end, p_branch) values (p_start, p_end, p_branch);
  return jsonb_build_object('schema', 'stub_route_aware_materializer', 'start', p_start, 'end', p_end);
end $$;
revoke all on function public.dawaa_materialize_attendance_range_route_aware_v1(date,date,text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.dawaa_actor_is_top_management_v1()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.staff_accounts sa
    where sa.id = public.dawaa_current_staff_account_id_strict()
      and lower(trim(coalesce(sa.role, ''))) in ('general_manager', 'executive_manager', 'branches_manager', 'admin')
  );
$function$;

CREATE OR REPLACE FUNCTION public.materialize_attendance_range_v2(p_start date, p_end date, p_branch text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select public.dawaa_materialize_attendance_range_route_aware_v1(p_start,p_end,p_branch)
$function$;
revoke all on function public.materialize_attendance_range_v2(date,date,text) from public;
grant execute on function public.materialize_attendance_range_v2(date,date,text) to anon, authenticated, service_role;

-- ---- payroll finalization ----
create table public.payroll_final_snapshot_staging (
  id uuid primary key, staff_id uuid, staff_username text, staff_name text, branch text, month_cycle text,
  cycle_start date, cycle_end date, finalization_ready boolean, snapshot_fingerprint text, payload jsonb, created_at timestamptz default now()
);
create table public.payroll_snapshot_reviews (id uuid primary key default gen_random_uuid(), snapshot_id uuid, decision text, created_at timestamptz default now());
create table public.payroll_finalized_snapshots_v2 (
  id uuid primary key default gen_random_uuid(), snapshot_id uuid, staff_id uuid, staff_username text, staff_name text, branch text,
  month_cycle text, cycle_start date, cycle_end date, snapshot_fingerprint text, payload jsonb, finalized_by uuid, finalized_by_name text,
  unique (staff_id, month_cycle)
);
create table public.staff_overtime_approvals (id uuid primary key default gen_random_uuid(), staff_id uuid, attendance_date date, status text,
  source_resolution_id uuid, source_resolution_fingerprint text);
revoke all on public.payroll_final_snapshot_staging, public.payroll_snapshot_reviews, public.payroll_finalized_snapshots_v2, public.staff_overtime_approvals from anon, authenticated;

create function public.dawaa_can_manage_payroll_staff_v1(p_username text) returns boolean language sql stable as $$ select true $$;
create function public.attendance_resolution_fingerprint_v2(p_id uuid) returns text language sql stable as $$ select null::text $$;
create function public.compare_payroll_final_snapshot_v1(p_snapshot_id uuid) returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog' as $$
  select jsonb_build_object('compare', 'v1', 'unchanged', not (s.payload ? 'preview_route'), 'current_ready', true)
  from public.payroll_final_snapshot_staging s where s.id = p_snapshot_id $$;
create function public.compare_payroll_final_snapshot_v2(p_snapshot_id uuid) returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog' as $$
  select jsonb_build_object('compare', 'v2', 'unchanged', (s.payload ? 'preview_route'), 'current_ready', true)
  from public.payroll_final_snapshot_staging s where s.id = p_snapshot_id $$;

CREATE OR REPLACE FUNCTION public.finalize_payroll_snapshot_v2(p_snapshot_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_actor public.staff_accounts%rowtype; v_snapshot public.payroll_final_snapshot_staging%rowtype;
  v_compare jsonb; v_review public.payroll_snapshot_reviews%rowtype;
  v_existing public.payroll_finalized_snapshots_v2%rowtype; v_final public.payroll_finalized_snapshots_v2%rowtype;
  v_stale_overtime integer:=0;
begin
  if p_snapshot_id is null then raise exception 'snapshot_id_required' using errcode='22023'; end if;
  select * into v_actor from public.staff_accounts where id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false)=true and coalesce(can_login,false)=true;
  if not found or coalesce(v_actor.role,'') not in ('general_manager','executive_manager')
     or not public.dawaa_current_actor_can(array['manage_payroll']) then
    raise exception 'not_authorized_for_payroll_finalization' using errcode='42501';
  end if;
  select * into v_snapshot from public.payroll_final_snapshot_staging where id=p_snapshot_id;
  if not found then raise exception 'snapshot_not_found' using errcode='22023'; end if;
  if not public.dawaa_can_manage_payroll_staff_v1(v_snapshot.staff_username) then
    raise exception 'not_authorized_for_payroll_staff' using errcode='42501';
  end if;
  select count(*)::int into v_stale_overtime
  from public.staff_overtime_approvals o
  left join public.attendance_daily_summary a on a.id=o.source_resolution_id
  where o.staff_id=v_snapshot.staff_id and o.attendance_date between v_snapshot.cycle_start and v_snapshot.cycle_end
    and o.status='approved' and (
      o.source_resolution_id is null or a.id is null or a.status<>'approved'
      or public.attendance_resolution_fingerprint_v2(a.id) is distinct from o.source_resolution_fingerprint
    );
  if v_stale_overtime>0 then
    raise exception 'stale_approved_overtime_blocks_payroll_finalization: %',v_stale_overtime using errcode='55000';
  end if;
  select * into v_existing from public.payroll_finalized_snapshots_v2
  where staff_id=v_snapshot.staff_id and month_cycle=v_snapshot.month_cycle;
  if found then
    if v_existing.snapshot_fingerprint=v_snapshot.snapshot_fingerprint then
      return jsonb_build_object('success',true,'existing',true,'finalized',to_jsonb(v_existing),'paid',false,'financial_effect','none');
    end if;
    raise exception 'payroll_cycle_already_finalized_with_different_snapshot' using errcode='55000';
  end if;
  select * into v_review from public.payroll_snapshot_reviews where snapshot_id=p_snapshot_id order by created_at desc,id desc limit 1;
  if not found or v_review.decision<>'approved' then raise exception 'latest_snapshot_review_must_be_approved' using errcode='22023'; end if;
  v_compare:=public.compare_payroll_final_snapshot_v1(p_snapshot_id);
  if coalesce(v_snapshot.finalization_ready,false) is not true
     or coalesce((v_compare->>'unchanged')::boolean,false) is not true
     or coalesce((v_compare->>'current_ready')::boolean,false) is not true then
    raise exception 'snapshot_changed_or_blocked_before_finalization' using errcode='55000';
  end if;
  insert into public.payroll_finalized_snapshots_v2(
    snapshot_id,staff_id,staff_username,staff_name,branch,month_cycle,cycle_start,cycle_end,
    snapshot_fingerprint,payload,finalized_by,finalized_by_name
  ) values(
    v_snapshot.id,v_snapshot.staff_id,v_snapshot.staff_username,v_snapshot.staff_name,v_snapshot.branch,
    v_snapshot.month_cycle,v_snapshot.cycle_start,v_snapshot.cycle_end,v_snapshot.snapshot_fingerprint,
    v_snapshot.payload,v_actor.id,coalesce(v_actor.name,v_actor.username)
  ) returning * into v_final;
  return jsonb_build_object('success',true,'existing',false,'finalized',to_jsonb(v_final),
    'review',to_jsonb(v_review),'comparison',v_compare,'stale_approved_overtime',v_stale_overtime,'paid',false,'financial_effect','none');
end; $function$;
