-- Backfill stale approved overtime rows after the canonical V2/V3 cutover.
-- Any approval whose Attendance Truth is missing, reopened, or fingerprint-drifted
-- must return to pending human review before it can affect payroll again.

do $$
declare
  v_row record;
  v_cycle record;
begin
  for v_row in
    select
      o.id,
      o.staff_id,
      o.attendance_date,
      o.decision_note,
      o.decision_evidence_snapshot
    from public.staff_overtime_approvals o
    left join public.attendance_daily_summary a on a.id=o.source_resolution_id
    where o.status='approved'
      and (
        o.source_resolution_id is null
        or a.id is null
        or a.status<>'approved'
        or public.attendance_resolution_fingerprint_v2(a.id)
           is distinct from o.source_resolution_fingerprint
      )
    for update of o
  loop
    update public.staff_overtime_approvals
    set
      status='pending',
      decided_at=null,
      decided_by=null,
      decided_by_name=null,
      decision_note=concat_ws(
        ' | ',
        nullif(trim(coalesce(v_row.decision_note,'')),''),
        'أعيدت للمراجعة أثناء Canonical Overtime cutover بسبب Attendance Truth غير مستقرة'
      ),
      source_resolution_fingerprint=null,
      source_resolution_linked_at=null,
      decision_evidence_snapshot=jsonb_build_object(
        'evidence_available',false,
        'reason','canonical_cutover_stale_approved_overtime',
        'previous_evidence',coalesce(v_row.decision_evidence_snapshot,'{}'::jsonb),
        'invalidated_at',now()
      ),
      decision_evidence_version='canonical_cutover_stale_v1',
      updated_at=now()
    where id=v_row.id;

    select * into v_cycle
    from public.dawaa_pay_cycle_bounds_v1(v_row.attendance_date);

    delete from public.employee_transactions et
    where et.staff_id=v_row.staff_id
      and et.month_cycle=v_cycle.month_cycle
      and et.source in ('attendance_overtime_v1','attendance_overtime_v2');
  end loop;
end;
$$;
