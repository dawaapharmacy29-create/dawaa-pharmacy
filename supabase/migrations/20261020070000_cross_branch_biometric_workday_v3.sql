-- 2026-10-20: read-only cross-branch biometric evidence with canonical workday attribution.
-- Never infer identity from code alone. Matching is through raw event staff_id (which
-- is assigned by provider/device-scoped verified biometric mapping).
-- A midnight checkout belongs to the shift_date in the accepted attendance event,
-- not necessarily to the local calendar date of its raw device timestamp.
-- The old v2 RPC remains unchanged and callable. No data changes or new grants.
CREATE OR REPLACE FUNCTION public.list_cross_branch_biometric_events_v3(
  p_start date,
  p_end date,
  p_branch text DEFAULT NULL::text,
  p_limit integer DEFAULT 250
)
RETURNS TABLE (
  staff_id uuid,
  staff_name text,
  role text,
  home_branch text,
  expected_branch text,
  punch_branch text,
  expected_source text,
  biometric_user_id text,
  punch_time timestamptz,
  punch_type text,
  device_id text,
  provider text,
  attendance_date date,
  processing_status text,
  attendance_type text,
  day_evidence text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor public.staff_accounts%rowtype;
BEGIN
  IF p_start IS NULL OR p_end IS NULL OR p_end<p_start OR p_end-p_start>45 THEN
    RAISE EXCEPTION 'invalid_cross_branch_range' USING errcode='22023';
  END IF;

  SELECT * INTO v_actor
  FROM public.staff_accounts sa
  WHERE sa.id=public.dawaa_current_staff_account_id_strict()
    AND coalesce(sa.active,false)=true
    AND coalesce(sa.can_login,false)=true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active staff actor required' USING errcode='42501';
  END IF;

  RETURN QUERY
  WITH normalized AS (
    SELECT
      b.id AS raw_event_id,
      b.staff_id AS raw_staff_id,
      b.biometric_user_id AS biometric_code,
      b.punch_type AS raw_punch_type,
      b.device_id::text AS device_code,
      b.provider AS source_provider,
      public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time) AS event_at,
      NULLIF(trim(public.dawaa_biometric_source_branch_v1(b.raw_payload,b.branch)),'') AS source_branch
    FROM public.biometric_attendance_logs b
    WHERE b.staff_id IS NOT NULL
      -- Include adjacent calendar dates: a late-night or overnight accepted punch
      -- can belong to a different assigned attendance shift_date.
      AND (public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time)
        AT TIME ZONE 'Africa/Cairo')::date
        BETWEEN p_start-1 AND p_end+1
  ), resolved AS (
    SELECT
      s.id AS person_id,
      s.name AS person_name,
      s.role AS person_role,
      NULLIF(trim(s.branch),'') AS current_branch,
      COALESCE(NULLIF(trim(sch.branch),''),NULLIF(trim(s.branch),'')) AS schedule_branch,
      n.source_branch AS device_branch,
      CASE WHEN sch.schedule_id IS NOT NULL
        THEN 'schedule_'||coalesce(sch.source_kind,'resolved')
        ELSE 'staff_current_fallback'
      END AS branch_source,
      n.biometric_code AS punch_code,
      n.event_at AS punch_at,
      n.raw_punch_type AS raw_type,
      n.device_code AS device_name,
      n.source_provider AS provider_name,
      COALESCE(linked.shift_date,
        (n.event_at AT TIME ZONE 'Africa/Cairo')::date) AS work_day,
      COALESCE(linked.status,'unlinked') AS processing_state,
      linked.attendance_type AS interpreted_type,
      CASE WHEN linked.shift_date IS NOT NULL
        THEN 'linked_attendance_shift_date'
        ELSE 'raw_calendar_day_fallback'
      END AS day_source
    FROM normalized n
    JOIN public.staff s ON s.id=n.raw_staff_id
    LEFT JOIN LATERAL (
      SELECT sal.shift_date,sal.status,sal.attendance_type
      FROM public.staff_attendance_logs sal
      WHERE sal.biometric_source_log_id=n.raw_event_id
        AND sal.staff_id=n.raw_staff_id
      ORDER BY (sal.status='accepted') DESC, sal.created_at DESC
      LIMIT 1
    ) linked ON TRUE
    LEFT JOIN LATERAL public.attendance_schedule_for_date_v1(
      s.id,
      COALESCE(linked.shift_date,(n.event_at AT TIME ZONE 'Africa/Cairo')::date)
    ) sch ON TRUE
  )
  SELECT
    r.person_id,r.person_name,r.person_role,r.current_branch,r.schedule_branch,
    r.device_branch,r.branch_source,r.punch_code,r.punch_at,r.raw_type,
    r.device_name,r.provider_name,r.work_day,r.processing_state,
    r.interpreted_type,r.day_source
  FROM resolved r
  WHERE r.work_day BETWEEN p_start AND p_end
    AND r.schedule_branch IS NOT NULL
    AND r.device_branch IS NOT NULL
    AND r.device_branch<>r.schedule_branch
    AND (p_branch IS NULL OR trim(p_branch)='' OR p_branch='الكل'
      OR r.schedule_branch=trim(p_branch))
    AND public.dawaa_can_read_staff_attendance_log(r.person_id,r.schedule_branch)
  ORDER BY r.work_day DESC,r.punch_at DESC,r.person_name
  LIMIT greatest(1,least(coalesce(p_limit,250),1000));
END;
$function$;
