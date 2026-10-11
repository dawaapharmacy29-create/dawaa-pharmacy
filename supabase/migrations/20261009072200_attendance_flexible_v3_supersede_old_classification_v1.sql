-- When a flexible attendance resolution is promoted from V2 to V3,
-- the old classified ledger row must never remain active beside the V3 row.

do $do$
declare
  v_oid oid;
  v_def text;
  v_old text;
  v_new text;
begin
  v_oid:=to_regprocedure('public.dawaa_reconcile_flexible_attendance_dirty_day_v1(uuid,date)');
  if v_oid is null then raise exception 'missing flexible reconciler'; end if;
  v_def:=pg_get_functiondef(v_oid);

  v_old:=$anchor$
  if (not v_system) or v_old_event is distinct from v_new_event then
    update public.attendance_impact_ledger set impact_status='superseded'
    where source_resolution_id=v_saved.id and impact_status='classified';
  end if;
$anchor$;

  v_new:=$replacement$
  if coalesce(v_saved.resolution_version,0)<>3
     or coalesce(v_saved.approved_by,'')<>'system:auto-attendance-v3'
     or (not v_system)
     or v_old_event is distinct from v_new_event then
    update public.attendance_impact_ledger set impact_status='superseded'
    where source_resolution_id=v_saved.id and impact_status='classified';
  end if;
$replacement$;

  if position(v_old in v_def)=0 then
    raise exception 'flexible reconciler anchor not found';
  end if;

  execute replace(v_def,v_old,v_new);
end;
$do$;

-- Repair any pre-existing V2/V3 double-classified rows in the current operational cycle.
with dupes as (
  select distinct l2.source_resolution_id
  from public.attendance_impact_ledger l2
  join public.attendance_impact_ledger l3
    on l3.source_resolution_id=l2.source_resolution_id
  join public.attendance_daily_summary a on a.id=l2.source_resolution_id
  join public.staff s on s.id=a.staff_id
  where l2.impact_status='classified'
    and l2.created_by='system:auto-attendance-v2'
    and l3.impact_status='classified'
    and l3.created_by='system:auto-attendance-v3'
    and s.branch in ('فرع الشامي','فرع شكري')
    and a.attendance_date between
      (select cycle_start from public.dawaa_pay_cycle_bounds_v1((now() at time zone 'Africa/Cairo')::date))
      and
      (select cycle_end from public.dawaa_pay_cycle_bounds_v1((now() at time zone 'Africa/Cairo')::date))
)
update public.attendance_impact_ledger l
set impact_status='superseded'
where l.source_resolution_id in (select source_resolution_id from dupes)
  and l.impact_status='classified'
  and l.created_by='system:auto-attendance-v2';
