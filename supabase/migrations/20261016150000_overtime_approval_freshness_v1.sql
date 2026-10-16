-- Overtime approval freshness: an approval is only valid against the attendance truth it was decided on.
--
-- Production (2026-10-16, read-only review): 14 approved overtime rows in cycle 2026-10 no longer match attendance truth
-- (10 without a fingerprint, 4 with a fingerprint that diverged). Every approved row in Production was written outside
-- the decision RPCs (decided_by is never a staff account; no 'overtime_evidence_v3' row exists), so the RPCs' own
-- fingerprint and drift checks never ran. Separately, the invalidation trigger does not watch every fingerprint input:
-- policy_version is rewritten on approved days by the dirty-day reconciler (cron attendance-dirty-queue-v1), which left
-- approvals stale without invalidation. Only finalize_payroll_snapshot_v2 refuses stale approvals: the delivery route of
-- finalize_payroll_snapshot_v3 finalizes without that check while dawaa_delivery_hours_truth_v1 pays approved overtime.
--
-- This migration adds invariants only; it changes no row, no RPC, no grant and no payroll formula:
--   1. dawaa_stale_approved_overtime_count_v1(staff, start, end): the existing stale predicate
--      (finalize_payroll_snapshot_v2 / hr_canonical_architecture_health_v1), internal (service_role).
--   2. staff_overtime_approvals BEFORE INSERT/UPDATE guard: a write that makes a row approved, or changes an approved
--      row's staff, date, hours, rate, amount, source or fingerprint, must reference an approved attendance day of the
--      same staff and date whose current fingerprint equals the stored one. Every writer (RPC, cron, manual SQL) is
--      covered. Writes that leave those fields unchanged (notes, evidence, status back to pending/rejected) and all
--      existing rows are untouched.
--   3. hr_invalidate_overtime_on_attendance_change_v1 watches every attendance_resolution_fingerprint_v2 input
--      (adds policy_version and the row identity id/staff_id/attendance_date) and keeps scheduled_start_at and
--      scheduled_end_at, which are not fingerprint inputs but set the overtime window the decision computes from.
--      Invalidated approvals and their overtime points are matched by the OLD identity (same as Production when the
--      identity is unchanged). Exact Production text otherwise.
--   4. payroll_finalized_snapshots_v2 BEFORE INSERT guard: the same refusal finalize_payroll_snapshot_v2 already
--      raises ('stale_approved_overtime_blocks_payroll_finalization'), now for every finalization route.
-- The 14 existing stale approvals stay as they are; they go to manager review (no automatic decision).

do $guard$
begin
  if to_regclass('public.staff_overtime_approvals') is null or to_regclass('public.attendance_daily_summary') is null
     or to_regclass('public.payroll_finalized_snapshots_v2') is null then
    raise exception 'overtime freshness dependencies are missing';
  end if;
  if md5(btrim(regexp_replace(pg_get_functiondef('public.attendance_resolution_fingerprint_v2(uuid)'::regprocedure), '\s+', ' ', 'g')))
       <> 'cfaeb51614c3cf5e4f3df0a9b3439681' then
    raise exception 'attendance_resolution_fingerprint_v2 differs from the reviewed definition; regenerate this migration';
  end if;
  if md5(btrim(regexp_replace(pg_get_functiondef(to_regprocedure('public.hr_invalidate_overtime_on_attendance_change_v1()')), '\s+', ' ', 'g')))
       not in ('c9723912ef74593485fbf2dcd6bb952e', '267d035f40631f580912320d790185e1') then
    raise exception 'hr_invalidate_overtime_on_attendance_change_v1 differs from the reviewed definition; regenerate this migration';
  end if;
  if (select pg_get_triggerdef(t.oid) from pg_trigger t
      where t.tgrelid = 'public.attendance_daily_summary'::regclass and t.tgname = 'trg_hr_invalidate_overtime_on_attendance_change_v1')
     not in ('CREATE TRIGGER trg_hr_invalidate_overtime_on_attendance_change_v1 AFTER UPDATE OF status, schedule_id, scheduled_start_at, scheduled_end_at, first_in, last_out, candidate_hours, payroll_eligible_hours, late_minutes, early_leave_minutes, resolution_status, time_off_request_id ON public.attendance_daily_summary FOR EACH ROW EXECUTE FUNCTION hr_invalidate_overtime_on_attendance_change_v1()', 'CREATE TRIGGER trg_hr_invalidate_overtime_on_attendance_change_v1 AFTER UPDATE OF status, schedule_id, scheduled_start_at, scheduled_end_at, first_in, last_out, candidate_hours, payroll_eligible_hours, late_minutes, early_leave_minutes, resolution_status, time_off_request_id, policy_version, id, staff_id, attendance_date ON public.attendance_daily_summary FOR EACH ROW EXECUTE FUNCTION hr_invalidate_overtime_on_attendance_change_v1()') then
    raise exception 'trg_hr_invalidate_overtime_on_attendance_change_v1 differs from the reviewed definition; regenerate this migration';
  end if;
