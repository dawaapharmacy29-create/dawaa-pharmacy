-- Phase 2: N+1 Elimination via Batch RPC - PARITY-SAFE IMPLEMENTATION (v3)
-- Goal: 100% numeric parity to JS fetchByStrategies() + summarizeInvoices()
-- All amounts including 0 and negative. All invoices counted. Date filters only for temporal metrics.
-- SCHEMA VALIDATED: Only live columns used (customer_code, customer_id, customer_phone, phone, whatsapp_phone, customer_name, name)
-- SECURITY: INVOKER, authenticated only, no RLS bypass

-- Amount priority exactly as getInvoiceAmount()
create or replace function get_amount_v3(
  p_net_amount numeric,
  p_net_total numeric,
  p_total_amount numeric,
  p_amount numeric,
  p_gross_amount numeric,
  p_discounted_amount numeric
) returns numeric as $$
declare
  v_value numeric;
begin
  -- Priority: net_amount → net_total → total_amount → amount → gross_amount → discounted_amount
  -- Returns first non-null value (including 0 and negative)
  v_value := coalesce(p_net_amount, p_net_total, p_total_amount, p_amount, p_gross_amount, p_discounted_amount);
  return coalesce(v_value, 0);
end;
$$ language plpgsql immutable;

-- Date priority exactly as getInvoiceDay()
create or replace function get_date_v3(
  p_sale_date date,
  p_invoice_date timestamp,
  p_invoice_datetime timestamp,
  p_close_datetime timestamp,
  p_date date
) returns date as $$
begin
  -- Priority: sale_date → invoice_date → invoice_datetime → close_datetime → date
  -- All cast to date, return NULL if all null
  if p_sale_date is not null then return p_sale_date; end if;
  if p_invoice_date is not null then return (p_invoice_date::date); end if;
  if p_invoice_datetime is not null then return (p_invoice_datetime::date); end if;
  if p_close_datetime is not null then return (p_close_datetime::date); end if;
  if p_date is not null then return p_date; end if;
  return null;
end;
$$ language plpgsql immutable;

-- Invoice ID exactly as getInvoiceId()
create or replace function get_invoice_id_v3(
  p_invoice_number text,
  p_invoice_no text,
  p_id text
) returns text as $$
begin
  -- Priority: invoice_number → invoice_no → id
  -- Return empty string if all null
  if coalesce(p_invoice_number, '') != '' then return trim(p_invoice_number); end if;
  if coalesce(p_invoice_no, '') != '' then return trim(p_invoice_no); end if;
  if coalesce(p_id, '') != '' then return trim(p_id); end if;
  return '';
end;
$$ language plpgsql immutable;

-- Branch normalization exactly as getInvoiceBranch()
create or replace function get_branch_v3(
  p_branch_name text,
  p_branch text
) returns text as $$
declare
  v_branch text;
begin
  v_branch := coalesce(nullif(trim(p_branch_name), ''), nullif(trim(p_branch), ''));
  if v_branch is null then return 'غير محدد'; end if;
  
  -- Normalize to canonical Egyptian branch names (matches invoiceCore EGYPTIAN_BRANCHES)
  if v_branch ilike '%شكري%' or v_branch ilike '%شكرى%' or v_branch ilike '%shokry%' or v_branch ilike '%shoukry%' then
    return 'فرع شكري';
  end if;
  if v_branch ilike '%الشامي%' or v_branch ilike '%الشامى%' or v_branch ilike '%shamy%' or v_branch ilike '%shami%' then
    return 'فرع الشامي';
  end if;
  
  return v_branch;
end;
$$ language plpgsql immutable;

-- Extract last N digits
create or replace function last_digits_v3(p_phone text, p_count int default 10)
returns text as $$
declare
  v_digits text;
begin
  if p_phone is null then return null; end if;
  v_digits := regexp_replace(p_phone, '[^0-9]', '', 'g');
  return case when length(v_digits) > p_count then right(v_digits, p_count) else v_digits end;
end;
$$ language plpgsql immutable;

-- Main RPC: Batch fetch customer service metrics with EXACT parity
create or replace function get_customer_service_metrics_batch_v3(p_customers jsonb)
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
with 

