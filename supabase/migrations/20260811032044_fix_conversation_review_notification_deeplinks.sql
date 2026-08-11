create or replace function public.enforce_conversation_review_notification_route()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_route text;
begin
  v_kind := lower(coalesce(new.type, new.target_type, ''));
  if v_kind in ('conversation_review','conversation_sales_review') and new.target_id is not null then
    v_route := '/reviews?id=' || new.target_id::text;
    new.route := v_route;
    new.target_route := v_route;
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'route', v_route,
      'review_id', new.target_id::text
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_conversation_review_notification_route on public.notifications;
create trigger trg_enforce_conversation_review_notification_route
before insert or update on public.notifications
for each row
execute function public.enforce_conversation_review_notification_route();

update public.notifications
set route = '/reviews?id=' || target_id::text,
    target_route = '/reviews?id=' || target_id::text,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'route', '/reviews?id=' || target_id::text,
      'review_id', target_id::text
    )
where lower(coalesce(type, target_type, '')) in ('conversation_review','conversation_sales_review')
  and target_id is not null;
