-- Authenticated application command for staff notifications.
-- Internal triggers keep using create_staff_notification; browser callers use
-- this wrapper so a canonical active staff actor is always required.

create or replace function public.create_staff_notification_client_v1(
  p_recipient_staff_id uuid,
  p_notification_type text,
  p_title text,
  p_message text,
  p_entity_type text default null,
  p_entity_id text default null,
  p_action_url text default null,
  p_priority text default 'normal',
  p_metadata jsonb default '{}'::jsonb,
  p_dedupe_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor_id uuid;
begin
  v_actor_id := public.dawaa_current_staff_account_id_strict();
  if v_actor_id is null then raise exception 'active staff actor required'; end if;
  return public.create_staff_notification(
    p_recipient_staff_id, p_notification_type, p_title, p_message,
    p_entity_type, p_entity_id, p_action_url, p_priority, p_metadata,
    p_dedupe_key, v_actor_id
  );
end;
$$;

revoke all on function public.create_staff_notification_client_v1(uuid,text,text,text,text,text,text,text,jsonb,text)
  from public;
grant execute on function public.create_staff_notification_client_v1(uuid,text,text,text,text,text,text,text,jsonb,text)
  to anon, authenticated;
