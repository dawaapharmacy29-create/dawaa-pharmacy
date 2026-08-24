begin;

-- Customer Requests V2 command boundary.
-- ROLLOUT ORDER: deploy the V2 application first, confirm canonical RPC writes are
-- healthy, then apply this migration. Applying this revoke while the legacy main
-- client is still active will intentionally break its direct table writes.
-- The app may use anon/authenticated as transport roles, but those roles must
-- never bypass audited SECURITY DEFINER commands with raw table mutations.

drop policy if exists customer_requests_scoped_insert on public.customer_requests;
drop policy if exists customer_requests_scoped_update on public.customer_requests;

revoke insert, update, delete on table public.customer_requests from anon, authenticated;

-- Timeline events are emitted by canonical commands. Keep scoped SELECT for
-- authorized readers, but retire direct client event insertion completely.
drop policy if exists customer_request_events_scoped_insert on public.customer_request_events;

revoke insert, update, delete on table public.customer_request_events from anon, authenticated;

comment on table public.customer_requests is
  'Canonical Customer Requests state. Client writes are forbidden; use Customer Requests command RPCs.';

comment on table public.customer_request_events is
  'Append-only Customer Requests timeline. Events are emitted by canonical command RPCs; direct client writes are forbidden.';

commit;