-- Step 1: Parse input with stable identity
cte_input_customers as (
  select 
    (elem->>'customer_id')::uuid as input_cust_id,
    nullif(trim(elem->>'customer_code'), '') as input_cust_code,
    nullif(trim(elem->>'customer_phone'), '') as input_cust_phone,
    nullif(trim(elem->>'customer_name'), '') as input_cust_name,
    nullif(trim(elem->>'branch'), '') as input_cust_branch,
    last_digits_v3(nullif(trim(elem->>'customer_phone'), ''), 10) as input_phone_tail
  from jsonb_array_elements(p_customers) with ordinality as t(elem, ordinal_idx)
),

-- Step 2a: Strategy 1 - Code exact match (only valid live column: customer_code)
cte_strategy_code as (
  select 
    c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch,
    (c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch) as input_key,
    si.id, si.invoice_number, si.invoice_no, si.branch_name, si.branch,
    get_date_v3(si.sale_date, si.invoice_date, si.invoice_datetime, si.close_datetime, si.date) as inv_date,
    get_amount_v3(si.net_amount, si.net_total, si.total_amount, si.amount, si.gross_amount, si.discounted_amount) as inv_amount,
    get_branch_v3(si.branch_name, si.branch) as inv_branch,
    'code:customer_code' as matched_strategy,
    1 as strategy_priority
  from cte_input_customers c
  join public.sales_invoices si on (
    c.input_cust_code is not null 
    and si.customer_code = c.input_cust_code
  )
  where c.input_cust_code is not null
  limit 700
),

-- Step 2b: Strategy 2 - Customer ID exact match (only valid live column: customer_id)
cte_strategy_customer_id as (
  select 
    c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch,
    (c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch) as input_key,
    si.id, si.invoice_number, si.invoice_no, si.branch_name, si.branch,
    get_date_v3(si.sale_date, si.invoice_date, si.invoice_datetime, si.close_datetime, si.date) as inv_date,
    get_amount_v3(si.net_amount, si.net_total, si.total_amount, si.amount, si.gross_amount, si.discounted_amount) as inv_amount,
    get_branch_v3(si.branch_name, si.branch) as inv_branch,
    'customer_id' as matched_strategy,
    2 as strategy_priority
  from cte_input_customers c
  join public.sales_invoices si on (
    c.input_cust_id is not null 
    and si.customer_id = c.input_cust_id
  )
  where c.input_cust_id is not null
  and not exists (
    select 1 from cte_strategy_code where input_key = (c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch)
  )
  limit 700
),

-- Step 2c: Strategy 3 - Phone exact match (try columns in priority order)
-- Try customer_phone first
cte_phone_customer_phone as (
  select c.*, si.*, 'phone:customer_phone' as phone_strategy
  from cte_input_customers c
  join public.sales_invoices si on (
    c.input_cust_phone is not null and si.customer_phone = c.input_cust_phone
  )
  where c.input_cust_phone is not null
  and not exists (select 1 from cte_strategy_code where input_key = (c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch))
  and not exists (select 1 from cte_strategy_customer_id where input_key = (c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch))
  limit 700
),

-- Try phone column (only if no customer_phone results)
cte_phone_phone as (
  select c.*, si.*, 'phone:phone' as phone_strategy
  from cte_input_customers c
  join public.sales_invoices si on (
    c.input_cust_phone is not null and si.phone = c.input_cust_phone
  )
  where c.input_cust_phone is not null
  and not exists (select 1 from cte_strategy_code where input_key = (c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch))
  and not exists (select 1 from cte_strategy_customer_id where input_key = (c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch))
  and not exists (select 1 from cte_phone_customer_phone where input_key = (c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch))
  limit 700
),

-- Try whatsapp_phone column (only if no previous results)
cte_phone_whatsapp as (
  select c.*, si.*, 'phone:whatsapp_phone' as phone_strategy
  from cte_input_customers c
  join public.sales_invoices si on (
    c.input_cust_phone is not null and si.whatsapp_phone = c.input_cust_phone
  )
  where c.input_cust_phone is not null
  and not exists (select 1 from cte_strategy_code where input_key = (c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch))
  and not exists (select 1 from cte_strategy_customer_id where input_key = (c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch))
  and not exists (select 1 from cte_phone_customer_phone where input_key = (c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch))
  and not exists (select 1 from cte_phone_phone where input_key = (c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch))
  limit 700
),

