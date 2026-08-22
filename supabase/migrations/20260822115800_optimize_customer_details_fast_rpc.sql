create or replace function public.dawaa_get_customer_details_fast_v1(
  p_customer_code text default null,
  p_customer_phone text default null,
  p_customer_name text default null,
  p_invoice_limit integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions, pg_temp
as $function$
declare
  v_code text := nullif(btrim(coalesce(p_customer_code, '')), '');
  v_phone text := public.dawaa_fast_phone_v1(p_customer_phone);
  v_name text := nullif(btrim(coalesce(p_customer_name, '')), '');
  v_invoice_limit integer := least(greatest(coalesce(p_invoice_limit, 20), 5), 50);
  v_result jsonb;
begin
  with matched as materialized (
    select
      si.id::text as id,
      coalesce(nullif(btrim(si.invoice_number), ''), nullif(btrim(si.invoice_no), ''), si.id::text) as invoice_key,
      coalesce(si.invoice_date::date, si.sale_date, public.dawaa_fast_date_v1(si.date)) as invoice_day,
      coalesce(si.net_amount, si.net_total, si.discounted_amount, si.total_amount, si.amount, si.gross_amount, si.gross_total, 0)::numeric as amount,
      nullif(btrim(si.seller_name), '') as seller_name,
      nullif(btrim(si.branch), '') as branch
    from public.sales_invoices si
    where
      case
        when v_code is not null then si.customer_code = v_code
        when v_phone is not null then
          si.customer_phone = v_phone
          or si.phone = v_phone
          or public.dawaa_fast_phone_v1(si.customer_phone) = v_phone
          or public.dawaa_fast_phone_v1(si.phone) = v_phone
        when v_name is not null then si.customer_name ilike '%' || v_name || '%'
        else false
      end
  ),
  months as (
    select to_char(invoice_day, 'YYYY-MM') as month_key, count(distinct invoice_key)::integer as cnt
    from matched
    where invoice_day is not null
    group by 1
  ),
  counts as (
    select
      coalesce(max(cnt) filter (where month_key = to_char(current_date, 'YYYY-MM')), 0)::integer as current_count,
      coalesce(max(cnt) filter (where month_key = to_char((date_trunc('month', current_date) - interval '1 month')::date, 'YYYY-MM')), 0)::integer as previous_count,
      coalesce(round(avg(cnt))::integer, 0) as avg_count
    from months
  ),
  latest_invoices as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'invoice_number', invoice_key,
        'invoice_date', invoice_day,
        'amount', amount,
        'seller_name', seller_name,
        'branch', branch
      ) order by invoice_day desc nulls last
    ), '[]'::jsonb) as invoices
    from (
      select * from matched order by invoice_day desc nulls last limit v_invoice_limit
    ) x
  ),
  doctor_totals as (
    select seller_name, sum(amount) as total, count(*) as cnt
    from matched
    where seller_name is not null
    group by seller_name
    order by total desc, cnt desc
    limit 1
  ),
  customer_row as (
    select
      c.id,
      coalesce(c.customer_code, v_code) as customer_code,
      coalesce(c.customer_name, c.name, v_name) as customer_name,
      coalesce(
        public.dawaa_fast_phone_v1(c.customer_phone),
        public.dawaa_fast_phone_v1(c.phone),
        public.dawaa_fast_phone_v1(c.whatsapp_phone),
        public.dawaa_fast_phone_v1(c.phone_alt),
        v_phone
      ) as customer_phone,
      c.notes,
      c.whatsapp_notes,
      c.customer_notes,
      c.service_notes,
      c.team_notes,
      c.handling_notes,
      c.address,
      c.phone_alt,
      c.whatsapp_phone,
      c.customer_flags
    from public.customers c
    where
      case
        when v_code is not null then c.customer_code = v_code
        when v_phone is not null then
          c.customer_phone = v_phone
          or c.phone = v_phone
          or c.whatsapp_phone = v_phone
          or c.phone_alt = v_phone
          or public.dawaa_fast_phone_v1(c.customer_phone) = v_phone
          or public.dawaa_fast_phone_v1(c.phone) = v_phone
          or public.dawaa_fast_phone_v1(c.whatsapp_phone) = v_phone
          or public.dawaa_fast_phone_v1(c.phone_alt) = v_phone
        when v_name is not null then coalesce(c.customer_name, c.name) ilike '%' || v_name || '%'
        else false
      end
    limit 1
  ),
  followups as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', f.id,
        'status', f.status,
        'assigned_to', f.assigned_to,
        'responsible_name', f.responsible_name,
        'notes', f.notes,
        'followup_result', f.followup_result,
        'created_at', f.created_at,
        'followup_date', f.followup_date,
        'completed_at', f.completed_at
      ) order by f.created_at desc
    ), '[]'::jsonb) as rows
    from (
      select df.*
      from public.daily_followups df
      where
        case
          when v_code is not null then df.customer_code = v_code
          when v_phone is not null then df.customer_phone = v_phone or df.phone = v_phone
          when v_name is not null then df.customer_name = v_name
          else false
        end
      order by df.created_at desc
      limit 20
    ) f
  )
  select jsonb_build_object(
    'success', true,
    'currentMonthVisits', c.current_count,
    'previousMonthVisits', c.previous_count,
    'avgMonthlyVisits', c.avg_count,
    'purchaseFrequencyStatus', public.dawaa_purchase_status_v1(c.current_count, c.previous_count),
    'purchaseFrequencyRecommendation', public.dawaa_purchase_recommendation_v1(public.dawaa_purchase_status_v1(c.current_count, c.previous_count)),
    'invoices', li.invoices,
    'followups', f.rows,
    'topDoctor', (select seller_name from doctor_totals limit 1),
    'lastServiceDoctor', null,
    'lastFollowupReport', null,
    'customerNotes', (select coalesce(customer_notes, notes) from customer_row limit 1),
    'whatsappNotes', (select whatsapp_notes from customer_row limit 1),
    'serviceNotes', (select service_notes from customer_row limit 1),
    'teamNotes', (select team_notes from customer_row limit 1),
    'handlingNotes', (select handling_notes from customer_row limit 1),
    'address', (select address from customer_row limit 1),
    'phoneAlt', (select phone_alt from customer_row limit 1),
    'whatsappPhone', (select whatsapp_phone from customer_row limit 1),
    'customerFlags', coalesce((select customer_flags from customer_row limit 1), '{}'::jsonb),
    'hasValidPhone', coalesce((select customer_phone is not null from customer_row limit 1), v_phone is not null),
    'isPseudoCustomer', false,
    'activeAlerts', '[]'::jsonb,
    'cashback', null,
    'welcomeStatus', null,
    'invoiceClassifications', '[]'::jsonb
  )
  into v_result
  from counts c
  cross join latest_invoices li
  cross join followups f;

  return coalesce(v_result, jsonb_build_object('success', true, 'invoices', '[]'::jsonb, 'followups', '[]'::jsonb));
end;
$function$;
