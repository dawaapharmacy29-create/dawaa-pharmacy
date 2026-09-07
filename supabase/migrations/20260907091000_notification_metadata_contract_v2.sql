-- Notification metadata contract v2.
-- Centralizes metadata normalization for every producer without rewriting historical type ids.

create or replace function public.canonical_notification_type_v2(p_type text)
returns text
language sql
immutable
set search_path = public, pg_catalog
as $$
  select case lower(trim(coalesce(p_type,'system')))
    when 'chat_evaluation' then 'conversation_review'
    when 'conversation_sales_review' then 'conversation_review'
    when 'task' then 'staff_task'
    when 'employee_task' then 'staff_task'
    when 'assignment' then 'staff_task'
    when 'cleaning_task' then 'staff_task'
    when 'branch_manager_task' then 'staff_task'
    when 'staff_task_overdue' then 'staff_task'
    when 'staff_task_completed' then 'staff_task'
    when 'followup' then 'customer_followup'
    when 'customer_alert' then 'customer_followup'
    when 'customer_service_progress' then 'customer_followup'
    when 'customer_service_incomplete' then 'customer_followup'
    when 'customer_service_queue_incomplete' then 'customer_followup'
    when 'daily_followup_queue_missing' then 'customer_followup'
    when 'delivery' then 'delivery_order'
    when 'stock_alert' then 'inventory'
    when 'low_stock' then 'inventory'
    when 'stagnant_item' then 'inventory'
    when 'penalty' then 'deduction'
    when 'vip_customer_health' then 'vip_customer_silence'
    when 'vip_customer_health_digest' then 'vip_customer_silence'
    when 'daily_customer_attention_digest' then 'vip_customer_silence'
    when 'branch_manager_operational_digest' then 'manager_alert'
    when 'branch_manager_checklist_gap' then 'manager_alert'
    when 'monthly_evaluation_ready' then 'manager_alert'
    when 'weekly_evaluation_submitted' then 'manager_alert'
    when 'reminder' then 'manager_alert'
    when 'sync_health' then 'system'
    when 'sync_health_alert' then 'system'
    else case
      when lower(trim(coalesce(p_type,'system'))) in (
        'conversation_review','staff_task','customer_followup','customer_request',
        'customer_data_review','welcome_task','reward','deduction','payroll','attendance',
        'sales_target','inventory','expiry_alert','delivery_order','shift_issue','manager_alert',
        'vip_customer_silence','system'
      ) then lower(trim(coalesce(p_type,'system')))
      else 'system'
    end
  end;
$$;

create or replace function public.normalize_notification_metadata_v2(
  p_type text,
  p_metadata jsonb,
  p_route text default null,
  p_branch text default null,
  p_staff_id text default null
)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_catalog
as $$
declare
  v_meta jsonb := case when jsonb_typeof(coalesce(p_metadata,'{}'::jsonb))='object' then coalesce(p_metadata,'{}'::jsonb) else '{}'::jsonb end;
  v_type text := public.canonical_notification_type_v2(p_type);
  v_value text;
begin
  v_meta := v_meta || jsonb_build_object('schemaVersion',2,'canonicalType',v_type);

  v_value := coalesce(nullif(trim(p_route),''), nullif(trim(v_meta->>'route'),''), nullif(trim(v_meta->>'actionUrl'),''), nullif(trim(v_meta->>'action_url'),''), nullif(trim(v_meta->>'targetRoute'),''), nullif(trim(v_meta->>'target_route'),''));
  if v_value is not null then v_meta := v_meta || jsonb_build_object('route',v_value); end if;

  v_value := coalesce(nullif(trim(p_branch),''), nullif(trim(v_meta->>'branch'),''), nullif(trim(v_meta->>'branchName'),''), nullif(trim(v_meta->>'branch_name'),''), nullif(trim(v_meta->>'audienceBranch'),''));
  if v_value is not null then v_meta := v_meta || jsonb_build_object('branch',v_value); end if;

  v_value := coalesce(nullif(trim(p_staff_id),''), nullif(trim(v_meta->>'staffId'),''), nullif(trim(v_meta->>'staff_id'),''), nullif(trim(v_meta->>'recipientStaffId'),''), nullif(trim(v_meta->>'recipient_staff_id'),''));
  if v_value is not null then v_meta := v_meta || jsonb_build_object('staffId',v_value); end if;

  v_value := coalesce(nullif(trim(v_meta->>'staffName'),''), nullif(trim(v_meta->>'staff_name'),''), nullif(trim(v_meta->>'doctorName'),''), nullif(trim(v_meta->>'doctor_name'),''), nullif(trim(v_meta->>'assignedStaffName'),''), nullif(trim(v_meta->>'assigned_name'),''));
  if v_value is not null then v_meta := v_meta || jsonb_build_object('staffName',v_value); end if;

  v_value := coalesce(nullif(trim(v_meta->>'customerCode'),''), nullif(trim(v_meta->>'customer_code'),''), nullif(trim(v_meta->>'code'),''));
  if v_value is not null then v_meta := v_meta || jsonb_build_object('customerCode',v_value); end if;

  v_value := coalesce(nullif(trim(v_meta->>'customerName'),''), nullif(trim(v_meta->>'customer_name'),''));
  if v_value is not null then v_meta := v_meta || jsonb_build_object('customerName',v_value); end if;

  v_value := coalesce(nullif(trim(v_meta->>'reviewId'),''), nullif(trim(v_meta->>'review_id'),''));
  if v_value is not null then v_meta := v_meta || jsonb_build_object('reviewId',v_value); end if;

  if v_meta ? 'score' then null;
  elsif v_meta ? 'reviewScore' then v_meta := v_meta || jsonb_build_object('score',v_meta->'reviewScore');
  elsif v_meta ? 'review_score' then v_meta := v_meta || jsonb_build_object('score',v_meta->'review_score');
  elsif v_meta ? 'totalScore' then v_meta := v_meta || jsonb_build_object('score',v_meta->'totalScore');
  elsif v_meta ? 'total_score' then v_meta := v_meta || jsonb_build_object('score',v_meta->'total_score');
  end if;

  if not (v_meta ? 'pointsImpact') and v_meta ? 'points_impact' then
    v_meta := v_meta || jsonb_build_object('pointsImpact',v_meta->'points_impact');
  end if;

  v_value := coalesce(nullif(trim(v_meta->>'taskTitle'),''), nullif(trim(v_meta->>'task_title'),''));
  if v_value is not null then v_meta := v_meta || jsonb_build_object('taskTitle',v_value); end if;

  v_value := coalesce(nullif(trim(v_meta->>'taskState'),''), nullif(trim(v_meta->>'task_state'),''), nullif(trim(v_meta->>'state'),''));
  if v_value is not null then v_meta := v_meta || jsonb_build_object('taskState',v_value); end if;

  v_value := coalesce(nullif(trim(v_meta->>'syncName'),''), nullif(trim(v_meta->>'sync_name'),''));
  if v_value is not null then v_meta := v_meta || jsonb_build_object('syncName',v_value); end if;

  return v_meta;
