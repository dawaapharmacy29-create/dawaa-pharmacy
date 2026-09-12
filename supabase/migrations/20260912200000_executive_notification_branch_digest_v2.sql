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
set search_path = public, pg_catalog
as $$
  select
    case
      when public.canonical_notification_type_v2(coalesce(n.type,n.target_type)) = 'staff_task' then 'tasks'
      when public.canonical_notification_type_v2(coalesce(n.type,n.target_type)) in ('customer_followup','vip_customer_silence','customer_request','customer_data_review','welcome_task') then 'customers'
      when public.canonical_notification_type_v2(coalesce(n.type,n.target_type)) = 'conversation_review' then 'reviews'
      when public.canonical_notification_type_v2(coalesce(n.type,n.target_type)) in ('system','manager_alert') then 'operations'
      when public.canonical_notification_type_v2(coalesce(n.type,n.target_type)) in ('inventory','expiry_alert') then 'inventory'
      else 'other'
    end as signal_group,
    coalesce(nullif(trim(n.branch),''),'كل الفروع') as branch,
    count(*)::bigint as total,
    count(*) filter (where not coalesce(n.is_read,false))::bigint as unread,
    count(*) filter (where lower(coalesce(n.priority,'')) in ('urgent','critical'))::bigint as urgent,
    count(*) filter (where coalesce(n.requires_action,false))::bigint as requires_action,
    max(n.created_at) as latest_at
  from public.notification_events_v2 n
  where n.created_at >= now() - interval '7 days'
  group by 1,2
  order by 5 desc,6 desc,4 desc,3 desc;
$$;

drop function if exists public.get_executive_notification_branch_cards_v2();
create function public.get_executive_notification_branch_cards_v2()
returns table(
  branch text,
  total bigint,
  unread bigint,
  urgent bigint,
  action_required bigint,
  tasks bigint,
  customers bigint,
  reviews bigint,
  operations bigint,
  inventory bigint,
  digests bigint,
  latest_at timestamptz
)
language sql
stable
set search_path = public, pg_catalog
as $$
  with visible as (
    select
      n.*,
      public.canonical_notification_type_v2(coalesce(n.type,n.target_type)) as canonical_type,
      lower(coalesce(n.metadata->>'signalTier','')) as signal_tier
    from public.notification_events_v2 n
    where n.created_at >= now() - interval '7 days'
  )
  select
    coalesce(nullif(trim(v.branch),''),'كل الفروع') as branch,
    count(*)::bigint as total,
    count(*) filter (where not coalesce(v.is_read,false))::bigint as unread,
    count(*) filter (where lower(coalesce(v.priority,'')) in ('urgent','critical') or v.signal_tier='critical')::bigint as urgent,
    count(*) filter (where coalesce(v.requires_action,false) or v.signal_tier in ('critical','action','attention'))::bigint as action_required,
    count(*) filter (where v.canonical_type='staff_task')::bigint as tasks,
    count(*) filter (where v.canonical_type in ('customer_followup','vip_customer_silence','customer_request','customer_data_review','welcome_task'))::bigint as customers,
    count(*) filter (where v.canonical_type='conversation_review')::bigint as reviews,
    count(*) filter (where v.canonical_type in ('system','manager_alert'))::bigint as operations,
    count(*) filter (where v.canonical_type in ('inventory','expiry_alert'))::bigint as inventory,
    count(*) filter (where v.signal_tier='digest')::bigint as digests,
    max(v.created_at) as latest_at
  from visible v
  group by 1
  order by 3 desc,4 desc,5 desc,2 desc;
$$;

grant execute on function public.get_executive_notification_digest_v1() to anon, authenticated;
grant execute on function public.get_executive_notification_branch_cards_v2() to anon, authenticated;
