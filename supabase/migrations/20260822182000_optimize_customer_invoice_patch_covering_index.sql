-- Keep the customer invoice patch path index-only without increasing the final index count.
-- This is the same customer_code/invoice_date covering index used by loyalty/customer reads,
-- with `id` added because api/customers.ts selects it while aggregating customer metrics.
create index if not exists sales_invoices_customer_patch_cover_full_v2
on public.sales_invoices (customer_code, invoice_date)
include (
  id,
  net_total,
  net_amount,
  discounted_amount,
  amount,
  total_amount,
  gross_total,
  gross_amount,
  branch,
  branch_name
);

-- The new index is a strict superset of this older covering index.
drop index if exists public.sales_invoices_loyalty_code_invoice_date_idx;

-- Cleanup only: this name was used by an earlier partial-index experiment and
-- is not required by the final plan. Safe on environments where it never existed.
drop index if exists public.sales_invoices_customer_patch_cover_v2;
