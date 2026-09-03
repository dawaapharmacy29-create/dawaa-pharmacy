-- Attendance sync watermark: prevent false absence/missing-checkout judgments until the biometric source explicitly confirms complete sync coverage.
create table if not exists public.biometric_sync_watermarks (
  provider text not null,
  scope_key text not null default 'global',
  complete_through timestamptz not null,
  reported_at timestamptz not null default now(),
  client_id uuid null references public.biometric_api_clients(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  primary key (provider, scope_key)
);

alter table public.biometric_sync_watermarks enable row level security;
revoke all on public.biometric_sync_watermarks from anon, authenticated;
grant select on public.biometric_sync_watermarks to service_role;

create or replace function public.attendance_sync_complete_through_v1(p_provider text default 'fingerprint_vendor_primary')
returns timestamptz
language sql
stable
security definer
set search_path=public,pg_catalog
as $$
  select max(w.complete_through)
  from public.biometric_sync_watermarks w
  where w.provider=p_provider and w.scope_key='global';
$$;
revoke all on function public.attendance_sync_complete_through_v1(text) from public;
grant execute on function public.attendance_sync_complete_through_v1(text) to anon, authenticated, service_role;

-- attendance_daily_command_v1 is updated in production to emit sync_pending / sync_pending_checkout
-- when the source has not confirmed complete coverage through the scheduled shift end.
