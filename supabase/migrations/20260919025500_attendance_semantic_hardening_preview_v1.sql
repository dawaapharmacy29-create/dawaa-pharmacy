-- Read-only semantic hardening preview.
-- Compares stored biometric decisions with the current classifier without mutating attendance truth.

create or replace function public.attendance_semantic_hardening_preview_v1(
  p_days integer default 7,
  p_branch text default null,
  p_limit integer default 200
) returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_catalog
as $function$
declare
  v_days integer:=greatest(1,least(coalesce(p_days,7),14));
  v_limit integer:=greatest(1,least(coalesce(p_limit,200),500));
  v_payload jsonb;
begin
  if not public.dawaa_can_manage_biometric_mapping_v1() then
    raise exception using errcode='42501', message='صلاحية الإدارة مطلوبة';
  end if;

  with recent as (
    select
      b.id,b.staff_id,coalesce(s.name,b.staff_name_snapshot,'غير محدد') staff_name,
      coalesce(s.branch,b.branch) branch,
      public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time) event_at,
      b.punch_type raw_type,
      d.decision current_decision,
      d.semantic_type current_type,
      d.confidence current_confidence,
      d.reason current_reason
    from public.biometric_attendance_logs b
    join public.staff s on s.id=b.staff_id
    left join public.biometric_semantic_decisions d on d.biometric_log_id=b.id
    where b.staff_id is not null
      and b.ingested_at>=now()-(v_days||' days')::interval
      and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or s.branch=p_branch)
      and public.dawaa_can_read_staff_attendance_log(b.staff_id,s.branch)
  ), compared as (
    select r.*,
      public.dawaa_biometric_semantic_decision_v1(r.staff_id,r.event_at,r.raw_type,r.id) proposed
    from recent r
    where r.event_at is not null
  ), classified as (
    select c.*,
      coalesce(c.proposed->>'decision','review') proposed_decision,
      c.proposed->>'semantic_type' proposed_type,
      nullif(c.proposed->>'confidence','')::numeric proposed_confidence,
      c.proposed->>'reason' proposed_reason,
      (
        coalesce(c.current_decision,'') is distinct from coalesce(c.proposed->>'decision','')
        or coalesce(c.current_type,'') is distinct from coalesce(c.proposed->>'semantic_type','')
      ) would_change
    from compared c
  ), counts as (
    select
      count(*) total_checked,
      count(*) filter(where would_change) would_change,
      count(*) filter(where proposed_decision='review' and current_decision='accepted') accepted_to_review,
      count(*) filter(where proposed_decision='duplicate' and coalesce(current_decision,'')<>'duplicate') newly_duplicate,
      count(*) filter(where proposed_decision='accepted' and coalesce(current_decision,'')<>'accepted') newly_accepted
    from classified
  )
  select jsonb_build_object(
    'days',v_days,
    'branch',p_branch,
    'generated_at',now(),
    'total_checked',coalesce(ct.total_checked,0),
    'would_change',coalesce(ct.would_change,0),
    'accepted_to_review',coalesce(ct.accepted_to_review,0),
    'newly_duplicate',coalesce(ct.newly_duplicate,0),
    'newly_accepted',coalesce(ct.newly_accepted,0),
    'mutation_performed',false,
    'samples',coalesce((
      select jsonb_agg(jsonb_build_object(
        'log_id',x.id,
        'staff_id',x.staff_id,
        'staff_name',x.staff_name,
        'branch',x.branch,
        'event_at',x.event_at,
        'raw_type',x.raw_type,
        'current_decision',x.current_decision,
        'current_type',x.current_type,
        'current_confidence',x.current_confidence,
        'current_reason',x.current_reason,
        'proposed_decision',x.proposed_decision,
        'proposed_type',x.proposed_type,
        'proposed_confidence',x.proposed_confidence,
        'proposed_reason',x.proposed_reason
      ) order by x.event_at desc)
      from (
        select * from classified
        where would_change
        order by event_at desc
        limit v_limit
      ) x
    ),'[]'::jsonb)
  ) into v_payload
  from counts ct;

  return v_payload;
end;
$function$;

revoke execute on function public.attendance_semantic_hardening_preview_v1(integer,text,integer) from public,anon;
grant execute on function public.attendance_semantic_hardening_preview_v1(integer,text,integer) to authenticated,service_role;

notify pgrst,'reload schema';
