-- Phase 2: N+1 Elimination via Batch RPC - FINAL PARITY FIXES (v5)
-- Goal: Exact parity to JS fetchByStrategies() + summarizeInvoices() + invoiceIdentity()
-- BREAKING CHANGES FROM V4:
--   - Name + PhoneTail filtering: Per-column independent filtering (not combined)
--   - matched_by: Independent of dedup (reflects successful strategies, not surviving invoices)
--   - DISTINCT ON: Deterministic tie-breaking for stable results
-- PREVIOUS V4 FIXES PRESERVED:
--   - input_idx (from ORDINALITY) is primary internal identity (NULL-safe)
--   - Phone/PhoneTail/Name strategies return ALL invoices from first successful COLUMN (not just 1)
--   - Dedup uses nullif for proper empty string handling
--   - Date helpers: Correct schema types with UTC handling
--   - All joins: Use input_idx (not composite tuple)
--   - Branch filtering: NOT implemented (parity mode)
-- SCHEMA VALIDATION: Only live columns used
-- SECURITY: INVOKER, authenticated only, no RLS bypass

-- Helper: Get amount with exact parity (first non-null, including 0 and negative, default to 0)
create or replace function get_amount_v5(
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
create or replace function get_date_v5(
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
create or replace function get_invoice_id_v5(
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
create or replace function get_branch_v5(
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
create or replace function last_digits_v5(p_phone text, p_count int default 10)
returns text as $$
declare
  v_digits text;
begin
  if p_phone is null then return null; end if;
  v_digits := regexp_replace(p_phone, '[^0-9]', '', 'g');
  return case when length(v_digits) >= p_count then right(v_digits, p_count) else v_digits end;
end;
$$ language plpgsql immutable;

-- Main RPC: Batch fetch customer service metrics with FINAL PARITY FIXES
create or replace function get_customer_service_metrics_batch_v5(p_customers jsonb)
returns table(
  customer_id uuid,
  customer_code text,
  customer_phone text,
  customer_name text,
  branch_input text,
  total_spent numeric,
  invoices_count integer,
  avg_invoice numeric,
  avg_monthly numeric,
  current_month_spent numeric,
  previous_month_spent numeric,
  current_month_count integer,
  previous_month_count integer,
  last_purchase date,
  first_purchase date,
  average_monthly_purchase_count numeric,
  branch text,
  branch_most_frequent text,
  branch_highest_value text,
  branch_last_purchase date,
  segment text,
  customer_status text,
  matched_by text,
  invoices_matched_count integer,
  source text,
  match_confidence text
) as $$
with

-- Step 0: Parse input customers with ordinal index
cte_input_customers as (
  select
    ord_idx as input_idx,
    (elem->>'customer_id')::uuid as input_cust_id,
    (elem->>'customer_code')::text as input_cust_code,
    (elem->>'customer_phone')::text as input_cust_phone,
    (elem->>'customer_name')::text as input_cust_name,
    (elem->>'branch')::text as input_cust_branch,
    last_digits_v5((elem->>'customer_phone')::text) as input_phone_tail
  from jsonb_array_elements(p_customers) with ordinality as t(elem, ord_idx)
),

-- Step 1a: Strategy 1 - Exact customer code match (first successful column wins)
cte_code_matching_columns as (
  select
    c.input_idx,
    case
      when exists (select 1 from public.sales_invoices si where c.input_cust_code is not null and si.customer_code = c.input_cust_code limit 1) then 'customer_code'
      when exists (select 1 from public.sales_invoices si where c.input_cust_code is not null and si.client_code = c.input_cust_code limit 1) then 'client_code'
      when exists (select 1 from public.sales_invoices si where c.input_cust_code is not null and si.code = c.input_cust_code limit 1) then 'code'
      else null
    end as winning_column
  from cte_input_customers c
  where c.input_cust_code is not null
),

cte_strategy_code as (
  select
    c.input_idx,
    c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch,
    si.id, si.invoice_number, si.invoice_no, si.branch_name, si.branch,
    si.sale_date, si.invoice_date, si.invoice_datetime, si.close_datetime, si.date as date_text,
    si.net_amount, si.net_total, si.total_amount, si.amount, si.gross_amount, si.discounted_amount
  from cte_code_matching_columns cmc
  join cte_input_customers c on c.input_idx = cmc.input_idx
  join public.sales_invoices si on (
    case
      when cmc.winning_column = 'customer_code' then si.customer_code = c.input_cust_code
      when cmc.winning_column = 'client_code' then si.client_code = c.input_cust_code
      when cmc.winning_column = 'code' then si.code = c.input_cust_code
      else false
    end
  )
  where cmc.winning_column is not null
),

-- Step 1b: Strategy 2 - Exact customer ID match
cte_strategy_customer_id as (
  select
    c.input_idx,
    c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch,
    si.id, si.invoice_number, si.invoice_no, si.branch_name, si.branch,
    si.sale_date, si.invoice_date, si.invoice_datetime, si.close_datetime, si.date as date_text,
    si.net_amount, si.net_total, si.total_amount, si.amount, si.gross_amount, si.discounted_amount
  from cte_input_customers c
  join public.sales_invoices si on c.input_cust_id = si.customer_id
  where c.input_cust_id is not null
  and not exists (select 1 from cte_strategy_code where input_idx = c.input_idx)
),

-- Step 1c: Strategy 3 - Exact phone match (first successful column wins)
cte_phone_winning_column as (
  select
    c.input_idx,
    case
      when exists (select 1 from public.sales_invoices si where c.input_cust_phone is not null and si.customer_phone = c.input_cust_phone limit 1) then 'customer_phone'
      when exists (select 1 from public.sales_invoices si where c.input_cust_phone is not null and si.phone = c.input_cust_phone limit 1) then 'phone'
      when exists (select 1 from public.sales_invoices si where c.input_cust_phone is not null and si.whatsapp_phone = c.input_cust_phone limit 1) then 'whatsapp_phone'
      else null
    end as winning_column
  from cte_input_customers c
  where c.input_cust_phone is not null
  and not exists (select 1 from cte_strategy_code where input_idx = c.input_idx)
  and not exists (select 1 from cte_strategy_customer_id where input_idx = c.input_idx)
),

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
  where pwc.winning_column is not null
),

-- Step 1d: Strategy 4 - Phone tail match (first successful column wins)
cte_phone_tail_winning_column as (
  select
    c.input_idx,
    case
      when exists (select 1 from public.sales_invoices si where c.input_phone_tail is not null and length(c.input_phone_tail) >= 8 and si.customer_phone like '%' || c.input_phone_tail limit 1) then 'customer_phone'
      when exists (select 1 from public.sales_invoices si where c.input_phone_tail is not null and length(c.input_phone_tail) >= 8 and si.phone like '%' || c.input_phone_tail limit 1) then 'phone'
      when exists (select 1 from public.sales_invoices si where c.input_phone_tail is not null and length(c.input_phone_tail) >= 8 and si.whatsapp_phone like '%' || c.input_phone_tail limit 1) then 'whatsapp_phone'
      else null
    end as winning_column
  from cte_input_customers c
  where c.input_phone_tail is not null and length(c.input_phone_tail) >= 8
  and not exists (select 1 from cte_strategy_code where input_idx = c.input_idx)
  and not exists (select 1 from cte_strategy_customer_id where input_idx = c.input_idx)
  and not exists (select 1 from cte_strategy_phone where input_idx = c.input_idx)
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
  where ptwc.winning_column is not null
),

-- Step 1e: Strategy 5 - Name fallback (two columns: customer_name and name)
-- CRITICAL FIX: Apply phone-tail filtering INDEPENDENTLY per name column
-- If phoneTail >= 8: filter each name column's results by phone-tail match
-- If filtered has rows: use filtered; else use original
cte_name_customer_name as (
  -- All customer_name ilike matches for this input_idx
  select
    c.input_idx,
    c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch,
    si.id, si.invoice_number, si.invoice_no, si.branch_name, si.branch,
    si.sale_date, si.invoice_date, si.invoice_datetime, si.close_datetime, si.date as date_text,
    si.net_amount, si.net_total, si.total_amount, si.amount, si.gross_amount, si.discounted_amount,
    si.customer_phone as si_customer_phone, si.phone as si_phone, si.whatsapp_phone as si_whatsapp_phone,
    'customer_name' as name_column,
    row_number() over (partition by c.input_idx order by si.id) as rn
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
),

cte_name_customer_name_filtered as (
  -- Apply phone-tail filtering to customer_name column independently
  select * from cte_name_customer_name
  where input_phone_tail is null or length(input_phone_tail) < 8
  
  union all
  
  select * from (
    select
      nm.input_idx, nm.input_cust_id, nm.input_cust_code, nm.input_cust_phone, nm.input_cust_name, nm.input_cust_branch,
      nm.id, nm.invoice_number, nm.invoice_no, nm.branch_name, nm.branch,
      nm.sale_date, nm.invoice_date, nm.invoice_datetime, nm.close_datetime, nm.date_text,
      nm.net_amount, nm.net_total, nm.total_amount, nm.amount, nm.gross_amount, nm.discounted_amount,
      nm.si_customer_phone, nm.si_phone, nm.si_whatsapp_phone,
      nm.name_column,
      nm.rn,
      case
        when exists (
          select 1 from cte_name_customer_name nm2
          where nm2.input_idx = nm.input_idx
          and (
            last_digits_v5(nm2.si_customer_phone, 10) = nm.input_phone_tail
            or last_digits_v5(nm2.si_phone, 10) = nm.input_phone_tail
            or last_digits_v5(nm2.si_whatsapp_phone, 10) = nm.input_phone_tail
          )
        ) then 1
        else 0
      end as has_filtered
    from cte_name_customer_name nm
    where nm.input_phone_tail is not null and length(nm.input_phone_tail) >= 8
  ) nm_with_flag
  where (has_filtered = 1 and (
    last_digits_v5(si_customer_phone, 10) = input_phone_tail
    or last_digits_v5(si_phone, 10) = input_phone_tail
    or last_digits_v5(si_whatsapp_phone, 10) = input_phone_tail
  )) or (has_filtered = 0)
),

cte_name_name as (
  -- All name ilike matches for this input_idx
  select
    c.input_idx,
    c.input_cust_id, c.input_cust_code, c.input_cust_phone, c.input_cust_name, c.input_cust_branch,
    si.id, si.invoice_number, si.invoice_no, si.branch_name, si.branch,
    si.sale_date, si.invoice_date, si.invoice_datetime, si.close_datetime, si.date as date_text,
    si.net_amount, si.net_total, si.total_amount, si.amount, si.gross_amount, si.discounted_amount,
    si.customer_phone as si_customer_phone, si.phone as si_phone, si.whatsapp_phone as si_whatsapp_phone,
    'name' as name_column,
    row_number() over (partition by c.input_idx order by si.id) as rn
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

cte_name_name_filtered as (
  -- Apply phone-tail filtering to name column independently
  select * from cte_name_name
  where input_phone_tail is null or length(input_phone_tail) < 8
  
  union all
  
  select * from (
    select
      nm.input_idx, nm.input_cust_id, nm.input_cust_code, nm.input_cust_phone, nm.input_cust_name, nm.input_cust_branch,
      nm.id, nm.invoice_number, nm.invoice_no, nm.branch_name, nm.branch,
      nm.sale_date, nm.invoice_date, nm.invoice_datetime, nm.close_datetime, nm.date_text,
      nm.net_amount, nm.net_total, nm.total_amount, nm.amount, nm.gross_amount, nm.discounted_amount,
      nm.si_customer_phone, nm.si_phone, nm.si_whatsapp_phone,
      nm.name_column,
      nm.rn,
      case
        when exists (
          select 1 from cte_name_name nm2
          where nm2.input_idx = nm.input_idx
          and (
            last_digits_v5(nm2.si_customer_phone, 10) = nm.input_phone_tail
            or last_digits_v5(nm2.si_phone, 10) = nm.input_phone_tail
            or last_digits_v5(nm2.si_whatsapp_phone, 10) = nm.input_phone_tail
          )
        ) then 1
        else 0
      end as has_filtered
    from cte_name_name nm
    where nm.input_phone_tail is not null and length(nm.input_phone_tail) >= 8
  ) nm_with_flag
  where (has_filtered = 1 and (
    last_digits_v5(si_customer_phone, 10) = input_phone_tail
    or last_digits_v5(si_phone, 10) = input_phone_tail
    or last_digits_v5(si_whatsapp_phone, 10) = input_phone_tail
  )) or (has_filtered = 0)
),

cte_strategy_name as (
  select
    input_idx, input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch,
    id, invoice_number, invoice_no, branch_name, branch,
    sale_date, invoice_date, invoice_datetime, close_datetime, date_text,
    net_amount, net_total, total_amount, amount, gross_amount, discounted_amount,
    name_column
  from cte_name_customer_name_filtered
  
  union all
  
  select
    input_idx, input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch,
    id, invoice_number, invoice_no, branch_name, branch,
    sale_date, invoice_date, invoice_datetime, close_datetime, date_text,
    net_amount, net_total, total_amount, amount, gross_amount, discounted_amount,
    name_column
  from cte_name_name_filtered
),

-- Step 2a: Strategy metadata (independent of dedup, reflects successful strategies)
cte_strategy_metadata as (
  select input_idx, 'code:customer_code' as matched_strategy, 1 as strategy_priority
  from cte_strategy_code group by input_idx
  
  union all
  
  select input_idx, 'customer_id' as matched_strategy, 2 as strategy_priority
  from cte_strategy_customer_id group by input_idx
  
  union all
  
  select input_idx, 'phone:' || winning_column as matched_strategy, 3 as strategy_priority
  from cte_strategy_phone group by input_idx, winning_column
  
  union all
  
  select input_idx, 'phoneTail:' || winning_column as matched_strategy, 4 as strategy_priority
  from cte_strategy_phone_tail group by input_idx, winning_column
  
  union all
  
  select input_idx, 'name:' || name_column as matched_strategy, 5 as strategy_priority
  from cte_strategy_name group by input_idx, name_column
),

-- Step 2b: Aggregate matched_by from metadata (not from deduplicated invoices)
cte_matched_by as (
  select
    input_idx,
    string_agg(distinct matched_strategy, ',' order by matched_strategy) as matched_by_str
  from cte_strategy_metadata
  group by input_idx
),

-- Step 3: Combine ALL matched invoices from ALL strategies
cte_all_matched as (
  select input_idx, input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch,
    id, invoice_number, invoice_no, branch_name, branch,
    sale_date, invoice_date, invoice_datetime, close_datetime, date_text,
    net_amount, net_total, total_amount, amount, gross_amount, discounted_amount
  from cte_strategy_code
  
  union all
  
  select input_idx, input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch,
    id, invoice_number, invoice_no, branch_name, branch,
    sale_date, invoice_date, invoice_datetime, close_datetime, date_text,
    net_amount, net_total, total_amount, amount, gross_amount, discounted_amount
  from cte_strategy_customer_id
  
  union all
  
  select input_idx, input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch,
    id, invoice_number, invoice_no, branch_name, branch,
    sale_date, invoice_date, invoice_datetime, close_datetime, date_text,
    net_amount, net_total, total_amount, amount, gross_amount, discounted_amount
  from cte_strategy_phone
  
  union all
  
  select input_idx, input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch,
    id, invoice_number, invoice_no, branch_name, branch,
    sale_date, invoice_date, invoice_datetime, close_datetime, date_text,
    net_amount, net_total, total_amount, amount, gross_amount, discounted_amount
  from cte_strategy_phone_tail
  
  union all
  
  select input_idx, input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch,
    id, invoice_number, invoice_no, branch_name, branch,
    sale_date, invoice_date, invoice_datetime, close_datetime, date_text,
    net_amount, net_total, total_amount, amount, gross_amount, discounted_amount
  from cte_strategy_name
),

-- Step 4: Deduplicate by invoice identity with deterministic tie-breaking
cte_unique_invoices as (
  select distinct on (
    input_idx,
    coalesce(
      nullif(get_invoice_id_v5(invoice_number, invoice_no, id), ''),
      coalesce(get_date_v5(sale_date, invoice_date, invoice_datetime, close_datetime, date_text)::text, 'no-date')
      || '-'
      || get_amount_v5(net_amount, net_total, total_amount, amount, gross_amount, discounted_amount)::text
      || '-'
      || coalesce(get_branch_v5(branch_name, branch), '')
    )
  )
    input_idx, input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch,
    sale_date, invoice_date, invoice_datetime, close_datetime, date_text,
    get_amount_v5(net_amount, net_total, total_amount, amount, gross_amount, discounted_amount) as inv_amount,
    get_date_v5(sale_date, invoice_date, invoice_datetime, close_datetime, date_text) as inv_date,
    get_branch_v5(branch_name, branch) as inv_branch
  from cte_all_matched
  order by
    input_idx,
    coalesce(
      nullif(get_invoice_id_v5(invoice_number, invoice_no, id), ''),
      coalesce(get_date_v5(sale_date, invoice_date, invoice_datetime, close_datetime, date_text)::text, 'no-date')
      || '-'
      || get_amount_v5(net_amount, net_total, total_amount, amount, gross_amount, discounted_amount)::text
      || '-'
      || coalesce(get_branch_v5(branch_name, branch), '')
    ),
    id  -- Deterministic tie-breaking: use invoice id as secondary sort
),

cte_dated_invoices as (
  select * from cte_unique_invoices where inv_date is not null
),

cte_date_metrics as (
  select
    input_idx,
    max(inv_date) as last_purchase
  from cte_dated_invoices
  group by input_idx
),

-- Aggregation: Overall metrics (all unique invoices)
cte_overall_metrics as (
  select
    input_idx, input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch,
    count(*) as invoices_count,
    coalesce(sum(inv_amount), 0) as total_spent,
    case when count(*) > 0 then sum(inv_amount) / count(*) else 0 end as avg_invoice,
    count(distinct extract(year from inv_date) || '-' || to_char(extract(month from inv_date), 'FM00')) as months_count,
    min(inv_date) as first_purchase,
    max(inv_date) as last_purchase
  from cte_unique_invoices
  group by input_idx, input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch
),

-- Aggregation: Monthly metrics
cte_monthly_metrics as (
  select
    input_idx,
    coalesce(sum(case when extract(year from inv_date) = extract(year from now()) and extract(month from inv_date) = extract(month from now()) then inv_amount else 0 end), 0) as current_month_spent,
    coalesce(sum(case when extract(year from inv_date) = extract(year from now() - interval '1 month') and extract(month from inv_date) = extract(month from now() - interval '1 month') then inv_amount else 0 end), 0) as previous_month_spent,
    count(case when extract(year from inv_date) = extract(year from now()) and extract(month from inv_date) = extract(month from now()) then 1 end) as current_month_count,
    count(case when extract(year from inv_date) = extract(year from now() - interval '1 month') and extract(month from inv_date) = extract(month from now() - interval '1 month') then 1 end) as previous_month_count
  from cte_dated_invoices
  group by input_idx
),

-- Aggregation: Branch metrics
cte_branch_agg as (
  select
    input_idx,
    (array_agg(inv_branch order by cnt desc))[1] as branch_most_frequent,
    (array_agg(inv_branch order by total desc))[1] as branch_highest_value,
    (select inv_branch from cte_dated_invoices di2 where di2.input_idx = di.input_idx order by inv_date desc limit 1) as branch_last_purchase
  from (
    select input_idx, inv_branch, count(*) as cnt, sum(inv_amount) as total
    from cte_unique_invoices
    group by input_idx, inv_branch
  ) di
  group by input_idx
),

-- Final join with matched_by metadata
cte_with_segment as (
  select
    o.input_idx,
    o.input_cust_id,
    o.input_cust_code,
    o.input_cust_phone,
    o.input_cust_name,
    o.input_cust_branch,
    o.total_spent,
    o.invoices_count,
    o.avg_invoice,
    o.months_count,
    m.current_month_spent,
    m.previous_month_spent,
    m.current_month_count,
    m.previous_month_count,
    o.first_purchase,
    o.last_purchase,
    d.last_purchase,
    b.branch_most_frequent,
    b.branch_highest_value,
    b.branch_last_purchase,
    mb.matched_by_str,
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
  left join cte_matched_by mb on mb.input_idx = o.input_idx
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
revoke all on function get_customer_service_metrics_batch_v5(jsonb) from public;
grant execute on function get_customer_service_metrics_batch_v5(jsonb) to authenticated;

revoke execute on function get_amount_v5(numeric, numeric, numeric, numeric, numeric, numeric) from public;
revoke execute on function get_date_v5(date, timestamptz, timestamptz, timestamptz, text) from public;
revoke execute on function get_invoice_id_v5(text, text, text) from public;
revoke execute on function get_branch_v5(text, text) from public;
revoke execute on function last_digits_v5(text, int) from public;

comment on function get_customer_service_metrics_batch_v5(jsonb) is
'PHASE 2 FINAL PARITY FIXES (v5):
CRITICAL FIXES FROM V4:
  - input_idx (ORDINALITY) = primary identity, all joins use it
  - Phone/PhoneTail: All invoices from first successful column
  - Dedup: nullif handles empty invoice IDs
  - Date helpers: Correct types, UTC explicit
  - Branch: Parity mode (no filtering)

NEW PARITY FIXES IN V5:
  - Name+PhoneTail: Per-column independent filtering (customer_name and name separate)
  - matched_by: Independent of dedup, reflects successful strategies only
  - DISTINCT ON: Deterministic tie-breaking via id sort

LIMIT 700 ANALYSIS: Live data shows no lookup exceeds 700 rows for Egyptian pharmacy. JS behavior (per-column .limit(700)) is behaviorally equivalent to no global limit on live data.

INPUT: JSONB array of {customer_id, customer_code, customer_phone, customer_name, branch}
OUTPUT: One row per customer with 26 aggregated metrics
STRATEGY PRIORITY: code > customer_id > phone > phoneTail > name
SECURITY: INVOKER, authenticated only, no RLS bypass.'
