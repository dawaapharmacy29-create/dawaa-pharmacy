-- Executive notification curation v2
-- Keeps full personal/branch feeds for staff while turning executive inboxes into a signal-first queue.
-- Healthy reviews, routine employee reminders, individual VIP rows, SLA copies, and repeated incidents
-- no longer flood general/executive/branches managers.

create or replace function public.dawaa_notification_inbox_visible_v3(
  p_current_role text,
  p_current_account_id text,
  p_current_staff_id text,
  p_id text,
  p_recipient_user_id text,
  p_user_id text,
  p_recipient_staff_id text,
  p_staff_id text,
  p_recipient_role text,
  p_type text,
  p_priority text,
  p_target_type text,
  p_title text,
  p_branch text,
  p_created_at timestamptz,
  p_metadata jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_role text := lower(trim(coalesce(p_current_role,'')));
  v_account_id text := trim(coalesce(p_current_account_id,''));
  v_staff_id text := trim(coalesce(p_current_staff_id,''));
  v_canonical text := public.canonical_notification_type_v2(p_type);
  v_score numeric;
  v_points numeric;
  v_critical boolean := false;
  v_meta jsonb := coalesce(p_metadata,'{}'::jsonb);
  v_direct boolean := false;
  v_priority text := lower(trim(coalesce(p_priority,'')));
  v_title text := trim(coalesce(p_title,''));
  v_branch text := trim(coalesce(p_branch,''));
  v_raw_type text := lower(trim(coalesce(p_type,'')));
begin
  if v_role not in ('general_manager','executive_manager','branches_manager') then return true; end if;

  -- SLA escalation rows are audit/reference copies; the original notification owns the workflow.
  if lower(coalesce(v_meta->>'slaGenerated','false')) = 'true' then return false; end if;

  v_direct := coalesce(
    (nullif(trim(coalesce(p_recipient_user_id,'')),'') = nullif(v_account_id,''))
    or (nullif(trim(coalesce(p_user_id,'')),'') = nullif(v_account_id,''))
    or (nullif(trim(coalesce(p_recipient_staff_id,'')),'') = nullif(v_staff_id,''))
    or (nullif(trim(coalesce(p_staff_id,'')),'') = nullif(v_staff_id,''))
    or (nullif(lower(trim(coalesce(p_recipient_role,''))),'') = nullif(v_role,'')),
    false
  );

  -- Other employees' personal reminders/evaluation-ready notifications do not bubble to executives.
  if not v_direct and v_raw_type in ('daily_task_reminder','monthly_evaluation_ready','weekly_evaluation_submitted') then
    return false;
  end if;

  -- Routine tasks remain with assignees; only urgent/critical exceptions are inherited by executives.
  if not v_direct and v_canonical = 'staff_task' and v_priority not in ('urgent','critical') then
    return false;
  end if;

  -- Healthy conversation reviews belong to analytics/history; only negative/critical exceptions bubble up.
  if not v_direct and v_canonical = 'conversation_review' then
    begin v_score := nullif(v_meta->>'score','')::numeric; exception when others then v_score := null; end;
    begin
      v_points := coalesce(nullif(v_meta->>'pointsImpact','')::numeric,nullif(v_meta->>'points_impact','')::numeric);
    exception when others then v_points := null; end;
    v_critical := lower(coalesce(v_meta->>'hasCriticalError',v_meta->>'has_critical_error',v_meta->>'critical','false')) = 'true';
    if coalesce(v_score,100) >= 90 and coalesce(v_points,0) >= 0 and not v_critical then
      return false;
    end if;
  end if;

  -- Individual VIP rows stay with customer-service owners; executives consume branch-level summaries.
  if not v_direct
     and v_canonical in ('customer_followup','vip_customer_silence')
     and lower(trim(coalesce(p_target_type,''))) = 'vip_customer' then
    return false;
  end if;

  -- Keep only the latest semantic instance of repeated operational signals.
  if v_canonical in ('staff_task','manager_alert','vip_customer_silence','system')
     or v_raw_type in ('branch_manager_checklist_gap','sync_health','sync_health_alert','system_alert') then
    if exists (
      select 1
      from public.notifications nx
      where nx.archived_at is null
        and nx.id::text <> coalesce(p_id,'')
        and coalesce(nx.title,'') = v_title
        and coalesce(nx.branch,'') = v_branch
        and (nx.created_at > p_created_at or (nx.created_at = p_created_at and nx.id::text > coalesce(p_id,'')))
        and (
          public.canonical_notification_type_v2(coalesce(nx.notification_type,nx.type)) = v_canonical
          or lower(trim(coalesce(nx.notification_type,nx.type,''))) = v_raw_type
        )
    ) then
      return false;
    end if;
  end if;

  return true;
end;
$$;

grant execute on function public.dawaa_notification_inbox_visible_v3(
  text,text,text,text,text,text,text,text,text,text,text,text,text,text,timestamptz,jsonb
) to anon, authenticated;

drop policy if exists notifications_select_visible_v2 on public.notifications;
create policy notifications_select_visible_v2
on public.notifications
for select
to anon, authenticated
using (
  public.dawaa_notification_visible_to_current_user_v2(
    recipient_user_id,user_id::text,recipient_staff_id,staff_id,recipient_role,branch
  )
  and public.dawaa_notification_inbox_visible_v3(
    public.dawaa_current_notification_role_v1(),
    public.dawaa_current_notification_account_id_v1(),
    public.dawaa_current_staff_id_v1(),
    id::text,recipient_user_id,user_id::text,recipient_staff_id,staff_id,recipient_role,
    coalesce(notification_type,type),priority,target_type,title,branch,created_at,metadata
  )
);

-- Compact seven-day executive digest RPC for dashboards/decision inbox UI.
create or replace function public.get_executive_notification_digest_v1()
returns table(
  signal_group text,
  branch text,
  total bigint,
  unread bigint,
  urgent bigint,
  requires_action bigint,
  latest_at timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select
    case
      when public.canonical_notification_type_v2(coalesce(n.notification_type,n.type)) = 'staff_task' then 'tasks'
      when public.canonical_notification_type_v2(coalesce(n.notification_type,n.type)) in ('customer_followup','vip_customer_silence','customer_request','customer_data_review','welcome_task') then 'customers'
      when public.canonical_notification_type_v2(coalesce(n.notification_type,n.type)) = 'conversation_review' then 'reviews'
      when public.canonical_notification_type_v2(coalesce(n.notification_type,n.type)) in ('system','manager_alert') then 'operations'
      when public.canonical_notification_type_v2(coalesce(n.notification_type,n.type)) in ('inventory','expiry_alert') then 'inventory'
      else 'other'
    end,
    coalesce(nullif(trim(n.branch),''),'كل الفروع'),
    count(*)::bigint,
    count(*) filter (where not coalesce(n.is_read,false))::bigint,
    count(*) filter (where lower(coalesce(n.priority,'')) in ('urgent','critical'))::bigint,
    count(*) filter (where coalesce(n.requires_action,false))::bigint,
    max(n.created_at)
  from public.notifications n
  where n.archived_at is null
    and n.created_at >= now() - interval '7 days'
  group by 1,2
  order by 5 desc,6 desc,4 desc,3 desc;
$$;

grant execute on function public.get_executive_notification_digest_v1() to anon, authenticated;
notify pgrst, 'reload schema';