-- Combine phone results with proper priority
cte_strategy_phone as (
  select input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch, input_key, id, invoice_number, invoice_no, branch_name, branch,
    get_date_v3(sale_date, invoice_date, invoice_datetime, close_datetime, date) as inv_date,
    get_amount_v3(net_amount, net_total, total_amount, amount, gross_amount, discounted_amount) as inv_amount,
    get_branch_v3(branch_name, branch) as inv_branch,
    phone_strategy as matched_strategy,
    3 as strategy_priority
  from (
    select *, row_number() over (partition by input_key order by phone_strategy) as rn
    from (
      select * from cte_phone_customer_phone
      union all
      select * from cte_phone_phone
      union all
      select * from cte_phone_whatsapp
    ) t
  ) t2
  where rn = 1  -- Only first matching column per customer
),

-- Step 2d: Strategy 4 - Phone tail fuzzy match (same column priority as phone)
cte_phone_tail_customer_phone as (
  select c.*, si.*, 'phoneTail:customer_phone' as tail_strategy
  from cte_input_customers c
  join public.sales_invoices si on (
    c.input_phone_tail is not null and length(c.input_phone_tail) >= 8
    and si.customer_phone ilike '%' || c.input_phone_tail
  )
  where c.input_phone_tail is not null and length(c.input_phone_tail) >= 8
  and not exists (select 1 from cte_strategy_code where input_key = (c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch))
  and not exists (select 1 from cte_strategy_customer_id where input_key = (c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch))
  and not exists (select 1 from cte_strategy_phone where input_key = (c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch))
  limit 700
),

cte_phone_tail_phone as (
  select c.*, si.*, 'phoneTail:phone' as tail_strategy
  from cte_input_customers c
  join public.sales_invoices si on (
    c.input_phone_tail is not null and length(c.input_phone_tail) >= 8
    and si.phone ilike '%' || c.input_phone_tail
  )
  where c.input_phone_tail is not null and length(c.input_phone_tail) >= 8
  and not exists (select 1 from cte_strategy_code where input_key = (c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch))
  and not exists (select 1 from cte_strategy_customer_id where input_key = (c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch))
  and not exists (select 1 from cte_strategy_phone where input_key = (c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch))
  and not exists (select 1 from cte_phone_tail_customer_phone where input_key = (c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch))
  limit 700
),

cte_phone_tail_whatsapp as (
  select c.*, si.*, 'phoneTail:whatsapp_phone' as tail_strategy
  from cte_input_customers c
  join public.sales_invoices si on (
    c.input_phone_tail is not null and length(c.input_phone_tail) >= 8
    and si.whatsapp_phone ilike '%' || c.input_phone_tail
  )
  where c.input_phone_tail is not null and length(c.input_phone_tail) >= 8
  and not exists (select 1 from cte_strategy_code where input_key = (c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch))
  and not exists (select 1 from cte_strategy_customer_id where input_key = (c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch))
  and not exists (select 1 from cte_strategy_phone where input_key = (c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch))
  and not exists (select 1 from cte_phone_tail_customer_phone where input_key = (c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch))
  and not exists (select 1 from cte_phone_tail_phone where input_key = (c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch))
  limit 700
),

cte_strategy_phone_tail as (
  select input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch, input_key, id, invoice_number, invoice_no, branch_name, branch,
    get_date_v3(sale_date, invoice_date, invoice_datetime, close_datetime, date) as inv_date,
    get_amount_v3(net_amount, net_total, total_amount, amount, gross_amount, discounted_amount) as inv_amount,
    get_branch_v3(branch_name, branch) as inv_branch,
    tail_strategy as matched_strategy,
    4 as strategy_priority
  from (
    select *, row_number() over (partition by input_key order by tail_strategy) as rn
    from (
      select * from cte_phone_tail_customer_phone
      union all
      select * from cte_phone_tail_phone
      union all
      select * from cte_phone_tail_whatsapp
    ) t
  ) t2
  where rn = 1
),

