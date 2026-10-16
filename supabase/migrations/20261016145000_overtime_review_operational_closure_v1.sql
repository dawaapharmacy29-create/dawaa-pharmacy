-- Overtime review operational closure: managers can decide overtime from the app and review stale approvals.
--
-- Production (2026-10-16, read-only review):
--   * The overtime center calls decide_overtime_approval_v3, but only authenticated/service_role may execute it. Every
--     app request runs as anon with a verified staff session, so the decision button is refused (42501) and every
--     approval so far was written outside the app. v3 authorizes internally: verified staff session (active, can_login),
--     manage_payroll, and the per-staff payroll scope (branch managers only their branch). EXECUTE for anon is therefore
--     the same contract as the other session-verified decision RPCs; the function is unchanged.
--   * The 14 stale approvals are status 'approved', and v3 only decides 'pending' rows: no in-app path can confirm,
--     adjust, reject or send them back for recalculation.
--   * Payroll readiness does not show stale approved overtime, which finalize_payroll_snapshot_v2 refuses only at the
--     last step. payroll_finalization_gate_current_v1 is not changed here: Production runs a fail-open version while the
--     repository's fail-closed version (20261009121500) is not applied, so the payroll panel reads the review queue
--     below instead and keeps finalization disabled while it is not empty.
--
-- This migration:
--   1. grants EXECUTE on decide_overtime_approval_v3 to anon (definition unchanged, hash-guarded);
--   2. list_stale_overtime_approvals_v1: the review queue (approved rows that no longer match attendance truth), with
--      the current truth, stale reason, fingerprint state, source and last decision; scoped per staff by
--      dawaa_can_manage_payroll_staff_id_v1; no suggestion value is computed (recalculation stays in v3);
--   3. review_stale_overtime_approval_v1: one manager decision per stale approved row: confirm (keep the decided values,
--      re-link to the current approved truth), adjust (manager-entered minutes/amount/multiplier), reject, or
--      recalculate (back to pending so v3 recomputes from current truth). Same authorization as v3, a note is required,
--      finalized cycles are refused, the decision note of rows that stay approved is not rewritten (the delivery
--      multiplier is read from it) and the review is recorded in the evidence snapshot. No points are written: the
--      overtime reward sync rebuilds from fresh approvals.
-- No row is changed by this migration; the 14 stale approvals wait for manager decisions.

do $guard$
begin
  if md5(btrim(regexp_replace(pg_get_functiondef('public.decide_overtime_approval_v3(uuid,text,text)'::regprocedure), '\s+', ' ', 'g')))
       <> '8c739c78aa528c4d704951df5dc19342' then
    raise exception 'decide_overtime_approval_v3 differs from the reviewed definition; regenerate this migration';
  end if;
  if md5(btrim(regexp_replace(pg_get_functiondef('public.attendance_resolution_fingerprint_v2(uuid)'::regprocedure), '\s+', ' ', 'g')))
       <> 'cfaeb51614c3cf5e4f3df0a9b3439681' then
    raise exception 'attendance_resolution_fingerprint_v2 differs from the reviewed definition; regenerate this migration';
  end if;
  if to_regprocedure('public.dawaa_can_manage_payroll_staff_id_v1(uuid)') is null
     or to_regprocedure('public.dawaa_overtime_multiplier_from_approval_v1(jsonb,text)') is null
     or to_regprocedure('public.dawaa_staff_uses_delivery_finance_v1(uuid)') is null
     or to_regprocedure('public.dawaa_pay_cycle_bounds_v1(date)') is null then
    raise exception 'overtime review dependencies are missing';
  end if;
end;
$guard$;

grant execute on function public.decide_overtime_approval_v3(uuid,text,text) to anon;

