-- Prevent accidental audience-less notifications from becoming effectively global.
-- Global delivery must be explicit via is_global=true.

create or replace function public.dawaa_enforce_notification_audience_v1()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  v_staff_id text;
begin
  if coalesce(new.is_global, false) then
    return new;
  end if;

  if nullif(trim(coalesce(new.recipient_user_id, '')), '') is not null
     or new.user_id is not null
     or nullif(trim(coalesce(new.recipient_staff_id, '')), '') is not null
     or nullif(trim(coalesce(new.staff_id, '')), '') is not null
     or nullif(trim(coalesce(new.recipient_role, '')), '') is not null
     or nullif(trim(coalesce(new.branch, '')), '') is not null then
    return new;
  end if;

  v_staff_id := nullif(trim(coalesce(public.dawaa_current_staff_id_v1(), '')), '');
  if v_staff_id is not null then
    new.recipient_staff_id := v_staff_id;
    new.staff_id := coalesce(nullif(trim(coalesce(new.staff_id, '')), ''), v_staff_id);
    return new;
  end if;

  raise exception 'notification audience is required (recipient user/staff/role/branch or explicit is_global=true)';
end;
$$;

drop trigger if exists daw_notification_audience_guard_v1 on public.notifications;
create trigger daw_notification_audience_guard_v1
before insert on public.notifications
for each row
execute function public.dawaa_enforce_notification_audience_v1();
