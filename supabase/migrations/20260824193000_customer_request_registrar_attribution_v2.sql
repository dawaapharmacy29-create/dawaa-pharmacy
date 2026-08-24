-- Fix Customer Request doctor attribution semantics.
-- The incentive owner is the request registrar/doctor, not the sourcing assignee.
-- Source assignee identity remains operational metadata only.

create or replace function public.get_customer_request_staff_attribution_review_core_v1(
  p_branch text default null,
  p_limit integer default 100
)
returns table(
  source_label text,
  branch text,
  requests_count bigint,
  suggested_staff_id uuid,
  suggested_staff_name text,
  suggested_staff_role text,
  match_state text
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with unresolved as (
    select
      nullif(trim(coalesce(
        cr.source_payload->>'recorded_by',
        cr.created_by_name
      )), '') as source_label,
      cr.branch,
      count(*)::bigint as requests_count,
      public.dawaa_customer_request_normalize_staff_label(
        coalesce(cr.source_payload->>'recorded_by', cr.created_by_name)
      ) as normalized_label
    from public.customer_requests cr
    where cr.doctor_id is null
      and nullif(trim(coalesce(
        cr.source_payload->>'recorded_by',
        cr.created_by_name,
        ''
      )), '') is not null
      and (
        p_branch is null
        or trim(p_branch) = ''
        or lower(trim(p_branch)) = 'all'
        or cr.branch = p_branch
      )
    group by 1, 2, 4
  ),
  candidates as (
    select
      u.*,
      s.id as staff_id,
      s.name as staff_name,
      s.role as staff_role,
      count(s.id) over (partition by u.source_label, u.branch) as candidate_count
    from unresolved u
    left join public.staff s
      on public.dawaa_customer_request_normalize_staff_label(s.name) = u.normalized_label
     and coalesce(s.is_active, true) = true
     and coalesce(s.active, true) = true
     and (
       s.branch = u.branch
       or s.branch = 'كل الفروع'
     )
  )
  select
    c.source_label,
    c.branch,
    max(c.requests_count)::bigint,
    case when max(c.candidate_count) = 1 then min(c.staff_id::text)::uuid else null end,
    case when max(c.candidate_count) = 1 then min(c.staff_name) else null end,
    case when max(c.candidate_count) = 1 then min(c.staff_role) else null end,
    case
      when max(c.candidate_count) = 1 then 'unique_exact_normalized'
      when max(c.candidate_count) > 1 then 'ambiguous'
      else 'unmatched'
    end as match_state
  from candidates c
  where public.dawaa_customer_request_points_reader_allowed()
  group by c.source_label, c.branch
  order by max(c.requests_count) desc, c.source_label
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

create or replace function public.get_customer_request_staff_attribution_apply_preview_v1(
  p_source_label text,
  p_branch text,
  p_staff_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_total integer;
  v_points_ready integer;
  v_approved boolean;
begin
  if not public.dawaa_customer_request_staff_attribution_admin_allowed()
     or nullif(trim(coalesce(p_branch,'')),'') is null
     or not public.dawaa_can_access_customer_request_branch('manage_customer_requests',p_branch) then
    raise exception 'not_authorized' using errcode='42501';
  end if;

  select exists(
    select 1
    from public.customer_request_staff_attribution_decisions d
    where d.source_label=trim(p_source_label)
      and d.branch=trim(p_branch)
      and d.staff_id=p_staff_id
      and d.decision='approved'
  ) into v_approved;

  select
    count(*)::integer,
    count(*) filter (
      where cr.customer_id is not null
        and nullif(trim(coalesce(cr.customer_code,'')),'') is not null
        and cr.product_id is not null
        and nullif(trim(coalesce(cr.product_code,'')),'') is not null
        and not coalesce(cr.sync_conflict,false)
    )::integer
  into v_total,v_points_ready
  from public.customer_requests cr
  where cr.doctor_id is null
    and trim(coalesce(cr.source_payload->>'recorded_by',cr.created_by_name,''))=trim(p_source_label)
    and cr.branch=trim(p_branch);

  return jsonb_build_object(
    'approved',v_approved,
    'requests_to_attribute',coalesce(v_total,0),
    'currently_points_identity_ready',coalesce(v_points_ready,0),
    'attribution_kind','registrar',
    'points_are_still_subject_to_tier_policy_and_effective_date',true
  );
end;
$$;

create or replace function public.apply_customer_request_staff_attribution_v1(
  p_source_label text,
  p_branch text,
  p_staff_id uuid,
  p_confirm text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_decision_id uuid;
  v_staff_name text;
  v_staff_branch text;
  v_count integer:=0;
begin
  if not public.dawaa_customer_request_staff_attribution_admin_allowed()
     or nullif(trim(coalesce(p_branch,'')),'') is null
     or not public.dawaa_can_access_customer_request_branch('manage_customer_requests',p_branch) then
    raise exception 'not_authorized' using errcode='42501';
  end if;

  if p_confirm<>'APPLY_CONFIRMED_MAPPING' then
    raise exception 'explicit_confirmation_required';
  end if;

  select d.id
    into v_decision_id
  from public.customer_request_staff_attribution_decisions d
  where d.source_label=trim(p_source_label)
    and d.branch=trim(p_branch)
    and d.staff_id=p_staff_id
    and d.decision='approved'
  limit 1;

  if v_decision_id is null then raise exception 'approved_review_required'; end if;

  select s.name,s.branch
    into v_staff_name,v_staff_branch
  from public.staff s
  where s.id=p_staff_id;

  if v_staff_name is null then raise exception 'staff_not_found'; end if;

  if public.dawaa_customer_request_branch_key(v_staff_branch)
       is distinct from public.dawaa_customer_request_branch_key(p_branch)
     and lower(trim(coalesce(v_staff_branch,'')))<>'كل الفروع' then
    raise exception 'staff_branch_mismatch';
  end if;

  update public.customer_requests cr
  set doctor_id=p_staff_id,
      doctor_name=v_staff_name,
      source_recorded_staff_id=p_staff_id,
      updated_at=now()
  where cr.doctor_id is null
    and trim(coalesce(cr.source_payload->>'recorded_by',cr.created_by_name,''))=trim(p_source_label)
    and cr.branch=trim(p_branch);

  get diagnostics v_count=row_count;

  update public.customer_request_staff_attribution_decisions
  set applied_at=now(),
      applied_requests_count=v_count,
      updated_at=now()
  where id=v_decision_id;

  return v_count;
end;
$$;

comment on function public.apply_customer_request_staff_attribution_v1(text,text,uuid,text) is
  'Applies a reviewed registrar identity mapping to Customer Requests. Never derives doctor_id from source_assigned_employee.';
