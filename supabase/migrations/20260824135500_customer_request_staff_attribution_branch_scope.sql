-- Historical staff attribution can change doctor_id and therefore points ownership.
-- Restrict both review and apply flows to explicitly authorized data-quality roles,
-- and keep branch-scoped customer service managers inside their own branch.

alter function public.get_customer_request_staff_attribution_review_v1(text, integer)
  rename to get_customer_request_staff_attribution_review_core_v1;

revoke execute on function public.get_customer_request_staff_attribution_review_core_v1(text, integer) from public, anon, authenticated;
grant execute on function public.get_customer_request_staff_attribution_review_core_v1(text, integer) to service_role;

create or replace function public.get_customer_request_staff_attribution_review_v1(
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
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor uuid := public.dawaa_current_staff_account_id_strict();
  v_role text;
  v_actor_branch text;
  v_effective_branch text;
begin
  if v_actor is null or not public.dawaa_customer_request_staff_attribution_admin_allowed() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select lower(trim(coalesce(sa.role,''))), sa.branch
    into v_role, v_actor_branch
  from public.staff_accounts sa
  where sa.id = v_actor
    and coalesce(sa.active,false)
    and coalesce(sa.can_login,false)
  limit 1;
  if not found then raise exception 'not_authorized' using errcode = '42501'; end if;

  if p_branch is null or trim(p_branch) = '' or lower(trim(p_branch)) = 'all' then
    if v_role in ('general_manager','executive_manager','branches_manager','admin') then
      v_effective_branch := null;
    else
      v_effective_branch := v_actor_branch;
    end if;
  else
    if not public.dawaa_can_access_customer_request_branch('view_customer_requests', p_branch) then
      raise exception 'not_authorized' using errcode = '42501';
    end if;
    v_effective_branch := p_branch;
  end if;

  return query
  select * from public.get_customer_request_staff_attribution_review_core_v1(v_effective_branch, p_limit);
end;
$$;

create or replace function public.review_customer_request_staff_attribution_v1(
  p_source_label text,
  p_branch text,
  p_staff_id uuid,
  p_decision text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_identifier text := public.dawaa_request_staff_identifier();
  v_account_id uuid;
  v_decision_id uuid;
  v_staff_branch text;
begin
  if not public.dawaa_customer_request_staff_attribution_admin_allowed() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_branch,'')),'') is null then raise exception 'branch_required'; end if;
  if not public.dawaa_can_access_customer_request_branch('manage_customer_requests', p_branch) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_source_label,'')),'') is null then raise exception 'source_label_required'; end if;
  if p_staff_id is null or not exists(select 1 from public.staff s where s.id=p_staff_id) then raise exception 'staff_not_found'; end if;

  select s.branch into v_staff_branch from public.staff s where s.id=p_staff_id;
  if public.dawaa_customer_request_branch_key(v_staff_branch) is distinct from public.dawaa_customer_request_branch_key(p_branch)
     and lower(trim(coalesce(v_staff_branch,''))) <> 'كل الفروع' then
    raise exception 'staff_branch_mismatch';
  end if;

  if p_decision not in ('approved','rejected') then raise exception 'invalid_decision'; end if;
  if length(trim(coalesce(p_reason,''))) < 5 then raise exception 'review_reason_required'; end if;

  select sa.id into v_account_id
  from public.staff_accounts sa
  where sa.id::text = v_identifier
  limit 1;

  insert into public.customer_request_staff_attribution_decisions(
    source_label,branch,staff_id,decision,reason,reviewed_by_account_id,reviewed_at,updated_at,applied_at,applied_requests_count
  ) values(
    trim(p_source_label),trim(p_branch),p_staff_id,p_decision,trim(p_reason),v_account_id,now(),now(),null,0
  )
  on conflict (source_label,branch) do update set
    staff_id=excluded.staff_id,
    decision=excluded.decision,
    reason=excluded.reason,
    reviewed_by_account_id=excluded.reviewed_by_account_id,
    reviewed_at=now(),updated_at=now(),applied_at=null,applied_requests_count=0
  returning id into v_decision_id;

  return v_decision_id;