end;
$guard$;

create or replace function public.dawaa_stale_approved_overtime_count_v1(p_staff_id uuid, p_start date, p_end date)
returns integer
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select count(*)::integer
  from public.staff_overtime_approvals o
  left join public.attendance_daily_summary a on a.id=o.source_resolution_id
  where o.staff_id=p_staff_id and o.attendance_date between p_start and p_end
    and o.status='approved' and (
      o.source_resolution_id is null or a.id is null or a.status<>'approved'
      or public.attendance_resolution_fingerprint_v2(a.id) is distinct from o.source_resolution_fingerprint
    );
$function$;
revoke all on function public.dawaa_stale_approved_overtime_count_v1(uuid,date,date) from public, anon, authenticated;
grant execute on function public.dawaa_stale_approved_overtime_count_v1(uuid,date,date) to service_role;

create or replace function public.dawaa_overtime_approval_freshness_guard_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_day public.attendance_daily_summary%rowtype;
begin
  if new.status is distinct from 'approved' then
    return new;
  end if;
  if tg_op='UPDATE' and old.status='approved'
     and row(new.staff_id,new.attendance_date,new.overtime_hours,new.hourly_rate,new.overtime_amount,
             new.source_resolution_id,new.source_resolution_fingerprint)
         is not distinct from
         row(old.staff_id,old.attendance_date,old.overtime_hours,old.hourly_rate,old.overtime_amount,
             old.source_resolution_id,old.source_resolution_fingerprint) then
    return new;
  end if;

  if new.source_resolution_id is null then
    raise exception 'overtime_approval_requires_attendance_truth: approved overtime must reference its attendance day'
      using errcode='55000';
  end if;
  select * into v_day from public.attendance_daily_summary a where a.id=new.source_resolution_id;
  if not found or v_day.status is distinct from 'approved'
     or v_day.staff_id is distinct from new.staff_id or v_day.attendance_date is distinct from new.attendance_date then
    raise exception 'overtime_approval_requires_attendance_truth: the referenced attendance day is not the approved truth of this staff and date'
      using errcode='55000';
  end if;
  if new.source_resolution_fingerprint is distinct from public.attendance_resolution_fingerprint_v2(v_day.id) then
    raise exception 'overtime_approval_requires_fresh_fingerprint: the stored fingerprint does not match the current attendance truth'
      using errcode='55000';
  end if;
  return new;
end;
$function$;
revoke all on function public.dawaa_overtime_approval_freshness_guard_v1() from public, anon, authenticated;

drop trigger if exists trg_overtime_approval_freshness_guard_v1 on public.staff_overtime_approvals;
create trigger trg_overtime_approval_freshness_guard_v1
  before insert or update on public.staff_overtime_approvals
  for each row execute function public.dawaa_overtime_approval_freshness_guard_v1();

CREATE OR REPLACE FUNCTION public.hr_invalidate_overtime_on_attendance_change_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_invalidated integer:=0;
  v_cycle record;