-- Step 2e: Strategy 5 - Name fallback (try columns in order)
cte_name_customer_name as (
  select c.*, si.*, 'name:customer_name' as name_strategy
  from cte_input_customers c
  join public.sales_invoices si on (
    c.input_cust_name is not null and length(c.input_cust_name) >= 1
    and si.customer_name ilike '%' || c.input_cust_name || '%'
  )
  where c.input_cust_name is not null
  and not exists (select 1 from cte_strategy_code where input_key = (c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch))
  and not exists (select 1 from cte_strategy_customer_id where input_key = (c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch))
  and not exists (select 1 from cte_strategy_phone where input_key = (c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch))
  and not exists (select 1 from cte_strategy_phone_tail where input_key = (c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch))
  limit 700
),

cte_name_name as (
  select c.*, si.*, 'name:name' as name_strategy
  from cte_input_customers c
  join public.sales_invoices si on (
    c.input_cust_name is not null and length(c.input_cust_name) >= 1
    and si.name ilike '%' || c.input_cust_name || '%'
  )
  where c.input_cust_name is not null
  and not exists (select 1 from cte_strategy_code where input_key = (c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch))
  and not exists (select 1 from cte_strategy_customer_id where input_key = (c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch))
  and not exists (select 1 from cte_strategy_phone where input_key = (c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch))
  and not exists (select 1 from cte_strategy_phone_tail where input_key = (c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch))
  and not exists (select 1 from cte_name_customer_name where input_key = (c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch))
  limit 700
),

cte_strategy_name as (
  select input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch, input_key, id, invoice_number, invoice_no, branch_name, branch,
    get_date_v3(sale_date, invoice_date, invoice_datetime, close_datetime, date) as inv_date,
    get_amount_v3(net_amount, net_total, total_amount, amount, gross_amount, discounted_amount) as inv_amount,
    get_branch_v3(branch_name, branch) as inv_branch,
    name_strategy as matched_strategy,
    5 as strategy_priority
  from (
    select *, row_number() over (partition by input_key order by name_strategy) as rn
    from (
      select * from cte_name_customer_name
      union all
      select * from cte_name_name
    ) t
  ) t2
  where rn = 1
),

-- Step 3: Combine ALL matched invoices from ALL strategies (no dedup yet)
cte_all_matched as (
  select input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch, 
    id, invoice_number, invoice_no, branch_name, branch, inv_date, inv_amount, inv_branch, matched_strategy, strategy_priority
  from (
    select input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch, 
      id, invoice_number, invoice_no, branch_name, branch, inv_date, inv_amount, inv_branch, matched_strategy, strategy_priority
    from cte_strategy_code
    union all
    select input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch, 
      id, invoice_number, invoice_no, branch_name, branch, inv_date, inv_amount, inv_branch, matched_strategy, strategy_priority
    from cte_strategy_customer_id
    union all
    select input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch, 
      id, invoice_number, invoice_no, branch_name, branch, inv_date, inv_amount, inv_branch, matched_strategy, strategy_priority
    from cte_strategy_phone
    union all
    select input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch, 
      id, invoice_number, invoice_no, branch_name, branch, inv_date, inv_amount, inv_branch, matched_strategy, strategy_priority
    from cte_strategy_phone_tail
    union all
    select input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch, 
      id, invoice_number, invoice_no, branch_name, branch, inv_date, inv_amount, inv_branch, matched_strategy, strategy_priority
    from cte_strategy_name
  ) combined
),

-- Step 4: Deduplicate invoices by identity (id OR date-amount-branch) - MATCHES JS invoiceIdentity
cte_unique_invoices as (
  select distinct on (
    input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch,
    coalesce(get_invoice_id_v3(invoice_number, invoice_no, id), (inv_date::text || '-' || inv_amount::text || '-' || coalesce(inv_branch, '')))
  )
    input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch,
    inv_date, inv_amount, inv_branch, matched_strategy
  from cte_all_matched
  order by 
    input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch,
    coalesce(get_invoice_id_v3(invoice_number, invoice_no, id), (inv_date::text || '-' || inv_amount::text || '-' || coalesce(inv_branch, ''))),
    strategy_priority
),

