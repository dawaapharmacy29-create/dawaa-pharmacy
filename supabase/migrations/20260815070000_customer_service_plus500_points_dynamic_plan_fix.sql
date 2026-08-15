-- Follow-up to 20260815060000: the top50/three-cycle fix alone did not fully resolve the
-- "canceling statement due to statement timeout" errors on the customer-service page,
-- because the frontend fires 5 RPCs concurrently (Promise.all) and two of the other four -
-- get_customer_service_plus500_core and get_customer_points_daily20_core - had the exact
-- same LANGUAGE SQL / SECURITY DEFINER parameter-sniffing problem, still measured at
-- 1.4-2.2s each in isolation (compounding badly under concurrency).
--
-- A SECOND, distinct bottleneck was also found in both functions: the customer name/phone
-- enrichment lookup against public.customers was written with btrim(customer_code) (plus500)
-- or was joined BEFORE truncating to the final row set (points daily20), causing a full
-- Seq Scan over customers (16.8k rows) per matched row instead of an index lookup. Measured:
-- plus500 92k+ buffer hits -> 3.1k after the fix; points daily20 15.8k -> 2.3k buffer hits.
--
-- Fix: same dynamic-SQL/literal-embedding pattern as 20260815060000, PLUS (a) dropped the
-- unnecessary btrim() on the indexed side of the customers lookup in plus500 (mirrors the
-- already-fast pattern in get_customer_service_recent_top50_core), and (b) restructured
-- points daily20 to rank + truncate to top 10 per branch BEFORE enriching, instead of after.

create or replace function public.get_customer_service_plus500_core(p_date date, p_scope text)
returns table(branch text, customer_code text, customer_name text, customer_phone text, qualifying_invoice_count bigint, qualifying_total numeric, invoice_values jsonb, highest_invoice numeric)
language plpgsql stable security definer
set search_path=public,pg_catalog
as $$
declare
  v_date date := coalesce(p_date, current_date-1);
  v_scope text := coalesce(nullif(btrim(p_scope),''),'ALL');
begin
  return query execute format($f$
    with eligible_invoices as (
      select
        s.branch,
        btrim(s.customer_code) as customer_code,
        nullif(btrim(s.customer_name),'') as invoice_name,
        nullif(btrim(coalesce(s.customer_phone,s.phone)),'') as invoice_phone,
        coalesce(s.net_amount,s.net_total,s.total_amount,s.amount,0)::numeric as invoice_value,
        coalesce(s.invoice_no,s.invoice_number,'') as invoice_number
      from public.sales_invoices s
      where s.sale_date = %1$L::date
        and s.branch in ('فرع شكري','فرع الشامي')
        and (%2$L='ALL' or lower(btrim(s.branch))=%2$L)
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
          and x.customer_code=g.customer_code
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
      select c1.name,c1.phone,c1.whatsapp_phone,c1.phone_alt
      from public.customers c1
      where c1.customer_code=g.customer_code
      order by
        case when c1.branch=g.branch then 0 else 1 end,
        c1.updated_at desc nulls last,
        c1.id
      limit 1
    ) c on true
    order by g.branch,g.qualifying_total desc,g.customer_code
  $f$, v_date, v_scope);
end;
$$;

grant execute on function public.get_customer_service_plus500_core(date,text) to anon,authenticated;

create or replace function public.get_customer_points_daily20_core(p_date date, p_scope text)
returns table(daily_order integer, branch text, customer_code text, customer_name text, customer_phone text, points_balance numeric, last_contacted_at timestamptz, ledger_entries bigint)
language plpgsql stable security definer
set search_path=public,pg_catalog
as $$
declare
  v_date date := coalesce(p_date, current_date);
  v_scope text := coalesce(nullif(btrim(p_scope),''),'ALL');
begin
  return query execute format($f$
    with balances as (
      select l.branch,btrim(l.customer_code) customer_code,max(nullif(btrim(l.customer_name),'')) customer_name,max(nullif(btrim(l.customer_phone),'')) customer_phone,
        sum(coalesce(l.points_amount,0))::numeric points_balance,max(l.contacted_at) last_contacted_at,count(*)::bigint ledger_entries
      from public.customer_points_ledger l where l.branch in ('فرع شكري','فرع الشامي') and (%2$L='ALL' or lower(btrim(l.branch))=%2$L)
        and nullif(btrim(l.customer_code),'') is not null and btrim(l.customer_code) not in ('5','10','54','170','12820')
        and nullif(btrim(l.customer_name),'') is not null and btrim(l.customer_name) not in ('عميل الصيدلية','عميل نقدي','عميل عابر','كاش','عميل','.')
        and (l.expiry_date is null or l.expiry_date>=%1$L::date)
        group by l.branch,btrim(l.customer_code) having sum(coalesce(l.points_amount,0))>0
    ), excluded as (
      select customer_code from public.customer_flags where flag_key='wholesale_b2b' and coalesce(is_active,false)
    ), filtered as (
      select b.* from balances b where not exists (select 1 from excluded x where x.customer_code=b.customer_code)
    ), ranked as (
      select f.*,row_number() over(partition by f.branch order by f.last_contacted_at asc nulls first,f.points_balance desc,f.customer_code)::integer rn
      from filtered f
    ), top10 as materialized (
      select * from ranked where rn<=10
    ), enriched as (
      select t.branch, t.customer_code,
        coalesce(public.dawaa_clean_customer_name(c.name), public.dawaa_clean_customer_name(t.customer_name), t.customer_name) as customer_name,
        coalesce(nullif(btrim(c.phone),''), nullif(btrim(c.whatsapp_phone),''), nullif(btrim(c.phone_alt),''), t.customer_phone) as customer_phone,
        t.points_balance, t.last_contacted_at, t.ledger_entries, t.rn
      from top10 t
      left join public.customers c on c.customer_code = t.customer_code
    )
    select row_number() over(order by e.branch,e.rn)::integer,e.branch,e.customer_code,e.customer_name,e.customer_phone,round(e.points_balance,2),e.last_contacted_at,e.ledger_entries
    from enriched e order by e.branch,e.rn
  $f$, v_date, v_scope);
end;
$$;

grant execute on function public.get_customer_points_daily20_core(date,text) to anon,authenticated;
