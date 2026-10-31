-- Daily agenda, cycle-scoped: open customer requests count from the start of the current 26 -> 25 cycle
-- (older open ones are shown apart as «قبل الدورة»), and a cycle compliance read for the general manager
-- and branches manager: per branch per day, which floor checks were closed and what was flagged.

create or replace function public.get_branch_manager_agenda_v1(p_branch text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_branch text := public.branch_manager_agenda_branch_v1(p_branch);
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_sales_day date;
  v_purchase_day date;
  v_items jsonb := '[]'::jsonb;
  v_count integer;
  v_rows jsonb;
  v_session record;
  v_cycle_start date;
  v_before_cycle integer;
begin
  if v_branch = 'NONE' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select max(si.invoice_date::date) into v_sales_day
  from public.sales_invoices si
  where si.invoice_date >= v_today - 7 and si.invoice_date::date < v_today
    and public.dawaa_customer_request_branch_key(si.branch) = v_branch;

  select max(pi.invoice_date) into v_purchase_day
  from public.purchase_invoices pi
  where pi.invoice_date >= v_today - 7 and pi.invoice_date <= v_today
    and public.dawaa_customer_request_branch_key(pi.branch) = v_branch;

  -- Current points cycle (26 -> 25).
  v_cycle_start := case when extract(day from v_today) >= 26
    then make_date(extract(year from v_today)::int, extract(month from v_today)::int, 26)
    else (date_trunc('month', v_today) - interval '1 month')::date + 25 end;

  -- 1) Customer requests of the current cycle still open after a day; older open ones are counted apart.
  select count(*), coalesce(jsonb_agg(r) filter (where r.rn <= 5), '[]'::jsonb) into v_count, v_rows
  from (
    select row_number() over (order by cr.created_at) rn, cr.id, cr.customer_name, cr.medicine_name, cr.status,
           (v_today - (cr.created_at at time zone 'Africa/Cairo')::date) age_days
    from public.customer_requests cr
    where public.dawaa_customer_request_branch_key(cr.branch) = v_branch
      and cr.status not in ('delivered', 'closed', 'cancelled', 'not_available')
      and cr.created_at >= (v_cycle_start::timestamp at time zone 'Africa/Cairo')
      and cr.created_at < now() - interval '24 hours'
  ) r;
  select count(*) into v_before_cycle
  from public.customer_requests cr
  where public.dawaa_customer_request_branch_key(cr.branch) = v_branch
    and cr.status not in ('delivered', 'closed', 'cancelled', 'not_available')
    and cr.created_at < (v_cycle_start::timestamp at time zone 'Africa/Cairo');
  v_items := v_items || jsonb_build_object('key', 'open_requests', 'group', 'auto', 'count', v_count, 'rows', v_rows,
    'before_cycle', v_before_cycle);

  -- 2) Invoices without a customer code on the latest sales day, per seller.
  select coalesce(sum(s.n), 0), coalesce(jsonb_agg(s order by s.n desc), '[]'::jsonb) into v_count, v_rows
  from (
    select coalesce(nullif(btrim(si.seller_name), ''), 'بدون اسم') seller, count(*) n
    from public.sales_invoices si
    where si.invoice_date >= v_sales_day and si.invoice_date < v_sales_day + 1 and public.dawaa_customer_request_branch_key(si.branch) = v_branch
      and nullif(btrim(si.customer_code), '') is null
    group by 1
  ) s;
  v_items := v_items || jsonb_build_object('key', 'uncoded_invoices', 'group', 'auto', 'count', v_count,
    'rows', v_rows, 'data_day', v_sales_day);

  -- 3) Purchase invoices of the latest purchase day not reviewed yet.
  select count(*), coalesce(jsonb_agg(p) filter (where p.rn <= 5), '[]'::jsonb) into v_count, v_rows
  from (
    select row_number() over (order by pi.total_value desc nulls last) rn, pi.id,
           coalesce(pi.system_invoice_number, pi.supplier_invoice_number) invoice_number, pi.total_value
    from public.purchase_invoices pi
    where pi.invoice_date = v_purchase_day and public.dawaa_customer_request_branch_key(pi.branch) = v_branch
      and pi.reviewed_at is null
  ) p;
  v_items := v_items || jsonb_build_object('key', 'purchases_review', 'group', 'auto', 'count', v_count,
    'rows', v_rows, 'data_day', v_purchase_day);

  -- 4) This week's inventory count: plan it, push it when late, review it when submitted.
  select s.id, s.status, s.due_date, s.week_start into v_session
  from public.inventory_count_sessions s
  where s.count_type = 'weekly_items' and public.dawaa_customer_request_branch_key(s.branch) = v_branch
    and s.week_start <= v_today and s.week_start > v_today - 7
  order by s.week_start desc
  limit 1;
  v_items := v_items || jsonb_build_object('key', 'weekly_inventory', 'group', 'auto',
    'count', case
      when v_session.id is null then 1
      when v_session.status = 'submitted' then 1
      when v_session.status in ('planned', 'counting') and v_session.due_date < v_today then 1
      else 0 end,
    'rows', '[]'::jsonb,
    'inventory_status', case when v_session.id is null then 'not_planned'
      when v_session.status in ('planned', 'counting') and v_session.due_date < v_today then 'late'
      else v_session.status end,
    'due_date', v_session.due_date);

  -- 5) Customers who spent 500 EGP or more: a thank-you / follow-up call.
  select count(*), coalesce(jsonb_agg(b) filter (where b.rn <= 5), '[]'::jsonb) into v_count, v_rows
  from (
    select row_number() over (order by coalesce(si.net_amount, si.net_total, si.amount) desc) rn,
           coalesce(nullif(btrim(si.customer_name), ''), nullif(btrim(si.name), ''), 'بدون اسم') customer_name,
           coalesce(si.net_amount, si.net_total, si.amount) amount, si.seller_name seller
    from public.sales_invoices si
    where si.invoice_date >= v_sales_day and si.invoice_date < v_sales_day + 1 and public.dawaa_customer_request_branch_key(si.branch) = v_branch
      and coalesce(si.net_amount, si.net_total, si.amount) >= 500
  ) b;
  v_items := v_items || jsonb_build_object('key', 'big_customers', 'group', 'decide', 'count', v_count,
    'rows', v_rows, 'data_day', v_sales_day);

  -- 6) Discounts above 10% of the invoice need a reason.
  select count(*), coalesce(jsonb_agg(d) filter (where d.rn <= 5), '[]'::jsonb) into v_count, v_rows
  from (
    select row_number() over (order by si.discount_amount desc) rn,
           coalesce(si.invoice_number, si.invoice_no) invoice_number,
           coalesce(nullif(btrim(si.customer_name), ''), nullif(btrim(si.name), ''), 'بدون اسم') customer_name,
           si.discount_amount discount, coalesce(si.gross_amount, si.gross_total) gross, si.seller_name seller
    from public.sales_invoices si
    where si.invoice_date >= v_sales_day and si.invoice_date < v_sales_day + 1 and public.dawaa_customer_request_branch_key(si.branch) = v_branch
      and coalesce(si.discount_amount, 0) > 0.1 * nullif(coalesce(si.gross_amount, si.gross_total), 0)
  ) d;
  v_items := v_items || jsonb_build_object('key', 'high_discount', 'group', 'decide', 'count', v_count,
    'rows', v_rows, 'data_day', v_sales_day);

  -- 7-9) Floor checks.
  v_items := v_items
    || jsonb_build_object('key', 'cash_reconciliation', 'group', 'check', 'count', 1, 'rows', '[]'::jsonb)
    || jsonb_build_object('key', 'appearance_cleanliness', 'group', 'check', 'count', 1, 'rows', '[]'::jsonb)
    || jsonb_build_object('key', 'shelves_fridge', 'group', 'check', 'count', 1, 'rows', '[]'::jsonb);

  -- Attach today's marks; an item is done when its data is clean or the manager closed it.
  select jsonb_agg(i || jsonb_build_object(
           'state', m.state, 'note', m.note, 'marked_at', m.marked_at, 'marked_by', sa.name,
           'done', (m.state is not null) or (i->>'group' = 'auto' and (i->>'count')::int = 0)
                   or (i->>'group' = 'decide' and (i->>'count')::int = 0))
         order by o.ord)
    into v_items
  from jsonb_array_elements(v_items) with ordinality o(i, ord)
  left join public.branch_manager_agenda_marks m
    on m.branch_key = v_branch and m.agenda_day = v_today and m.item_key = o.i->>'key'
  left join public.staff_accounts sa on sa.id = m.staff_account_id;

  return jsonb_build_object(
    'branch', v_branch,
    'day', v_today,
    'cycle_start', v_cycle_start,
    'sales_day', v_sales_day,
    'purchase_day', v_purchase_day,
    'items', v_items,
    'done', (select count(*) from jsonb_array_elements(v_items) e where (e->>'done')::boolean),
    'total', jsonb_array_length(v_items)
  );
