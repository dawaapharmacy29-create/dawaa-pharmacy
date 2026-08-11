create or replace function public.dawaa_customer_request_sla_hours(p_status text, p_urgent boolean default false)
returns int
language sql
immutable
set search_path=public
as $$
  select case
    when lower(coalesce(p_status,'')) in ('closed','delivered','cancelled','not_available') then 0
    when coalesce(p_urgent,false) and lower(coalesce(p_status,'')) in ('new','purchasing_review') then 2
    when coalesce(p_urgent,false) and lower(coalesce(p_status,'')) in ('searching_suppliers','sourcing') then 6
    when coalesce(p_urgent,false) and lower(coalesce(p_status,'')) in ('needs_customer_confirmation','customer_confirmed') then 4
    when coalesce(p_urgent,false) and lower(coalesce(p_status,'')) in ('available','arrived') then 1
    when coalesce(p_urgent,false) and lower(coalesce(p_status,'')) = 'customer_contacted' then 12
    when lower(coalesce(p_status,'')) in ('new','purchasing_review') then 4
    when lower(coalesce(p_status,'')) in ('searching_suppliers','sourcing') then 24
    when lower(coalesce(p_status,'')) in ('needs_customer_confirmation','customer_confirmed') then 12
    when lower(coalesce(p_status,'')) in ('available','arrived') then 2
    when lower(coalesce(p_status,'')) = 'customer_contacted' then 24
    else case when coalesce(p_urgent,false) then 6 else 24 end
  end;
$$;

create or replace function public.get_customer_request_overdue_ids(p_branch text default null)
returns uuid[]
language plpgsql
stable security definer
set search_path=public
as $$
declare
  v_identifier text := public.dawaa_request_staff_identifier();
  v_allowed boolean := false;
  v_ids uuid[];
begin
  if auth.uid() is not null then v_allowed := true;
  elsif v_identifier is not null then
    select exists(select 1 from public.staff_accounts sa where sa.id::text=v_identifier and coalesce(sa.active,true)=true and coalesce(sa.can_login,true)=true) into v_allowed;
  end if;
  if not v_allowed then raise exception 'not_authorized'; end if;

  select coalesce(array_agg(cr.id order by coalesce(cr.last_action_at,cr.updated_at,cr.requested_at,cr.created_at)), array[]::uuid[])
  into v_ids
  from public.customer_requests cr
  where (p_branch is null or p_branch='' or p_branch='all' or cr.branch=p_branch)
    and lower(coalesce(cr.status,'new')) not in ('closed','delivered','cancelled','not_available')
    and now()-coalesce(cr.last_action_at,cr.updated_at,cr.requested_at,cr.created_at,now())
      > make_interval(hours=>public.dawaa_customer_request_sla_hours(
        cr.status,
        coalesce(cr.is_urgent,false)
          or lower(trim(coalesce(cr.urgency,''))) in ('urgent','high','عاجل','مهم')
          or lower(trim(coalesce(cr.priority,'')))='high'
      ));
  return v_ids;
end;
$$;

create or replace function public.get_customer_requests_command_center_summary(p_branch text default null)
returns jsonb
language sql
stable security definer
set search_path=public
as $$
with scoped as (
  select cr.*,
    coalesce(cr.requested_at,cr.created_at,now()) request_ts,
    coalesce(cr.last_action_at,cr.updated_at,cr.requested_at,cr.created_at,now()) stage_ts,
    lower(trim(coalesce(cr.status,'new'))) status_key,
    regexp_replace(coalesce(cr.customer_phone,''),'[^0-9]','','g') phone_digits,
    (coalesce(cr.is_urgent,false) or lower(trim(coalesce(cr.urgency,''))) in ('urgent','high','عاجل','مهم') or lower(trim(coalesce(cr.priority,'')))='high') urgent_flag
  from public.customer_requests cr
  where p_branch is null or p_branch='' or p_branch='all' or cr.branch=p_branch
), aggregated as (
  select count(*)::int total,
    count(*) filter(where (request_ts at time zone 'Africa/Cairo')::date=(now() at time zone 'Africa/Cairo')::date)::int today,
    count(*) filter(where status_key not in ('closed','delivered','cancelled','not_available'))::int open,
    count(*) filter(where urgent_flag)::int urgent,
    count(*) filter(where status_key not in ('closed','delivered','cancelled','not_available') and now()-stage_ts > make_interval(hours=>public.dawaa_customer_request_sla_hours(status_key,urgent_flag)))::int overdue,
    count(*) filter(where status_key in ('purchasing_review','searching_suppliers','sourcing'))::int searching,
    count(*) filter(where status_key in ('needs_customer_confirmation','customer_confirmed'))::int waiting_customer,
    count(*) filter(where status_key in ('available','arrived','customer_contacted'))::int ready,
    count(*) filter(where status_key='delivered')::int delivered,
    count(*) filter(where status_key='not_available')::int not_available,
    count(*) filter(where status_key='cancelled')::int cancelled,
    count(*) filter(where source_system='dawaawael')::int from_dawaawael,
    count(*) filter(where customer_id is null)::int unlinked_customer,
    count(*) filter(where nullif(trim(coalesce(branch,'')),'') is null)::int no_branch,
    count(*) filter(where phone_digits='' or phone_digits ~ '^0+$' or length(phone_digits)<8)::int invalid_phone,
    count(*) filter(where nullif(trim(coalesce(purchasing_assignee,'')),'') is null and nullif(trim(coalesce(source_assigned_employee,'')),'') is null and status_key not in ('closed','delivered','cancelled','not_available'))::int unassigned,
    count(*) filter(where coalesce(sync_conflict,false))::int sync_conflicts,
    count(*) filter(where shortage_item_id is not null)::int moved_to_shortage,
    round(100.0*count(*) filter(where status_key='delivered')/nullif(count(*) filter(where status_key in ('delivered','cancelled','not_available')),0),1) fulfillment_rate,
    round(avg(extract(epoch from (closed_at-request_ts))/3600.0) filter(where status_key='delivered' and closed_at is not null),1) avg_fulfillment_hours
  from scoped
)
select jsonb_build_object('total',total,'today',today,'open',open,'urgent',urgent,'overdue',overdue,'searching',searching,'waiting_customer',waiting_customer,'ready',ready,'delivered',delivered,'not_available',not_available,'cancelled',cancelled,'from_dawaawael',from_dawaawael,'unlinked_customer',unlinked_customer,'no_branch',no_branch,'invalid_phone',invalid_phone,'unassigned',unassigned,'sync_conflicts',sync_conflicts,'moved_to_shortage',moved_to_shortage,'fulfillment_rate',coalesce(fulfillment_rate,0),'avg_fulfillment_hours',coalesce(avg_fulfillment_hours,0)) from aggregated;
$$;

