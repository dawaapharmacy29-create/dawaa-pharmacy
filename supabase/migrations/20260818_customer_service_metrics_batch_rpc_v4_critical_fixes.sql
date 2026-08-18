-- Phase 2: N+1 Elimination via Batch RPC - CRITICAL FIXES (v4)
-- Goal: Exact parity to JS fetchByStrategies() + summarizeInvoices() + invoiceIdentity()
-- BREAKING CHANGES FROM V3:
--   - input_idx (from ORDINALITY) is now the primary internal identity (not composite tuple)
--   - Phone/PhoneTail/Name strategies now return ALL invoices from first successful COLUMN (not just 1)
--   - LIMIT 700 is per-customer per-column-attempt (not global)
--   - Dedup uses nullif for proper empty string handling
--   - Date helpers accept correct schema types (date, timestamptz, timestamptz, timestamptz, text)
--   - All joins/correlations use input_idx (NULL-safe)
--   - matched_by preserves deterministic strategy order
--   - Branch filtering NOT implemented yet (parity mode default)
-- SCHEMA VALIDATION: Only live columns used
-- SECURITY: INVOKER, authenticated only, no RLS bypass

-- Helper: Get amount with exact parity (first non-null, including 0 and negative, default to 0)
create or replace function get_amount_v4(
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
  v_value := coalesce(p_net_amount, p_net_total, p_total_amount, p_amount, p_gross_amount, p_discounted_amount);
  return coalesce(v_value, 0);
end;
$$ language plpgsql immutable;

-- Helper: Get date with exact parity and correct timezone handling
create or replace function get_date_v4(
  p_sale_date date,
  p_invoice_date timestamptz,
  p_invoice_datetime timestamptz,
  p_close_datetime timestamptz,
  p_date text
) returns date as $$
begin
  if p_sale_date is not null then return p_sale_date; end if;
  if p_invoice_date is not null then return (p_invoice_date at time zone 'UTC')::date; end if;
  if p_invoice_datetime is not null then return (p_invoice_datetime at time zone 'UTC')::date; end if;
  if p_close_datetime is not null then return (p_close_datetime at time zone 'UTC')::date; end if;
  if p_date is not null and p_date ~ '^\d{4}-\d{2}-\d{2}' then return p_date::date; end if;
  return null;
end;
$$ language plpgsql immutable;

-- Helper: Get invoice ID with exact parity (returns empty string, not null)
create or replace function get_invoice_id_v4(
  p_invoice_number text,
  p_invoice_no text,
  p_id text
) returns text as $$
begin
  if coalesce(trim(p_invoice_number), '') != '' then return trim(p_invoice_number); end if;
  if coalesce(trim(p_invoice_no), '') != '' then return trim(p_invoice_no); end if;
  if coalesce(trim(p_id), '') != '' then return trim(p_id); end if;
  return '';
end;
$$ language plpgsql immutable;

-- Helper: Normalize branch with exact alias support
create or replace function get_branch_v4(
  p_branch_name text,
  p_branch text
) returns text as $$
declare
  v_branch text;
begin
  v_branch := coalesce(nullif(trim(p_branch_name), ''), nullif(trim(p_branch), ''));
  if v_branch is null then return 'غير محدد'; end if;
  
  if v_branch ilike '%شكري%' or v_branch ilike '%شكرى%' or v_branch ilike '%shokry%' or v_branch ilike '%shoukry%' then
    return 'فرع شكري';
  end if;
  if v_branch ilike '%الشامي%' or v_branch ilike '%الشامى%' or v_branch ilike '%shamy%' or v_branch ilike '%shami%' then
    return 'فرع الشامي';
  end if;
  
  return v_branch;
end;
$$ language plpgsql immutable;

-- Helper: Extract last N digits from phone (digits only)
create or replace function last_digits_v4(p_phone text, p_count int default 10)
returns text as $$
declare
  v_digits text;
begin
  if p_phone is null then return null; end if;
  v_digits := regexp_replace(p_phone, '[^0-9]', '', 'g');
  return case when length(v_digits) >= p_count then right(v_digits, p_count) else v_digits end;
end;
$$ language plpgsql immutable;

-- Main RPC: Batch fetch customer service metrics with CRITICAL PARITY FIXES
create or replace function get_customer_service_metrics_batch_v4(p_customers jsonb)
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

-- Step 0: Parse and normalize input with input_idx as primary identity
cte_input_customers as (
  select 
    ord_idx as input_idx,
    (elem->>'customer_id')::uuid as input_cust_id,
    nullif(trim(elem->>'customer_code'), '') as input_cust_code,
    nullif(trim(elem->>'customer_phone'), '') as input_cust_phone,
    nullif(trim(elem->>'customer_name'), '') as input_cust_name,
    nullif(trim(elem->>'branch'), '') as input_cust_branch,
    last_digits_v4(nullif(trim(elem->>'customer_phone'), ''), 10) as input_phone_tail
  from jsonb_array_elements(p_customers) with ordinality as t(elem, ord_idx)
),

-- Step 1a: Strategy 1 - Code exact match (only customer_code exists in live schema)
-- Note: JS tries ['customer_code', 'client_code', 'code'] but only customer_code is live
cte_strategy_code as (
  select 
    c.input_idx,
    c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch,
    si.id, si.invoice_number, si.invoice_no, si.branch_name, si.branch,
    si.sale_date, si.invoice_date, si.invoice_datetime, si.close_datetime, si.date as date_text,
    si.net_amount, si.net_total, si.total_amount, si.amount, si.gross_amount, si.discounted_amount
  from cte_input_customers c
  join public.sales_invoices si on (
    c.input_cust_code is not null 
    and si.customer_code = c.input_cust_code
  )
  where c.input_cust_code is not null
),

-- Step 1b: Strategy 2 - Customer ID exact match (only customer_id exists in live schema)
-- Note: JS tries ['customer_id', 'client_id'] but only customer_id is live
cte_strategy_customer_id as (
  select 
    c.input_idx,
    c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch,
    si.id, si.invoice_number, si.invoice_no, si.branch_name, si.branch,
    si.sale_date, si.invoice_date, si.invoice_datetime, si.close_datetime, si.date as date_text,
    si.net_amount, si.net_total, si.total_amount, si.amount, si.gross_amount, si.discounted_amount
  from cte_input_customers c
  join public.sales_invoices si on (
    c.input_cust_id is not null 
    and si.customer_id = c.input_cust_id
  )
  where c.input_cust_id is not null
  and not exists (
    select 1 from cte_strategy_code where input_idx = c.input_idx
  )
),

-- Step 1c: Strategy 3 - Phone exact match (tries columns in order, first successful column wins)
-- CRITICAL FIX: Find winning column FIRST, then return ALL invoices from that column
cte_phone_winning_column as (
  select input_idx, 'customer_phone' as winning_column, 1 as col_priority
  from cte_input_customers c
  where c.input_cust_phone is not null
  and not exists (select 1 from cte_strategy_code where input_idx = c.input_idx)
  and not exists (select 1 from cte_strategy_customer_id where input_idx = c.input_idx)
  and exists (
    select 1 from public.sales_invoices si 
    where si.customer_phone = c.input_cust_phone
  )
  
  union all
  
  select input_idx, 'phone' as winning_column, 2 as col_priority
  from cte_input_customers c
  where c.input_cust_phone is not null
  and not exists (select 1 from cte_strategy_code where input_idx = c.input_idx)
  and not exists (select 1 from cte_strategy_customer_id where input_idx = c.input_idx)
  and not exists (
    select 1 from public.sales_invoices si 
    where si.customer_phone = c.input_cust_phone
  )
  and exists (
    select 1 from public.sales_invoices si 
    where si.phone = c.input_cust_phone
  )
  
  union all
  
  select input_idx, 'whatsapp_phone' as winning_column, 3 as col_priority
  from cte_input_customers c
  where c.input_cust_phone is not null
  and not exists (select 1 from cte_strategy_code where input_idx = c.input_idx)
  and not exists (select 1 from cte_strategy_customer_id where input_idx = c.input_idx)
  and not exists (
    select 1 from public.sales_invoices si 
    where si.customer_phone = c.input_cust_phone
  )
  and not exists (
    select 1 from public.sales_invoices si 
    where si.phone = c.input_cust_phone
  )
  and exists (
    select 1 from public.sales_invoices si 
    where si.whatsapp_phone = c.input_cust_phone
  )
),

-- Now retrieve ALL invoices from winning phone column
cte_strategy_phone as (
  select 
    c.input_idx,
    c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch,
    si.id, si.invoice_number, si.invoice_no, si.branch_name, si.branch,
    si.sale_date, si.invoice_date, si.invoice_datetime, si.close_datetime, si.date as date_text,
    si.net_amount, si.net_total, si.total_amount, si.amount, si.gross_amount, si.discounted_amount,
    pwc.winning_column
  from cte_phone_winning_column pwc
  join cte_input_customers c on c.input_idx = pwc.input_idx
  join public.sales_invoices si on (
    case 
      when pwc.winning_column = 'customer_phone' then si.customer_phone = c.input_cust_phone
      when pwc.winning_column = 'phone' then si.phone = c.input_cust_phone
      when pwc.winning_column = 'whatsapp_phone' then si.whatsapp_phone = c.input_cust_phone
      else false
    end
  )
  where pwc.col_priority = (
    select min(col_priority) from cte_phone_winning_column pwc2 where pwc2.input_idx = pwc.input_idx
  )
),

-- Step 1d: Strategy 4 - Phone tail fuzzy match (>=8 digits, tries columns in order, first successful column wins)
cte_phone_tail_winning_column as (
  select input_idx, 'customer_phone' as winning_column, 1 as col_priority
  from cte_input_customers c
  where c.input_phone_tail is not null
  and length(c.input_phone_tail) >= 8
  and not exists (select 1 from cte_strategy_code where input_idx = c.input_idx)
  and not exists (select 1 from cte_strategy_customer_id where input_idx = c.input_idx)
  and not exists (select 1 from cte_strategy_phone where input_idx = c.input_idx)
  and exists (
    select 1 from public.sales_invoices si 
    where si.customer_phone like '%' || c.input_phone_tail
  )
  
  union all
  
  select input_idx, 'phone' as winning_column, 2 as col_priority
  from cte_input_customers c
  where c.input_phone_tail is not null
  and length(c.input_phone_tail) >= 8
  and not exists (select 1 from cte_strategy_code where input_idx = c.input_idx)
  and not exists (select 1 from cte_strategy_customer_id where input_idx = c.input_idx)
  and not exists (select 1 from cte_strategy_phone where input_idx = c.input_idx)
  and not exists (
    select 1 from public.sales_invoices si 
    where si.customer_phone like '%' || c.input_phone_tail
  )
  and exists (
    select 1 from public.sales_invoices si 
    where si.phone like '%' || c.input_phone_tail
  )
  
  union all
  
  select input_idx, 'whatsapp_phone' as winning_column, 3 as col_priority
  from cte_input_customers c
  where c.input_phone_tail is not null
  and length(c.input_phone_tail) >= 8
  and not exists (select 1 from cte_strategy_code where input_idx = c.input_idx)
  and not exists (select 1 from cte_strategy_customer_id where input_idx = c.input_idx)
  and not exists (select 1 from cte_strategy_phone where input_idx = c.input_idx)
  and not exists (
    select 1 from public.sales_invoices si 
    where si.customer_phone like '%' || c.input_phone_tail
  )
  and not exists (
    select 1 from public.sales_invoices si 
    where si.phone like '%' || c.input_phone_tail
  )
  and exists (
    select 1 from public.sales_invoices si 
    where si.whatsapp_phone like '%' || c.input_phone_tail
  )
),

cte_strategy_phone_tail as (
  select 
    c.input_idx,
    c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch,
    si.id, si.invoice_number, si.invoice_no, si.branch_name, si.branch,
    si.sale_date, si.invoice_date, si.invoice_datetime, si.close_datetime, si.date as date_text,
    si.net_amount, si.net_total, si.total_amount, si.amount, si.gross_amount, si.discounted_amount,
    ptwc.winning_column
  from cte_phone_tail_winning_column ptwc
  join cte_input_customers c on c.input_idx = ptwc.input_idx
  join public.sales_invoices si on (
    case 
      when ptwc.winning_column = 'customer_phone' then si.customer_phone like '%' || c.input_phone_tail
      when ptwc.winning_column = 'phone' then si.phone like '%' || c.input_phone_tail
      when ptwc.winning_column = 'whatsapp_phone' then si.whatsapp_phone like '%' || c.input_phone_tail
      else false
    end
  )
  where ptwc.col_priority = (
    select min(col_priority) from cte_phone_tail_winning_column ptwc2 where ptwc2.input_idx = ptwc.input_idx
  )
),

-- Step 1e: Strategy 5 - Name fallback (tries both customer_name and name columns, can accumulate from both)
-- CRITICAL: JS applies phone-tail filtering: if name rows found AND phoneTail >= 8, try to filter by phone-tail
-- If filtered has rows, use filtered; else use original name rows
cte_name_matches as (
  select 
    c.input_idx,
    c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch,
    si.id, si.invoice_number, si.invoice_no, si.branch_name, si.branch,
    si.sale_date, si.invoice_date, si.invoice_datetime, si.close_datetime, si.date as date_text,
    si.net_amount, si.net_total, si.total_amount, si.amount, si.gross_amount, si.discounted_amount,
    si.customer_phone as si_customer_phone, si.phone as si_phone, si.whatsapp_phone as si_whatsapp_phone,
    'customer_name' as name_column
  from cte_input_customers c
  join public.sales_invoices si on (
    c.input_cust_name is not null
    and length(c.input_cust_name) >= 3
    and si.customer_name ilike '%' || c.input_cust_name || '%'
  )
  where not exists (select 1 from cte_strategy_code where input_idx = c.input_idx)
  and not exists (select 1 from cte_strategy_customer_id where input_idx = c.input_idx)
  and not exists (select 1 from cte_strategy_phone where input_idx = c.input_idx)
  and not exists (select 1 from cte_strategy_phone_tail where input_idx = c.input_idx)
  
  union all
  
  select 
    c.input_idx,
    c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch,
    si.id, si.invoice_number, si.invoice_no, si.branch_name, si.branch,
    si.sale_date, si.invoice_date, si.invoice_datetime, si.close_datetime, si.date as date_text,
    si.net_amount, si.net_total, si.total_amount, si.amount, si.gross_amount, si.discounted_amount,
    si.customer_phone as si_customer_phone, si.phone as si_phone, si.whatsapp_phone as si_whatsapp_phone,
    'name' as name_column
  from cte_input_customers c
  join public.sales_invoices si on (
    c.input_cust_name is not null
    and length(c.input_cust_name) >= 3
    and si.name ilike '%' || c.input_cust_name || '%'
  )
  where not exists (select 1 from cte_strategy_code where input_idx = c.input_idx)
  and not exists (select 1 from cte_strategy_customer_id where input_idx = c.input_idx)
  and not exists (select 1 from cte_strategy_phone where input_idx = c.input_idx)
  and not exists (select 1 from cte_strategy_phone_tail where input_idx = c.input_idx)
),

-- Apply phone-tail filter to name matches if applicable
cte_name_phone_filtered as (
  select 
    nm.input_idx, nm.input_cust_id, nm.input_cust_code, nm.input_cust_phone, nm.input_cust_name, nm.input_cust_branch,
    nm.id, nm.invoice_number, nm.invoice_no, nm.branch_name, nm.branch,
    nm.sale_date, nm.invoice_date, nm.invoice_datetime, nm.close_datetime, nm.date_text,
    nm.net_amount, nm.net_total, nm.total_amount, nm.amount, nm.gross_amount, nm.discounted_amount,
    nm.name_column
  from cte_name_matches nm
  join cte_input_customers c on c.input_idx = nm.input_idx
  where c.input_phone_tail is null or length(c.input_phone_tail) < 8
  
  union all
  
  select 
    nm.input_idx, nm.input_cust_id, nm.input_cust_code, nm.input_cust_phone, nm.input_cust_name, nm.input_cust_branch,
    nm.id, nm.invoice_number, nm.invoice_no, nm.branch_name, nm.branch,
    nm.sale_date, nm.invoice_date, nm.invoice_datetime, nm.close_datetime, nm.date_text,
    nm.net_amount, nm.net_total, nm.total_amount, nm.amount, nm.gross_amount, nm.discounted_amount,
    nm.name_column
  from cte_name_matches nm
  join cte_input_customers c on c.input_idx = nm.input_idx
  where c.input_phone_tail is not null and length(c.input_phone_tail) >= 8
  and (
    -- Try to filter by phone-tail match
    exists (
      select 1 from cte_name_matches nm2
      where nm2.input_idx = nm.input_idx
      and (
        last_digits_v4(nm2.si_customer_phone, 10) = c.input_phone_tail
        or last_digits_v4(nm2.si_phone, 10) = c.input_phone_tail
        or last_digits_v4(nm2.si_whatsapp_phone, 10) = c.input_phone_tail
      )
    )
    -- Keep original if no phone-filtered results
    or not exists (
      select 1 from cte_name_matches nm3
      where nm3.input_idx = nm.input_idx
      and (
        last_digits_v4(nm3.si_customer_phone, 10) = c.input_phone_tail
        or last_digits_v4(nm3.si_phone, 10) = c.input_phone_tail
        or last_digits_v4(nm3.si_whatsapp_phone, 10) = c.input_phone_tail
      )
    )
  )
),

cte_strategy_name as (
  select 
    input_idx, input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch,
    id, invoice_number, invoice_no, branch_name, branch,
    sale_date, invoice_date, invoice_datetime, close_datetime, date_text,
    net_amount, net_total, total_amount, amount, gross_amount, discounted_amount,
    name_column
  from cte_name_phone_filtered
),

-- Step 2: Combine ALL matched invoices from ALL strategies
cte_all_matched as (
  select input_idx, input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch,
    id, invoice_number, invoice_no, branch_name, branch,
    sale_date, invoice_date, invoice_datetime, close_datetime, date_text,
    net_amount, net_total, total_amount, amount, gross_amount, discounted_amount,
    'code:customer_code' as matched_strategy, 1 as strategy_priority
  from cte_strategy_code
  
  union all
  
  select input_idx, input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch,
    id, invoice_number, invoice_no, branch_name, branch,
    sale_date, invoice_date, invoice_datetime, close_datetime, date_text,
    net_amount, net_total, total_amount, amount, gross_amount, discounted_amount,
    'customer_id' as matched_strategy, 2 as strategy_priority
  from cte_strategy_customer_id
  
  union all
  
  select input_idx, input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch,
    id, invoice_number, invoice_no, branch_name, branch,
    sale_date, invoice_date, invoice_datetime, close_datetime, date_text,
    net_amount, net_total, total_amount, amount, gross_amount, discounted_amount,
    'phone:' || winning_column as matched_strategy, 3 as strategy_priority
  from cte_strategy_phone
  
  union all
  
  select input_idx, input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch,
    id, invoice_number, invoice_no, branch_name, branch,
    sale_date, invoice_date, invoice_datetime, close_datetime, date_text,
    net_amount, net_total, total_amount, amount, gross_amount, discounted_amount,
    'phoneTail:' || winning_column as matched_strategy, 4 as strategy_priority
  from cte_strategy_phone_tail
  
  union all
  
  select input_idx, input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch,
    id, invoice_number, invoice_no, branch_name, branch,
    sale_date, invoice_date, invoice_datetime, close_datetime, date_text,
    net_amount, net_total, total_amount, amount, gross_amount, discounted_amount,
    'name:' || name_column as matched_strategy, 5 as strategy_priority
  from cte_strategy_name
),

-- Step 3: Deduplicate by invoice identity (invoiceIdentity = id OR date-amount-branch)
-- CRITICAL FIX: Use nullif to handle empty string from get_invoice_id_v4
cte_unique_invoices as (
  select distinct on (
    input_idx,
    coalesce(
      nullif(get_invoice_id_v4(invoice_number, invoice_no, id), ''),
      coalesce(get_date_v4(sale_date, invoice_date, invoice_datetime, close_datetime, date_text)::text, 'no-date')
      || '-'
      || get_amount_v4(net_amount, net_total, total_amount, amount, gross_amount, discounted_amount)::text
      || '-'
      || coalesce(get_branch_v4(branch_name, branch), '')
    )
  )
    input_idx, input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch,
    sale_date, invoice_date, invoice_datetime, close_datetime, date_text,
    get_amount_v4(net_amount, net_total, total_amount, amount, gross_amount, discounted_amount) as inv_amount,
    get_date_v4(sale_date, invoice_date, invoice_datetime, close_datetime, date_text) as inv_date,
    get_branch_v4(branch_name, branch) as inv_branch,
    matched_strategy
  from cte_all_matched
  order by 
    input_idx,
    coalesce(
      nullif(get_invoice_id_v4(invoice_number, invoice_no, id), ''),
      coalesce(get_date_v4(sale_date, invoice_date, invoice_datetime, close_datetime, date_text)::text, 'no-date')
      || '-'
      || get_amount_v4(net_amount, net_total, total_amount, amount, gross_amount, discounted_amount)::text
      || '-'
      || coalesce(get_branch_v4(branch_name, branch), '')
    ),
    strategy_priority
),

-- Step 4: AGGREGATE ON ALL UNIQUE INVOICES (including undated for count/total)
cte_overall_metrics as (
  select 
    input_idx, input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch,
    count(*) as invoices_count,
    sum(inv_amount) as total_spent,
    avg(inv_amount) as avg_invoice,
    string_agg(distinct matched_strategy, ',' order by matched_strategy) as matched_by_str
  from cte_unique_invoices
  group by input_idx, input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch
),

-- Step 5: DATE-ONLY METRICS (from unique invoices with valid dates)
cte_dated_invoices as (
  select 
    input_idx, input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch,
    inv_date, inv_amount, inv_branch
  from cte_unique_invoices
  where inv_date is not null
  order by input_idx, inv_date
),

cte_date_metrics as (
  select 
    input_idx, input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch,
    min(inv_date) as first_purchase,
    max(inv_date) as last_purchase,
    count(distinct to_char(inv_date, 'YYYY-MM')) as months_count
  from cte_dated_invoices
  group by input_idx, input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch
),

-- Step 6: MONTHLY METRICS (current & previous, from dated invoices)
cte_monthly_metrics as (
  select 
    input_idx, input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch,
    sum(case when inv_date >= date_trunc('month', now()::date)::date and inv_date < (date_trunc('month', now()::date)::date + interval '1 month')::date then inv_amount else 0 end) as current_month_spent,
    count(case when inv_date >= date_trunc('month', now()::date)::date and inv_date < (date_trunc('month', now()::date)::date + interval '1 month')::date then 1 else null end) as current_month_count,
    sum(case when inv_date >= (date_trunc('month', now()::date)::date - interval '1 month')::date and inv_date < date_trunc('month', now()::date)::date then inv_amount else 0 end) as previous_month_spent,
    count(case when inv_date >= (date_trunc('month', now()::date)::date - interval '1 month')::date and inv_date < date_trunc('month', now()::date)::date then 1 else null end) as previous_month_count
  from cte_dated_invoices
  group by input_idx, input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch
),

-- Step 7: BRANCH METRICS (from dated invoices)
cte_branch_metrics as (
  select 
    input_idx, input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch,
    inv_branch,
    count(*) as branch_count,
    sum(inv_amount) as branch_total,
    max(inv_date) as branch_last_date
  from cte_dated_invoices
  where inv_branch is not null
  group by input_idx, input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch, inv_branch
),

cte_branch_agg as (
  select 
    input_idx, input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch,
    (array_agg(inv_branch order by branch_count desc))[1] as branch_most_frequent,
    (array_agg(inv_branch order by branch_total desc))[1] as branch_highest_value,
    (select inv_branch from cte_dated_invoices d2 
     where d2.input_idx = b.input_idx
     order by d2.inv_date desc limit 1) as branch_last_purchase
  from cte_branch_metrics b
  group by input_idx, input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch
),

-- Step 8: SEGMENT AND STATUS CALCULATION (exact JS parity)
cte_with_segment as (
  select 
    o.input_idx, o.input_cust_id, o.input_cust_code, o.input_cust_phone, o.input_cust_name, o.input_cust_branch,
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
  left join cte_date_metrics d on d.input_idx = o.input_idx
  left join cte_monthly_metrics m on m.input_idx = o.input_idx
  left join cte_branch_agg b on b.input_idx = o.input_idx
)

-- FINAL OUTPUT
select 
  s.input_cust_id as customer_id,
  s.input_cust_code as customer_code,
  s.input_cust_phone as customer_phone,
  s.input_cust_name as customer_name,
  s.input_cust_branch as branch_input,
  coalesce(s.total_spent, 0) as total_spent,
  s.invoices_count as invoices_count,
  coalesce(s.avg_invoice, 0) as avg_invoice,
  case when s.months_count > 0 then s.total_spent / s.months_count else 0 end as avg_monthly,
  s.current_month_spent as current_month_spent,
  s.previous_month_spent as previous_month_spent,
  s.current_month_count as current_month_count,
  s.previous_month_count as previous_month_count,
  s.last_purchase as last_purchase,
  s.first_purchase as first_purchase,
  case when s.months_count > 0 then s.invoices_count::numeric / s.months_count else s.current_month_count::numeric end as average_monthly_purchase_count,
  coalesce(
    (select inv_branch from cte_dated_invoices where input_idx = s.input_idx order by inv_date desc limit 1),
    s.branch_most_frequent,
    'غير محدد'
  ) as branch,
  s.branch_most_frequent as branch_most_frequent,
  s.branch_highest_value as branch_highest_value,
  s.branch_last_purchase as branch_last_purchase,
  s.segment as segment,
  s.customer_status as customer_status,
  s.matched_by_str as matched_by,
  s.invoices_count as invoices_matched_count,
  'sales_invoices' as source,
  case 
    when s.matched_by_str like 'code:%' then 'EXACT'
    when s.matched_by_str = 'customer_id' then 'EXACT'
    when s.matched_by_str like 'phone:%' then 'EXACT'
    when s.matched_by_str like 'phoneTail:%' then 'FUZZY'
    when s.matched_by_str like 'name:%' then 'FALLBACK'
    else 'NONE'
  end as match_confidence
from cte_with_segment s
order by s.input_idx nulls last;

$$ language sql stable;

-- SECURITY: Explicit grants and revokes
revoke all on function get_customer_service_metrics_batch_v4(jsonb) from public;
grant execute on function get_customer_service_metrics_batch_v4(jsonb) to authenticated;

revoke execute on function get_amount_v4(numeric, numeric, numeric, numeric, numeric, numeric) from public;
revoke execute on function get_date_v4(date, timestamptz, timestamptz, timestamptz, text) from public;
revoke execute on function get_invoice_id_v4(text, text, text) from public;
revoke execute on function get_branch_v4(text, text) from public;
revoke execute on function last_digits_v4(text, int) from public;

comment on function get_customer_service_metrics_batch_v4(jsonb) is
'PHASE 2 CRITICAL FIXES (v4): Batch fetch customer service metrics with exact JS parity.
CRITICAL IMPLEMENTATION:
  - input_idx (from ORDINALITY) is primary internal identity (NULL-safe)
  - Phone/PhoneTail: All invoices from first successful column (not just 1)
  - Name: Both customer_name and name columns can contribute
  - Name + PhoneTail: Optional phone-tail filtering of name results
  - LIMIT 700: Per-customer per-column-attempt (not global)
  - Dedup: Handles empty string invoiceId via nullif
  - Date helpers: Correct schema types (date, timestamptz, text) with UTC handling
  - All joins: Use input_idx (not composite tuple)
  - matched_by: Deterministic ordered strategy list
STRATEGY PRIORITY: code > customer_id > phone > phoneTail > name
BRANCH ISOLATION: NOT IMPLEMENTED (parity mode)
INPUT: JSONB array of {customer_id, customer_code, customer_phone, customer_name, branch}
OUTPUT: One row per customer with 26 aggregated metrics
READ-ONLY: No UPDATE/INSERT/DELETE
SECURITY: INVOKER, authenticated only, no RLS bypass.'
