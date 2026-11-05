-- «مراجعتي اليومية» v3 (owner's notes, 2026-11-05):
--   * ملف المبيعات: done only when the file was uploaded TODAY (a file uploaded yesterday no longer counts).
--   * تحويلات التحصيل: removed from the list.
--   * العملاء: per branch, customers coded for the first time yesterday, coded buyers yesterday, the share of
--     coded invoices, and for the cycle: new coded so far, the pace to the cycle end and coded buyers.
--   * المشتريات: get_gm_pending_purchases_v1() lists the invoices still «انتظار المراجعة» in دواء وائل so the
--     general manager sees them here.
-- Delivery counts (today / cycle / unmatched) come from the delivery app snapshot (its migration
-- 20261105151000); this function passes the snapshot branches through unchanged.

create or replace function public.get_gm_daily_review_v1()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_yesterday date := v_today - 1;
  v_cycle_start date;
  v_cycle_end date;
  v_items jsonb := '[]'::jsonb;
  v_detail jsonb;
  v_ok boolean;
  v_n integer;
  v_m integer;
  v_synced timestamptz;
begin
  perform public.gm_daily_review_actor_v1();
  v_cycle_start := case when extract(day from v_today) >= 26
    then make_date(extract(year from v_today)::int, extract(month from v_today)::int, 26)
    else (date_trunc('month', v_today) - interval '1 month')::date + 25 end;
  v_cycle_end := (v_cycle_start + interval '1 month')::date - 1;

  -- ملف المبيعات: today's upload, not just yesterday's invoices.
  select jsonb_agg(jsonb_build_object('branch', b.k, 'last_day', x.last_day, 'uploaded_at', x.uploaded_at) order by b.k),
         bool_and(coalesce((x.uploaded_at at time zone 'Africa/Cairo')::date >= v_today, false))
    into v_detail, v_ok
  from (values ('shokry', 'فرع شكري'), ('elshamy', 'فرع الشامي')) b(k, name)
  left join lateral (
    select max((si.invoice_date at time zone 'Africa/Cairo')::date) last_day, max(si.created_at) uploaded_at
    from public.sales_invoices si
    where si.branch = b.name and si.invoice_date >= v_today - 10
  ) x on true;
  v_items := v_items || jsonb_build_object('key', 'sales_upload', 'kind', 'auto', 'ok', v_ok, 'detail', v_detail);

  select jsonb_agg(jsonb_build_object('branch', b.k, 'pending', coalesce(x.pending, 0),
           'missing', coalesce(x.missing, 0), 'late', coalesce(x.late, 0)) order by b.k),
         bool_and(coalesce(x.pending, 0) = 0)
    into v_detail, v_ok
  from (values ('shokry'), ('elshamy')) b(k)
  left join lateral (
    select count(*) filter (where a.status = 'pending_review') pending,
           count(*) filter (where a.missing_punch) missing,
           count(*) filter (where coalesce(a.late_minutes, 0) > 15) late
    from public.attendance_daily_summary a
    where a.attendance_date = v_yesterday and public.dawaa_customer_request_branch_key(a.branch) = b.k
  ) x on true;
  v_items := v_items || jsonb_build_object('key', 'attendance', 'kind', 'auto', 'ok', v_ok, 'detail', v_detail,
    'data_day', v_yesterday);

  select jsonb_agg(jsonb_build_object('branch', b.k, 'checks_done', coalesce(x.checks, 0), 'checks_total', 4,
           'issues', coalesce(x.issues, 0)) order by b.k),
         bool_and(coalesce(x.checks, 0) >= 4)
    into v_detail, v_ok
  from (values ('shokry'), ('elshamy')) b(k)
  left join lateral (
    select count(*) filter (where m.item_key in ('cash_reconciliation', 'appearance_cleanliness', 'shelves_fridge', 'stories_upload')) checks,
           count(*) filter (where m.state = 'issue') issues
    from public.branch_manager_agenda_marks m
    where m.branch_key = b.k and m.agenda_day = v_yesterday
  ) x on true;
  v_items := v_items || jsonb_build_object('key', 'managers', 'kind', 'auto', 'ok', v_ok, 'detail', v_detail,
    'data_day', v_yesterday);

  select jsonb_agg(jsonb_build_object('branch', b.k, 'ratings', coalesce(x.n, 0), 'last_day', x.last_day) order by b.k),
         bool_and(coalesce(x.n, 0) > 0)
    into v_detail, v_ok
  from (values ('shokry'), ('elshamy')) b(k)
  left join lateral (
    select count(*) filter (where c.rating_date = v_yesterday) n, max(c.rating_date) last_day
    from public.cleaning_daily_ratings c
    where public.dawaa_customer_request_branch_key(c.branch) = b.k
  ) x on true;
  v_items := v_items || jsonb_build_object('key', 'cleaning', 'kind', 'auto', 'ok', v_ok, 'detail', v_detail,
    'data_day', v_yesterday);

  select jsonb_agg(jsonb_build_object('branch', b.k, 'status', coalesce(case
             when x.status in ('planned', 'counting') and x.due_date < v_today then 'late' else x.status end, 'not_planned'),
           'due_date', x.due_date) order by b.k),
         bool_and(x.status is not null and not (x.status in ('planned', 'counting') and x.due_date < v_today)
                  and x.status <> 'submitted')
    into v_detail, v_ok
  from (values ('shokry'), ('elshamy')) b(k)
  left join lateral (
    select s.status, s.due_date
    from public.inventory_count_sessions s
    where s.count_type = 'weekly_items' and public.dawaa_customer_request_branch_key(s.branch) = b.k
      and s.week_start <= v_today and s.week_start > v_today - 7
    order by s.week_start desc
    limit 1
  ) x on true;
  v_items := v_items || jsonb_build_object('key', 'inventory', 'kind', 'auto', 'ok', coalesce(v_ok, false), 'detail', v_detail);

  select max(l.ran_at) into v_synced from public.base44_sync_run_log l
   where coalesce(l.source, 'purchase_invoices') = 'purchase_invoices' and l.status = 'success';
  select jsonb_agg(jsonb_build_object('branch', b.k, 'pending', coalesce(x.pending, 0), 'value', coalesce(x.value, 0),
           'oldest', x.oldest, 'yesterday', coalesce(x.yesterday, 0)) order by b.k),
         bool_and(coalesce(x.pending, 0) = 0)
    into v_detail, v_ok
  from (values ('shokry', 'فرع شكري'), ('elshamy', 'فرع الشامي')) b(k, name)
  left join lateral (
    select count(*) filter (where p.base44_status = 'انتظار المراجعة' and p.invoice_date < v_today) pending,
           sum(p.total_value) filter (where p.base44_status = 'انتظار المراجعة' and p.invoice_date < v_today) value,
           min(p.invoice_date) filter (where p.base44_status = 'انتظار المراجعة' and p.invoice_date < v_today) oldest,
           count(*) filter (where p.invoice_date = v_yesterday) yesterday
    from public.base44_purchase_invoice_sync p
    where p.branch = b.name and p.invoice_date >= v_today - 45 and p.invoice_date <= v_today
      and (p.base44_missing_at is null or p.synced_at > p.base44_missing_at)
  ) x on true;
  v_items := v_items || jsonb_build_object('key', 'purchases_handover', 'kind', 'external',
    'ok', coalesce(v_ok and v_synced > now() - interval '1 hour', false),
    'detail', jsonb_build_object('branches', v_detail, 'synced_at', v_synced));

  select max(l.ran_at) into v_synced from public.base44_sync_run_log l
   where l.source = 'shift_deliveries' and l.status = 'success';
  select jsonb_agg(jsonb_build_object('branch', b.k,
           'yesterday_done', (select count(distinct h.shift_type) from public.shift_handovers h
                               where h.branch = b.name and h.shift_date = v_yesterday and not h.is_archived),
           'missing', coalesce(m.missing, '[]'::jsonb)) order by b.k),
         bool_and(m.missing is null)
    into v_detail, v_ok
  from (values ('shokry', 'فرع شكري'), ('elshamy', 'فرع الشامي')) b(k, name)
  left join lateral (
    select jsonb_agg(jsonb_build_object('day', s.shift_date, 'shift', s.shift_type, 'due_at', s.due_at,
             'doctors', public.shift_on_duty_doctors_v1(s.branch, s.due_at - interval '2 hours'))
             order by s.due_at) missing
    from public.shift_handover_due_v1(now()) s
    where s.branch = b.name and not s.closed
  ) m on true;
  v_items := v_items || jsonb_build_object('key', 'shifts', 'kind', 'auto',
    'ok', coalesce(v_ok and v_synced > now() - interval '1 hour', false),
    'detail', jsonb_build_object('branches', v_detail, 'synced_at', v_synced), 'data_day', v_yesterday);

  select s.snapshot, s.fetched_at into v_detail, v_synced
  from public.delivery_daily_review_snapshot s where s.id = 1;
  v_ok := v_detail is not null and (v_detail->>'day')::date = v_today
    and not exists (select 1 from jsonb_array_elements(v_detail->'branches') b
                    where coalesce((b->>'pending_errands')::int, 0) > 0 or coalesce((b->>'stuck')::int, 0) > 0);
  v_items := v_items || jsonb_build_object('key', 'delivery', 'kind', 'external',
    'ok', coalesce(v_ok and v_synced > now() - interval '1 hour', false),
    'detail', jsonb_build_object('branches', coalesce(v_detail->'branches', '[]'::jsonb), 'synced_at', v_synced,
      'cycle_start', v_detail->'cycle_start',
      'invoice_sync', (select jsonb_build_object('last_success_at', j.last_success_at, 'last_error', j.last_error,
                              'last_result', j.last_result)
                       from public.delivery_invoice_export_jobs j where j.period_start = v_cycle_start)),
    'data_day', v_yesterday);

  -- Stories: each branch manager marks today's stories in «قائمة اليوم».
  select jsonb_agg(jsonb_build_object('branch', b.k, 'state', m.state, 'note', m.note, 'marked_at', m.marked_at,
           'marked_by', sa.name) order by b.k),
         bool_and(coalesce(m.state = 'done', false))
    into v_detail, v_ok
  from (values ('shokry'), ('elshamy')) b(k)
  left join public.branch_manager_agenda_marks m
    on m.branch_key = b.k and m.agenda_day = v_today and m.item_key = 'stories_upload'
  left join public.staff_accounts sa on sa.id = m.staff_account_id;
  v_items := v_items || jsonb_build_object('key', 'stories', 'kind', 'auto', 'ok', coalesce(v_ok, false),
    'detail', v_detail, 'data_day', v_today);

  -- العملاء: open requests (as before) + coded customers per branch.
  select count(*) into v_n from public.customer_requests cr
   where cr.status not in ('delivered', 'closed', 'cancelled', 'not_available')
     and cr.created_at >= (v_cycle_start::timestamp at time zone 'Africa/Cairo')
     and cr.created_at < now() - interval '24 hours';
  select count(*) into v_m from public.sales_invoices si
   where si.invoice_date >= v_yesterday and si.invoice_date < v_yesterday + 1
     and coalesce(si.net_amount, si.net_total, si.amount) >= 500;
  with inv as (
    select replace(coalesce(nullif(s.branch_name, ''), s.branch), 'فرع ', '') b, s.customer_code code, s.sale_date
    from public.sales_invoices s
    where s.sale_date between v_cycle_start and v_yesterday
      and s.import_validation_status = 'valid' and s.save_status = 'تم حفظها'
  ), coded as (
    select b, code, min(sale_date) first_day from inv
    where nullif(btrim(code), '') is not null group by 1, 2
  ), fresh as (
    select c.* from coded c
    where not exists (select 1 from public.sales_invoices p where p.customer_code = c.code
                        and p.invoice_date < (v_cycle_start::timestamp at time zone 'Africa/Cairo'))
  )
  select jsonb_agg(jsonb_build_object(
           'branch', b.k,
           'new_yesterday', (select count(*) from fresh f where f.b = b.name and f.first_day = v_yesterday),
           'new_cycle', (select count(*) from fresh f where f.b = b.name),
           'buyers_yesterday', (select count(distinct i.code) from inv i where i.b = b.name and i.sale_date = v_yesterday
                                  and nullif(btrim(i.code), '') is not null),
           'invoices_yesterday', (select count(*) from inv i where i.b = b.name and i.sale_date = v_yesterday),
           'coded_invoices_yesterday', (select count(*) from inv i where i.b = b.name and i.sale_date = v_yesterday
                                          and nullif(btrim(i.code), '') is not null),
           'buyers_cycle', (select count(distinct i.code) from inv i where i.b = b.name and nullif(btrim(i.code), '') is not null))
         order by b.k)
    into v_detail
  from (values ('shokry', 'شكري'), ('elshamy', 'الشامي')) b(k, name);
  v_items := v_items || jsonb_build_object('key', 'customers', 'kind', 'auto', 'ok', v_n = 0,
    'detail', jsonb_build_object('open_requests', v_n, 'big_customers_yesterday', v_m, 'branches', v_detail,
      'cycle_start', v_cycle_start, 'cycle_end', v_cycle_end,
      'days_done', greatest(v_yesterday - v_cycle_start + 1, 0), 'cycle_days', v_cycle_end - v_cycle_start + 1),
    'data_day', v_yesterday);

  select jsonb_agg(i || jsonb_build_object(
           'state', m.state, 'note', m.note, 'marked_at', m.marked_at, 'marked_by', sa.name,
           'done', m.state is not null or (i->>'ok')::boolean)
         order by o.ord)
    into v_items
  from jsonb_array_elements(v_items) with ordinality o(i, ord)
  left join public.gm_daily_review_marks m on m.review_day = v_today and m.item_key = o.i->>'key'
  left join public.staff_accounts sa on sa.id = m.staff_account_id;

  return jsonb_build_object(
    'day', v_today,
    'yesterday', v_yesterday,
    'items', v_items,
    'done', (select count(*) from jsonb_array_elements(v_items) e where (e->>'done')::boolean),
    'total', jsonb_array_length(v_items),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('day', g.d::date,
                  'marked', (select count(*) from public.gm_daily_review_marks m where m.review_day = g.d::date))
                  order by g.d desc), '[]'::jsonb)
                from generate_series(v_today - 13, v_today, interval '1 day') g(d))
  );
