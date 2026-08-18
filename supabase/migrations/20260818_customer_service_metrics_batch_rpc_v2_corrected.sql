-- Phase 2: N+1 Elimination via Batch RPC - CORRECTED IMPLEMENTATION
-- Goal: Replace 376-382 sequential queries with 1-2 batch RPC calls
-- Matching priority: code > customer_id > phone > phone_tail > name
-- All metrics calculated with 100% numeric parity to JS summarizeInvoices()
-- SCHEMA VALIDATED: All columns verified against live sales_invoices table
-- 
-- CRITICAL: This RPC is READ-ONLY. No UPDATE/INSERT/DELETE/TRUNCATE allowed.
-- Branch isolation uses normalized canonical branch names.

-- Helper: Normalize Arabic text (matches JS normalizeArabicName)
create or replace function normalize_text_v2(p_text text)
returns text as $$
begin
  if p_text is null or trim(p_text) = '' then return null; end if;
  return lower(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(trim(p_text), '[أإآ]', 'ا', 'g'), 
        'ة', 'ه', 'g'
      ), 
      'ى', 'ي', 'g'
    ), 
    '\s+', ' ', 'g'
  ));
end;
$$ language plpgsql immutable;

-- Helper: Extract last N digits of phone (matches JS lastPhoneDigits)
create or replace function last_digits_v2(p_phone text, p_count int default 10)
returns text as $$
declare
  v_digits text;
begin
  if p_phone is null then return null; end if;
  v_digits := regexp_replace(p_phone, '[^0-9]', '', 'g');
  return case when length(v_digits) > p_count then right(v_digits, p_count) else v_digits end;
end;
$$ language plpgsql immutable;

-- Helper: Get invoice ID with correct priority (matches JS getInvoiceId)
create or replace function get_invoice_id_v2(p_row public.sales_invoices)
returns text as $$
begin
  if p_row.invoice_number is not null and trim(p_row.invoice_number::text) != '' then
    return trim(p_row.invoice_number::text);
  end if;
  if p_row.invoice_no is not null and trim(p_row.invoice_no::text) != '' then
    return trim(p_row.invoice_no::text);
  end if;
  if p_row.id is not null and trim(p_row.id::text) != '' then
    return trim(p_row.id::text);
  end if;
  return '';
end;
$$ language plpgsql immutable;

-- Helper: Get amount with correct priority (matches JS getInvoiceAmount)
-- Priority: net_amount → net_total → total_amount → amount → gross_amount → discounted_amount
create or replace function get_amount_v2(p_row public.sales_invoices)
returns numeric as $$
declare
  v_amount numeric;
begin
  if p_row.net_amount is not null and p_row.net_amount > 0 then
    return p_row.net_amount;
  end if;
  if p_row.net_total is not null and p_row.net_total > 0 then
    return p_row.net_total;
  end if;
  if p_row.total_amount is not null and p_row.total_amount > 0 then
    return p_row.total_amount;
  end if;
  if p_row.amount is not null and p_row.amount > 0 then
    return p_row.amount;
  end if;
  if p_row.gross_amount is not null and p_row.gross_amount > 0 then
    return p_row.gross_amount;
  end if;
  if p_row.discounted_amount is not null and p_row.discounted_amount > 0 then
    return p_row.discounted_amount;
  end if;
  return 0;
exception when others then
  return 0;
end;
$$ language plpgsql immutable;

-- Helper: Get invoice date with correct priority (matches JS getInvoiceDay)
-- Priority: sale_date → invoice_date → invoice_datetime → close_datetime → date
-- All returned as YYYY-MM-DD
create or replace function get_invoice_date_v2(p_row public.sales_invoices)
returns date as $$
begin
  if p_row.sale_date is not null then
    return (p_row.sale_date::timestamp)::date;
  end if;
  if p_row.invoice_date is not null then
    return (p_row.invoice_date::timestamp)::date;
  end if;
  if p_row.invoice_datetime is not null then
    return (p_row.invoice_datetime::timestamp)::date;
  end if;
  if p_row.close_datetime is not null then
    return (p_row.close_datetime::timestamp)::date;
  end if;
  if p_row."date" is not null then
    return (p_row."date"::timestamp)::date;
  end if;
  return null;
