begin;

-- Keep canonical request creation on the same authorization model as every other
-- Customer Requests command. The legacy V1 body still owns the transactional
-- create/duplicate/identity behavior, but V2 must establish a strict active actor
-- and canonical manage permission for the effective doctor/request branch first.
create or replace function public.create_customer_request_canonical_v2(
  p_customer_id uuid,
  p_product_id uuid,
  p_doctor_id uuid,
  p_branch text,
  p_quantity numeric default 1,
  p_urgency text default 'normal',
  p_request_type text default 'missing_medicine',
  p_channel text default null,
  p_needed_by_date date default null,
  p_expected_fulfillment_days integer default null,
  p_supplier_hint text default null,
  p_notes text default null,
  p_image_url text default null,
  p_image_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor_id uuid;
  v_scope_branch text;
  v_result jsonb;
  v_request_id uuid;
  v_duplicate boolean;
  v_credit record;
begin
  v_actor_id := public.dawaa_current_staff_account_id_strict();
  if v_actor_id is null then
    raise exception 'not_authorized';
  end if;

  select nullif(trim(coalesce(s.branch,'')),'')
    into v_scope_branch
  from public.staff s
  where s.id = p_doctor_id
    and coalesce(s.is_active,true) = true
    and coalesce(s.active,true) = true
  limit 1;

  v_scope_branch := coalesce(v_scope_branch, nullif(trim(coalesce(p_branch,'')),''));
  if v_scope_branch is null
     or not public.dawaa_can_access_customer_request_branch('manage_customer_requests', v_scope_branch) then
    raise exception 'customer_request_create_not_authorized';
  end if;

  v_result := public.create_customer_request_canonical_v1(
    p_customer_id,
    p_product_id,
    p_doctor_id,
    p_branch,
    p_quantity,
    p_urgency,
    p_request_type,
    p_channel,
    p_needed_by_date,
    p_expected_fulfillment_days,
    p_supplier_hint,
    p_notes,
    p_image_url,
    p_image_path
  );

  v_request_id := nullif(v_result->'request'->>'id','')::uuid;
  v_duplicate := coalesce((v_result->>'duplicate')::boolean,false);

  if v_request_id is null then
    return v_result || jsonb_build_object(
      'registration_credit',
      jsonb_build_object('settled',false,'points',null,'tier_key',null,'policy_version',null,'event_id',null)
    );
  end if;

  select e.id, e.points, e.tier_key, e.policy_version, e.event_at
    into v_credit
  from public.customer_request_incentive_events e
  where e.request_id = v_request_id
    and e.event_key = 'request_registered'
  order by e.event_at asc, e.created_at asc
  limit 1;

  return v_result || jsonb_build_object(
    'registration_credit',
    case when v_credit.id is null then
      jsonb_build_object(
        'settled',false,
        'points',null,
        'tier_key',null,
        'policy_version',null,
        'event_id',null,
        'duplicate',v_duplicate
      )
    else
      jsonb_build_object(
        'settled',true,
        'points',v_credit.points,
        'tier_key',v_credit.tier_key,
        'policy_version',v_credit.policy_version,
        'event_id',v_credit.id,
        'event_at',v_credit.event_at,
        'duplicate',v_duplicate
      )
    end
  );
end;
$$;

revoke all on function public.create_customer_request_canonical_v2(
  uuid,uuid,uuid,text,numeric,text,text,text,date,integer,text,text,text,text
) from public;
grant execute on function public.create_customer_request_canonical_v2(
  uuid,uuid,uuid,text,numeric,text,text,text,date,integer,text,text,text,text
) to anon, authenticated, service_role;

comment on function public.create_customer_request_canonical_v2(
  uuid,uuid,uuid,text,numeric,text,text,text,date,integer,text,text,text,text
) is 'Canonical Customer Request create: strict active actor + manage permission/branch scope + atomic V1 create + settled registration credit.';

commit;
