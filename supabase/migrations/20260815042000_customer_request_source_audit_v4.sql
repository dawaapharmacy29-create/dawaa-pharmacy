-- Read-only audit of CustomerOrder data imported from Base44/dawaawael.
-- Compares preserved source_payload fields with normalized management fields without mutating workflow state.

create or replace function public.get_customer_request_source_audit_v4(p_branch text default null)
returns jsonb
language sql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
with base as (
  select
    cr.*,
    public.dawaa_sync_map_branch(cr.source_payload->>'branch') as expected_branch,
    public.dawaa_sync_map_customer_order_status(cr.source_payload->>'status') as expected_status,
    case public.dawaa_sync_norm_text(cr.source_payload->>'priority')
      when 'عاجل' then 'high'
      when 'متوسط' then 'medium'
      when 'عادي' then 'low'
      else 'medium'
    end as expected_priority,
    case public.dawaa_sync_norm_text(cr.source_payload->>'request_type')
      when 'نواقص' then 'shortage'
      when 'استفسار' then 'inquiry'
      when 'عادي' then 'normal'
      else null
    end as expected_request_type,
    coalesce(
      nullif(cr.source_payload->>'requested_at','')::timestamptz,
      nullif(cr.source_payload->>'created_date','')::timestamptz
    ) as expected_requested_at,
    coalesce(nullif((cr.source_payload->>'quantity')::numeric,0),1) as expected_quantity,
    nullif(btrim(cr.source_payload->>'request_source'),'') as expected_channel,
    nullif(btrim(cr.source_payload->>'assigned_employee'),'') as expected_assignee,
    coalesce(
      nullif(btrim(cr.source_payload->>'recorded_by'),''),
      nullif(btrim(cr.source_payload #>> '{timeline,0,by}'),'')
    ) as expected_recorded_by
  from public.customer_requests cr
  where cr.source_system='dawaawael'
    and cr.source_entity='CustomerOrder'
    and (p_branch is null or p_branch='' or p_branch='all' or cr.branch=p_branch)
), flags as (
  select b.*,
    (expected_branch is distinct from branch and expected_branch is not null) as branch_mismatch,
    (expected_requested_at is not null and requested_at is distinct from expected_requested_at) as request_time_mismatch,
    (coalesce(quantity,1) is distinct from expected_quantity) as quantity_mismatch,
    (expected_channel is not null and source_request_channel is distinct from expected_channel) as channel_mismatch,
    (expected_assignee is not null and source_assigned_employee is distinct from expected_assignee) as assignee_mismatch,
    (expected_recorded_by is not null and created_by_name is distinct from expected_recorded_by) as recorded_by_mismatch,
    (expected_request_type is not null and request_type is distinct from expected_request_type) as request_type_mismatch,
    (priority is distinct from expected_priority) as priority_mismatch,
    (public.dawaa_sync_status_rank(expected_status) > public.dawaa_sync_status_rank(coalesce(status,'new'))
      and not coalesce(sync_conflict,false)) as source_status_ahead,
    (public.dawaa_sync_status_rank(expected_status) < public.dawaa_sync_status_rank(coalesce(status,'new'))
      and expected_status not in ('cancelled','not_available')) as local_workflow_ahead
  from base b
), summary as (
  select
    count(*)::int total,
    count(*) filter(where branch is null or btrim(branch)='')::int no_branch,
    count(*) filter(where customer_id is null)::int unlinked_customer,
    count(*) filter(where source_request_channel is null or btrim(source_request_channel)='')::int missing_channel,
    count(*) filter(where customer_phone is null)::int missing_phone,
    count(*) filter(where customer_code is null or btrim(customer_code)='' or btrim(customer_code) in ('0','00'))::int missing_customer_code,
    count(*) filter(where coalesce(sync_conflict,false))::int sync_conflicts,
    count(*) filter(where branch_mismatch)::int branch_mismatch,
    count(*) filter(where request_time_mismatch)::int request_time_mismatch,
    count(*) filter(where quantity_mismatch)::int quantity_mismatch,
    count(*) filter(where channel_mismatch)::int channel_mismatch,
    count(*) filter(where assignee_mismatch)::int assignee_mismatch,
    count(*) filter(where recorded_by_mismatch)::int recorded_by_mismatch,
    count(*) filter(where request_type_mismatch)::int request_type_mismatch,
    count(*) filter(where priority_mismatch)::int priority_mismatch,
    count(*) filter(where source_status_ahead)::int source_status_ahead,
    count(*) filter(where local_workflow_ahead)::int local_workflow_ahead,
    max(source_updated_at) latest_source_update,
    max(source_last_seen_at) last_seen
  from flags
), unresolved as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,
    'order_number',source_order_number,
    'customer_name',customer_name,
    'customer_code',customer_code,
    'phone',customer_phone,
    'branch',branch,
    'medicine_name',medicine_name,
    'source_status',source_status,
    'status',status,
    'requested_at',requested_at,
    'source_updated_at',source_updated_at,
    'issues', array_remove(array[
      case when branch is null or btrim(branch)='' then 'بدون فرع' end,
      case when customer_id is null then 'عميل غير مربوط' end,
      case when source_request_channel is null or btrim(source_request_channel)='' then 'قناة الطلب غير مسجلة' end,
      case when coalesce(sync_conflict,false) then 'تعارض مزامنة' end,
      case when branch_mismatch then 'اختلاف الفرع عن المصدر' end,
      case when request_time_mismatch then 'اختلاف وقت الطلب' end,
      case when request_type_mismatch then 'اختلاف نوع الطلب' end,
      case when priority_mismatch then 'اختلاف الأولوية' end
    ], null)
  ) order by coalesce(source_updated_at,updated_at,created_at) desc),'[]'::jsonb) rows
  from (
    select * from flags
    where branch is null or btrim(branch)=''
       or customer_id is null
       or source_request_channel is null or btrim(source_request_channel)=''
       or coalesce(sync_conflict,false)
       or branch_mismatch or request_time_mismatch or request_type_mismatch or priority_mismatch
    order by coalesce(source_updated_at,updated_at,created_at) desc
    limit 30
  ) q
)
select jsonb_build_object(
  'generated_at',now(),
  'source_system','dawaawael',
  'source_entity','CustomerOrder',
  'summary',(select to_jsonb(summary) from summary),
  'unresolved',(select rows from unresolved)
);
$$;

revoke all on function public.get_customer_request_source_audit_v4(text) from public;
grant execute on function public.get_customer_request_source_audit_v4(text) to authenticated, service_role;
