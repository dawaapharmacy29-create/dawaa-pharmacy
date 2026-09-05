-- Keep conversation review history fast as the table grows.
-- Safe to re-apply: all indexes are created idempotently with IF NOT EXISTS.
create index if not exists idx_conversation_sales_reviews_created_at_desc
  on public.conversation_sales_reviews (created_at desc);

create index if not exists idx_conversation_sales_reviews_branch_created_at_desc
  on public.conversation_sales_reviews (branch, created_at desc);

create index if not exists idx_conversation_sales_reviews_staff_created_at_desc
  on public.conversation_sales_reviews (staff_id, created_at desc);
