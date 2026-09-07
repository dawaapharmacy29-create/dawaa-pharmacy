-- Fail closed: browser roles may only read visible notification action history.
revoke all on table public.notification_action_events from anon, authenticated;
grant select on table public.notification_action_events to anon, authenticated;
