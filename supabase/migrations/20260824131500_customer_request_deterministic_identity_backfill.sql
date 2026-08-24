-- Deterministic identity repair for legacy Customer Requests.
-- This migration deliberately avoids fuzzy/name-guess matching. It only fills data
-- when the existing canonical relation or a unique exact product-name match proves
-- the identity.

-- 1) A request already linked to customers.id can safely inherit the canonical code.
update public.customer_requests cr
set customer_code = c.customer_code,
    updated_at = now()
from public.customers c
where cr.customer_id = c.id::text
  and nullif(trim(coalesce(cr.customer_code,'')), '') is null
  and nullif(trim(coalesce(c.customer_code,'')), '') is not null;

-- 2) Link a product only when the request medicine name has exactly one exact
-- case-insensitive match in the catalog and that product has a real product code.
with exact_product_candidates as (
  select
    cr.id as request_id,
    (array_agg(p.id order by p.id))[1] as product_id,
    (array_agg(p.product_code order by p.id))[1] as product_code,
    count(distinct p.id) as candidate_count
  from public.customer_requests cr
  join public.products p
    on lower(trim(p.name)) = lower(trim(cr.medicine_name))
   and nullif(trim(coalesce(p.product_code,'')), '') is not null
  where cr.product_id is null
    and nullif(trim(coalesce(cr.medicine_name,'')), '') is not null
  group by cr.id
), unique_product_candidates as (
  select request_id, product_id, product_code
  from exact_product_candidates
  where candidate_count = 1
)
update public.customer_requests cr
set product_id = candidate.product_id,
    product_code = coalesce(nullif(trim(cr.product_code), ''), candidate.product_code),
    updated_at = now()
from unique_product_candidates candidate
where cr.id = candidate.request_id
  and cr.product_id is null;

-- Do not infer doctor_id from display names here. Historical staff attribution stays
-- in the Data Quality queue until a canonical staff/account relation exists.