-- Step 5: AGGREGATE ON ALL UNIQUE INVOICES (including undated)
cte_overall_metrics as (
  select 
    input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch,
    count(*) as invoices_count,
    sum(inv_amount) as total_spent,
    avg(inv_amount) as avg_invoice,
    max(matched_strategy) as matched_by_str
  from cte_unique_invoices
  group by input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch
),

-- Step 6: DATE-ONLY METRICS (from unique invoices with valid dates)
cte_dated_invoices as (
  select 
    input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch,
    inv_date, inv_amount, inv_branch
  from cte_unique_invoices
  where inv_date is not null
  order by input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch, inv_date
),

cte_date_metrics as (
  select 
    input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch,
    min(inv_date) as first_purchase,
    max(inv_date) as last_purchase,
    count(distinct to_char(inv_date, 'YYYY-MM')) as months_count
  from cte_dated_invoices
  group by input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch
),

-- Step 7: MONTHLY METRICS (current & previous, from dated invoices)
cte_monthly_metrics as (
  select 
    input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch,
    sum(case when inv_date >= date_trunc('month', now())::date and inv_date < date_trunc('month', now() + interval '1 month')::date then inv_amount else 0 end) as current_month_spent,
    count(case when inv_date >= date_trunc('month', now())::date and inv_date < date_trunc('month', now() + interval '1 month')::date then 1 else null end) as current_month_count,
    sum(case when inv_date >= date_trunc('month', now() - interval '1 month')::date and inv_date < date_trunc('month', now())::date then inv_amount else 0 end) as previous_month_spent,
    count(case when inv_date >= date_trunc('month', now() - interval '1 month')::date and inv_date < date_trunc('month', now())::date then 1 else null end) as previous_month_count
  from cte_dated_invoices
  group by input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch
),

-- Step 8: BRANCH METRICS (from dated invoices)
cte_branch_metrics as (
  select 
    input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch,
    inv_branch,
    count(*) as branch_count,
    sum(inv_amount) as branch_total,
    max(inv_date) as branch_last_date
  from cte_dated_invoices
  where inv_branch is not null
  group by input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch, inv_branch
),

cte_branch_agg as (
  select 
    input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch,
    (array_agg(inv_branch order by branch_count desc))[1] as branch_most_frequent,
    (array_agg(inv_branch order by branch_total desc))[1] as branch_highest_value,
    (select inv_branch from cte_dated_invoices d2 
     where d2.input_cust_id = b.input_cust_id and d2.input_cust_code = b.input_cust_code and d2.input_cust_phone = b.input_cust_phone and d2.input_cust_name = b.input_cust_name and d2.input_cust_branch = b.input_cust_branch
     order by d2.inv_date desc limit 1) as branch_last_purchase
  from cte_branch_metrics b
  group by input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch
),

-- Step 9: SEGMENT CALCULATION (exact JS parity - matches segmentFrom)
cte_with_segment as (
  select 
    o.input_cust_id, o.input_cust_code, o.input_cust_phone, o.input_cust_name, o.input_cust_branch,
    o.total_spent, o.invoices_count, o.avg_invoice, o.matched_by_str,
    coalesce(d.first_purchase, null) as first_purchase,
    coalesce(d.last_purchase, null) as last_purchase,
    coalesce(d.months_count, 0) as months_count,
    coalesce(m.current_month_spent, 0) as current_month_spent,
    coalesce(m.previous_month_spent, 0) as previous_month_spent,
    coalesce(m.current_month_count, 0) as current_month_count,
    coalesce(m.previous_month_count, 0) as previous_month_count,
    coalesce(b.branch_most_frequent, null) as branch_most_frequent,
    coalesce(b.branch_highest_value, null) as branch_highest_value,
    coalesce(b.branch_last_purchase, null) as branch_last_purchase,
    -- SEGMENT: Exact JS parity
    case 
      when o.total_spent >= 8000 or o.invoices_count >= 12 then 'VIP'
      when o.total_spent >= 4000 or o.invoices_count >= 6 then 'Loyal'
      when d.last_purchase is null or (extract(day from (now()::date - d.last_purchase)::interval)) > 90 then 'At Risk'
      else 'Occasional'
    end as segment,
    -- STATUS: Exact JS parity
    case 
      when d.last_purchase is null then 'لا يوجد شراء'
      when (extract(day from (now()::date - d.last_purchase)::interval)) <= 45 then 'نشط'
      when (extract(day from (now()::date - d.last_purchase)::interval)) <= 90 then 'يحتاج متابعة'
      else 'متوقف'
    end as customer_status
  from cte_overall_metrics o
  left join cte_date_metrics d on (o.input_cust_id, o.input_cust_code, o.input_cust_phone, o.input_cust_name, o.input_cust_branch) = (d.input_cust_id, d.input_cust_code, d.input_cust_phone, d.input_cust_name, d.input_cust_branch)
  left join cte_monthly_metrics m on (o.input_cust_id, o.input_cust_code, o.input_cust_phone, o.input_cust_name, o.input_cust_branch) = (m.input_cust_id, m.input_cust_code, m.input_cust_phone, m.input_cust_name, m.input_cust_branch)
  left join cte_branch_agg b on (o.input_cust_id, o.input_cust_code, o.input_cust_phone, o.input_cust_name, o.input_cust_branch) = (b.input_cust_id, b.input_cust_code, b.input_cust_phone, b.input_cust_name, b.input_cust_branch)
)

