-- Reconcile only previously approved manager decisions that were later re-queued.
-- No inferred/system-only decision is promoted. Historical audit remains append-only.
with candidates as (
  select d.id,d.staff_id,d.attendance_date,d.resolution_status,a.snapshot,a.created_at,
    row_number() over(partition by d.staff_id,d.attendance_date order by a.created_at desc,a.id desc) rn
  from public.attendance_daily_summary d
  join public.staff s on s.id=d.staff_id
  join public.attendance_resolution_audit a
    on a.staff_id=d.staff_id and a.attendance_date=d.attendance_date
  where d.attendance_date between date '2026-08-26' and date '2026-09-25'
    and coalesce(s.active,s.is_active,true)=true
    and (d.status<>'approved' or d.review_required)
    and a.action in ('approve_worked_on_off','correct_worked_on_off_evidence')
), safe as (
  select * from candidates
  where rn=1
    and snapshot->>'status'='approved'
    and snapshot->>'review_required'='false'
)
update public.attendance_daily_summary d set
  status='approved',
  review_required=false,
  approved_at=(safe.snapshot->>'approved_at')::timestamptz,
  approved_by=safe.snapshot->>'approved_by',
  approved_by_name=safe.snapshot->>'approved_by_name',
  approval_note=safe.snapshot->>'approval_note',
  resolution_origin='manager',
  resolved_at=coalesce((safe.snapshot->>'resolved_at')::timestamptz,(safe.snapshot->>'approved_at')::timestamptz),
  updated_at=now()
from safe
where d.id=safe.id
  and d.resolution_status=safe.snapshot->>'resolution_status';

notify pgrst,'reload schema';