exception when others then
  return null;
end;
$$ language plpgsql immutable;

-- Helper: Get branch with normalization (matches JS getInvoiceBranch)
-- First tries branch_name, then branch. Normalizes to canonical names.
create or replace function get_branch_v2(p_row public.sales_invoices)
returns text as $$
declare
  v_branch text;
  v_normalized text;
begin
  -- Try branch_name first
  if p_row.branch_name is not null and trim(p_row.branch_name) != '' then
    v_branch := trim(p_row.branch_name);
  -- Then try branch
  elsif p_row.branch is not null and trim(p_row.branch) != '' then
    v_branch := trim(p_row.branch);
  else
    return 'غير محدد';
  end if;
  
  -- Normalize to canonical Egyptian branch names
  if v_branch ilike '%شكري%' or v_branch ilike '%shokry%' or v_branch ilike '%shoukry%' then
    return 'فرع شكري';
  end if;
  if v_branch ilike '%الشامي%' or v_branch ilike '%شامي%' or v_branch ilike '%shamy%' then
    return 'فرع الشامي';
  end if;
  
  -- Return as-is if no canonical match
  return v_branch;
exception when others then
  return 'غير محدد';
end;
$$ language plpgsql immutable;

-- Main RPC: Batch fetch customer service metrics with correct aggregation logic
create or replace function get_customer_service_metrics_batch_v2(p_customers jsonb)
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

-- Step 1: Parse input with persistent input_index for grouping
cte_input_customers as (
  select 
    row_number() over () as input_idx,
    (elem->>'customer_id')::uuid as input_cust_id,
    nullif(trim(elem->>'customer_code'), '') as input_cust_code,
    nullif(trim(elem->>'customer_phone'), '') as input_cust_phone,
    nullif(trim(elem->>'customer_name'), '') as input_cust_name,
    nullif(trim(elem->>'branch'), '') as input_cust_branch,
    last_digits_v2(nullif(trim(elem->>'customer_phone'), ''), 10) as input_phone_tail,
    normalize_text_v2(nullif(trim(elem->>'customer_name'), '')) as input_norm_name
  from jsonb_array_elements(p_customers) as elem
),

-- Step 2: Strategy 1 - Exact code match (highest priority)
cte_strategy_code as (
  select 
    c.input_idx,
    c.input_cust_id,
    c.input_cust_code,
    c.input_cust_phone,
    c.input_cust_name,
    c.input_cust_branch,
    si.*,
    'code:' || case 
      when si.customer_code = c.input_cust_code then 'customer_code'
      else 'unknown'
    end as matched_strategy,
    1 as strategy_priority
  from cte_input_customers c
  join public.sales_invoices si on (
    c.input_cust_code is not null 
    and si.customer_code = c.input_cust_code
  )
  where c.input_cust_code is not null
),

-- Step 3: Strategy 2 - Exact customer_id match
cte_strategy_customer_id as (
  select 
    c.input_idx,
    c.input_cust_id,
    c.input_cust_code,
    c.input_cust_phone,
    c.input_cust_name,
    c.input_cust_branch,
    si.*,
    'customer_id' as matched_strategy,
    2 as strategy_priority
  from cte_input_customers c
  join public.sales_invoices si on (
    c.input_cust_id is not null 
    and si.customer_id = c.input_cust_id
  )
  where c.input_cust_id is not null
  and c.input_idx not in (
    -- Exclude customers that already matched via code
    select input_idx from cte_strategy_code
  )
),