end;
$function$;

-- The invoices still waiting for review in دواء وائل, for the general manager to read here.
create or replace function public.get_gm_pending_purchases_v1(p_limit integer default 60)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_today date := (now() at time zone 'Africa/Cairo')::date;
begin
  perform public.gm_daily_review_actor_v1();
  return (
    select coalesce(jsonb_agg(r order by r.invoice_date, r.total_value desc), '[]'::jsonb)
    from (
      select bs.branch, bs.invoice_date, bs.total_value, bs.system_invoice_number, bs.supplier_invoice_number,
             coalesce(s.name, '—') supplier, bs.entered_by_raw entered_by, bs.transaction_type,
             v_today - bs.invoice_date days_waiting
      from public.base44_purchase_invoice_sync bs
      left join public.purchase_invoices pi on pi.base44_id = bs.base44_id
      left join public.purchase_suppliers s on s.id = pi.supplier_id
      where bs.base44_status = 'انتظار المراجعة' and bs.invoice_date < v_today and bs.invoice_date >= v_today - 45
        and (bs.base44_missing_at is null or bs.synced_at > bs.base44_missing_at)
      order by bs.invoice_date, bs.total_value desc
      limit greatest(1, least(coalesce(p_limit, 60), 200))
    ) r
  );
end;
$function$;

revoke all on function public.get_gm_pending_purchases_v1(integer) from public;
grant execute on function public.get_gm_pending_purchases_v1(integer) to anon, authenticated;
