-- Notification V3 privilege hardening.
-- Clients read through RLS-backed canonical views and mutate state only through scoped RPCs.

revoke all on public.notification_events_v2_base from anon, authenticated;
grant select on public.notification_events_v2_base to authenticated;

revoke all on public.notification_events_v2 from anon, authenticated;
grant select on public.notification_events_v2 to authenticated;

revoke all on public.notification_events_v3 from anon, authenticated;
grant select on public.notification_events_v3 to authenticated;

revoke all on public.notifications from anon;
revoke insert, update, delete, truncate, references, trigger on public.notifications from authenticated;
grant select on public.notifications to authenticated;

drop policy if exists notifications_select_visible_v2 on public.notifications;
create policy notifications_select_visible_v2
on public.notifications
for select
to authenticated
using (
  public.dawaa_notification_visible_to_current_user_v2(
    recipient_user_id,
    user_id::text,
    recipient_staff_id,
    staff_id,
    recipient_role,
    branch
  )
);

drop policy if exists notifications_update_visible_v2 on public.notifications;

notify pgrst,'reload schema';
