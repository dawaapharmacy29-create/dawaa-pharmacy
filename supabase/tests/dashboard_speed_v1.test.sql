-- The cached monthly sales equal the live ones; the branch key inlines; unused indexes are gone.
do $$
declare
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_branch text;
  v_diff integer;
  v_cached integer;
begin
  select count(*) into v_cached from public.dashboard_monthly_sales_cache;
  if v_cached = 0 then raise exception 'cache_empty'; end if;
  if exists (select 1 from public.dashboard_monthly_sales_cache
              where month_start >= date_trunc('month', v_today)::date) then
    raise exception 'current_month_cached';
  end if;

  foreach v_branch in array array[null, '', 'كل الفروع', 'فرع شكري', 'فرع الشامي', 'فرع مش موجود'] loop
    select count(*) into v_diff from (
      (select * from public.get_dashboard_monthly_sales_v172(v_today, v_branch, 5)
       except all select * from public.old_monthly_sales(v_today, v_branch, 5))
      union all
      (select * from public.old_monthly_sales(v_today, v_branch, 5)
       except all select * from public.get_dashboard_monthly_sales_v172(v_today, v_branch, 5))
    ) d;
    if v_diff <> 0 then raise exception 'monthly_sales_differs for %', coalesce(v_branch, 'null'); end if;
  end loop;

  -- A new invoice in the current month shows at once; one in a closed month waits for the nightly refresh.
  insert into public.sales_invoices(branch, invoice_date, customer_code, save_status, net_total)
  values ('فرع شكري', date_trunc('month', now()) + interval '1 hour', 'C9', 'saved', 50);
  if (select invoices_count from public.get_dashboard_monthly_sales_v172(v_today, null, 5)
       where month_start = date_trunc('month', v_today)::date)
     <> (select invoices_count from public.old_monthly_sales(v_today, null, 5)
          where month_start = date_trunc('month', v_today)::date) then
    raise exception 'current_month_not_live';
  end if;
  insert into public.sales_invoices(branch, invoice_date, customer_code, save_status, net_total)
  values ('فرع شكري', date_trunc('month', now()) - interval '1 month' + interval '1 day', 'C9', 'saved', 50);
  perform public.refresh_dashboard_monthly_sales_cache_v1();
  select count(*) into v_diff from (
    select * from public.get_dashboard_monthly_sales_v172(v_today, null, 5)
    except all select * from public.old_monthly_sales(v_today, null, 5)) d;
  if v_diff <> 0 then raise exception 'refresh_missed_late_invoice'; end if;

  -- Branch key: same answers, and no SET clause left so it can inline.
  if public.dawaa_customer_request_branch_key(' فرع شكري ') <> 'shokry'
     or public.dawaa_customer_request_branch_key('الشامى') <> 'elshamy'
     or public.dawaa_customer_request_branch_key('  ') is not null
     or public.dawaa_customer_request_branch_key('مخزن') <> 'مخزن' then
    raise exception 'branch_key_changed';
  end if;
  if (select proconfig from pg_proc where proname = 'dawaa_customer_request_branch_key') is not null then
    raise exception 'branch_key_not_inlinable';
  end if;

  if to_regclass('public.idx_sales_invoices_invoice_no_key') is not null
     or to_regclass('public.sales_invoices_customer_phone_idx') is not null then
    raise exception 'unused_index_kept';
  end if;

  if has_table_privilege('anon', 'public.dashboard_monthly_sales_cache', 'select')
     or has_function_privilege('anon', 'public.refresh_dashboard_monthly_sales_cache_v1()', 'execute') then
    raise exception 'client_access';
  end if;
end;
$$;
