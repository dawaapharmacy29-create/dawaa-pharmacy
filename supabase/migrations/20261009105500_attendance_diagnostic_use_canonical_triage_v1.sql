create or replace function public.attendance_case_diagnostic_v2(p_staff_id uuid,p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_base jsonb;
  v_preview jsonb;
  v_status text;
  v_auto boolean:=false;
  v_triage text;
  v_owner text;
  v_evidence jsonb;
  v_actions jsonb;
begin
  v_base:=public.attendance_case_diagnostic_legacy_v1(p_staff_id,p_date);
  v_preview:=public.dawaa_build_attendance_day_resolution_current_v1(p_staff_id,p_date);
  v_status:=v_base->'evidence'->>'resolution_status';
  v_auto:=coalesce((v_preview->>'system_resolvable')::boolean,false);
  v_triage:=public.dawaa_attendance_review_triage_v1(v_status,v_preview);

  if v_triage in ('waiting','auto') then
    v_owner:='system';
  elsif v_triage='manager' then
    v_owner:='manager';
  else
    v_owner:=case
      when coalesce(v_base->>'owner','') in ('schedule','sync','timeoff','system') then v_base->>'owner'
      else 'system'
    end;
  end if;

  v_evidence:=coalesce(v_base->'evidence','{}'::jsonb) || jsonb_build_object(
    'canonical_route',v_preview->>'canonical_route',
    'canonical_resolution_status',v_preview->>'resolution_status',
    'canonical_finalizable',coalesce((v_preview->>'finalizable')::boolean,false),
    'canonical_system_resolvable',v_auto
  );

  v_actions:=case when v_auto then
    jsonb_build_array(jsonb_build_object('id','rematerialize','label','إعادة تحديث حقيقة الحضور تلقائيًا'))
  else coalesce(v_base->'suggested_actions','[]'::jsonb) end;

  return v_base || jsonb_build_object(
    'owner',v_owner,
    'triage',v_triage,
    'auto_fix_available',v_auto,
    'suggested_actions',v_actions,
    'evidence',v_evidence,
    'engine_version','attendance_diagnostic_v2',
    'generated_at',now()
  );
end;
$$;
