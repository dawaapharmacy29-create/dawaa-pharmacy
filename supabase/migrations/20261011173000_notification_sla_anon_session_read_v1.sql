-- Restore custom-session reads for the security-invoker notification SLA read model.
-- The existing authenticated policies remain unchanged.

grant select on public.notification_sla_policies to anon;

drop policy if exists notification_sla_policies_anon_verified_staff_read_v1
  on public.notification_sla_policies;
create policy notification_sla_policies_anon_verified_staff_read_v1
on public.notification_sla_policies
for select
to anon
using (public.dawaa_current_staff_account_id_strict() is not null);

drop policy if exists notification_sla_events_anon_visible_v1
  on public.notification_sla_events;
create policy notification_sla_events_anon_visible_v1
on public.notification_sla_events
for select
to anon
using (
  exists (
    select 1
    from public.notifications n
    where n.id = notification_sla_events.notification_id
      and public.dawaa_notification_visible_to_current_user_v2(
        n.recipient_user_id,
        n.user_id::text,
        n.recipient_staff_id,
        n.staff_id,
        n.recipient_role,
        n.branch
      )
  )
);

notify pgrst, 'reload schema';