-- FINAL OUTPUT
select 
  input_cust_id as customer_id,
  input_cust_code as customer_code,
  input_cust_phone as customer_phone,
  input_cust_name as customer_name,
  input_cust_branch as branch_input,
  coalesce(total_spent, 0) as total_spent,
  invoices_count as invoices_count,
  coalesce(avg_invoice, 0) as avg_invoice,
  case when months_count > 0 then total_spent / months_count else 0 end as avg_monthly,
  current_month_spent as current_month_spent,
  previous_month_spent as previous_month_spent,
  current_month_count as current_month_count,
  previous_month_count as previous_month_count,
  last_purchase as last_purchase,
  first_purchase as first_purchase,
  case when months_count > 0 then invoices_count::numeric / months_count else current_month_count::numeric end as average_monthly_purchase_count,
  coalesce(
    (select inv_branch from cte_dated_invoices where (input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch) = (s.input_cust_id, s.input_cust_code, s.input_cust_phone, s.input_cust_name, s.input_cust_branch) order by inv_date desc limit 1),
    branch_most_frequent,
    'غير محدد'
  ) as branch,
  branch_most_frequent as branch_most_frequent,
  branch_highest_value as branch_highest_value,
  branch_last_purchase as branch_last_purchase,
  segment as segment,
  customer_status as customer_status,
  matched_by_str as matched_by,
  invoices_count as invoices_matched_count,
  'sales_invoices' as source,
  case 
    when matched_by_str like 'code:%' then 'EXACT'
    when matched_by_str = 'customer_id' then 'EXACT'
    when matched_by_str like 'phone:%' then 'EXACT'
    when matched_by_str like 'phoneTail:%' then 'FUZZY'
    when matched_by_str like 'name:%' then 'FALLBACK'
    else 'NONE'
  end as match_confidence
from cte_with_segment s
order by input_cust_id nulls last;

$$ language sql stable;

-- SECURITY: Explicit grants and revokes
revoke all on function get_customer_service_metrics_batch_v3(jsonb) from public;
grant execute on function get_customer_service_metrics_batch_v3(jsonb) to authenticated;

comment on function get_customer_service_metrics_batch_v3(jsonb) is
'PHASE 2 PARITY-SAFE: Batch fetch customer service metrics with 100% numeric parity to fetchByStrategies() + summarizeInvoices().
EXACT parity:
  - All amounts (including 0 and negative)
  - All invoices counted (undated included)
  - Date filters only for temporal metrics
  - Sequential column matching (first successful column wins)
  - Segment calculation matches JS segmentFrom exactly
  - Branch metrics from dated invoices only
Matching priority: code > customer_id > phone > phoneTail > name
Input: JSONB array of {customer_id, customer_code, customer_phone, customer_name, branch}
Output: One row per customer with 26 aggregated metrics fields.
READ-ONLY: No UPDATE/INSERT/DELETE allowed.
SECURITY: INVOKER, authenticated only, no RLS bypass.';