end;
$$;

create or replace function public.normalize_notification_row_metadata_v2()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  new.metadata := public.normalize_notification_metadata_v2(
    coalesce(nullif(new.notification_type,''),nullif(new.type,''),'system'),
    coalesce(new.metadata,new.details,'{}'::jsonb),
    coalesce(nullif(new.action_url,''),nullif(new.target_route,''),nullif(new.route,''),nullif(new.link,'')),
    new.branch,
    coalesce(nullif(new.recipient_staff_id,''),nullif(new.staff_id,''))
  );
  return new;
end;
$$;

drop trigger if exists trg_normalize_notification_metadata_v2 on public.notifications;
create trigger trg_normalize_notification_metadata_v2
before insert or update of metadata, details, notification_type, type, action_url, target_route, route, link, branch, recipient_staff_id, staff_id
on public.notifications
for each row execute function public.normalize_notification_row_metadata_v2();

create or replace view public.notification_metadata_contract_audit_v2
with (security_invoker = true)
as
select
  n.id,
  n.created_at,
  coalesce(nullif(n.notification_type,''),nullif(n.type,''),'system') as raw_type,
  public.canonical_notification_type_v2(coalesce(nullif(n.notification_type,''),nullif(n.type,''),'system')) as canonical_type,
  case
    when public.canonical_notification_type_v2(coalesce(nullif(n.notification_type,''),nullif(n.type,''),'system'))='conversation_review'
      then array_remove(array[
        case when nullif(trim(coalesce(m->>'reviewId',m->>'review_id','')),'') is null then 'reviewId' end,
        case when not (m ? 'score' or m ? 'reviewScore' or m ? 'review_score' or m ? 'totalScore' or m ? 'total_score') then 'score' end,
        case when nullif(trim(coalesce(m->>'staffName',m->>'staff_name',m->>'doctorName','')),'') is null then 'staffName' end
      ],null)
    when public.canonical_notification_type_v2(coalesce(nullif(n.notification_type,''),nullif(n.type,''),'system'))='staff_task'
      then array_remove(array[
        case when nullif(trim(coalesce(m->>'taskTitle',m->>'task_title','')),'') is null then 'taskTitle' end,
        case when nullif(trim(coalesce(m->>'taskState',m->>'task_state',m->>'state','')),'') is null then 'taskState' end
      ],null)
    when public.canonical_notification_type_v2(coalesce(nullif(n.notification_type,''),nullif(n.type,''),'system'))='vip_customer_silence'
      then array_remove(array[
        case when nullif(trim(coalesce(m->>'customerCode',m->>'customer_code','')),'') is null then 'customerCode' end
      ],null)
    when coalesce(nullif(n.notification_type,''),nullif(n.type,''),'system') in ('sync_health','sync_health_alert')
      then array_remove(array[
        case when nullif(trim(coalesce(m->>'syncName',m->>'sync_name','')),'') is null then 'syncName' end,
        case when nullif(trim(coalesce(m->>'severity','')),'') is null then 'severity' end
      ],null)
    else array[]::text[]
  end as missing_keys,
  coalesce(m,'{}'::jsonb) as metadata
from public.notifications n
cross join lateral (select coalesce(n.metadata,n.details,'{}'::jsonb) m) x;

grant select on public.notification_metadata_contract_audit_v2 to authenticated;
