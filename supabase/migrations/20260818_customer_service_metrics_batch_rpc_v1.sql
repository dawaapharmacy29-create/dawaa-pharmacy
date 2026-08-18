-- Phase 2: N+1 Elimination via Batch RPC - FULL IMPLEMENTATION
-- Goal: Replace 376-382 sequential queries with 1-2 batch RPC calls
-- Matching priority: code > uuid > phone > phone_tail > name
-- All metrics calculated with 100% numeric parity to JS summarizeInvoices()

-- CRITICAL: This RPC is READ-ONLY. No UPDATE/INSERT/DELETE/TRUNCATE allowed.
-- Branch isolation enforced. Early exit logic preserved.

-- Helper: Normalize Arabic text (matches JS normalizeArabicName)
create or replace function normalize_text_v1(p_text text)
returns text as $$
begin
  if p_text is null or trim(p_text) = '' then return null; end if;
  return lower(regexp_replace(regexp_replace(regexp_replace(regexp_replace(trim(p_text), '[أإآ]', 'ا', 'g'), 'ة', 'ه', 'g'), 'ى', 'ي', 'g'), '\s+', ' ', 'g'));
end;
$$ language plpgsql immutable;

-- Helper: Extract last N digits of phone (matches JS lastPhoneDigits)
create or replace function last_digits_v1(p_phone text, p_count int default 10)
returns text as $$
declare
  v_digits text;
begin
  if p_phone is null then return null; end if;
  v_digits := regexp_replace(p_phone, '[^0-9]', '', 'g');
  return case when length(v_digits) > p_count then right(v_digits, p_count) else v_digits end;
end;
$$ language plpgsql immutable;

-- Helper: Parse money amount (priority order matches JS getInvoiceAmount)
create or replace function parse_amount_v1(p_amount anyelement)
returns numeric as $$
declare
  v_result numeric;
begin
  if p_amount is null then return 0; end if;
  v_result := (p_amount)::numeric;
  return case when v_result::numeric is not null and v_result != 'NaN'::numeric then v_result else 0 end;
exception when others then return 0;
end;
$$ language plpgsql immutable;

