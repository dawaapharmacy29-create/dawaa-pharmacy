-- Notification inbox latest-lookup v5
--
-- Preserve the exact V3 inbox visibility semantics while replacing the per-row
-- correlated "does any newer row exist?" scan with a single indexed latest-row
-- lookup. A production-equivalence check across the current live set showed
-- zero mismatches for all rows where dedupe applies.

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
) returns boolean
language plpgsql stable security definer
set search_path='public','pg_catalog'
as $$
declare
  v_role text := lower(trim(coalesce(p_current_role,'')));
  v_account_id text := trim(coalesce(p_current_account_id,''));
  v_staff_id text := trim(coalesce(p_current_staff_id,''));
  v_canonical text;
  v_score numeric;
  v_points numeric;
  v_critical boolean := false;
  v_meta jsonb := coalesce(p_metadata,'{}'::jsonb);
  v_direct boolean := false;
  v_priority text := lower(trim(coalesce(p_priority,'')));
  v_title text := trim(coalesce(p_title,''));
  v_branch text := trim(coalesce(p_branch,''));
  v_raw_type text := lower(trim(coalesce(p_type,'')));
  v_latest_id text;
begin
  -- Non-top-management callers never enter the management inbox-noise rules.
  if v_role not in ('general_manager','executive_manager','branches_manager') then return true; end if;
  if lower(coalesce(v_meta->>'slaGenerated','false')) = 'true' then return false; end if;

  -- Most live rows already carry a canonical type. Avoid invoking the canonical
  -- SQL helper for those hot-path values; aliases still fall back to the single
  -- source of truth below.
  if v_raw_type in ('staff_task','manager_alert','vip_customer_silence','system','conversation_review','customer_followup') then
    v_canonical := v_raw_type;
  else
    v_canonical := public.canonical_notification_type_v2(p_type);
  end if;

  v_direct := coalesce(
    (nullif(trim(coalesce(p_recipient_user_id,'')),'') = nullif(v_account_id,''))
    or (nullif(trim(coalesce(p_user_id,'')),'') = nullif(v_account_id,''))
    or (nullif(trim(coalesce(p_recipient_staff_id,'')),'') = nullif(v_staff_id,''))
    or (nullif(trim(coalesce(p_staff_id,'')),'') = nullif(v_staff_id,''))
    or (nullif(lower(trim(coalesce(p_recipient_role,''))),'') = nullif(v_role,'')),
    false
  );

  if not v_direct and v_raw_type in ('daily_task_reminder','monthly_evaluation_ready','weekly_evaluation_submitted') then return false; end if;
  if not v_direct and v_canonical = 'staff_task' and v_priority not in ('urgent','critical') then return false; end if;

  if not v_direct and v_canonical = 'conversation_review' then
    begin v_score := nullif(v_meta->>'score','')::numeric; exception when others then v_score := null; end;
    begin v_points := coalesce(nullif(v_meta->>'pointsImpact','')::numeric,nullif(v_meta->>'points_impact','')::numeric); exception when others then v_points := null; end;
    v_critical := lower(coalesce(v_meta->>'hasCriticalError',v_meta->>'has_critical_error',v_meta->>'critical','false')) = 'true';
    if coalesce(v_score,100) >= 90 and coalesce(v_points,0) >= 0 and not v_critical then return false; end if;
  end if;

  if not v_direct and v_canonical in ('customer_followup','vip_customer_silence') and lower(trim(coalesce(p_target_type,''))) = 'vip_customer' then return false; end if;

  if v_canonical in ('staff_task','manager_alert','vip_customer_silence','system')
     or v_raw_type in ('branch_manager_checklist_gap','sync_health','sync_health_alert','system_alert') then
    -- The old implementation asked whether ANY later matching row existed.
    -- That is exactly equivalent to keeping only the latest row in the same
    -- (title, branch, canonical type) group. The expression index introduced
    -- in v4 makes this an indexed top-1 lookup instead of a repeated scan.
    select nx.id::text into v_latest_id
    from public.notifications nx
    where nx.archived_at is null
      and coalesce(nx.title,'') = v_title
      and coalesce(nx.branch,'') = v_branch
      and public.canonical_notification_type_v2(coalesce(nx.notification_type,nx.type)) = v_canonical
    order by nx.created_at desc, nx.id::text desc
    limit 1;

    if v_latest_id is distinct from p_id then return false; end if;
  end if;

  return true;
end;
$$;
