alter table public.offers
add column if not exists active boolean generated always as (coalesce(status,'active') = 'active') stored;

create index if not exists idx_offers_active_compat_v1 on public.offers(active) where active is true;
