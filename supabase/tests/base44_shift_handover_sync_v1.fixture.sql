-- Synthetic isolated fixture; reuses the GM daily review fixture (no production IDs).
\ir gm_daily_review_v1.fixture.sql

create table public.base44_sync_run_log(id uuid primary key default gen_random_uuid(), ran_at timestamptz default now(),
  status text, total integer, matched integer, ambiguous integer, unmatched integer, error_message text);
-- Production already has the Base44 id and its unique index, and grants the browser roles everything.
alter table public.shift_handovers add column base44_id text;
create unique index shift_handovers_base44_id_key on public.shift_handovers (base44_id);
grant select, insert, update, delete on public.shift_handovers to anon, authenticated;
