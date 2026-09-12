-- Restore notification read access for Dawaa's custom application auth model.
--
-- The web app intentionally uses the Supabase anon key and sends the signed-in
-- Dawaa account id through x-dawaa-user-id. Audience visibility is still enforced
-- by notifications RLS through dawaa_notification_visible_to_current_user_v2.
--
-- The previous privilege-hardening migration accidentally limited the canonical
-- notification read model to the Supabase `authenticated` role, while the app does
-- not create a Supabase Auth session for normal staff logins. That made the UI read
-- zero rows even though notifications were present.

-- Canonical read models are safe to expose to anon because the underlying
-- notifications table remains RLS-protected and the views use security_invoker.
grant select on public.notification_events_v2_base to anon, authenticated;
grant select on public.notification_events_v2 to anon, authenticated;
grant select on public.notification_events_v3 to anon, authenticated;
grant select on public.notifications to anon, authenticated;

-- Helpers used by the RLS visibility predicate must be callable by the role making
-- the request. They derive the current Dawaa account from x-dawaa-user-id/auth.uid().
grant execute on function public.dawaa_current_notification_account_id_v1() to anon, authenticated;
grant execute on function public.dawaa_current_notification_branch_v1() to anon, authenticated;
grant execute on function public.dawaa_current_notification_role_v1() to anon, authenticated;
grant execute on function public.dawaa_current_staff_id_v1() to anon, authenticated;
grant execute on function public.dawaa_notification_visible_to_current_user_v2(text, text, text, text, text, text) to anon, authenticated;

-- Keep writes locked down. State changes continue to flow through scoped RPCs.
revoke insert, update, delete, truncate, references, trigger on public.notifications from anon, authenticated;

-- Read policy must cover the actual application transport role (`anon`) as well as
-- future Supabase-authenticated sessions. Visibility itself remains identity/role/
-- branch scoped by the security-definer predicate.
drop policy if exists notifications_select_visible_v2 on public.notifications;
create policy notifications_select_visible_v2
on public.notifications
for select
to anon, authenticated
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

notify pgrst, 'reload schema';