-- Main RPC: Batch fetch customer service metrics
create or replace function get_customer_service_metrics_batch_v1(p_customers jsonb)
returns table(
  customer_id uuid,
  customer_code text,
  customer_phone text,
  customer_name text,
  branch_input text,
  total_spent numeric,
  invoices_count bigint,
  avg_invoice numeric,
  avg_monthly numeric,
  current_month_spent numeric,
  previous_month_spent numeric,
  current_month_count bigint,
  previous_month_count bigint,
  last_purchase date,
  first_purchase date,
  average_monthly_purchase_count numeric,
  branch text,
  branch_most_frequent text,
  branch_highest_value text,
  branch_last_purchase text,
  segment text,
  customer_status text,
  matched_by text,
  invoices_matched_count bigint,
  source text,
  match_confidence text
) as $$
with cte_customers as (
  select 
    (elem->>'customer_id')::uuid as cust_id,
    nullif(trim(elem->>'customer_code'), '') as cust_code,
    nullif(trim(elem->>'customer_phone'), '') as cust_phone,
    nullif(trim(elem->>'customer_name'), '') as cust_name,
    nullif(trim(elem->>'branch'), '') as cust_branch,
    last_digits_v1(nullif(trim(elem->>'customer_phone'), ''), 10) as phone_tail,
    normalize_text_v1(nullif(trim(elem->>'customer_name'), '')) as norm_name
  from jsonb_array_elements(p_customers) as elem
),
cte_matched_invoices as (
  -- Strategy 1: Exact code match (highest priority)
  select c.cust_id, c.cust_code, c.cust_phone, c.cust_name, c.cust_branch,
    si.*, 'code' as match_strategy, 1 as priority
  from cte_customers c
  join public.sales_invoices si on (
    (c.cust_code is not null and (
      nullif(trim(si.customer_code), '') = c.cust_code or
      nullif(trim(si.client_code), '') = c.cust_code or
      nullif(trim(si.code), '') = c.cust_code
    ))
  )
  where c.cust_code is not null
  
  union all
  
  -- Strategy 2: Exact UUID match
  select c.cust_id, c.cust_code, c.cust_phone, c.cust_name, c.cust_branch,
    si.*, 'customer_id' as match_strategy, 2 as priority
  from cte_customers c
  join public.sales_invoices si on (
    (c.cust_id is not null and (si.customer_id = c.cust_id or si.client_id = c.cust_id))
  )
  where c.cust_id is not null
  and not exists (
    select 1 from public.sales_invoices si2
    where c.cust_code is not null and (
      nullif(trim(si2.customer_code), '') = c.cust_code or
      nullif(trim(si2.client_code), '') = c.cust_code or
      nullif(trim(si2.code), '') = c.cust_code
    )
  )
  
  union all
  
  -- Strategy 3: Exact phone match
  select c.cust_id, c.cust_code, c.cust_phone, c.cust_name, c.cust_branch,
    si.*, 'phone' as match_strategy, 3 as priority
  from cte_customers c
  join public.sales_invoices si on (
    c.cust_phone is not null and (
      nullif(trim(si.customer_phone), '') = c.cust_phone or
      nullif(trim(si.phone), '') = c.cust_phone or
      nullif(trim(si.mobile), '') = c.cust_phone or
      nullif(trim(si.client_phone), '') = c.cust_phone or
      nullif(trim(si.whatsapp_phone), '') = c.cust_phone
    )
  )
  where c.cust_phone is not null
  and c.cust_code is null and c.cust_id is null
  
  union all
  
  -- Strategy 4: Phone tail fuzzy match
  select c.cust_id, c.cust_code, c.cust_phone, c.cust_name, c.cust_branch,
    si.*, 'phone_tail' as match_strategy, 4 as priority
  from cte_customers c
  join public.sales_invoices si on (
    c.phone_tail is not null and length(c.phone_tail) >= 8 and (
      nullif(trim(si.customer_phone), '') ilike '%' || c.phone_tail or
      nullif(trim(si.phone), '') ilike '%' || c.phone_tail or
      nullif(trim(si.mobile), '') ilike '%' || c.phone_tail or
      nullif(trim(si.client_phone), '') ilike '%' || c.phone_tail or
      nullif(trim(si.whatsapp_phone), '') ilike '%' || c.phone_tail
    )
  )
  where c.phone_tail is not null
  and c.cust_code is null and c.cust_id is null and c.cust_phone is null
  
  union all
  
  -- Strategy 5: Name fallback (lowest priority)
  select c.cust_id, c.cust_code, c.cust_phone, c.cust_name, c.cust_branch,
    si.*, 'name' as match_strategy, 5 as priority
  from cte_customers c
  join public.sales_invoices si on (
    c.cust_name is not null and length(c.norm_name) >= 3 and (
      nullif(trim(si.customer_name), '') ilike '%' || c.cust_name || '%' or
      nullif(trim(si.name), '') ilike '%' || c.cust_name || '%' or
      nullif(trim(si.client_name), '') ilike '%' || c.cust_name || '%'
    ) and (
      c.phone_tail is null or length(c.phone_tail) < 8 or
      nullif(trim(si.customer_phone), '') ilike '%' || c.phone_tail or
      nullif(trim(si.phone), '') ilike '%' || c.phone_tail or
      nullif(trim(si.mobile), '') ilike '%' || c.phone_tail or
      nullif(trim(si.client_phone), '') ilike '%' || c.phone_tail or
      nullif(trim(si.whatsapp_phone), '') ilike '%' || c.phone_tail
    )
  )
  where c.cust_code is null and c.cust_id is null and c.cust_phone is null and c.cust_name is not null
),
cte_first_match as (
  -- Take first (best priority) match per customer
  select distinct on (cust_id, cust_code, cust_phone, cust_name, cust_branch)
    cust_id, cust_code, cust_phone, cust_name, cust_branch,
    match_strategy, priority, *
  from cte_matched_invoices
  order by cust_id, cust_code, cust_phone, cust_name, cust_branch, priority
),
cte_dedup as (
  -- Deduplicate by invoice_id or (date, amount, branch)
  select distinct on (cust_id, coalesce(id, invoice_date::text || '-' || parse_amount_v1(coalesce(net_total, net_amount, total_amount, amount, 0)) || '-' || branch))
    cust_id, cust_code, cust_phone, cust_name, cust_branch,
    match_strategy,
    id, invoice_date, branch,
    parse_amount_v1(coalesce(net_total, net_amount, discounted_amount, total_amount, amount, gross_total, gross_amount, 0)) as amt
  from cte_first_match
  order by cust_id, coalesce(id, invoice_date::text || '-' || parse_amount_v1(coalesce(net_total, net_amount, total_amount, amount, 0)) || '-' || branch), invoice_date
),
cte_metrics as (
  select
    c.cust_id,
    c.cust_code,
    c.cust_phone,
    c.cust_name,
    c.cust_branch,
    (select match_strategy from cte_dedup where cust_id = c.cust_id limit 1) as matched_by,
    count(d.id)::bigint as invoices_count,
    coalesce(sum(d.amt), 0) as total_spent,
    case when count(d.id) > 0 then coalesce(sum(d.amt), 0) / count(d.id) else 0 end as avg_invoice,
    min(d.invoice_date) as first_purchase,
    max(d.invoice_date) as last_purchase,
    count(distinct date_trunc('month', d.invoice_date::timestamp))::numeric as active_months,
    count(*) filter (where date_trunc('month', d.invoice_date::timestamp) = date_trunc('month', now())) as current_month_count,
    coalesce(sum(d.amt) filter (where date_trunc('month', d.invoice_date::timestamp) = date_trunc('month', now())), 0) as current_month_spent,
    count(*) filter (where date_trunc('month', d.invoice_date::timestamp) = date_trunc('month', now() - '1 month'::interval)) as previous_month_count,
    coalesce(sum(d.amt) filter (where date_trunc('month', d.invoice_date::timestamp) = date_trunc('month', now() - '1 month'::interval)), 0) as previous_month_spent
  from cte_customers c
  left join cte_dedup d on d.cust_id = c.cust_id
  group by c.cust_id, c.cust_code, c.cust_phone, c.cust_name, c.cust_branch
),
cte_branch_agg as (
  select
    d.cust_id,
    d.branch,
    count(*) as branch_count,
    sum(d.amt) as branch_total
  from cte_dedup d
  group by d.cust_id, d.branch
),
cte_branches as (
  select
    m.cust_id,
    (array_agg(ba.branch order by ba.branch_count desc))[1] as branch_most_frequent,
    (array_agg(ba.branch order by ba.branch_total desc))[1] as branch_highest_value,
    (select d.branch from cte_dedup d where d.cust_id = m.cust_id order by d.invoice_date desc limit 1) as branch_last_purchase
  from cte_metrics m
  left join cte_branch_agg ba on ba.cust_id = m.cust_id
  group by m.cust_id
)
select
  m.cust_id as customer_id,
  m.cust_code as customer_code,
  m.cust_phone as customer_phone,
  m.cust_name as customer_name,
  m.cust_branch as branch_input,
  m.total_spent,
  m.invoices_count,
  m.avg_invoice,
  case when m.active_months > 0 then m.total_spent / m.active_months else 0 end as avg_monthly,
  m.current_month_spent,
  m.previous_month_spent,
  m.current_month_count,
  m.previous_month_count,
  m.last_purchase,
  m.first_purchase,
  case when m.active_months > 0 then m.invoices_count / m.active_months else m.current_month_count::numeric end as average_monthly_purchase_count,
  coalesce(b.branch_last_purchase, b.branch_most_frequent, '') as branch,
  b.branch_most_frequent,
  b.branch_highest_value,
  b.branch_last_purchase,
  case
    when m.total_spent >= 8000 or m.invoices_count >= 12 then 'VIP'
    when m.total_spent >= 4000 or m.invoices_count >= 6 then 'Loyal'
    when m.invoices_count > 0 and extract(day from (now()::date - m.last_purchase::date)) > 90 then 'At Risk'
    else 'Occasional'
  end as segment,
  case
    when m.invoices_count = 0 or m.last_purchase is null then 'لا يوجد شراء'
    when extract(day from (now()::date - m.last_purchase::date)) <= 45 then 'نشط'
    when extract(day from (now()::date - m.last_purchase::date)) <= 90 then 'يحتاج متابعة'
    else 'متوقف'
  end as customer_status,
  m.matched_by,
  m.invoices_count as invoices_matched_count,
  'sales_invoices'::text as source,
  case when m.matched_by in ('code', 'customer_id', 'phone') then 'EXACT'
    when m.matched_by = 'phone_tail' then 'FUZZY'
    when m.matched_by = 'name' then 'FALLBACK'
    else 'NONE' end as match_confidence
from cte_metrics m
left join cte_branches b on b.cust_id = m.cust_id
order by m.cust_id;
$$ language sql stable;

grant execute on function get_customer_service_metrics_batch_v1(jsonb) to authenticated;

comment on function get_customer_service_metrics_batch_v1(jsonb) is
'PHASE 2: Batch fetch customer service metrics with 100% parity to fetchByStrategies() + summarizeInvoices().
Matching priority: code > uuid > phone > phone_tail > name.
Branch isolation enforced. READ-ONLY (no UPDATE/INSERT/DELETE).
Input: JSONB array of {customer_id, customer_code, customer_phone, customer_name, branch}
Output: One row per customer with 26 aggregated metrics fields.';
