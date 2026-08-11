create or replace function public.get_customer_request_operational_insights(p_branch text default null, p_days int default 30)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_identifier text := public.dawaa_request_staff_identifier();
  v_allowed boolean := false;
  v_from timestamptz := now() - make_interval(days => greatest(coalesce(p_days,30),1));
  v_result jsonb;
begin
  if auth.uid() is not null then
    v_allowed := true;
  elsif v_identifier is not null then
    select exists(
      select 1 from public.staff_accounts sa
      where sa.id::text=v_identifier
        and coalesce(sa.active,true)=true
        and coalesce(sa.can_login,true)=true
    ) into v_allowed;
  end if;
  if not v_allowed then raise exception 'not_authorized'; end if;

  with base as (
    select cr.*,
      coalesce(nullif(cr.purchasing_assignee,''),nullif(cr.source_assigned_employee,''),nullif(cr.searching_by_name,''),'غير مسند') owner_name,
      coalesce(cr.requested_at,cr.created_at) req_at
    from public.customer_requests cr
    where coalesce(cr.requested_at,cr.created_at) >= v_from
      and (p_branch is null or p_branch='' or p_branch='all' or cr.branch=p_branch)
  ),
  top_products as (
    select coalesce(nullif(product_code,''),'—') product_code,
           medicine_name,
           count(*) requests_count,
           count(*) filter (where status in ('available','arrived','customer_contacted','delivered','closed')) fulfilled_count,
           count(*) filter (where status='not_available') not_available_count,
           round(avg(product_price)::numeric,2) avg_price
    from base
    group by coalesce(nullif(product_code,''),'—'), medicine_name
    order by count(*) desc, medicine_name
    limit 10
  ),
  owners as (
    select owner_name,
           count(*) assigned_count,
           count(*) filter (where status in ('delivered','closed')) completed_count,
           count(*) filter (where status not in ('delivered','closed','cancelled','not_available') and now()-req_at > interval '24 hours') overdue_count,
           round(avg(extract(epoch from (coalesce(closed_at,updated_at)-req_at))/3600.0) filter (where status in ('delivered','closed') and req_at is not null)::numeric,1) avg_close_hours
    from base
    group by owner_name
    order by completed_count desc, assigned_count desc
    limit 10
  ),
  branches as (
    select coalesce(nullif(branch,''),'غير محدد') branch,
           count(*) total,
           count(*) filter (where status in ('delivered','closed')) completed,
           count(*) filter (where status='not_available') not_available,
           count(*) filter (where status not in ('delivered','closed','cancelled','not_available') and now()-req_at > interval '24 hours') overdue
    from base group by coalesce(nullif(branch,''),'غير محدد')
  ),
  k as (
    select count(*) total,
      count(*) filter (where status not in ('delivered','closed','cancelled','not_available')) open,
      count(*) filter (where status in ('available','arrived') and coalesce(customer_contacted_by_name,'')='') ready_not_contacted,
      count(*) filter (where status not in ('delivered','closed','cancelled','not_available') and now()-req_at > interval '24 hours') overdue,
      count(*) filter (where product_id is not null) linked_products,
      count(*) filter (where product_id is null) unlinked_products,
      round(100.0*count(*) filter (where status in ('available','arrived','customer_contacted','delivered','closed'))/nullif(count(*),0),1) fulfillment_rate
    from base
  )
  select jsonb_build_object(
    'period_days', greatest(coalesce(p_days,30),1),
    'kpis',(select to_jsonb(k) from k),
    'top_products',(select coalesce(jsonb_agg(to_jsonb(top_products)),'[]'::jsonb) from top_products),
    'owners',(select coalesce(jsonb_agg(to_jsonb(owners)),'[]'::jsonb) from owners),
    'branches',(select coalesce(jsonb_agg(to_jsonb(branches)),'[]'::jsonb) from branches)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.get_customer_request_operational_insights(text,int) from public, anon;
grant execute on function public.get_customer_request_operational_insights(text,int) to authenticated, anon, service_role;
