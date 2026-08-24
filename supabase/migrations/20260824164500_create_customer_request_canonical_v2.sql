-- V2 canonical create wrapper returns the ACTUAL registration credit settled by the
-- database trigger, so the UI never claims points from a preview alone.

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
  v_result jsonb;
  v_request_id uuid;
  v_duplicate boolean;
  v_credit record;
begin
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
  where e.request_id=v_request_id
    and e.event_key='request_registered'
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
) is 'Atomic canonical Customer Request creation plus actual database-settled registration credit.';
