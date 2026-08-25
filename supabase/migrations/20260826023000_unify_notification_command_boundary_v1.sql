-- One governed notification boundary: canonical actor, per-recipient fan-out,
-- independent read state, and no browser writes to the base table.

create or replace function public.create_notification_audience_v1(
  p_recipient_staff_id text default null,
  p_recipient_role text default null,
  p_branch text default null,
  p_notification_type text default 'system',
  p_title text default 'إشعار جديد',
  p_message text default '',
  p_entity_type text default null,
  p_entity_id text default null,
  p_action_url text default null,
  p_priority text default 'normal',
  p_metadata jsonb default '{}'::jsonb,
  p_dedupe_key text default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor public.staff_accounts%rowtype;
  v_recipient record;
  v_id uuid;
  v_first_id uuid;
  v_count integer := 0;
begin
  select * into v_actor from public.staff_accounts
  where id = public.dawaa_current_staff_account_id_strict()
    and coalesce(active,is_active,true) and coalesce(can_login,true);
  if not found then raise exception 'active staff actor required'; end if;

  for v_recipient in
    select distinct nullif(sa.staff_id,'')::uuid staff_id
    from public.staff_accounts sa
    where coalesce(sa.active,sa.is_active,true) and coalesce(sa.can_login,true)
      and sa.staff_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and (
        (nullif(trim(p_recipient_staff_id),'') is not null and sa.staff_id = trim(p_recipient_staff_id))
        or (
          nullif(trim(p_recipient_staff_id),'') is null
          and nullif(trim(p_recipient_role),'') is not null
          and lower(trim(coalesce(sa.role,sa.staff_role,''))) = lower(trim(p_recipient_role))
          and (nullif(trim(p_branch),'') is null or sa.branch = trim(p_branch))
        )
        or (
          nullif(trim(p_recipient_staff_id),'') is null
          and nullif(trim(p_recipient_role),'') is null
          and sa.id = v_actor.id
        )
      )
    limit 100
  loop
    v_id := public.create_staff_notification(
      v_recipient.staff_id, p_notification_type, p_title, p_message,
      p_entity_type, p_entity_id, p_action_url, p_priority,
      coalesce(p_metadata,'{}'::jsonb) || jsonb_build_object('audienceRole',nullif(trim(p_recipient_role),''),'audienceBranch',nullif(trim(p_branch),'')),
      case when nullif(trim(p_dedupe_key),'') is null then null else trim(p_dedupe_key)||':'||v_recipient.staff_id::text end,
      v_actor.id, nullif(trim(p_branch),'')
    );
    v_first_id := coalesce(v_first_id,v_id);
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then raise exception 'notification audience resolved to no active staff'; end if;
  return v_first_id;
end;
$$;

create or replace function public.mark_my_notification_read_v1(p_notification_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_actor public.staff_accounts%rowtype;
begin
  select * into v_actor from public.staff_accounts where id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,is_active,true) and coalesce(can_login,true);
  if not found then raise exception 'active staff actor required'; end if;
  update public.notifications set is_read=true, read=true, status=case when status='new' then 'read' else status end,
    read_at=coalesce(read_at,now())
  where id=p_notification_id and recipient_staff_id=v_actor.staff_id;
  return found;
end; $$;

create or replace function public.mark_all_my_notifications_read_v1()
returns integer language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_actor public.staff_accounts%rowtype; v_count integer;
begin
  select * into v_actor from public.staff_accounts where id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,is_active,true) and coalesce(can_login,true);
  if not found then raise exception 'active staff actor required'; end if;
  update public.notifications set is_read=true, read=true, status=case when status='new' then 'read' else status end,
    read_at=coalesce(read_at,now())
  where recipient_staff_id=v_actor.staff_id and coalesce(is_read,false)=false;
  get diagnostics v_count = row_count; return v_count;
end; $$;

create or replace function public.transition_staff_notification_action(p_notification_id uuid,p_next_state text)
returns boolean language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_actor public.staff_accounts%rowtype; v_current text; v_now timestamptz:=now();
begin
  if p_next_state not in ('in_progress','completed','dismissed','escalated') then raise exception 'invalid notification action state'; end if;
  select * into v_actor from public.staff_accounts where id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,is_active,true) and coalesce(can_login,true);
  if not found then raise exception 'active staff actor required'; end if;
  select coalesce(nullif(action_status,''),'new') into v_current from public.notifications
    where id=p_notification_id and recipient_staff_id=v_actor.staff_id for update;
  if not found then return false; end if;
  if v_current in ('completed','dismissed') and p_next_state<>v_current then raise exception 'terminal notification action cannot be reopened'; end if;
  update public.notifications set action_status=p_next_state, requires_action=p_next_state not in ('completed','dismissed'),
    is_read=true,read=true,read_at=coalesce(read_at,v_now),
    status=case when p_next_state='in_progress' then 'read' else p_next_state end,
    completed_at=case when p_next_state='completed' then v_now else completed_at end,
    priority=case when p_next_state='escalated' then 'urgent' else priority end,
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('actionState',p_next_state,'actionStateUpdatedAt',v_now)
  where id=p_notification_id;
  return true;
end; $$;

drop policy if exists notifications_insert_app on public.notifications;
revoke insert, update, delete, truncate on public.notifications from anon, authenticated;
revoke execute on function public.create_staff_notification(uuid,text,text,text,text,text,text,text,jsonb,text,uuid) from public,anon,authenticated;
revoke execute on function public.create_staff_notification(uuid,text,text,text,text,text,text,text,jsonb,text,uuid,text) from public,anon,authenticated;
revoke execute on function public.get_my_notifications(text,text,text,integer) from public,anon,authenticated;

revoke all on function public.create_notification_audience_v1(text,text,text,text,text,text,text,text,text,text,jsonb,text) from public;
revoke all on function public.mark_my_notification_read_v1(uuid) from public;
revoke all on function public.mark_all_my_notifications_read_v1() from public;
revoke all on function public.transition_staff_notification_action(uuid,text) from public;
grant execute on function public.create_notification_audience_v1(text,text,text,text,text,text,text,text,text,text,jsonb,text) to anon,authenticated;
grant execute on function public.mark_my_notification_read_v1(uuid) to anon,authenticated;
grant execute on function public.mark_all_my_notifications_read_v1() to anon,authenticated;
grant execute on function public.transition_staff_notification_action(uuid,text) to anon,authenticated;
