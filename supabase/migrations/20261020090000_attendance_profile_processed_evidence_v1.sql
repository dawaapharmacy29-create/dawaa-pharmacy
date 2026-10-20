-- 2026-10-20: read-only attendance profile evidence supplement.
-- Existing attendance_employee_profile_v1 enforces the caller's verified staff
-- session and per-person attendance read authorization. Reuse it before looking
-- at processed events so this RPC does not expand who can view another employee.
-- Accepted device events are evidence, NOT approved/payroll-eligible hours.
CREATE OR REPLACE FUNCTION public.attendance_employee_profile_evidence_v1(
  p_staff_id uuid,
  p_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_profile jsonb;
  v_from date := (now() AT TIME ZONE 'Africa/Cairo')::date
    - greatest(1, least(coalesce(p_days,30), 90));
  v_to date := (now() AT TIME ZONE 'Africa/Cairo')::date;
  v_total integer;
  v_accepted integer;
  v_accepted_days integer;
  v_summary_covered_days integer;
  v_missing_summary_days integer;
  v_pair_days integer;
  v_review integer;
  v_rejected integer;
  v_recent jsonb;
BEGIN
  -- The browser may use an anon transport role with a verified Dawaa staff
  -- session. Granting EXECUTE must never grant access to unauthenticated calls.
  IF public.dawaa_current_staff_account_id_strict() IS NULL THEN
    RAISE EXCEPTION 'active staff session required' USING errcode='42501';
  END IF;
  -- Fails closed on missing staff, inactive/unauthorized session and row scope.
  -- Never fetch staff_attendance_logs before the existing authorization check.
  v_profile := public.attendance_employee_profile_v1(p_staff_id,p_days);
  IF v_profile IS NULL OR v_profile->'staff' IS NULL
    OR v_profile->'staff'->>'id' IS DISTINCT FROM p_staff_id::text
  THEN
    RAISE EXCEPTION 'attendance_profile_authorized_identity_missing'
      USING errcode='42501';
  END IF;

  WITH daily_events AS (
    SELECT l.shift_date,
      count(*) AS total,
      count(*) FILTER(WHERE l.status='accepted') AS accepted_count,
      count(*) FILTER(WHERE l.status='manual_review') AS review_count,
      count(*) FILTER(WHERE l.status='rejected') AS rejected_count,
      min(l.recorded_at) FILTER(WHERE l.status='accepted' AND l.attendance_type='check_in') AS first_in,
      max(l.recorded_at) FILTER(WHERE l.status='accepted' AND l.attendance_type='check_out') AS last_out,
      count(*) FILTER(WHERE l.status='accepted' AND l.attendance_type='check_in') AS accepted_in,
      count(*) FILTER(WHERE l.status='accepted' AND l.attendance_type='check_out') AS accepted_out,
      coalesce(jsonb_agg(DISTINCT l.branch_name) FILTER(WHERE nullif(trim(l.branch_name),'') IS NOT NULL),'[]'::jsonb) AS branches
    FROM public.staff_attendance_logs l
    WHERE l.staff_id=p_staff_id
      AND l.shift_date BETWEEN v_from AND v_to
    GROUP BY l.shift_date
  ),
  coverage AS (
    SELECT e.*,(ads.id IS NOT NULL) AS has_summary
    FROM daily_events e
    LEFT JOIN public.attendance_daily_summary ads
      ON ads.staff_id=p_staff_id AND ads.attendance_date=e.shift_date
  )
  SELECT coalesce(sum(d.total),0)::int,
    coalesce(sum(d.accepted_count),0)::int,
    count(*) FILTER(WHERE d.accepted_count>0)::int,
    count(*) FILTER(WHERE d.accepted_count>0 AND d.has_summary)::int,
    count(*) FILTER(WHERE d.accepted_count>0 AND NOT d.has_summary)::int,
    count(*) FILTER(WHERE d.accepted_in>0 AND d.accepted_out>0)::int,
    coalesce(sum(d.review_count),0)::int,
    coalesce(sum(d.rejected_count),0)::int
  INTO v_total,v_accepted,v_accepted_days,v_summary_covered_days,
    v_missing_summary_days,v_pair_days,v_review,v_rejected
  FROM coverage d;

  SELECT coalesce(jsonb_agg(
    to_jsonb(d) || jsonb_build_object(
      'has_summary',(ads.id IS NOT NULL),
      'summary_status',ads.status
    ) ORDER BY d.shift_date DESC),'[]'::jsonb)
  INTO v_recent
  FROM (
    SELECT l.shift_date, count(*) FILTER(WHERE l.status='accepted')::int AS accepted_punches,
      count(*) FILTER(WHERE l.status='manual_review')::int AS review_punches,
      count(*) FILTER(WHERE l.status='rejected')::int AS rejected_punches,
      min(l.recorded_at) FILTER(WHERE l.status='accepted' AND l.attendance_type='check_in') AS first_in,
      max(l.recorded_at) FILTER(WHERE l.status='accepted' AND l.attendance_type='check_out') AS last_out,
      coalesce(jsonb_agg(DISTINCT l.branch_name) FILTER(WHERE nullif(trim(l.branch_name),'') IS NOT NULL),'[]'::jsonb) AS punch_branches
    FROM public.staff_attendance_logs l
    WHERE l.staff_id=p_staff_id
      AND l.shift_date BETWEEN v_from AND v_to
    GROUP BY l.shift_date
    ORDER BY l.shift_date DESC
    LIMIT 15
  ) d
  LEFT JOIN public.attendance_daily_summary ads
    ON ads.staff_id=p_staff_id AND ads.attendance_date=d.shift_date;

  RETURN v_profile || jsonb_build_object('processed_evidence',
    jsonb_build_object(
      'source','staff_attendance_logs',
      'from',v_from,'to',v_to,
      'total_punches',v_total,
      'accepted_punches',v_accepted,
      'accepted_days',v_accepted_days,
      'summary_covered_days',v_summary_covered_days,
      'missing_summary_days',v_missing_summary_days,
      'coverage_complete',(v_missing_summary_days=0 AND
        (v_profile->'rates'->>'evaluated_days')::int > 0),
      'complete_pair_days',v_pair_days,
      'manual_review_punches',v_review,
      'rejected_punches',v_rejected,
      'recent_days',v_recent
    )
  );
END;
$function$;

-- Same browser transport as the existing profile RPC: anon API key plus
-- independently verified Dawaa staff-session token. The wrapper explicitly
-- inherits v1's session/row authorization before reading any processed punch.
REVOKE ALL ON FUNCTION public.attendance_employee_profile_evidence_v1(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.attendance_employee_profile_evidence_v1(uuid,integer)
  TO anon, authenticated, service_role;
