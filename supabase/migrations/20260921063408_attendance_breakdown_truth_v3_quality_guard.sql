CREATE OR REPLACE FUNCTION public.get_branch_attendance_roster_v3(p_branch text, p_start date, p_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  j jsonb;
  v_out jsonb;
begin
  j:=public.get_branch_attendance_roster_v2(p_branch,p_start,p_end);

  select coalesce(jsonb_agg(
    (row_data || jsonb_build_object('risk_level','none','risk_reasons','[]'::jsonb))
    order by
      coalesce((row_data->>'absence_review_days')::int,0) desc,
      coalesce((row_data->>'needs_review_days')::int,0) desc,
      coalesce((row_data->>'system_review_days')::int,0) desc,
      coalesce((row_data->>'total_late_minutes')::int,0) desc,
      row_data->>'staff_name'
  ),'[]'::jsonb)
  into v_out
  from jsonb_array_elements(j) row_data;

  return v_out;
end;
$function$


CREATE OR REPLACE FUNCTION public.get_staff_attendance_detail_v3(p_staff_id uuid, p_start date, p_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  j jsonb;
  v_effective_end date;
  v_drift integer:=0;
  v_financial_drift integer:=0;
begin
  j:=public.get_staff_attendance_detail_v2(p_staff_id,p_start,p_end);
  v_effective_end:=nullif(j->'summary'->>'effective_end','')::date;

  if v_effective_end is not null and v_effective_end>=p_start then
    v_drift:=public.attendance_resolution_drift_count_v1(p_staff_id,p_start,v_effective_end);
    v_financial_drift:=public.attendance_resolution_financial_drift_count_v1(p_staff_id,p_start,v_effective_end);
  end if;

  return jsonb_set(
    j,
    '{summary}',
    (j->'summary') || jsonb_build_object(
      'resolution_drift_days',v_drift,
      'financial_drift_days',v_financial_drift,
      'classification_only_drift_days',greatest(v_drift-v_financial_drift,0)
    )
  );
end;
$function$


grant execute on function public.get_staff_attendance_detail_v3(uuid,date,date) to anon,authenticated,service_role;
grant execute on function public.get_branch_attendance_roster_v3(text,date,date) to anon,authenticated,service_role;
