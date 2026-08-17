create or replace function public.calculate_customer_monthly_performance(
  p_branch text,
  p_period_start date,
  p_period_end date,
  p_prev_period_start date,
  p_prev_period_end date
)
returns table(
  customer_code text, customer_name text, phone text, branch text,
  sales_amount numeric, invoice_count integer, items_count integer,
  avg_invoice numeric, avg_items_per_invoice numeric, purchase_days integer,
  first_purchase_date date, last_purchase_date date,
  cash_sales numeric, delivery_sales numeric, cash_ratio numeric, delivery_ratio numeric,
  current_segment text, previous_segment text,
  previous_month_sales numeric, previous_month_invoice_count integer,
  sales_change_amount numeric, sales_change_pct numeric, invoice_change_pct numeric,
  customer_state text, is_new_ever boolean, had_purchase_before_prev_period boolean,
  month_2_ago_sales numeric, month_3_ago_sales numeric
)
language sql stable security definer
set search_path='public'
as $function$
  select *
  from public.calculate_customer_monthly_performance_v2(
    p_branch,
    p_period_start,
    p_period_end,
    p_prev_period_start,
    p_prev_period_end
  );
$function$;