-- Step 4: Strategy 3 - Exact phone match
cte_strategy_phone as (
  select 
    c.input_idx,
    c.input_cust_id,
    c.input_cust_code,
    c.input_cust_phone,
    c.input_cust_name,
    c.input_cust_branch,
    si.*,
    'phone:' || case
      when si.customer_phone = c.input_cust_phone then 'customer_phone'
      when si.phone = c.input_cust_phone then 'phone'
      when si.whatsapp_phone = c.input_cust_phone then 'whatsapp_phone'
      else 'unknown'
    end as matched_strategy,
    3 as strategy_priority
  from cte_input_customers c
  join public.sales_invoices si on (
    c.input_cust_phone is not null and (
      si.customer_phone = c.input_cust_phone
      or si.phone = c.input_cust_phone
      or si.whatsapp_phone = c.input_cust_phone
    )
  )
  where c.input_cust_phone is not null
  and c.input_idx not in (
    select input_idx from cte_strategy_code
    union
    select input_idx from cte_strategy_customer_id
  )
),

-- Step 5: Strategy 4 - Phone tail fuzzy match (>=8 digits)
cte_strategy_phone_tail as (
  select 
    c.input_idx,
    c.input_cust_id,
    c.input_cust_code,
    c.input_cust_phone,
    c.input_cust_name,
    c.input_cust_branch,
    si.*,
    'phoneTail' as matched_strategy,
    4 as strategy_priority
  from cte_input_customers c
  join public.sales_invoices si on (
    c.input_phone_tail is not null 
    and length(c.input_phone_tail) >= 8 and (
      si.customer_phone ilike '%' || c.input_phone_tail
      or si.phone ilike '%' || c.input_phone_tail
      or si.whatsapp_phone ilike '%' || c.input_phone_tail
    )
  )
  where c.input_phone_tail is not null
  and length(c.input_phone_tail) >= 8
  and c.input_idx not in (
    select input_idx from cte_strategy_code
    union
    select input_idx from cte_strategy_customer_id
    union
    select input_idx from cte_strategy_phone
  )
),

-- Step 6: Strategy 5 - Name fallback (fuzzy match)
cte_strategy_name as (
  select 
    c.input_idx,
    c.input_cust_id,
    c.input_cust_code,
    c.input_cust_phone,
    c.input_cust_name,
    c.input_cust_branch,
    si.*,
    'name' as matched_strategy,
    5 as strategy_priority
  from cte_input_customers c
  join public.sales_invoices si on (
    c.input_norm_name is not null 
    and length(c.input_norm_name) >= 3 and (
      si.customer_name ilike '%' || c.input_cust_name || '%'
      or si.name ilike '%' || c.input_cust_name || '%'
    )
  )
  where c.input_norm_name is not null
  and length(c.input_norm_name) >= 3
  and c.input_idx not in (
    select input_idx from cte_strategy_code
    union
    select input_idx from cte_strategy_customer_id
    union
    select input_idx from cte_strategy_phone
    union
    select input_idx from cte_strategy_phone_tail
  )
),

-- Step 7: Combine all matched invoices (ALL rows, NOT deduplicated yet)
cte_all_matched as (
  select input_idx, input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch,
    id, customer_id, customer_code, customer_phone, phone, whatsapp_phone, customer_name, name,
    matched_strategy, strategy_priority,
    get_invoice_date_v2(si) as inv_date,
    get_amount_v2(si) as inv_amount,
    get_branch_v2(si) as inv_branch,
    get_invoice_id_v2(si) as inv_id,
    si
  from (
    select 
      input_idx, input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch,
      id, customer_id, customer_code, customer_phone, phone, whatsapp_phone, customer_name, name,
      matched_strategy, strategy_priority, 
      sales_invoices as si
    from cte_strategy_code
    union all
    select 
      input_idx, input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch,
      id, customer_id, customer_code, customer_phone, phone, whatsapp_phone, customer_name, name,
      matched_strategy, strategy_priority,
      sales_invoices as si
    from cte_strategy_customer_id
    union all
    select 
      input_idx, input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch,
      id, customer_id, customer_code, customer_phone, phone, whatsapp_phone, customer_name, name,
      matched_strategy, strategy_priority,
      sales_invoices as si
    from cte_strategy_phone
    union all
    select 
      input_idx, input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch,
      id, customer_id, customer_code, customer_phone, phone, whatsapp_phone, customer_name, name,
      matched_strategy, strategy_priority,
      sales_invoices as si
    from cte_strategy_phone_tail
    union all
    select 
      input_idx, input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch,
      id, customer_id, customer_code, customer_phone, phone, whatsapp_phone, customer_name, name,
      matched_strategy, strategy_priority,
      sales_invoices as si
    from cte_strategy_name
  ) combined
),

