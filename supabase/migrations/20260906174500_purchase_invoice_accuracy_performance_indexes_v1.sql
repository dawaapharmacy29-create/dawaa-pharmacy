-- Performance indexes for purchase-invoice accuracy dashboard/search.
-- Keep the page fast as review history and Base44 sync tables grow.

create extension if not exists pg_trgm;

-- Pending queue: newest-first scans and common dashboard filters.
create index if not exists idx_base44_purchase_invoice_sync_pending_date_v1
  on public.base44_purchase_invoice_sync (invoice_date desc, synced_at desc)
  where review_id is null;

create index if not exists idx_base44_purchase_invoice_sync_pending_branch_date_v1
  on public.base44_purchase_invoice_sync (branch, invoice_date desc)
  where review_id is null;

create index if not exists idx_base44_purchase_invoice_sync_pending_staff_date_v1
  on public.base44_purchase_invoice_sync (entered_by_staff_id, invoice_date desc)
  where review_id is null;

-- Historical pending search. Trigram indexes support the contains-search used by the RPC.
create index if not exists idx_base44_purchase_invoice_sync_invoice_number_trgm_v1
  on public.base44_purchase_invoice_sync using gin (lower(coalesce(system_invoice_number, '')) gin_trgm_ops)
  where review_id is null;

create index if not exists idx_base44_purchase_invoice_sync_base44_id_trgm_v1
  on public.base44_purchase_invoice_sync using gin (lower(coalesce(base44_id, '')) gin_trgm_ops)
  where review_id is null;

create index if not exists idx_base44_purchase_invoice_sync_entered_by_raw_trgm_v1
  on public.base44_purchase_invoice_sync using gin (lower(coalesce(entered_by_raw, '')) gin_trgm_ops)
  where review_id is null;

-- Review history/report filters and newest-first history reads.
create index if not exists idx_purchase_invoice_entry_reviews_date_created_v1
  on public.purchase_invoice_entry_reviews (review_date desc, created_at desc);

create index if not exists idx_purchase_invoice_entry_reviews_staff_date_v1
  on public.purchase_invoice_entry_reviews (staff_id, review_date desc);

create index if not exists idx_purchase_invoice_entry_reviews_branch_date_v1
  on public.purchase_invoice_entry_reviews (branch, review_date desc);

create index if not exists idx_purchase_invoice_entry_reviews_reviewer_date_v1
  on public.purchase_invoice_entry_reviews (reviewed_by_name, review_date desc);

create index if not exists idx_purchase_invoice_entry_reviews_invoice_reference_trgm_v1
  on public.purchase_invoice_entry_reviews using gin (lower(coalesce(invoice_reference, '')) gin_trgm_ops);

create index if not exists idx_purchase_invoice_entry_reviews_reviewer_trgm_v1
  on public.purchase_invoice_entry_reviews using gin (lower(coalesce(reviewed_by_name, '')) gin_trgm_ops);

create index if not exists idx_purchase_invoice_entry_reviews_notes_trgm_v1
  on public.purchase_invoice_entry_reviews using gin (lower(coalesce(notes, '')) gin_trgm_ops);
