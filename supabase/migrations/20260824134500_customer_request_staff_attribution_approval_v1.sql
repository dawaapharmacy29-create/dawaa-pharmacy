-- Explicit review/apply workflow for legacy Customer Request staff attribution.
-- No historical request is attributed or credited merely because a normalized name matches.

create table if not exists public.customer_request_staff_attribution_decisions (
  id uuid primary key default gen_random_uuid(),
  source_label text not null,
  branch text,
  staff_id uuid not null references public.staff(id),
  decision text not null check (decision in ('approved','rejected')),
  reason text not null,
  reviewed_by_account_id uuid not null references public.staff_accounts(id),
  reviewed_at timestamptz not null default now(),
  applied_at timestamptz,
  applied_requests_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_label, branch)
);

create or replace function public.dawaa_customer_request_staff_attribution_admin_allowed()
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_identifier text := public.dawaa_request_staff_identifier();
  v_role text;
begin
  if v_identifier is null then
    return false;
  end if;

  select lower(trim(coalesce(sa.role,''))) into v_role
  from public.staff_accounts sa
  where sa.id::text = v_identifier
    and coalesce(sa.active,true) = true
    and coalesce(sa.can_login,true) = true
  limit 1;

  return v_role in ('general_manager','executive_manager','branches_manager','customer_service_manager');
end;
$$;

create or replace function public.review_customer_request_staff_attribution_v1(
  p_source_label text,
  p_branch text,
  p_staff_id uuid,
  p_decision text,
  p_reason text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_identifier text := public.dawaa_request_staff_identifier();
  v_account_id uuid;
  v_decision_id uuid;
begin
  if not public.dawaa_customer_request_staff_attribution_admin_allowed() then
    raise exception 'not_authorized';
  end if;
  if nullif(trim(coalesce(p_source_label,'')), '') is null then raise exception 'source_label_required'; end if;
  if p_staff_id is null or not exists(select 1 from public.staff s where s.id=p_staff_id) then raise exception 'staff_not_found'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'invalid_decision'; end if;
  if length(trim(coalesce(p_reason,''))) < 5 then raise exception 'review_reason_required'; end if;

  select sa.id into v_account_id from public.staff_accounts sa where sa.id::text=v_identifier limit 1;

  insert into public.customer_request_staff_attribution_decisions(
    source_label,branch,staff_id,decision,reason,reviewed_by_account_id,reviewed_at,updated_at,applied_at,applied_requests_count
  ) values(
    trim(p_source_label),nullif(trim(coalesce(p_branch,'')),''),p_staff_id,p_decision,trim(p_reason),v_account_id,now(),now(),null,0
  )
  on conflict (source_label,branch) do update set
    staff_id=excluded.staff_id,
    decision=excluded.decision,
    reason=excluded.reason,
    reviewed_by_account_id=excluded.reviewed_by_account_id,
    reviewed_at=now(),
    updated_at=now(),
    applied_at=null,
    applied_requests_count=0
  returning id into v_decision_id;

  return v_decision_id;
end;
$$;

create or replace function public.get_customer_request_staff_attribution_apply_preview_v1(
  p_source_label text,
  p_branch text,
  p_staff_id uuid
) returns jsonb
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
  if not public.dawaa_customer_request_staff_attribution_admin_allowed() then raise exception 'not_authorized'; end if;

  select exists(
    select 1 from public.customer_request_staff_attribution_decisions d
    where d.source_label=trim(p_source_label)
      and d.branch is not distinct from nullif(trim(coalesce(p_branch,'')),'')
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
    and cr.branch is not distinct from nullif(trim(coalesce(p_branch,'')),'');

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
) returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_decision_id uuid;
  v_staff_name text;
  v_count integer := 0;
begin
  if not public.dawaa_customer_request_staff_attribution_admin_allowed() then raise exception 'not_authorized'; end if;
  if p_confirm <> 'APPLY_CONFIRMED_MAPPING' then raise exception 'explicit_confirmation_required'; end if;

  select d.id into v_decision_id
  from public.customer_request_staff_attribution_decisions d
  where d.source_label=trim(p_source_label)
    and d.branch is not distinct from nullif(trim(coalesce(p_branch,'')),'')
    and d.staff_id=p_staff_id
    and d.decision='approved'
  limit 1;
  if v_decision_id is null then raise exception 'approved_review_required'; end if;

  select s.name into v_staff_name from public.staff s where s.id=p_staff_id;
  if v_staff_name is null then raise exception 'staff_not_found'; end if;

  update public.customer_requests cr
  set doctor_id=p_staff_id,
      doctor_name=v_staff_name,
      updated_at=now()
  where cr.doctor_id is null
    and trim(coalesce(cr.source_assigned_employee,''))=trim(p_source_label)
    and cr.branch is not distinct from nullif(trim(coalesce(p_branch,'')),'');
  get diagnostics v_count = row_count;

  update public.customer_request_staff_attribution_decisions
  set applied_at=now(),applied_requests_count=v_count,updated_at=now()
  where id=v_decision_id;

  return v_count;
end;
$$;

revoke all on table public.customer_request_staff_attribution_decisions from public, anon, authenticated;
grant select on table public.customer_request_staff_attribution_decisions to service_role;
revoke all on function public.review_customer_request_staff_attribution_v1(text,text,uuid,text,text) from public;
revoke all on function public.get_customer_request_staff_attribution_apply_preview_v1(text,text,uuid) from public;
revoke all on function public.apply_customer_request_staff_attribution_v1(text,text,uuid,text) from public;
grant execute on function public.review_customer_request_staff_attribution_v1(text,text,uuid,text,text) to anon, authenticated, service_role;
grant execute on function public.get_customer_request_staff_attribution_apply_preview_v1(text,text,uuid) to anon, authenticated, service_role;
grant execute on function public.apply_customer_request_staff_attribution_v1(text,text,uuid,text) to anon, authenticated, service_role;