create or replace function public.list_stale_overtime_approvals_v1(p_month_cycle text default null, p_branch text default null)
returns table(
  id uuid, staff_id uuid, staff_name text, branch text, attendance_date date, month_cycle text,
  overtime_minutes integer, overtime_hours numeric, hourly_rate numeric, overtime_amount numeric, amount_missing boolean,
  multiplier numeric, is_delivery boolean, stale_reason text, fingerprint_state text,
  approval_source text, decided_by_name text, decided_at timestamptz, decision_note text,
  truth_resolution_id uuid, truth_status text, truth_resolution_status text, truth_first_in timestamptz,
  truth_last_out timestamptz, truth_scheduled_start_at timestamptz, truth_scheduled_end_at timestamptz,
  truth_payroll_eligible_hours numeric, truth_policy_version text, recalculate_available boolean, payroll_finalized boolean
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_bounds record;
begin
  if p_month_cycle is not null and coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_stale_overtime_review_input' using errcode='22023';
  end if;
  if not exists (
       select 1 from public.staff_accounts sa
       where sa.id=public.dawaa_current_staff_account_id_strict() and coalesce(sa.active,false) and coalesce(sa.can_login,false))
     or not public.dawaa_current_actor_can(array['manage_payroll']) then
    raise exception 'not_authorized_for_overtime_review' using errcode='42501';
  end if;
  select * into v_bounds from public.dawaa_pay_cycle_bounds_v1(
    case when p_month_cycle is null then null else to_date(p_month_cycle||'-25','YYYY-MM-DD') end);

  return query
  select o.id, o.staff_id, o.staff_name, o.branch, o.attendance_date, v_bounds.month_cycle,
    round(coalesce(o.overtime_hours,0)*60)::integer, o.overtime_hours, o.hourly_rate, o.overtime_amount, o.overtime_amount is null,
    public.dawaa_overtime_multiplier_from_approval_v1(o.decision_evidence_snapshot,o.decision_note),
    coalesce(public.dawaa_staff_uses_delivery_finance_v1(o.staff_id),false),
    case when o.source_resolution_id is null then 'no_attendance_link'
         when a.id is null then 'linked_attendance_missing'
         when a.status<>'approved' then 'linked_attendance_not_approved'
         when o.source_resolution_fingerprint is null then 'fingerprint_missing'
         else 'fingerprint_diverged' end,
    case when o.source_resolution_fingerprint is null then 'missing' else 'diverged' end,
    o.decision_evidence_version, o.decided_by_name, o.decided_at, o.decision_note,
    t.id, t.status, t.resolution_status, t.first_in, t.last_out, t.scheduled_start_at, t.scheduled_end_at,
    t.payroll_eligible_hours, t.policy_version,
    coalesce(t.status='approved' and coalesce(t.resolution_version,0)>=2
      and t.resolution_status in ('on_time','late','very_late','on_time_with_permission','worked_on_off')
      and t.scheduled_start_at is not null and t.scheduled_end_at is not null
      and exists (select 1 from public.employee_compensation_profiles cp
                  where cp.staff_id=o.staff_id::text and coalesce(cp.active,true) and coalesce(cp.hourly_rate,0)>0
                    and not coalesce(cp.exempt_from_lateness_deduction,false)), false),
    exists (select 1 from public.payroll_finalized_snapshots_v2 f where f.staff_id=o.staff_id and f.month_cycle=v_bounds.month_cycle)
  from public.staff_overtime_approvals o
  left join public.attendance_daily_summary a on a.id=o.source_resolution_id
  left join lateral (
    select s.* from public.attendance_daily_summary s
    where s.staff_id=o.staff_id and s.attendance_date=o.attendance_date
    order by (s.status='approved') desc, coalesce(s.resolution_version,0) desc, s.updated_at desc nulls last, s.created_at desc
    limit 1
  ) t on true
  where o.status='approved'
    and o.attendance_date between v_bounds.cycle_start and v_bounds.cycle_end
    and (o.source_resolution_id is null or a.id is null or a.status<>'approved'
      or public.attendance_resolution_fingerprint_v2(a.id) is distinct from o.source_resolution_fingerprint)
    and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or trim(coalesce(o.branch,''))=trim(p_branch))
    and public.dawaa_can_manage_payroll_staff_id_v1(o.staff_id)
  order by o.attendance_date, o.staff_name;
end;
$function$;
revoke all on function public.list_stale_overtime_approvals_v1(text,text) from public;
grant execute on function public.list_stale_overtime_approvals_v1(text,text) to anon, authenticated, service_role;