end;
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
     or not public.dawaa_can_access_customer_request_branch('manage_customer_requests', p_branch) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select exists(
    select 1 from public.customer_request_staff_attribution_decisions d
    where d.source_label=trim(p_source_label)
      and d.branch=trim(p_branch)
      and d.staff_id=p_staff_id
      and d.decision='approved'
  ) into v_approved;

  select count(*)::integer,
         count(*) filter (
           where cr.customer_id is not null
             and nullif(trim(coalesce(cr.customer_code,'')),'') is not null
             and nullif(trim(coalesce(cr.product_code,'')),'') is not null
             and not coalesce(cr.sync_conflict,false)
         )::integer
    into v_total,v_points_ready
  from public.customer_requests cr
  where cr.doctor_id is null
    and trim(coalesce(cr.source_assigned_employee,''))=trim(p_source_label)
    and cr.branch=trim(p_branch);

  return jsonb_build_object(
    'approved',v_approved,
    'requests_to_attribute',coalesce(v_total,0),
    'currently_points_identity_ready',coalesce(v_points_ready,0),
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
  v_count integer := 0;
begin
  if not public.dawaa_customer_request_staff_attribution_admin_allowed()
     or nullif(trim(coalesce(p_branch,'')),'') is null
     or not public.dawaa_can_access_customer_request_branch('manage_customer_requests', p_branch) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_confirm <> 'APPLY_CONFIRMED_MAPPING' then raise exception 'explicit_confirmation_required'; end if;

  select d.id into v_decision_id
  from public.customer_request_staff_attribution_decisions d
  where d.source_label=trim(p_source_label)
    and d.branch=trim(p_branch)
    and d.staff_id=p_staff_id
    and d.decision='approved'
  limit 1;
  if v_decision_id is null then raise exception 'approved_review_required'; end if;

  select s.name,s.branch into v_staff_name,v_staff_branch from public.staff s where s.id=p_staff_id;
  if v_staff_name is null then raise exception 'staff_not_found'; end if;
  if public.dawaa_customer_request_branch_key(v_staff_branch) is distinct from public.dawaa_customer_request_branch_key(p_branch)
     and lower(trim(coalesce(v_staff_branch,''))) <> 'كل الفروع' then
    raise exception 'staff_branch_mismatch';
  end if;

  update public.customer_requests cr
  set doctor_id=p_staff_id,doctor_name=v_staff_name,updated_at=now()
  where cr.doctor_id is null
    and trim(coalesce(cr.source_assigned_employee,''))=trim(p_source_label)
    and cr.branch=trim(p_branch);
  get diagnostics v_count=row_count;

  update public.customer_request_staff_attribution_decisions
  set applied_at=now(),applied_requests_count=v_count,updated_at=now()
  where id=v_decision_id;

  return v_count;
end;
$$;

revoke execute on function public.get_customer_request_staff_attribution_review_v1(text, integer) from public;
revoke execute on function public.review_customer_request_staff_attribution_v1(text,text,uuid,text,text) from public;
revoke execute on function public.get_customer_request_staff_attribution_apply_preview_v1(text,text,uuid) from public;
revoke execute on function public.apply_customer_request_staff_attribution_v1(text,text,uuid,text) from public;
grant execute on function public.get_customer_request_staff_attribution_review_v1(text, integer) to anon, authenticated, service_role;
grant execute on function public.review_customer_request_staff_attribution_v1(text,text,uuid,text,text) to anon, authenticated, service_role;
grant execute on function public.get_customer_request_staff_attribution_apply_preview_v1(text,text,uuid) to anon, authenticated, service_role;
grant execute on function public.apply_customer_request_staff_attribution_v1(text,text,uuid,text) to anon, authenticated, service_role;