end;
$function$;

create or replace function public.get_branch_manager_agenda_compliance_v1(p_branch text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_scope text := public.dawaa_current_operational_write_scope_v1(array[]::text[], array['branch_manager']);
  v_branch text := public.dawaa_customer_request_branch_key(p_branch);
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_cycle_start date;
  v_branches text[];
  v_days jsonb;
begin
  if v_scope = 'NONE' or (v_scope <> 'ALL' and v_branch is not null and v_branch <> v_scope) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  v_branches := case
    when v_scope <> 'ALL' then array[v_scope]
    when v_branch is not null then array[v_branch]
    else array['shokry', 'elshamy'] end;
  v_cycle_start := case when extract(day from v_today) >= 26
    then make_date(extract(year from v_today)::int, extract(month from v_today)::int, 26)
    else (date_trunc('month', v_today) - interval '1 month')::date + 25 end;

  -- One row per branch per cycle day: floor checks closed, everything marked, and what was flagged.
  select coalesce(jsonb_agg(jsonb_build_object(
           'branch', b.branch_key,
           'day', g.ts::date,
           'checks_done', coalesce(m.checks_done, 0),
           'checks_total', 3,
           'marked', coalesce(m.marked, 0),
           'issues', coalesce(m.issues, '[]'::jsonb),
           'first_marked_at', m.first_marked_at,
           'marked_by', m.marked_by)
         order by b.branch_key, g.ts desc), '[]'::jsonb)
    into v_days
  from unnest(v_branches) b(branch_key)
  cross join generate_series(v_cycle_start::timestamp, v_today::timestamp, interval '1 day') g(ts)
  left join lateral (
    select count(*) filter (where mk.item_key in ('cash_reconciliation', 'appearance_cleanliness', 'shelves_fridge')) checks_done,
           count(*) marked,
           jsonb_agg(jsonb_build_object('item', mk.item_key, 'note', mk.note)) filter (where mk.state = 'issue') issues,
           min(mk.marked_at) first_marked_at,
           string_agg(distinct sa.name, '، ') marked_by
    from public.branch_manager_agenda_marks mk
    left join public.staff_accounts sa on sa.id = mk.staff_account_id
    where mk.branch_key = b.branch_key and mk.agenda_day = g.ts::date
  ) m on true;

  return jsonb_build_object('cycle_start', v_cycle_start, 'today', v_today, 'days', v_days);
end;
$function$;
revoke all on function public.get_branch_manager_agenda_compliance_v1(text) from public;
grant execute on function public.get_branch_manager_agenda_compliance_v1(text) to anon, authenticated;