create or replace function public.review_stale_overtime_approval_v1(
  p_id uuid, p_decision text, p_note text,
  p_overtime_minutes integer default null, p_overtime_amount numeric default null, p_multiplier numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor public.staff_accounts%rowtype;
  v_ot public.staff_overtime_approvals%rowtype;
  v_link public.attendance_daily_summary%rowtype;
  v_truth public.attendance_daily_summary%rowtype;
  v_decision text:=lower(trim(coalesce(p_decision,'')));
  v_note text:=nullif(trim(coalesce(p_note,'')),'');
  v_cycle record;
  v_review jsonb;
  v_fingerprint text;
  v_status text;
begin
  if v_decision not in ('confirm','adjust','reject','recalculate') then
    raise exception 'invalid_stale_overtime_decision' using errcode='22023';
  end if;
  if v_note is null then
    raise exception 'stale_overtime_review_note_required' using errcode='22023';
  end if;

  select * into v_actor from public.staff_accounts
  where id=public.dawaa_current_staff_account_id_strict() and coalesce(active,false)=true and coalesce(can_login,false)=true;
  if not found or not public.dawaa_current_actor_can(array['manage_payroll']) then
    raise exception 'not_authorized_for_overtime_review' using errcode='42501';
  end if;

  select * into v_ot from public.staff_overtime_approvals where id=p_id for update;
  if not found then
    raise exception 'overtime_not_found' using errcode='22023';
  end if;
  if not public.dawaa_can_manage_payroll_staff_id_v1(v_ot.staff_id) then
    raise exception 'not_authorized_for_overtime_staff' using errcode='42501';
  end if;

  select * into v_link from public.attendance_daily_summary where id=v_ot.source_resolution_id;
  if v_ot.status<>'approved'
     or (v_ot.source_resolution_id is not null and found and v_link.status='approved'
         and public.attendance_resolution_fingerprint_v2(v_link.id) is not distinct from v_ot.source_resolution_fingerprint) then
    raise exception 'overtime_not_stale_approved' using errcode='55000';
  end if;

  select * into v_cycle from public.dawaa_pay_cycle_bounds_v1(v_ot.attendance_date);
  if exists (select 1 from public.payroll_finalized_snapshots_v2 f where f.staff_id=v_ot.staff_id and f.month_cycle=v_cycle.month_cycle) then
    raise exception 'payroll_already_finalized_for_cycle' using errcode='55000';
  end if;

  select * into v_truth from public.attendance_daily_summary s
  where s.staff_id=v_ot.staff_id and s.attendance_date=v_ot.attendance_date
  order by (s.status='approved') desc, coalesce(s.resolution_version,0) desc, s.updated_at desc nulls last, s.created_at desc
  limit 1;
  if v_decision in ('confirm','adjust') and (not found or v_truth.status<>'approved') then
    raise exception 'overtime_requires_approved_attendance_truth' using errcode='55000';
  end if;
  if v_decision='adjust' and (coalesce(p_overtime_minutes,0)<=0 or coalesce(p_overtime_amount,0)<0 or coalesce(p_multiplier,1)<=0) then
    raise exception 'invalid_stale_overtime_adjustment' using errcode='22023';
  end if;
  v_fingerprint:=case when v_truth.id is not null and v_truth.status='approved'
                      then public.attendance_resolution_fingerprint_v2(v_truth.id) end;

  v_review:=jsonb_build_object(
    'decision',v_decision,'note',v_note,'reviewed_by',v_actor.id,'reviewed_by_name',coalesce(v_actor.name,v_actor.username),
    'reviewed_at',now(),'truth_resolution_id',v_truth.id,'truth_fingerprint',v_fingerprint,
    'previous',jsonb_build_object(
      'status',v_ot.status,'overtime_hours',v_ot.overtime_hours,'hourly_rate',v_ot.hourly_rate,'overtime_amount',v_ot.overtime_amount,
      'source_resolution_id',v_ot.source_resolution_id,'source_resolution_fingerprint',v_ot.source_resolution_fingerprint,
      'decided_by',v_ot.decided_by,'decided_by_name',v_ot.decided_by_name,'decided_at',v_ot.decided_at,
      'decision_evidence_version',v_ot.decision_evidence_version));

  if v_decision in ('confirm','adjust') then
    update public.staff_overtime_approvals
    set source_resolution_id=v_truth.id,
        source_resolution_fingerprint=v_fingerprint,
        source_resolution_linked_at=now(),
        overtime_hours=case when v_decision='adjust' then round(p_overtime_minutes/60.0,2) else overtime_hours end,
        overtime_amount=case when v_decision='adjust' then p_overtime_amount else overtime_amount end,
        decided_at=now(),
        decided_by=v_actor.id::text,
        decided_by_name=coalesce(v_actor.name,v_actor.username),
        decision_evidence_snapshot=coalesce(decision_evidence_snapshot,'{}'::jsonb)
          || case when v_decision='adjust' and p_multiplier is not null then jsonb_build_object('multiplier',p_multiplier) else '{}'::jsonb end
          || jsonb_build_object('stale_review',v_review),
        decision_evidence_version='stale_review_v1',
        updated_at=now()
    where id=p_id;
    v_status:='approved';
  elsif v_decision='reject' then
    update public.staff_overtime_approvals
    set status='rejected',
        decided_at=now(),
        decided_by=v_actor.id::text,
        decided_by_name=coalesce(v_actor.name,v_actor.username),
        decision_note=concat_ws(' | ',nullif(trim(coalesce(decision_note,'')),''),'مراجعة المدير: '||v_note),
        decision_evidence_snapshot=coalesce(decision_evidence_snapshot,'{}'::jsonb) || jsonb_build_object('stale_review',v_review),
        decision_evidence_version='stale_review_v1',
        updated_at=now()
    where id=p_id;
    v_status:='rejected';
  else
    update public.staff_overtime_approvals
    set status='pending',
        source_resolution_id=coalesce(v_truth.id,source_resolution_id),
        source_resolution_fingerprint=v_fingerprint,
        source_resolution_linked_at=case when v_fingerprint is null then null else now() end,
        decided_at=null,
        decided_by=null,
        decided_by_name=null,
        decision_evidence_snapshot=coalesce(decision_evidence_snapshot,'{}'::jsonb) || jsonb_build_object('stale_review',v_review),
        decision_evidence_version='stale_review_v1',
        updated_at=now()
    where id=p_id;
    v_status:='pending';
  end if;

  return jsonb_build_object('success',true,'id',p_id,'decision',v_decision,'status',v_status,
    'fingerprint_fresh',v_status='approved','truth_resolution_id',v_truth.id);
end;
$function$;
revoke all on function public.review_stale_overtime_approval_v1(uuid,text,text,integer,numeric,numeric) from public;
grant execute on function public.review_stale_overtime_approval_v1(uuid,text,text,integer,numeric,numeric) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
