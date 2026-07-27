-- Hard fix for customer loyalty invoice timeouts.
-- Uses sargable predicates and narrow indexed paths before any fallback logic.

create index if not exists sales_invoices_loyalty_code_invoice_date_idx
  on public.sales_invoices (customer_code, invoice_date)
  include (net_total, net_amount, discounted_amount, amount, total_amount, gross_total, gross_amount, branch, branch_name);

create index if not exists sales_invoices_loyalty_id_invoice_date_idx
  on public.sales_invoices (customer_id, invoice_date)
  include (net_total, net_amount, discounted_amount, amount, total_amount, gross_total, gross_amount, branch, branch_name);

create index if not exists sales_invoices_loyalty_phone_invoice_date_idx
  on public.sales_invoices (customer_phone, invoice_date)
  include (net_total, net_amount, discounted_amount, amount, total_amount, gross_total, gross_amount, branch, branch_name);

create or replace function public.customer_invoice_period_summary(
  p_customer_code text,
  p_customer_phone text,
  p_customer_id text,
  p_branch text,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
security definer
set search_path = public
set statement_timeout = '12s'
as $$
declare
  v_total numeric := 0;
  v_count integer := 0;
  v_branch text := public.normalize_loyalty_branch(p_branch);
  v_code text := nullif(trim(coalesce(p_customer_code,'')),'');
  v_id text := nullif(trim(coalesce(p_customer_id,'')),'');
  v_phone text := nullif(trim(coalesce(p_customer_phone,'')),'');
  v_phone_digits text := regexp_replace(coalesce(p_customer_phone,''),'\D','','g');
begin
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'فترة احتساب النقاط غير صحيحة.';
  end if;

  -- Fastest and preferred path: exact customer code + invoice_date range.
  if v_code is not null then
    select
      coalesce(sum(coalesce(si.net_total,si.net_amount,si.discounted_amount,si.amount,si.total_amount,si.gross_total,si.gross_amount,0)),0),
      count(*)
    into v_total,v_count
    from public.sales_invoices si
    where si.customer_code = v_code
      and si.invoice_date >= p_from
      and si.invoice_date < (p_to + 1)
      and (
        v_branch is null
        or si.branch = v_branch
        or si.branch_name = v_branch
        or (v_branch='فرع الشامي' and (si.branch ilike '%شامي%' or si.branch_name ilike '%شامي%'))
        or (v_branch='فرع شكري' and (si.branch ilike '%شكري%' or si.branch ilike '%شكرى%' or si.branch_name ilike '%شكري%' or si.branch_name ilike '%شكرى%'))
      );

  elsif v_id is not null then
    select
      coalesce(sum(coalesce(si.net_total,si.net_amount,si.discounted_amount,si.amount,si.total_amount,si.gross_total,si.gross_amount,0)),0),
      count(*)
    into v_total,v_count
    from public.sales_invoices si
    where si.customer_id::text = v_id
      and si.invoice_date >= p_from
      and si.invoice_date < (p_to + 1)
      and (
        v_branch is null
        or si.branch = v_branch
        or si.branch_name = v_branch
        or (v_branch='فرع الشامي' and (si.branch ilike '%شامي%' or si.branch_name ilike '%شامي%'))
        or (v_branch='فرع شكري' and (si.branch ilike '%شكري%' or si.branch ilike '%شكرى%' or si.branch_name ilike '%شكري%' or si.branch_name ilike '%شكرى%'))
      );

  elsif v_phone is not null then
    -- Exact stored phone first so the normal btree index is used.
    select
      coalesce(sum(coalesce(si.net_total,si.net_amount,si.discounted_amount,si.amount,si.total_amount,si.gross_total,si.gross_amount,0)),0),
      count(*)
    into v_total,v_count
    from public.sales_invoices si
    where si.customer_phone in (
      v_phone,
      v_phone_digits,
      case when v_phone_digits like '20%' then '0' || substr(v_phone_digits,3) else v_phone_digits end,
      case when v_phone_digits like '01%' then '2' || v_phone_digits else v_phone_digits end
    )
      and si.invoice_date >= p_from
      and si.invoice_date < (p_to + 1)
      and (
        v_branch is null
        or si.branch = v_branch
        or si.branch_name = v_branch
        or (v_branch='فرع الشامي' and (si.branch ilike '%شامي%' or si.branch_name ilike '%شامي%'))
        or (v_branch='فرع شكري' and (si.branch ilike '%شكري%' or si.branch ilike '%شكرى%' or si.branch_name ilike '%شكري%' or si.branch_name ilike '%شكرى%'))
      );
  end if;

  return jsonb_build_object(
    'purchase_total',coalesce(v_total,0),
    'invoice_count',coalesce(v_count,0),
    'period_start',p_from,
    'period_end',p_to,
    'lookup_method',case when v_code is not null then 'customer_code' when v_id is not null then 'customer_id' else 'customer_phone' end
  );
end;
$$;

grant execute on function public.customer_invoice_period_summary(text,text,text,text,date,date) to authenticated;

analyze public.sales_invoices;
select pg_notify('pgrst','reload schema');
