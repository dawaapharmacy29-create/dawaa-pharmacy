-- Fix +500 customer-service queue after invoice reconciliation.
-- Reconciled invoices may have customer_code and value but no denormalized customer_name/phone.
-- Qualify invoices first, then enrich from customers by code. Never silently hide a valid +500 invoice.

create or replace function public.get_customer_service_plus500_core(p_date date, p_scope text)
returns table(branch text, customer_code text, customer_name text, customer_phone text, qualifying_invoice_count bigint, qualifying_total numeric, invoice_values jsonb, highest_invoice numeric)
language sql
stable security definer
set search_path = public, pg_catalog
set statement_timeout = '20s'
as $$
  with eligible_invoices as (
    select
      s.branch,
      btrim(s.customer_code) as customer_code,
      nullif(btrim(s.customer_name),'') as invoice_name,
      nullif(btrim(coalesce(s.customer_phone,s.phone)),'') as invoice_phone,
      coalesce(s.net_amount,s.net_total,s.total_amount,s.amount,0)::numeric as invoice_value,
      coalesce(s.invoice_no,s.invoice_number,'') as invoice_number
    from public.sales_invoices s
    where s.sale_date = p_date
      and s.branch in ('فرع شكري','فرع الشامي')
      and (p_scope='ALL' or lower(btrim(s.branch))=p_scope)
      and nullif(btrim(s.customer_code),'') is not null
      and btrim(s.customer_code) not in ('5','10','54','170','12820')
      and coalesce(s.net_amount,s.net_total,s.total_amount,s.amount,0) >= 500
  ),
  grouped as (
    select
      e.branch,
      e.customer_code,
      max(e.invoice_name) as invoice_name,
      max(e.invoice_phone) as invoice_phone,
      count(*)::bigint as qualifying_invoice_count,
      round(sum(e.invoice_value),2) as qualifying_total,
      jsonb_agg(
        jsonb_build_object('invoiceNumber',e.invoice_number,'value',round(e.invoice_value,2))
        order by e.invoice_value desc,e.invoice_number
      ) as invoice_values,
      round(max(e.invoice_value),2) as highest_invoice
    from eligible_invoices e
    group by e.branch,e.customer_code
  ),
  filtered as (
    select g.*
    from grouped g
    where not exists (
      select 1
      from public.customer_flags x
      where x.flag_key='wholesale_b2b'
        and coalesce(x.is_active,false)
        and btrim(x.customer_code)=g.customer_code
    )
  )
  select
    g.branch,
    g.customer_code,
    coalesce(
      public.dawaa_clean_customer_name(c.name),
      public.dawaa_clean_customer_name(g.invoice_name),
      'عميل كود ' || g.customer_code
    ) as customer_name,
    coalesce(
      nullif(btrim(c.phone),''),
      nullif(btrim(c.whatsapp_phone),''),
      nullif(btrim(c.phone_alt),''),
      g.invoice_phone
    ) as customer_phone,
    g.qualifying_invoice_count,
    g.qualifying_total,
    g.invoice_values,
    g.highest_invoice
  from filtered g
  left join lateral (
    select c1.*
    from public.customers c1
    where btrim(c1.customer_code)=g.customer_code
    order by
      case when c1.branch=g.branch then 0 else 1 end,
      c1.updated_at desc nulls last,
      c1.id
    limit 1
  ) c on true
  order by g.branch,g.qualifying_total desc,g.customer_code;
$$;

grant execute on function public.get_customer_service_plus500_core(date,text) to anon,authenticated;