create or replace function public.get_customer_request_operational_insights(p_branch text default null,p_days int default 30)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_identifier text := public.dawaa_request_staff_identifier();
  v_allowed boolean := false;
  v_from timestamptz := now()-make_interval(days=>greatest(coalesce(p_days,30),1));
  v_result jsonb;
begin
  if auth.uid() is not null then v_allowed:=true;
  elsif v_identifier is not null then select exists(select 1 from public.staff_accounts sa where sa.id::text=v_identifier and coalesce(sa.active,true)=true and coalesce(sa.can_login,true)=true) into v_allowed;
  end if;
  if not v_allowed then raise exception 'not_authorized'; end if;

  with base as (
    select cr.*,
      coalesce(nullif(cr.purchasing_assignee,''),nullif(cr.source_assigned_employee,''),nullif(cr.searching_by_name,''),'غير مسند') owner_name,
      coalesce(cr.requested_at,cr.created_at) req_at,
      coalesce(cr.last_action_at,cr.updated_at,cr.requested_at,cr.created_at,now()) stage_ts,
      (coalesce(cr.is_urgent,false) or lower(trim(coalesce(cr.urgency,''))) in ('urgent','high','عاجل','مهم') or lower(trim(coalesce(cr.priority,'')))='high') urgent_flag
    from public.customer_requests cr
    where coalesce(cr.requested_at,cr.created_at)>=v_from and (p_branch is null or p_branch='' or p_branch='all' or cr.branch=p_branch)
  ), top_products as (
    select coalesce(nullif(product_code,''),'—') product_code,medicine_name,count(*) requests_count,
      count(*) filter(where status in ('available','arrived','customer_contacted','delivered','closed')) fulfilled_count,
      count(*) filter(where status='not_available') not_available_count,round(avg(product_price)::numeric,2) avg_price
    from base group by coalesce(nullif(product_code,''),'—'),medicine_name order by count(*) desc,medicine_name limit 10
  ), owners as (
    select owner_name,count(*) assigned_count,count(*) filter(where status in ('delivered','closed')) completed_count,
      count(*) filter(where lower(coalesce(status,'new')) not in ('delivered','closed','cancelled','not_available') and now()-stage_ts > make_interval(hours=>public.dawaa_customer_request_sla_hours(status,urgent_flag))) overdue_count,
      round(avg(extract(epoch from (coalesce(closed_at,updated_at)-req_at))/3600.0) filter(where status in ('delivered','closed') and req_at is not null)::numeric,1) avg_close_hours
    from base group by owner_name order by completed_count desc,assigned_count desc limit 10
  ), branches as (
    select coalesce(nullif(branch,''),'غير محدد') branch,count(*) total,count(*) filter(where status in ('delivered','closed')) completed,
      count(*) filter(where status='not_available') not_available,
      count(*) filter(where lower(coalesce(status,'new')) not in ('delivered','closed','cancelled','not_available') and now()-stage_ts > make_interval(hours=>public.dawaa_customer_request_sla_hours(status,urgent_flag))) overdue
    from base group by coalesce(nullif(branch,''),'غير محدد')
  ), k as (
    select count(*) total,count(*) filter(where status not in ('delivered','closed','cancelled','not_available')) open,
      count(*) filter(where status in ('available','arrived') and coalesce(customer_contacted_by_name,'')='') ready_not_contacted,
      count(*) filter(where lower(coalesce(status,'new')) not in ('delivered','closed','cancelled','not_available') and now()-stage_ts > make_interval(hours=>public.dawaa_customer_request_sla_hours(status,urgent_flag))) overdue,
      count(*) filter(where product_id is not null) linked_products,count(*) filter(where product_id is null) unlinked_products,
      round(100.0*count(*) filter(where status in ('available','arrived','customer_contacted','delivered','closed'))/nullif(count(*),0),1) fulfillment_rate
    from base
  )
  select jsonb_build_object('period_days',greatest(coalesce(p_days,30),1),'kpis',(select to_jsonb(k) from k),'top_products',(select coalesce(jsonb_agg(to_jsonb(top_products)),'[]'::jsonb) from top_products),'owners',(select coalesce(jsonb_agg(to_jsonb(owners)),'[]'::jsonb) from owners),'branches',(select coalesce(jsonb_agg(to_jsonb(branches)),'[]'::jsonb) from branches)) into v_result;
  return v_result;
end;
$$;

revoke all on function public.get_customer_request_overdue_ids(text) from public,anon;
grant execute on function public.get_customer_request_overdue_ids(text) to authenticated,anon,service_role;
