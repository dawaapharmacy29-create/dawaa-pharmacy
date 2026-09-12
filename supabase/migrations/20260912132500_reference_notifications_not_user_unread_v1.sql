-- Reference-only notifications (currently SLA escalation copies) are audit/history,
-- not a second user workflow. Keep them queryable while preventing unread/action noise.

create or replace function public.normalize_reference_notification_visibility_v1()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if lower(coalesce(new.metadata->>'slaGenerated','false')) = 'true' then
    new.requires_action := false;
    new.sound_enabled := false;
    new.is_read := true;
    new.read := true;
    if coalesce(nullif(new.status,''),'new') = 'new' then
      new.status := 'read';
    end if;
    new.read_at := coalesce(new.read_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_normalize_reference_notification_visibility_v1 on public.notifications;
create trigger trg_normalize_reference_notification_visibility_v1
before insert or update on public.notifications
for each row execute function public.normalize_reference_notification_visibility_v1();

update public.notifications
set is_read = true,
    read = true,
    status = case when coalesce(nullif(status,''),'new')='new' then 'read' else status end,
    read_at = coalesce(read_at, now()),
    requires_action = false,
    sound_enabled = false
where lower(coalesce(metadata->>'slaGenerated','false'))='true'
  and (
    not coalesce(is_read,false)
    or not coalesce(read,false)
    or coalesce(requires_action,false)
    or coalesce(sound_enabled,false)
  );
