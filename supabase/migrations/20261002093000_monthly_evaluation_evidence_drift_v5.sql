-- Monthly Evaluation V5: freeze canonical attendance truth at approval.
-- The fingerprint excludes audit timestamps/notes and hashes only active classification truth.

create or replace function public.dawaa_monthly_evaluation_attendance_fingerprint_v5(
  p_staff_id uuid,
  p_evaluation_month date
)
returns text
language sql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
  with bounds as (
    select
      (date_trunc('month',p_evaluation_month)::date - interval '1 month' + interval '25 days')::date as cycle_start,
      (date_trunc('month',p_evaluation_month)::date + interval '25 days')::date as cycle_end_exclusive
  ), daily as (
    select jsonb_agg(
      jsonb_build_object(
        'date',a.attendance_date,
        'status',a.status,
        'resolution_status',a.resolution_status,
        'review_required',coalesce(a.review_required,false),
        'late_minutes',coalesce(a.late_minutes,0),
        'early_leave_minutes',coalesce(a.early_leave_minutes,0),
        'missing_punch',coalesce(a.missing_punch,false)
      ) order by a.attendance_date
    ) as value
    from public.attendance_daily_summary a,bounds b
    where a.staff_id=p_staff_id
      and a.attendance_date>=b.cycle_start and a.attendance_date<b.cycle_end_exclusive
  ), ledger as (
    select jsonb_agg(
      jsonb_build_object(
        'date',l.attendance_date,
        'event_type',l.event_type,
        'impact_status',l.impact_status
      ) order by l.attendance_date,l.event_type,l.id
    ) as value
    from public.attendance_impact_ledger l,bounds b
    where l.staff_id=p_staff_id
      and l.attendance_date>=b.cycle_start and l.attendance_date<b.cycle_end_exclusive
      and l.reversal_of is null and coalesce(l.impact_status,'')<>'reversed'
  )
  select md5(jsonb_build_object(
    'daily',coalesce(daily.value,'[]'::jsonb),
    'active_ledger',coalesce(ledger.value,'[]'::jsonb)
  )::text)
  from daily cross join ledger;
$function$;

create or replace function public.dawaa_monthly_evaluation_evidence_drift_v5(
  p_staff_id uuid,
  p_evaluation_month date,
  p_approved_snapshot jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_approved text := nullif(p_approved_snapshot->>'attendance_fingerprint','');
  v_current text := public.dawaa_monthly_evaluation_attendance_fingerprint_v5(p_staff_id,p_evaluation_month);
begin
  return jsonb_build_object(
    'attendance_changed',v_approved is not null and v_current is distinct from v_approved,
    'approved_attendance_fingerprint',v_approved,
    'current_attendance_fingerprint',v_current,
    'legacy_snapshot_without_fingerprint',v_approved is null
  );
end;
$function$;

-- Extend the existing final-snapshot trigger without changing its score/evidence gates:
-- the canonical fingerprint is attached to the immutable approval snapshot immediately
-- before its hash is calculated.
create or replace function public.trg_monthly_evaluation_attendance_fingerprint_v5()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_snapshot jsonb;
  v_hash text;
begin
  if new.status not in ('sent','approved') then return new; end if;
  v_snapshot := new.metrics_snapshot->'final_approval_snapshot';
  if v_snapshot is null then return new; end if;

  v_snapshot := v_snapshot || jsonb_build_object(
    'attendance_fingerprint',
    public.dawaa_monthly_evaluation_attendance_fingerprint_v5(new.staff_id,new.evaluation_month)
  );
  v_hash := md5(v_snapshot::text);
  new.metrics_snapshot := new.metrics_snapshot || jsonb_build_object(
    'final_approval_snapshot',v_snapshot,
    'final_approval_hash',v_hash
  );
  return new;
end;
$function$;

drop trigger if exists zzz_monthly_evaluation_attendance_fingerprint_v5
  on public.staff_monthly_manager_evaluations;
create trigger zzz_monthly_evaluation_attendance_fingerprint_v5
before insert or update of sections,metrics_snapshot,strengths,development_points,manager_notes,status,sent_at
on public.staff_monthly_manager_evaluations
for each row execute function public.trg_monthly_evaluation_attendance_fingerprint_v5();

revoke all on function public.dawaa_monthly_evaluation_attendance_fingerprint_v5(uuid,date) from public,anon,authenticated;
revoke all on function public.dawaa_monthly_evaluation_evidence_drift_v5(uuid,date,jsonb) from public,anon;
grant execute on function public.dawaa_monthly_evaluation_attendance_fingerprint_v5(uuid,date) to service_role;
grant execute on function public.dawaa_monthly_evaluation_evidence_drift_v5(uuid,date,jsonb) to authenticated,service_role;
grant execute on function public.trg_monthly_evaluation_attendance_fingerprint_v5() to service_role;

notify pgrst,'reload schema';
