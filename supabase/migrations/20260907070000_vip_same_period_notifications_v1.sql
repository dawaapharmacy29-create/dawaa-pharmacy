-- VIP customer health notifications: compare month-to-date with the exact same days last month.
-- Internal notification types stay canonical/English; titles/messages/metadata are Arabic-ready for the UI.

create or replace function public.notify_vip_same_period_customer_health_v1()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_branch text;
  v_recipient uuid;
  v_current_start date := date_trunc('month', current_date)::date;
  v_current_end date := current_date;
  v_prev_start date := (date_trunc('month', current_date) - interval '1 month')::date;
  v_prev_month_end date := (date_trunc('month', current_date) - interval '1 day')::date;
  v_prev_end date;
  v_day_offset integer := extract(day from current_date)::integer - 1;
  v_digest_count integer := 0;
  v_improving integer;
  v_stable integer;
  v_declining integer;
  v_critical integer;
  v_missing integer;
  v_total_current numeric;
  v_total_previous numeric;
  v_row record;
  v_change_pct numeric;
  v_state text;
  v_priority text;
  v_message text;
begin
  v_prev_end := least(v_prev_start + v_day_offset, v_prev_month_end);

  for v_branch in
    select unnest(array['فرع شكري','فرع الشامي'])
  loop
    select sa.staff_id::uuid
      into v_recipient
    from public.staff_accounts sa
    where sa.branch = v_branch
      and lower(trim(coalesce(sa.role, sa.staff_role, ''))) in ('customer_service_manager','branch_manager')
      and coalesce(sa.active, sa.is_active, true)
      and coalesce(sa.can_login, true)
      and nullif(trim(sa.staff_id), '') is not null
    order by case when lower(trim(coalesce(sa.role, sa.staff_role, ''))) = 'customer_service_manager' then 0 else 1 end
    limit 1;

    if v_recipient is null then
      continue;
    end if;

    with vip_candidates as (
      select distinct on (x.customer_code)
        x.customer_code,
        x.customer_name,
        x.phone,
        x.rank
      from (
        select
          nullif(trim(w.customer_code), '') as customer_code,
          nullif(trim(w.customer_name), '') as customer_name,
          nullif(trim(w.phone), '') as phone,
          coalesce(w.rank, 999) as rank
        from public.customer_service_watchlist w
        where w.branch = v_branch
          and coalesce(w.active, true)
          and nullif(trim(w.customer_code), '') is not null

        union all

        select
          nullif(trim(coalesce(c.effective_customer_code, c.customer_code, c.code)), '') as customer_code,
          nullif(trim(coalesce(c.display_name, c.customer_name, c.name)), '') as customer_name,
          nullif(trim(coalesce(c.whatsapp_phone, c.customer_phone, c.mobile, c.phone)), '') as phone,
          500 as rank
        from public.customers c
        where coalesce(c.effective_branch, c.corrected_branch, c.branch_name, c.branch) = v_branch
          and nullif(trim(coalesce(c.effective_customer_code, c.customer_code, c.code)), '') is not null
          and (
            lower(trim(coalesce(c.segment, c.customer_segment, c.loyalty_tier, ''))) in ('مهم جدًا','vip','v.i.p')
            or lower(trim(coalesce(c.priority, ''))) in ('vip','مهم جدًا')
          )
      ) x
      where x.customer_code is not null
      order by x.customer_code, x.rank
      limit 60
    ),
    invoice_rollup as (
      select
        coalesce(nullif(trim(si.customer_code), ''), nullif(trim(si.raw_data->>'customer_code'), '')) as customer_code,
        sum(case
          when coalesce(si.sale_date, si.invoice_date::date) between v_current_start and v_current_end
            then coalesce(si.total_amount, si.net_total, si.net_amount, si.amount, 0)
          else 0 end) as current_sales,
        sum(case
          when coalesce(si.sale_date, si.invoice_date::date) between v_prev_start and v_prev_end
            then coalesce(si.total_amount, si.net_total, si.net_amount, si.amount, 0)
          else 0 end) as previous_sales,
        max(case
          when coalesce(si.sale_date, si.invoice_date::date) <= v_current_end
            then coalesce(si.sale_date, si.invoice_date::date)
          else null end) as last_purchase_date
      from public.sales_invoices si
      where coalesce(si.branch_name, si.branch) = v_branch
        and coalesce(nullif(trim(si.customer_code), ''), nullif(trim(si.raw_data->>'customer_code'), '')) is not null
        and coalesce(si.sale_date, si.invoice_date::date) between v_prev_start and v_current_end
      group by 1
    ),
    health as (
      select
        v.customer_code,
        v.customer_name,
        v.phone,
        coalesce(r.current_sales, 0)::numeric as current_sales,
        coalesce(r.previous_sales, 0)::numeric as previous_sales,
        r.last_purchase_date,
        case
          when coalesce(r.previous_sales,0) <= 0 and coalesce(r.current_sales,0) > 0 then null
          when coalesce(r.previous_sales,0) > 0 then round(((coalesce(r.current_sales,0) - r.previous_sales) / r.previous_sales) * 100, 1)
          else null
        end as change_pct
      from vip_candidates v
      left join invoice_rollup r using (customer_code)
    )
    select
      count(*) filter (where current_sales > 0 and (change_pct is null or change_pct between -9.9 and 9.9)),
      count(*) filter (where change_pct >= 10),
      count(*) filter (where change_pct <= -10 and change_pct > -30),
      count(*) filter (where change_pct <= -30),
      count(*) filter (where previous_sales > 0 and current_sales = 0),
      coalesce(sum(current_sales),0),
      coalesce(sum(previous_sales),0)
    into v_stable, v_improving, v_declining, v_critical, v_missing, v_total_current, v_total_previous
    from health;

    -- Branch-level Arabic digest every day: gives a quick health view even when all VIPs are healthy.
    perform public.create_staff_notification(
      v_recipient,
      'customer_alert',
      'تقرير حركة عملاء VIP — ' || v_branch,
      'من ' || to_char(v_current_start, 'DD/MM') || ' إلى ' || to_char(v_current_end, 'DD/MM') ||
      ' مقارنة بنفس الأيام من الشهر السابق (' || to_char(v_prev_start, 'DD/MM') || '–' || to_char(v_prev_end, 'DD/MM') || '). ' ||
      'إجمالي الفترة الحالية: ' || trim(to_char(v_total_current, 'FM999G999G999G990D00')) || ' ج. ' ||
      'نفس الفترة السابقة: ' || trim(to_char(v_total_previous, 'FM999G999G999G990D00')) || ' ج. ' ||
      'متحسنون: ' || coalesce(v_improving,0) ||
      '، مستقرون: ' || coalesce(v_stable,0) ||
      '، متراجعون: ' || coalesce(v_declining,0) ||
      '، تراجع قوي: ' || coalesce(v_critical,0) ||
      '، بدون شراء هذا الشهر: ' || coalesce(v_missing,0) || '.',
      'vip_customer_health',
      v_branch || ':' || to_char(current_date, 'YYYY-MM-DD'),
      '/customer-monthly-performance',
      case when coalesce(v_missing,0) + coalesce(v_critical,0) > 0 then 'high' else 'normal' end,
      jsonb_build_object(
        'branch', v_branch,
        'currentStart', v_current_start,
        'currentEnd', v_current_end,
        'previousStart', v_prev_start,
        'previousEnd', v_prev_end,
        'currentSales', v_total_current,
        'previousSalesSamePeriod', v_total_previous,
        'improvingCount', v_improving,
        'stableCount', v_stable,
        'decliningCount', v_declining,
        'criticalDeclineCount', v_critical,
        'missingCount', v_missing,
        'comparisonMode', 'same_calendar_days_previous_month',
        'arabicLabel', 'تقرير حركة عملاء VIP'
      ),
      'vip-health-digest:' || v_branch || ':' || to_char(current_date, 'YYYY-MM-DD'),
      null,
      v_branch
    );
    v_digest_count := v_digest_count + 1;

    -- Individual actionable alerts only for severe decline / disappearance.
    for v_row in
      with vip_candidates as (
        select distinct on (x.customer_code)
          x.customer_code, x.customer_name, x.phone, x.rank
        from (
          select nullif(trim(w.customer_code),'') customer_code,
                 nullif(trim(w.customer_name),'') customer_name,
                 nullif(trim(w.phone),'') phone,
                 coalesce(w.rank,999) rank
          from public.customer_service_watchlist w
          where w.branch=v_branch and coalesce(w.active,true)
            and nullif(trim(w.customer_code),'') is not null
          union all
          select nullif(trim(coalesce(c.effective_customer_code,c.customer_code,c.code)),'') customer_code,
                 nullif(trim(coalesce(c.display_name,c.customer_name,c.name)),'') customer_name,
                 nullif(trim(coalesce(c.whatsapp_phone,c.customer_phone,c.mobile,c.phone)),'') phone,
                 500 rank
          from public.customers c
          where coalesce(c.effective_branch,c.corrected_branch,c.branch_name,c.branch)=v_branch
            and nullif(trim(coalesce(c.effective_customer_code,c.customer_code,c.code)),'') is not null
            and (
              lower(trim(coalesce(c.segment,c.customer_segment,c.loyalty_tier,''))) in ('مهم جدًا','vip','v.i.p')
              or lower(trim(coalesce(c.priority,''))) in ('vip','مهم جدًا')
            )
        ) x
        where x.customer_code is not null
        order by x.customer_code,x.rank
        limit 60
      ), invoice_rollup as (
        select
          coalesce(nullif(trim(si.customer_code),''),nullif(trim(si.raw_data->>'customer_code'),'')) customer_code,
          sum(case when coalesce(si.sale_date,si.invoice_date::date) between v_current_start and v_current_end
              then coalesce(si.total_amount,si.net_total,si.net_amount,si.amount,0) else 0 end)::numeric current_sales,
          sum(case when coalesce(si.sale_date,si.invoice_date::date) between v_prev_start and v_prev_end
              then coalesce(si.total_amount,si.net_total,si.net_amount,si.amount,0) else 0 end)::numeric previous_sales,
          max(case when coalesce(si.sale_date,si.invoice_date::date)<=v_current_end then coalesce(si.sale_date,si.invoice_date::date) end) last_purchase_date
        from public.sales_invoices si
        where coalesce(si.branch_name,si.branch)=v_branch
          and coalesce(nullif(trim(si.customer_code),''),nullif(trim(si.raw_data->>'customer_code'),'')) is not null
          and coalesce(si.sale_date,si.invoice_date::date) between v_prev_start and v_current_end
        group by 1
      )
      select v.customer_code,v.customer_name,v.phone,
             coalesce(r.current_sales,0) current_sales,
             coalesce(r.previous_sales,0) previous_sales,
             r.last_purchase_date,
             case when coalesce(r.previous_sales,0)>0
               then round(((coalesce(r.current_sales,0)-r.previous_sales)/r.previous_sales)*100,1)
               else null end change_pct
      from vip_candidates v
      left join invoice_rollup r using(customer_code)
      where coalesce(r.previous_sales,0)>0
        and (coalesce(r.current_sales,0)=0 or ((coalesce(r.current_sales,0)-r.previous_sales)/r.previous_sales)*100 <= -30)
      order by (coalesce(r.previous_sales,0)-coalesce(r.current_sales,0)) desc
      limit 12
    loop
      v_change_pct := v_row.change_pct;
      if v_row.current_sales = 0 then
        v_state := 'متوقف عن الشراء خلال الفترة الحالية';
        v_priority := 'urgent';
      else
        v_state := 'تراجع قوي';
        v_priority := 'high';
      end if;

      v_message :=
        'العميل ' || coalesce(v_row.customer_name, 'كود ' || v_row.customer_code) ||
        ' — الحالي: ' || trim(to_char(v_row.current_sales, 'FM999G999G999G990D00')) || ' ج' ||
        '، نفس المدة الشهر السابق: ' || trim(to_char(v_row.previous_sales, 'FM999G999G999G990D00')) || ' ج' ||
        case when v_change_pct is null then '' else '، التغير: ' || trim(to_char(v_change_pct, 'FM990D0')) || '%' end ||
        '، الحالة: ' || v_state ||
        case when v_row.last_purchase_date is null then '' else '، آخر شراء: ' || to_char(v_row.last_purchase_date, 'DD/MM/YYYY') end ||
        '. يفضل بدء متابعة مباشرة.';

      perform public.create_staff_notification(
        v_recipient,
        'customer_alert',
        case when v_row.current_sales = 0 then 'عميل VIP توقف عن الشراء' else 'تراجع قوي لعميل VIP' end,
        v_message,
        'vip_customer',
        v_row.customer_code,
        '/customer-service?quickFollowup=1&code=' || replace(v_row.customer_code, ' ', '%20'),
        v_priority,
        jsonb_build_object(
          'branch', v_branch,
          'customerCode', v_row.customer_code,
          'customerName', v_row.customer_name,
          'phone', v_row.phone,
          'currentSales', v_row.current_sales,
          'previousSalesSamePeriod', v_row.previous_sales,
          'changePct', v_row.change_pct,
          'stateAr', v_state,
          'lastPurchaseDate', v_row.last_purchase_date,
          'comparisonMode', 'same_calendar_days_previous_month',
          'requiresFollowup', true,
          'arabicLabel', 'تنبيه عميل VIP'
        ),
        'vip-health-alert:' || v_branch || ':' || v_row.customer_code || ':' || to_char(current_date,'YYYY-MM-DD'),
        null,
        v_branch
      );
    end loop;
  end loop;

  return v_digest_count;
end;
$$;

-- Replace only this job name if it already exists; keep other customer jobs untouched.
do $$
declare v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname='dawaa-vip-same-period-health-digest' limit 1;
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
  perform cron.schedule(
    'dawaa-vip-same-period-health-digest',
    '15 8 * * *',
    'select public.notify_vip_same_period_customer_health_v1();'
  );
end;
$$;
