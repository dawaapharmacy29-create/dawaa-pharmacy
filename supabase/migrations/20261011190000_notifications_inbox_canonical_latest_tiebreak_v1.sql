-- Match the latest-row lookup ordering exactly, including its text UUID tie-break.
-- Keep the existing canonical lookup index until Production plan evidence supports removal.
create index if not exists notifications_inbox_canonical_latest_v5_idx
  on public.notifications (
    (coalesce(title, '')),
    (coalesce(branch, '')),
    (public.canonical_notification_type_v2(coalesce(notification_type, type))),
    created_at desc,
    ((id::text)) desc
  )
  where archived_at is null;
