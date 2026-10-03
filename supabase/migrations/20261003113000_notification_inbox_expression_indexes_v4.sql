-- Notification inbox expression indexes v4
-- Align indexes exactly with the expressions used by notification_events_v2 and
-- dawaa_notification_inbox_visible_v3. This replaces the broader v3 indexes whose
-- plain title/branch columns could not satisfy COALESCE-based predicates directly.

-- Keep notifications_sla_source_stage_open_v3_idx: it already matches its predicate.
drop index if exists public.notifications_inbox_title_branch_latest_v3_idx;
drop index if exists public.notifications_vip_dedupe_open_v3_idx;
drop index if exists public.notifications_recipient_dedupe_open_v3_idx;

-- Exact lookup for the canonical-type branch inside dawaa_notification_inbox_visible_v3.
create index if not exists notifications_inbox_canonical_lookup_v4_idx
  on public.notifications (
    (coalesce(title,'')),
    (coalesce(branch,'')),
    (public.canonical_notification_type_v2(coalesce(notification_type,type))),
    created_at desc
  ) include (id)
  where archived_at is null;

-- Exact lookup for the raw-type branch in the same correlated EXISTS.
create index if not exists notifications_inbox_raw_type_lookup_v4_idx
  on public.notifications (
    (coalesce(title,'')),
    (coalesce(branch,'')),
    (lower(trim(coalesce(notification_type,type,'')))),
    created_at desc
  ) include (id)
  where archived_at is null;

-- Exact VIP dedupe lookup used by notification_events_v2.
create index if not exists notifications_vip_dedupe_open_v4_idx
  on public.notifications (
    (lower(coalesce(target_type,entity_type,''))),
    (coalesce(target_id,entity_id,'')),
    (coalesce(title,'')),
    (coalesce(branch,'')),
    (coalesce(recipient_staff_id,staff_id,recipient_role,'')),
    created_at desc
  )
  where archived_at is null;

-- Exact digest/report dedupe lookup used by notification_events_v2.
create index if not exists notifications_recipient_dedupe_open_v4_idx
  on public.notifications (
    (coalesce(title,'')),
    (coalesce(branch,'')),
    (coalesce(recipient_staff_id,staff_id,recipient_role,'')),
    created_at desc
  )
  where archived_at is null;
