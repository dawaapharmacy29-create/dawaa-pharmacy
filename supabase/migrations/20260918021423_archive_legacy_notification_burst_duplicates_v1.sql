-- Preserve notification history while removing only byte-for-byte equivalent
-- burst duplicates from active inboxes. Different messages in the same minute
-- remain separate events even when their title/audience match.
with ranked as (
  select
    id,
    row_number() over (
      partition by
        lower(coalesce(type, notification_type, '')),
        coalesce(recipient_staff_id::text, ''),
        coalesce(recipient_role, ''),
        coalesce(branch, ''),
        coalesce(target_type, ''),
        coalesce(target_id, ''),
        coalesce(title, ''),
        coalesce(message, body, ''),
        date_trunc('minute', created_at)
      order by created_at asc, id asc
    ) as duplicate_rank
  from public.notifications
  where archived_at is null
)
update public.notifications n
set
  archived_at = coalesce(n.archived_at, now()),
  metadata = coalesce(n.metadata, '{}'::jsonb) || jsonb_build_object(
    'archivedReason', 'exact_burst_duplicate_v1',
    'archivedAt', now()
  )
from ranked r
where n.id = r.id
  and r.duplicate_rank > 1;
