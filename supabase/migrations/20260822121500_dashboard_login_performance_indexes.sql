-- Dashboard/login performance hardening — 2026-08-22
-- Existing production schema already has strong invoice/follow-up/login indexes.
-- Keep only the missing compound audit-log lookup used by user-scoped recent activity.

create index if not exists idx_activity_log_user_created_at
  on public.activity_log (user_id, created_at desc)
  where user_id is not null;