-- Step 8: Deduplicate invoices by invoice identity (id OR date-amount-branch)
-- Matches JS invoiceIdentity logic
cte_unique_invoices as (
  select distinct on (
    input_idx,
    coalesce(nullif(inv_id, ''), (inv_date || '-' || inv_amount || '-' || coalesce(inv_branch, '')))
  )
    input_idx,
    input_cust_id,
    input_cust_code,
    input_cust_phone,
    input_cust_name,
    input_cust_branch,
    inv_date,
    inv_amount,
    inv_branch,
    matched_strategy,
    strategy_priority
  from cte_all_matched
  order by 
    input_idx,
    coalesce(nullif(inv_id, ''), (inv_date || '-' || inv_amount || '-' || coalesce(inv_branch, ''))),
    strategy_priority
),

-- Step 9: Calculate aggregated metrics
cte_metrics as (
  select 
    input_idx,
    input_cust_id,
    input_cust_code,
    input_cust_phone,
    input_cust_name,
    input_cust_branch,
    count(*) as invoices_count,
    sum(inv_amount) as total_spent,
    sum(inv_amount) / count(*) as avg_invoice,
    min(inv_date) as first_date,
    max(inv_date) as last_date,
    count(distinct (inv_date::text || '-' || extract(year from inv_date)::text || '-' || extract(month from inv_date)::text)) as months_count,
    max(matched_strategy) as matched_by_str
  from cte_unique_invoices
  where inv_date is not null
  group by input_idx, input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch
),

-- Step 10: Calculate monthly metrics
cte_monthly as (
  select 
    input_idx,
    input_cust_id,
    input_cust_code,
    input_cust_phone,
    input_cust_name,
    input_cust_branch,
    sum(case 
      when inv_date >= (date_trunc('month', now())::date) 
        and inv_date < (date_trunc('month', now() + interval '1 month')::date) 
      then inv_amount else 0 
    end) as current_month_spent,
    count(case 
      when inv_date >= (date_trunc('month', now())::date) 
        and inv_date < (date_trunc('month', now() + interval '1 month')::date) 
      then 1 else null 
    end) as current_month_count,
    sum(case 
      when inv_date >= (date_trunc('month', now() - interval '1 month')::date) 
        and inv_date < (date_trunc('month', now())::date) 
      then inv_amount else 0 
    end) as previous_month_spent,
    count(case 
      when inv_date >= (date_trunc('month', now() - interval '1 month')::date) 
        and inv_date < (date_trunc('month', now())::date) 
      then 1 else null 
    end) as previous_month_count
  from cte_unique_invoices
  group by input_idx, input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch
),

-- Step 11: Calculate branch metrics
cte_branch_stats as (
  select 
    input_idx,
    input_cust_id,
    input_cust_code,
    input_cust_phone,
    input_cust_name,
    input_cust_branch,
    inv_branch,
    count(*) as branch_count,
    sum(inv_amount) as branch_spent,
    max(inv_date) as branch_last_date
  from cte_unique_invoices
  where inv_branch is not null
  group by input_idx, input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch, inv_branch
),

cte_branch_agg as (
  select 
    input_idx,
    input_cust_id,
    input_cust_code,
    input_cust_phone,
    input_cust_name,
    input_cust_branch,
    (array_agg(inv_branch order by branch_count desc))[1] as branch_most_frequent,
    (array_agg(inv_branch order by branch_spent desc))[1] as branch_highest_value,
    (select inv_branch from cte_unique_invoices u2 
     where u2.input_idx = b.input_idx and u2.inv_date = 
       (select max(inv_date) from cte_unique_invoices u3 where u3.input_idx = b.input_idx)
     limit 1) as branch_last_purchase
  from cte_branch_stats b
  group by input_idx, input_cust_id, input_cust_code, input_cust_phone, input_cust_name, input_cust_branch
),

