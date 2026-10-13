-- Canonical product identity for incentive-list catalog.
-- The same product may have a branch-specific incentive later, so uniqueness is scoped by branch.

alter table public.incentive_medicines
  add column if not exists product_code text;

update public.incentive_medicines
set product_code = nullif(trim(product_code), '')
where product_code is not null;

create unique index if not exists incentive_medicines_product_code_branch_uidx
  on public.incentive_medicines(product_code, branch);

create index if not exists incentive_medicines_active_code_idx
  on public.incentive_medicines(active, product_code)
  where product_code is not null;

comment on column public.incentive_medicines.product_code is
  'Canonical B-Connect/product catalog code used to match incentive-list items safely.';
