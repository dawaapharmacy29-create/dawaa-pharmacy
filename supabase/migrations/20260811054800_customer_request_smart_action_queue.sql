create or replace function public.get_customer_request_action_queue(
  p_branch text default null,
  p_limit integer default 12
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_result jsonb;
begin
  if public.dawaa_current_staff_account_id_strict() is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  with base as (
    select
      r.*,
      coalesce(r.last_action_at, r.updated_at, r.requested_at, r.created_at) as stage_at,
      case
        when coalesce(r.is_urgent, false)
          or lower(coalesce(r.urgency, '')) in ('urgent','high','عاجل','مهم')
          or lower(coalesce(r.priority, '')) = 'high'
          then true else false
      end as is_priority,
      case
        when lower(coalesce(r.status, 'new')) in ('new','purchasing_review') then
          case when coalesce(r.is_urgent,false) or lower(coalesce(r.urgency,'')) in ('urgent','high','عاجل','مهم') or lower(coalesce(r.priority,''))='high' then 2 else 4 end
        when lower(coalesce(r.status, 'new')) in ('searching_suppliers','sourcing') then
          case when coalesce(r.is_urgent,false) or lower(coalesce(r.urgency,'')) in ('urgent','high','عاجل','مهم') or lower(coalesce(r.priority,''))='high' then 6 else 24 end
        when lower(coalesce(r.status, 'new')) in ('needs_customer_confirmation','customer_confirmed') then
          case when coalesce(r.is_urgent,false) or lower(coalesce(r.urgency,'')) in ('urgent','high','عاجل','مهم') or lower(coalesce(r.priority,''))='high' then 4 else 12 end
        when lower(coalesce(r.status, 'new')) in ('available','arrived') then
          case when coalesce(r.is_urgent,false) or lower(coalesce(r.urgency,'')) in ('urgent','high','عاجل','مهم') or lower(coalesce(r.priority,''))='high' then 1 else 2 end
        when lower(coalesce(r.status, 'new')) = 'customer_contacted' then
          case when coalesce(r.is_urgent,false) or lower(coalesce(r.urgency,'')) in ('urgent','high','عاجل','مهم') or lower(coalesce(r.priority,''))='high' then 12 else 24 end
        else 24
      end::numeric as sla_hours
    from public.customer_requests r
    where lower(coalesce(r.status, 'new')) not in ('closed','delivered','cancelled','not_available')
      and (p_branch is null or p_branch = '' or p_branch = 'all' or r.branch = p_branch)
  ), scored as (
    select
      b.*,
      greatest(0, extract(epoch from (now() - b.stage_at)) / 3600.0) as stage_age_hours,
      (
        case when b.is_priority then 40 else 0 end
        + case when greatest(0, extract(epoch from (now() - b.stage_at)) / 3600.0) > b.sla_hours then 35 else 0 end
        + case when lower(coalesce(b.status,'')) in ('available','arrived') then 30 else 0 end
        + case when lower(coalesce(b.status,'')) = 'needs_customer_confirmation' then 20 else 0 end
        + case when coalesce(nullif(trim(b.purchasing_assignee),''), nullif(trim(b.source_assigned_employee),''), nullif(trim(b.searching_by_name),'')) is null then 15 else 0 end
        + least(20, floor(greatest(0, extract(epoch from (now() - coalesce(b.requested_at,b.created_at))) / 3600.0) / 12.0))::int
      )::int as priority_score
    from base b
  ), ranked as (
    select *
    from scored
    order by priority_score desc, is_priority desc, stage_age_hours desc, coalesce(requested_at, created_at) asc
    limit greatest(1, least(coalesce(p_limit,12), 30))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'medicine_name', medicine_name,
    'product_code', product_code,
    'product_price', product_price,
    'customer_id', customer_id,
    'customer_name', customer_name,
    'customer_code', customer_code,
    'customer_phone', customer_phone,
    'branch', branch,
    'status', status,
    'urgency', urgency,
    'priority', priority,
    'is_urgent', is_urgent,
    'doctor_name', doctor_name,
    'created_by_name', created_by_name,
    'source_assigned_employee', source_assigned_employee,
    'purchasing_assignee', purchasing_assignee,
    'searching_by_name', searching_by_name,
    'requested_at', requested_at,
    'created_at', created_at,
    'updated_at', updated_at,
    'last_action_at', last_action_at,
    'quantity', quantity,
    'shortage_item_id', shortage_item_id,
    'priority_score', priority_score,
    'stage_age_hours', round(stage_age_hours::numeric,1),
    'sla_hours', sla_hours,
    'is_overdue', stage_age_hours > sla_hours,
    'reason', case
      when lower(coalesce(status,'')) in ('available','arrived') then 'الصنف جاهز ويحتاج تواصل سريع مع العميل'
      when stage_age_hours > sla_hours then 'تجاوز وقت المتابعة المحدد للمرحلة'
      when is_priority then 'طلب عالي الأهمية'
      when coalesce(nullif(trim(purchasing_assignee),''), nullif(trim(source_assigned_employee),''), nullif(trim(searching_by_name),'')) is null then 'الطلب بدون مسئول واضح'
      when lower(coalesce(status,'')) = 'needs_customer_confirmation' then 'يحتاج تأكيد العميل'
      else 'أقدم طلبات التشغيل المفتوحة'
    end
  ) order by priority_score desc, is_priority desc, stage_age_hours desc), '[]'::jsonb)
  into v_result
  from ranked;

  return v_result;
end;
$$;

revoke all on function public.get_customer_request_action_queue(text, integer) from public;
grant execute on function public.get_customer_request_action_queue(text, integer) to anon, authenticated, service_role;
