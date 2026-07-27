-- Fix loyalty invoice totals when imported sales values are stored in thousandths of an EGP.

create or replace function public.loyalty_invoice_amount(
  p_net_total numeric,
  p_gross_total numeric,
  p_total_amount numeric,
  p_net_amount numeric,
  p_discounted_amount numeric,
  p_gross_amount numeric,
  p_amount numeric,
  p_source text,
  p_import_batch text
)
returns numeric
language sql
immutable
as $$
  select round(
    case
      when coalesce(nullif(p_net_total,0),nullif(p_gross_total,0),nullif(p_total_amount,0)) is not null
        then coalesce(nullif(p_net_total,0),nullif(p_gross_total,0),nullif(p_total_amount,0))
      when coalesce(nullif(p_net_amount,0),nullif(p_discounted_amount,0),nullif(p_gross_amount,0),nullif(p_amount,0)) is null
        then 0
      when lower(coalesce(p_source,''))='manual'
        or lower(coalesce(p_import_batch,'')) like 'import-sales-%'
        then coalesce(nullif(p_net_amount,0),nullif(p_discounted_amount,0),nullif(p_gross_amount,0),nullif(p_amount,0)) / 1000.0
      else coalesce(nullif(p_net_amount,0),nullif(p_discounted_amount,0),nullif(p_gross_amount,0),nullif(p_amount,0))
    end,
    3
  );
$$;

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

  if v_code is not null then
    select coalesce(sum(public.loyalty_invoice_amount(si.net_total,si.gross_total,si.total_amount,si.net_amount,si.discounted_amount,si.gross_amount,si.amount,si.source,si.import_batch)),0), count(*)
      into v_total,v_count
    from public.sales_invoices si
    where trim(si.customer_code::text)=v_code
      and si.invoice_date >= p_from
      and si.invoice_date < p_to + 1
      and (v_branch is null or public.normalize_loyalty_branch(coalesce(si.branch,si.branch_name))=v_branch);
  elsif v_id is not null then
    select coalesce(sum(public.loyalty_invoice_amount(si.net_total,si.gross_total,si.total_amount,si.net_amount,si.discounted_amount,si.gross_amount,si.amount,si.source,si.import_batch)),0), count(*)
      into v_total,v_count
    from public.sales_invoices si
    where si.customer_id::text=v_id
      and si.invoice_date >= p_from
      and si.invoice_date < p_to + 1
      and (v_branch is null or public.normalize_loyalty_branch(coalesce(si.branch,si.branch_name))=v_branch);
  elsif v_phone is not null then
    select coalesce(sum(public.loyalty_invoice_amount(si.net_total,si.gross_total,si.total_amount,si.net_amount,si.discounted_amount,si.gross_amount,si.amount,si.source,si.import_batch)),0), count(*)
      into v_total,v_count
    from public.sales_invoices si
    where regexp_replace(coalesce(si.customer_phone,si.phone,''),'\D','','g') in (
      v_phone_digits,
      case when v_phone_digits like '20%' then '0'||substr(v_phone_digits,3) else v_phone_digits end,
      case when v_phone_digits like '01%' then '2'||v_phone_digits else v_phone_digits end
    )
      and si.invoice_date >= p_from
      and si.invoice_date < p_to + 1
      and (v_branch is null or public.normalize_loyalty_branch(coalesce(si.branch,si.branch_name))=v_branch);
  end if;

  return jsonb_build_object(
    'purchase_total',round(coalesce(v_total,0),2),
    'invoice_count',coalesce(v_count,0),
    'period_start',p_from,
    'period_end',p_to,
    'lookup_method',case when v_code is not null then 'customer_code' when v_id is not null then 'customer_id' else 'customer_phone' end
  );
end;
$$;

grant execute on function public.loyalty_invoice_amount(numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text) to authenticated;
grant execute on function public.customer_invoice_period_summary(text,text,text,text,date,date) to authenticated;

select pg_notify('pgrst','reload schema');
