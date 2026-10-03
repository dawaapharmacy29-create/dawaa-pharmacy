-- Monthly Evaluation V5: retire legacy attendance readers from the approval path.
-- Canonical attendance truth is Attendance Resolution V2 only:
-- attendance_daily_summary (day finalization) + attendance_impact_ledger (classified impacts).

create or replace function public.dawaa_monthly_evaluation_server_evidence_v5(
  p_staff_id uuid,
  p_evaluation_month date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_cycle_start date := (date_trunc('month',p_evaluation_month)::date - interval '1 month' + interval '25 days')::date;
  v_cycle_end_exclusive date := date_trunc('month',p_evaluation_month)::date + interval '25 days';
  v_role text;
  v_needs_reviews boolean := false;
  v_needs_followups boolean := false;
  v_needs_attendance boolean := false;
  v_needs_inventory boolean := false;
  v_reviews_available boolean := true;
  v_followups_available boolean := true;
  v_attendance_available boolean := true;
  v_inventory_available boolean := true;
  v_review_count int := 0;
  v_followup_count int := 0;
  v_attendance_resolved_days int := 0;
  v_attendance_pending_review_days int := 0;
  v_attendance_conflict_days int := 0;
  v_inventory_responsibilities int := 0;
  v_inventory_sessions int := 0;
  v_inventory_items int := 0;
  v_inventory_counted_items int := 0;
  v_errors jsonb := '{}'::jsonb;
begin
  select public.dawaa_monthly_evaluation_canonical_role_v5(coalesce(s.role,s.type,''))
    into v_role from public.staff s where s.id=p_staff_id;

  if v_role is null then
    return jsonb_build_object('schema','monthly_evaluation_server_evidence_v5','ready',false,'role','other',
      'errors',jsonb_build_object('staff','staff_not_found'));
  end if;

  v_needs_reviews := v_role in ('doctor','customer_service');
  v_needs_followups := v_role in ('doctor','customer_service','customer_service_manager','purchasing');
  v_needs_attendance := v_role in ('doctor','assistant','inventory_assistant','delivery','customer_service','shift_supervisor');
  v_needs_inventory := v_role in ('doctor','assistant','inventory_assistant','purchasing');

  begin
    select count(*)::int into v_review_count
    from public.conversation_sales_reviews r
    where (r.staff_id=p_staff_id or r.doctor_id=p_staff_id)
      and coalesce(r.conversation_date::date,(r.created_at at time zone 'Africa/Cairo')::date) >= v_cycle_start
      and coalesce(r.conversation_date::date,(r.created_at at time zone 'Africa/Cairo')::date) < v_cycle_end_exclusive;
  exception when others then
    v_reviews_available := false; v_errors := v_errors || jsonb_build_object('reviews',sqlerrm);
  end;

  begin
    select count(*)::int into v_followup_count
    from public.daily_followups f
    where (f.assigned_staff_id=p_staff_id or f.requested_by_staff_id=p_staff_id::text)
      and (f.created_at at time zone 'Africa/Cairo')::date >= v_cycle_start
      and (f.created_at at time zone 'Africa/Cairo')::date < v_cycle_end_exclusive;
  exception when others then
    v_followups_available := false; v_errors := v_errors || jsonb_build_object('followups',sqlerrm);
  end;

  begin
    select
      count(*) filter(where d.status='approved' and not coalesce(d.review_required,false))::int,
      count(*) filter(where d.status is distinct from 'approved' or coalesce(d.review_required,false))::int
    into v_attendance_resolved_days,v_attendance_pending_review_days
    from public.attendance_daily_summary d
    where d.staff_id=p_staff_id and d.attendance_date>=v_cycle_start and d.attendance_date<v_cycle_end_exclusive;

    select count(*)::int into v_attendance_conflict_days
    from (
      select l.attendance_date
      from public.attendance_impact_ledger l
      where l.staff_id=p_staff_id and l.attendance_date>=v_cycle_start and l.attendance_date<v_cycle_end_exclusive
        and l.impact_status='classified'
      group by l.attendance_date
      having count(*)>1
    ) c;
  exception when others then
    v_attendance_available := false; v_errors := v_errors || jsonb_build_object('attendance',sqlerrm);
  end;

  begin
    select count(distinct a.id)::int into v_inventory_responsibilities
    from public.staff_daily_checklist_assignments a
    join public.staff_daily_checklist_items i on i.id=a.item_id and i.active=true and i.operation_category='inventory'
    where a.staff_id=p_staff_id and a.active=true and a.active_from<v_cycle_end_exclusive
      and (a.active_to is null or a.active_to>=v_cycle_start);

    select count(distinct s.id)::int,count(it.id)::int,count(it.id) filter(where it.actual_qty is not null)::int
    into v_inventory_sessions,v_inventory_items,v_inventory_counted_items
    from public.inventory_count_sessions s left join public.inventory_count_items it on it.session_id=s.id
    where s.responsible_staff_id=p_staff_id and s.due_date>=v_cycle_start and s.due_date<v_cycle_end_exclusive
      and lower(trim(coalesce(s.status,''))) not in ('cancelled','canceled');
  exception when others then
    v_inventory_available := false; v_errors := v_errors || jsonb_build_object('inventory',sqlerrm);
  end;

  return jsonb_build_object(
    'schema','monthly_evaluation_server_evidence_v5','cycle_start',v_cycle_start,'cycle_end_exclusive',v_cycle_end_exclusive,'role',v_role,
    'requirements',jsonb_build_object('reviews',v_needs_reviews,'followups',v_needs_followups,'attendance',v_needs_attendance,'inventory',v_needs_inventory),
    'ready',
      (not v_needs_reviews or v_reviews_available)
      and (not v_needs_followups or v_followups_available)
      and (not v_needs_attendance or (v_attendance_available and v_attendance_pending_review_days=0 and v_attendance_conflict_days=0))
      and (not v_needs_inventory or v_inventory_available),
    'health',jsonb_build_object(
      'reviews',case when v_reviews_available then 'available' else 'unavailable' end,
      'followups',case when v_followups_available then 'available' else 'unavailable' end,
      'attendance',case when not v_attendance_available then 'unavailable' when v_attendance_pending_review_days=0 and v_attendance_conflict_days=0 then 'available' else 'blocked' end,
      'attendance_finalization',case when not v_attendance_available then 'unavailable' when v_attendance_pending_review_days=0 and v_attendance_conflict_days=0 then 'clear' else 'blocked' end,
      'inventory',case when v_inventory_available then 'available' else 'unavailable' end),
    'counts',jsonb_build_object(
      'conversation_reviews',v_review_count,'followups',v_followup_count,
      'attendance_resolved_days',v_attendance_resolved_days,
      'modern_attendance_days',v_attendance_resolved_days,
      'attendance_pending_review_days',v_attendance_pending_review_days,
      'attendance_conflict_days',v_attendance_conflict_days,
      'inventory_responsibilities',v_inventory_responsibilities,'inventory_sessions',v_inventory_sessions,
      'inventory_items',v_inventory_items,'inventory_counted_items',v_inventory_counted_items),
    'attendance_finalization',jsonb_build_object('ready',v_attendance_pending_review_days=0 and v_attendance_conflict_days=0,
      'pending_review_days',v_attendance_pending_review_days,'conflict_days',v_attendance_conflict_days),
    'errors',v_errors,'validated_at',now());
end;
$function$;

revoke all on function public.dawaa_monthly_evaluation_server_evidence_v5(uuid,date) from public,anon,authenticated;
grant execute on function public.dawaa_monthly_evaluation_server_evidence_v5(uuid,date) to service_role;

create or replace function public.dawaa_monthly_evaluation_attendance_fingerprint_v5(
  p_staff_id uuid,p_evaluation_month date
)
returns text language sql stable security definer set search_path to 'public','pg_catalog'
as $function$
with cycle as (
 select (date_trunc('month',p_evaluation_month)::date-interval '1 month'+interval '25 days')::date start_date,
        (date_trunc('month',p_evaluation_month)::date+interval '25 days')::date end_exclusive
), truth_rows as (
 select d.attendance_date,'day'::text kind,d.id::text stable_id,
   jsonb_build_object('date',d.attendance_date,'kind','day','status',d.status,'review_required',d.review_required,
     'approved_at',d.approved_at,'approval_note',d.approval_note) row_data
 from public.attendance_daily_summary d cross join cycle c
 where d.staff_id=p_staff_id and d.attendance_date>=c.start_date and d.attendance_date<c.end_exclusive
 union all
 select l.attendance_date,'impact',l.id::text,
   jsonb_build_object('date',l.attendance_date,'kind','impact','event_type',l.event_type,'status',l.impact_status,
     'policy',l.policy_version,'points',l.points_impact,'incentive',l.incentive_impact,
     'payroll_units',l.payroll_units_impact,'money',l.monetary_impact,'evidence',coalesce(l.evidence_snapshot,'{}'::jsonb)) row_data
 from public.attendance_impact_ledger l cross join cycle c
 where l.staff_id=p_staff_id and l.attendance_date>=c.start_date and l.attendance_date<c.end_exclusive
   and l.impact_status='classified'
)
select md5(coalesce(jsonb_agg(row_data order by attendance_date,kind,stable_id)::text,'[]')) from truth_rows
$function$;

revoke all on function public.dawaa_monthly_evaluation_attendance_fingerprint_v5(uuid,date) from public,anon,authenticated;
grant execute on function public.dawaa_monthly_evaluation_attendance_fingerprint_v5(uuid,date) to service_role;

create or replace function public.dawaa_monthly_evaluation_evidence_drift_v5(
  p_staff_id uuid,p_evaluation_month date,p_approved_snapshot jsonb
)
returns jsonb language plpgsql security definer set search_path to 'public','pg_catalog'
as $function$
declare
 v_current jsonb; v_approved jsonb:=coalesce(p_approved_snapshot->'server_evidence','{}'::jsonb);
 v_role text:=coalesce(p_approved_snapshot->'server_evidence'->>'role','');
 v_attendance_required boolean:=false; v_changed boolean:=false;
 v_current_fingerprint text; v_approved_fingerprint text:=nullif(p_approved_snapshot->>'attendance_fingerprint','');
begin
 v_current:=public.dawaa_monthly_evaluation_server_evidence_v5(p_staff_id,p_evaluation_month);
 v_current_fingerprint:=public.dawaa_monthly_evaluation_attendance_fingerprint_v5(p_staff_id,p_evaluation_month);
 if v_role='' then v_role:=coalesce(v_current->>'role','other'); end if;
 v_attendance_required:=coalesce((p_approved_snapshot->'server_evidence'->'requirements'->>'attendance')::boolean,
   v_role in ('doctor','assistant','inventory_assistant','delivery','customer_service','shift_supervisor'),false);
 if not (p_approved_snapshot?'server_evidence') then
   return jsonb_build_object('schema','monthly_evaluation_evidence_drift_v5','role',v_role,'attendance_changed',false,'comparable',false,
     'reason','approved_snapshot_missing_server_evidence');
 end if;
 if v_attendance_required then
   v_changed:=(v_approved_fingerprint is not null and v_current_fingerprint is distinct from v_approved_fingerprint)
     or coalesce(v_current->'counts'->>'attendance_pending_review_days','') is distinct from coalesce(v_approved->'counts'->>'attendance_pending_review_days','')
     or coalesce(v_current->'counts'->>'attendance_conflict_days','') is distinct from coalesce(v_approved->'counts'->>'attendance_conflict_days','')
     or coalesce(v_current->'counts'->>'modern_attendance_days','') is distinct from coalesce(v_approved->'counts'->>'modern_attendance_days','')
     or coalesce(v_current->'health'->>'attendance','') is distinct from coalesce(v_approved->'health'->>'attendance','');
 end if;
 return jsonb_build_object('schema','monthly_evaluation_evidence_drift_v5','role',v_role,'attendance_required',v_attendance_required,
   'attendance_changed',v_changed,'comparable',true,'fingerprint_comparable',v_approved_fingerprint is not null,
   'approved_attendance_fingerprint',v_approved_fingerprint,'current_attendance_fingerprint',v_current_fingerprint,
   'approved_attendance',jsonb_build_object('health',v_approved->'health'->>'attendance','resolved_days',v_approved->'counts'->>'modern_attendance_days',
     'pending_review_days',v_approved->'counts'->>'attendance_pending_review_days','conflict_days',v_approved->'counts'->>'attendance_conflict_days'),
   'current_attendance',jsonb_build_object('health',v_current->'health'->>'attendance','resolved_days',v_current->'counts'->>'modern_attendance_days',
     'pending_review_days',v_current->'counts'->>'attendance_pending_review_days','conflict_days',v_current->'counts'->>'attendance_conflict_days'),
   'checked_at',now());
end;
$function$;

revoke all on function public.dawaa_monthly_evaluation_evidence_drift_v5(uuid,date,jsonb) from public,anon,authenticated;
grant execute on function public.dawaa_monthly_evaluation_evidence_drift_v5(uuid,date,jsonb) to service_role;

notify pgrst,'reload schema';
