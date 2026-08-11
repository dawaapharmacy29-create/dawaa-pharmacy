-- Remove correlated historical invoice scans from the cohort RPC.
create or replace function public.get_customer_service_cycle_cohorts(
  p_branch text,
  p_as_of_date date default current_date,
  p_cycles integer default 3
) returns jsonb
language plpgsql stable security definer
set search_path = public, pg_catalog
as $$
declare
  v_current_start date;
  v_elapsed integer;
  v_result jsonb;
begin
  if not public.dawaa_can_manage_customer_intelligence() then
    raise exception 'not authorized to view customer intelligence';
  end if;
  p_cycles := greatest(1, least(coalesce(p_cycles, 3), 12));
  v_current_start := case when extract(day from p_as_of_date) >= 26
    then date_trunc('month', p_as_of_date)::date + 25
    else (date_trunc('month', p_as_of_date) - interval '1 month')::date + 25 end;
  v_elapsed := greatest(0, p_as_of_date - v_current_start);

  with cycle_windows as materialized (
    -- One extra matched window is internal-only and supplies the oldest comparison baseline.
    select offset_no,
      (v_current_start - make_interval(months => offset_no))::date cycle_start,
      least((v_current_start - make_interval(months => offset_no))::date + v_elapsed,
        (v_current_start - make_interval(months => offset_no - 1))::date - 1) period_end
    from generate_series(0, p_cycles) offset_no
  ), invoice_base as materialized (
    select coalesce(nullif(btrim(si.customer_code), ''), nullif(btrim(si.customer_phone), ''), si.customer_id::text) customer_key,
      si.invoice_date::date sale_day,
      coalesce(si.net_amount, si.net_total, si.amount, si.total_amount, 0)::numeric amount
    from public.sales_invoices si
    where si.invoice_date >= (select min(cycle_start)::timestamp from cycle_windows)
      and si.invoice_date < (p_as_of_date + 1)::timestamp
      and (p_branch is null or si.branch = p_branch)
      and coalesce(nullif(btrim(si.customer_code), ''), nullif(btrim(si.customer_phone), ''), si.customer_id::text) is not null
  ), first_known as materialized (
    select coalesce(nullif(btrim(c.customer_code), ''), nullif(btrim(c.customer_phone), ''), c.customer_id) customer_key,
      min(c.first_purchase) first_purchase
    from public.customer_metrics_summary c
    where (p_branch is null or c.branch = p_branch)
    group by 1
  ), cycle_customer as materialized (
    select w.offset_no,w.cycle_start,w.period_end,i.customer_key,
      sum(i.amount) sales,count(*)::integer invoices,min(i.sale_day) first_day
    from cycle_windows w join invoice_base i on i.sale_day between w.cycle_start and w.period_end
    group by w.offset_no,w.cycle_start,w.period_end,i.customer_key
  ), cycle_metrics as (
    select w.offset_no,w.cycle_start,w.period_end,
      count(c.customer_key)::integer customers_count,
      count(*) filter(where c.sales>=4000)::integer important_count,
      count(*) filter(where c.sales>=8000)::integer very_important_count,
      count(*) filter(where coalesce(fk.first_purchase,c.first_day) between w.cycle_start and w.period_end)::integer new_count,
      count(*) filter(where prev.customer_key is not null)::integer continuing_count,
      count(*) filter(where prev.customer_key is null and coalesce(fk.first_purchase,c.first_day)<w.cycle_start)::integer reactivated_count,
      coalesce(sum(c.invoices),0)::integer invoices_count,coalesce(sum(c.sales),0)::numeric sales_total
    from cycle_windows w
    left join cycle_customer c on c.offset_no=w.offset_no
    left join cycle_customer prev on prev.offset_no=w.offset_no+1 and prev.customer_key=c.customer_key
    left join first_known fk on fk.customer_key=c.customer_key
    where w.offset_no<p_cycles
    group by w.offset_no,w.cycle_start,w.period_end
  ), followup_metrics as (
    select w.offset_no,count(f.id)::integer followups_count,
      count(distinct coalesce(nullif(btrim(f.customer_code),''),f.customer_id::text,nullif(btrim(f.customer_phone),'')))::integer followed_customers,
      count(f.id) filter(where f.status='completed' or f.followup_status='completed' or f.completed_at is not null)::integer completed_followups,
      count(f.id) filter(where coalesce(f.purchase_after_followup,false))::integer purchase_after_followup_count,
      coalesce(sum(coalesce(f.purchase_amount,0)) filter(where coalesce(f.purchase_after_followup,false)),0)::numeric recovered_sales
    from cycle_windows w left join public.daily_followups f
      on f.created_at>=w.cycle_start::timestamp and f.created_at<(w.period_end+1)::timestamp
      and (p_branch is null or f.branch=p_branch)
    where w.offset_no<p_cycles group by w.offset_no
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'offset',m.offset_no,'cycle_start',m.cycle_start,'period_end',m.period_end,'elapsed_days',m.period_end-m.cycle_start+1,
    'customers_count',m.customers_count,'important_count',m.important_count,'very_important_count',m.very_important_count,
    'new_count',m.new_count,'continuing_count',m.continuing_count,'reactivated_count',m.reactivated_count,
    'invoices_count',m.invoices_count,'sales_total',m.sales_total,
    'average_invoice',case when m.invoices_count>0 then round(m.sales_total/m.invoices_count,2) end,
    'followups_count',f.followups_count,'followed_customers',f.followed_customers,'completed_followups',f.completed_followups,
    'followup_completion_rate',case when f.followups_count>0 then round(f.completed_followups::numeric/f.followups_count*100,1) end,
    'purchase_after_followup_count',f.purchase_after_followup_count,'recovered_sales',f.recovered_sales
  ) order by m.offset_no),'[]'::jsonb) into v_result
  from cycle_metrics m join followup_metrics f using(offset_no);
  return v_result;
end;
$$;