begin
  if old.status='approved'
     and (
       new.status is distinct from 'approved'
       or row(
         old.schedule_id,
         old.scheduled_start_at,
         old.scheduled_end_at,
         old.first_in,
         old.last_out,
         old.candidate_hours,
         old.payroll_eligible_hours,
         old.late_minutes,
         old.early_leave_minutes,
         old.resolution_status,
         old.time_off_request_id,
         old.policy_version,
         old.id,
         old.staff_id,
         old.attendance_date
       ) is distinct from row(
         new.schedule_id,
         new.scheduled_start_at,
         new.scheduled_end_at,
         new.first_in,
         new.last_out,
         new.candidate_hours,
         new.payroll_eligible_hours,
         new.late_minutes,
         new.early_leave_minutes,
         new.resolution_status,
         new.time_off_request_id,
         new.policy_version,
         new.id,
         new.staff_id,
         new.attendance_date
       )
     ) then

    update public.staff_overtime_approvals o
    set
      status='pending',
      decided_at=null,
      decided_by=null,
      decided_by_name=null,
      decision_note=concat_ws(
        ' | ',
        nullif(trim(coalesce(o.decision_note,'')),''),
        'أعيدت للمراجعة تلقائيًا بسبب تغيير Attendance Truth'
      ),
      source_resolution_fingerprint=null,
      source_resolution_linked_at=null,
      decision_evidence_snapshot=jsonb_build_object(
        'evidence_available',false,
        'reason','attendance_truth_changed_after_overtime_decision',
        'previous_evidence',coalesce(o.decision_evidence_snapshot,'{}'::jsonb),
        'invalidated_at',now()
      ),
      decision_evidence_version='attendance_truth_invalidated_v1',
      updated_at=now()
    where o.source_resolution_id=old.id
      and o.status='approved';

    get diagnostics v_invalidated = row_count;

    if v_invalidated>0 then
      select * into v_cycle
      from public.dawaa_pay_cycle_bounds_v1(old.attendance_date);

      delete from public.employee_transactions et
      where et.staff_id=old.staff_id
        and et.month_cycle=v_cycle.month_cycle
        and et.source in ('attendance_overtime_v1','attendance_overtime_v2');
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_hr_invalidate_overtime_on_attendance_change_v1 on public.attendance_daily_summary;
CREATE TRIGGER trg_hr_invalidate_overtime_on_attendance_change_v1 AFTER UPDATE OF status, schedule_id, scheduled_start_at, scheduled_end_at, first_in, last_out, candidate_hours, payroll_eligible_hours, late_minutes, early_leave_minutes, resolution_status, time_off_request_id, policy_version, id, staff_id, attendance_date ON public.attendance_daily_summary FOR EACH ROW EXECUTE FUNCTION public.hr_invalidate_overtime_on_attendance_change_v1();

create or replace function public.dawaa_block_stale_overtime_payroll_finalization_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_bounds record;
  v_stale integer;
begin
  select * into v_bounds from public.dawaa_pay_cycle_bounds_v1((new.month_cycle||'-25')::date);
  v_stale:=public.dawaa_stale_approved_overtime_count_v1(
    new.staff_id, coalesce(new.cycle_start, v_bounds.cycle_start), coalesce(new.cycle_end, v_bounds.cycle_end));
  if v_stale>0 then
    raise exception 'stale_approved_overtime_blocks_payroll_finalization: %',v_stale using errcode='55000';
  end if;
  return new;
end;
$function$;
revoke all on function public.dawaa_block_stale_overtime_payroll_finalization_v1() from public, anon, authenticated;

drop trigger if exists trg_block_stale_overtime_payroll_finalization_v1 on public.payroll_finalized_snapshots_v2;
create trigger trg_block_stale_overtime_payroll_finalization_v1
  before insert on public.payroll_finalized_snapshots_v2
  for each row execute function public.dawaa_block_stale_overtime_payroll_finalization_v1();

notify pgrst, 'reload schema';
