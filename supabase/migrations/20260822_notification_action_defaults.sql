-- Normalize action semantics for every notification writer, including legacy direct inserts.

begin;

create or replace function public.normalize_notification_action_defaults()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_type text := lower(coalesce(new.notification_type, new.type, 'system'));
  v_priority text := lower(coalesce(new.priority, 'normal'));
begin
  new.action_status := coalesce(nullif(new.action_status, ''), 'new');
  new.status := coalesce(nullif(new.status, ''), case when coalesce(new.is_read, new.read, false) then 'read' else 'new' end);
  new.is_read := coalesce(new.is_read, new.read, false);
  new.read := coalesce(new.read, new.is_read, false);

  if new.requires_action is null then
    new.requires_action :=
      v_priority in ('urgent','critical')
      or v_type ~ '(task|followup|request|deduction|penalty|attendance|inventory|stock|expiry|delivery|shift_issue|manager_alert|vip_customer_silence)';
  end if;

  if coalesce(new.route, new.target_route, new.action_url, '') <> '' then
    new.route := coalesce(nullif(new.route, ''), nullif(new.target_route, ''), nullif(new.action_url, ''));
    new.target_route := coalesce(nullif(new.target_route, ''), new.route);
    new.action_url := coalesce(nullif(new.action_url, ''), new.route);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_normalize_notification_action_defaults on public.notifications;
create trigger trg_normalize_notification_action_defaults
before insert or update on public.notifications
for each row execute function public.normalize_notification_action_defaults();

commit;
