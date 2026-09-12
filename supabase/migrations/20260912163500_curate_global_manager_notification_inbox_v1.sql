-- Curate the executive/global-manager notification inbox at the RLS boundary.
-- Staff and branch-level roles keep their full personal notification feed.
-- Global managers stop inheriting every routine employee task/review/VIP row.

create or replace function public.dawaa_notification_inbox_visible_v1(
  p_recipient_user_id text,
  p_user_id text,
  p_recipient_staff_id text,
  p_staff_id text,
  p_recipient_role text,
  p_type text,
  p_priority text,
  p_target_type text,
  p_metadata jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_role text := lower(trim(coalesce(public.dawaa_current_notification_role_v1(),'')));
  v_account_id text := public.dawaa_current_notification_account_id_v1();
  v_staff_id text := public.dawaa_current_staff_id_v1();
  v_canonical text := public.canonical_notification_type_v2(p_type);
  v_score numeric;
  v_points numeric;
  v_critical boolean := false;
  v_meta jsonb := coalesce(p_metadata,'{}'::jsonb);
begin
  if v_role not in ('general_manager','executive_manager','branches_manager') then
    return true;
  end if;

  if nullif(trim(coalesce(p_recipient_user_id,'')),'') = v_account_id
     or nullif(trim(coalesce(p_user_id,'')),'') = v_account_id
     or nullif(trim(coalesce(p_recipient_staff_id,'')),'') = v_staff_id
     or nullif(trim(coalesce(p_staff_id,'')),'') = v_staff_id
     or lower(trim(coalesce(p_recipient_role,''))) = v_role then
    return true;
  end if;

  if lower(coalesce(v_meta->>'slaGenerated','false')) = 'true' then
    return false;
  end if;

  if v_canonical = 'staff_task'
     and lower(trim(coalesce(p_priority,''))) not in ('urgent','critical') then
    return false;
  end if;

  if v_canonical = 'conversation_review' then
    begin
      v_score := nullif(v_meta->>'score','')::numeric;
    exception when others then
      v_score := null;
    end;
    begin
      v_points := coalesce(
        nullif(v_meta->>'pointsImpact','')::numeric,
        nullif(v_meta->>'points_impact','')::numeric
      );
    exception when others then
      v_points := null;
    end;
    v_critical := lower(coalesce(
      v_meta->>'hasCriticalError',
      v_meta->>'has_critical_error',
      v_meta->>'critical',
      'false'
    )) = 'true';

    if coalesce(v_score,100) >= 90
       and coalesce(v_points,0) >= 0
       and not v_critical then
      return false;
    end if;
  end if;

  if v_canonical in ('customer_followup','vip_customer_silence')
     and lower(trim(coalesce(p_target_type,''))) = 'vip_customer' then
    return false;
  end if;

  return true;
end;
$$;

grant execute on function public.dawaa_notification_inbox_visible_v1(
  text,text,text,text,text,text,text,text,jsonb
) to anon, authenticated;

drop policy if exists notifications_select_visible_v2 on public.notifications;
create policy notifications_select_visible_v2
on public.notifications
for select
to anon, authenticated
using (
  public.dawaa_notification_visible_to_current_user_v2(
    recipient_user_id,
    user_id::text,
    recipient_staff_id,
    staff_id,
    recipient_role,
    branch
  )
  and public.dawaa_notification_inbox_visible_v1(
    recipient_user_id,
    user_id::text,
    recipient_staff_id,
    staff_id,
    recipient_role,
    coalesce(notification_type,type),
    priority,
    target_type,
    metadata
  )
);