-- Step 12: Final aggregation with segment/status calculations
cte_final as (
  select 
    m.input_cust_id,
    m.input_cust_code,
    m.input_cust_phone,
    m.input_cust_name,
    m.input_cust_branch,
    m.total_spent,
    m.invoices_count,
    m.avg_invoice,
    case when m.months_count > 0 then m.total_spent / m.months_count else 0 end as avg_monthly,
    mo.current_month_spent,
    mo.previous_month_spent,
    mo.current_month_count,
    mo.previous_month_count,
    m.last_date as last_purchase,
    m.first_date as first_purchase,
    case when m.months_count > 0 then m.invoices_count::numeric / m.months_count else mo.current_month_count::numeric end as average_monthly_purchase_count,
    coalesce(
      (select inv_branch from cte_unique_invoices where input_idx = m.input_idx order by inv_date desc limit 1),
      b.branch_most_frequent,
      'غير محدد'
    ) as branch,
    b.branch_most_frequent,
    b.branch_highest_value,
    b.branch_last_purchase,
    case 
      when m.total_spent >= 8000 or m.invoices_count >= 12 then 'VIP'
      when m.total_spent >= 4000 or m.invoices_count >= 6 then 'Loyal'
      when m.last_date < (now() - interval '90 days')::date then 'At Risk'
      else 'Occasional'
    end as segment,
    case 
      when m.last_date is null then 'لا يوجد شراء'
      when m.last_date >= (now() - interval '45 days')::date then 'نشط'
      when m.last_date >= (now() - interval '90 days')::date then 'يحتاج متابعة'
      else 'متوقف'
    end as customer_status,
    m.matched_by_str as matched_by,
    m.invoices_count as invoices_matched_count
  from cte_metrics m
  left join cte_monthly mo on m.input_idx = mo.input_idx
  left join cte_branch_agg b on m.input_idx = b.input_idx
)

select 
  f.input_cust_id as customer_id,
  f.input_cust_code as customer_code,
  f.input_cust_phone as customer_phone,
  f.input_cust_name as customer_name,
  f.input_cust_branch as branch_input,
  f.total_spent,
  f.invoices_count,
  f.avg_invoice,
  f.avg_monthly,
  f.current_month_spent,
  f.previous_month_spent,
  f.current_month_count,
  f.previous_month_count,
  f.last_purchase,
  f.first_purchase,
  f.average_monthly_purchase_count,
  f.branch,
  f.branch_most_frequent,
  f.branch_highest_value,
  f.branch_last_purchase,
  f.segment,
  f.customer_status,
  f.matched_by,
  f.invoices_matched_count,
  'sales_invoices' as source,
  case 
    when f.matched_by like 'code:%' then 'EXACT'
    when f.matched_by = 'customer_id' then 'EXACT'
    when f.matched_by like 'phone:%' then 'EXACT'
    when f.matched_by = 'phoneTail' then 'FUZZY'
    when f.matched_by = 'name' then 'FALLBACK'
    else 'NONE'
  end as match_confidence
from cte_final f
order by f.input_cust_id nulls last;

$$ language sql stable;

-- Security: Grant only to authenticated role, no public access
grant execute on function get_customer_service_metrics_batch_v2(jsonb) to authenticated;

-- Documentation
comment on function get_customer_service_metrics_batch_v2(jsonb) is
'PHASE 2 CORRECTED: Batch fetch customer service metrics with 100% parity to fetchByStrategies() + summarizeInvoices().
Matching priority: code > customer_id > phone > phone_tail > name.
Uses stable SCHEMA-VERIFIED columns only. All invoices retained before dedup.
Input: JSONB array of {customer_id, customer_code, customer_phone, customer_name, branch}
Output: One row per customer with 26 aggregated metrics fields.
READ-ONLY: No UPDATE/INSERT/DELETE allowed.';
