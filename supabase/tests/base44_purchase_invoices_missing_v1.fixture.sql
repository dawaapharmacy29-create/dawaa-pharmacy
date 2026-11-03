-- Synthetic isolated fixture; reuses the review fixture (no production IDs).
\ir gm_review_bills_purchases_links_v1.fixture.sql

alter table public.base44_purchase_invoice_sync add column synced_at timestamptz not null default now();
