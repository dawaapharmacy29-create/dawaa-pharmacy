-- Staff account identifiers are historically mixed (UUIDs and aliases such as "admin").
-- Fan-out writes the canonical staff_accounts.staff_id as text for both shapes.

create or replace function public.create_notification_audience_v1(
  p_recipient_staff_id text default null, p_recipient_role text default null,
  p_branch text default null, p_notification_type text default 'system',
  p_title text default 'إشعار جديد', p_message text default '',
  p_entity_type text default null, p_entity_id text default null,
  p_action_url text default null, p_priority text default 'normal',
  p_metadata jsonb default '{}'::jsonb, p_dedupe_key text default null
) returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_actor public.staff_accounts%rowtype; v_recipient record;
  v_id uuid; v_first_id uuid; v_count integer:=0; v_key text;
begin
  select * into v_actor from public.staff_accounts
  where id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,is_active,true) and coalesce(can_login,true);
  if not found then raise exception 'active staff actor required'; end if;

  for v_recipient in
    select distinct nullif(trim(sa.staff_id),'') staff_id
    from public.staff_accounts sa
    where coalesce(sa.active,sa.is_active,true) and coalesce(sa.can_login,true)
      and nullif(trim(sa.staff_id),'') is not null
      and (
        (nullif(trim(p_recipient_staff_id),'') is not null and sa.staff_id=trim(p_recipient_staff_id))
        or (nullif(trim(p_recipient_staff_id),'') is null and nullif(trim(p_recipient_role),'') is not null
          and lower(trim(coalesce(sa.role,sa.staff_role,'')))=lower(trim(p_recipient_role))
          and (nullif(trim(p_branch),'') is null or sa.branch=trim(p_branch)))
        or (nullif(trim(p_recipient_staff_id),'') is null and nullif(trim(p_recipient_role),'') is null and sa.id=v_actor.id)
      ) limit 100
  loop
    v_key:=case when nullif(trim(p_dedupe_key),'') is null then null else trim(p_dedupe_key)||':'||v_recipient.staff_id end;
    insert into public.notifications(
      recipient_staff_id,notification_type,type,title,message,body,entity_type,entity_id,
      target_type,target_id,action_url,target_route,route,priority,metadata,dedupe_key,
      is_global,is_read,read,status,branch,created_at
    ) values (
      v_recipient.staff_id,coalesce(nullif(trim(p_notification_type),''),'system'),coalesce(nullif(trim(p_notification_type),''),'system'),
      coalesce(nullif(trim(p_title),''),'إشعار جديد'),coalesce(p_message,''),coalesce(p_message,''),
      nullif(trim(p_entity_type),''),nullif(trim(p_entity_id),''),nullif(trim(p_entity_type),''),nullif(trim(p_entity_id),''),
      nullif(trim(p_action_url),''),nullif(trim(p_action_url),''),nullif(trim(p_action_url),''),
      case when p_priority in ('low','normal','high','urgent','critical') then p_priority else 'normal' end,
      coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('createdByStaffAccountId',v_actor.id,'audienceRole',nullif(trim(p_recipient_role),''),'audienceBranch',nullif(trim(p_branch),'')),
      v_key,false,false,false,'new',nullif(trim(p_branch),''),now()
    ) on conflict(dedupe_key) where dedupe_key is not null do update set
      notification_type=excluded.notification_type,type=excluded.type,title=excluded.title,
      message=excluded.message,body=excluded.body,entity_type=excluded.entity_type,entity_id=excluded.entity_id,
      target_type=excluded.target_type,target_id=excluded.target_id,action_url=excluded.action_url,
      target_route=excluded.target_route,route=excluded.route,priority=excluded.priority,
      metadata=excluded.metadata,branch=excluded.branch,is_read=false,read=false,status='new',read_at=null,created_at=now()
    returning id into v_id;
    v_first_id:=coalesce(v_first_id,v_id); v_count:=v_count+1;
  end loop;
  if v_count=0 then raise exception 'notification audience resolved to no active staff'; end if;
  return v_first_id;
end; $$;

revoke all on function public.create_notification_audience_v1(text,text,text,text,text,text,text,text,text,text,jsonb,text) from public;
grant execute on function public.create_notification_audience_v1(text,text,text,text,text,text,text,text,text,text,jsonb,text) to anon,authenticated;
