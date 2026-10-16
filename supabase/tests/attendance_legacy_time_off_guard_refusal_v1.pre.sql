-- A legacy time-off API changed after review: the guard must refuse and revoke nothing.
CREATE OR REPLACE FUNCTION public.attendance_gm_time_off_queue_v1()
 RETURNS TABLE(id uuid, staff_id uuid, staff_name text, branch text, request_kind text, request_label text, start_date date, end_date date, start_time time without time zone, end_time time without time zone, reason text, requested_at timestamp with time zone, branch_decided_by_name text, branch_decided_at timestamp with time zone, branch_note text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  return query
  select r.id, r.staff_id, r.staff_name_snapshot, r.branch_snapshot, r.request_kind, r.request_label,
    r.start_date, r.end_date, r.start_time, r.end_time, r.reason, r.requested_at,
    r.metadata->'branch_decision'->>'decided_by_name', (r.metadata->'branch_decision'->>'decided_at')::timestamptz,
    r.metadata->'branch_decision'->>'note'
  from public.staff_time_off_requests r
  where r.status = 'pending_gm_review'
  order by r.requested_at;
end;
$function$;
