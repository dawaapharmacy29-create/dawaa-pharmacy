create or replace function public.get_staff_dashboard_actions_v1(
  p_staff_id text,
  p_user_id text,
  p_staff_name text,
  p_role text,
  p_branch text
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
with params as (
  select
    nullif(btrim(coalesce(p_staff_id,'')),'') as staff_id_text,
    case when coalesce(p_staff_id,'') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then p_staff_id::uuid end as staff_uuid,
    nullif(btrim(coalesce(p_user_id,'')),'') as user_id_text,
    case when coalesce(p_user_id,'') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then p_user_id::uuid end as user_uuid,
    lower(btrim(coalesce(p_staff_name,''))) as staff_name_key,
    lower(btrim(coalesce(p_role,''))) as role_key,
    btrim(coalesce(p_branch,'')) as branch_key
), visible_notifications as materialized (
  select n.*
  from public.notifications n cross join params p
  where
    coalesce(n.is_global,false)=true
    or (p.staff_id_text is not null and (n.recipient_staff_id=p.staff_id_text or n.staff_id=p.staff_id_text))
    or (p.user_id_text is not null and n.recipient_user_id=p.user_id_text)
    or (p.user_uuid is not null and n.user_id=p.user_uuid)
    or (p.role_key<>'' and lower(btrim(coalesce(n.recipient_role,'')))=p.role_key)
    or (
      p.branch_key<>'' and n.branch=p.branch_key
      and nullif(btrim(coalesce(n.recipient_staff_id,'')),'') is null
      and nullif(btrim(coalesce(n.recipient_user_id,'')),'') is null
      and n.user_id is null
      and nullif(btrim(coalesce(n.recipient_role,'')),'') is null
    )
), open_followups as (
  select df.*
  from public.daily_followups df cross join params p
  where coalesce(df.is_hidden,false)=false
    and df.completed_at is null
    and df.cancelled_at is null
    and lower(coalesce(df.status,'')) not in ('completed','done','closed','cancelled','archived')
    and lower(coalesce(df.followup_status,'')) not in ('completed','done','closed','cancelled')
    and coalesce(df.status,'') not in ('تم','مكتمل','ملغي')
    and coalesce(df.followup_status,'') not in ('تم','مكتمل','تم التواصل','تم الشراء بعد المتابعة','ملغي')
    and (
      (p.staff_uuid is not null and (df.assigned_staff_id=p.staff_uuid or df.staff_id=p.staff_uuid))
      or (p.staff_name_key<>'' and lower(btrim(coalesce(df.responsible_name,'')))=p.staff_name_key)
      or (p.staff_name_key<>'' and lower(btrim(coalesce(df.assigned_to,'')))=p.staff_name_key)
      or (p.staff_name_key<>'' and lower(btrim(coalesce(df.assigned_doctor,'')))=p.staff_name_key)
    )
), open_tasks as (
  select t.*
  from public.tasks t cross join params p
  where lower(coalesce(t.status,'')) not in ('completed','done','closed','cancelled')
    and coalesce(t.status,'') not in ('تم','مكتمل','ملغي')
    and (
      (p.staff_uuid is not null and t.staff_id=p.staff_uuid)
      or (p.staff_id_text is not null and t.assigned_to=p.staff_id_text)
      or (p.staff_name_key<>'' and lower(btrim(coalesce(t.assigned_name,'')))=p.staff_name_key)
      or (p.staff_name_key<>'' and lower(btrim(coalesce(t.assigned_to,'')))=p.staff_name_key)
    )
), latest_notifications as (
  select id,title,coalesce(nullif(body,''),message,description,'') as message,type,priority,status,requires_action,created_at,route,target_route,target_type,target_id
  from visible_notifications
  order by created_at desc
  limit 8
)
select jsonb_build_object(
  'unread_notifications', (select count(*) from visible_notifications where coalesce(read,false)=false and coalesce(is_read,false)=false and lower(coalesce(status,'')) not in ('read','completed','dismissed')),
  'urgent_actions', (select count(*) from visible_notifications where coalesce(requires_action,false)=true or lower(coalesce(priority,'')) in ('high','urgent','critical','عاجل','حرج')),
  'open_tasks', (select count(*) from open_tasks),
  'open_followups', (select count(*) from open_followups),
  'latest_notifications', coalesce((select jsonb_agg(to_jsonb(x)) from latest_notifications x),'[]'::jsonb)
);
$$;

revoke all on function public.get_staff_dashboard_actions_v1(text,text,text,text,text) from public;
grant execute on function public.get_staff_dashboard_actions_v1(text,text,text,text,text) to authenticated;
