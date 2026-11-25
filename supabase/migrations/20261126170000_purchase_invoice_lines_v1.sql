-- أصناف فواتير الشراء (صاحب الصيدلية 2026-11-25): تقرير «فواتير الشراء» من ePlus لو اتصدّر بالأصناف بيترفع زي
-- ما هو، والسيستم بيحفظ كل صنف (الكود والكمية والبونص والمرتجع وسعر الشراء والبيع والإجمالي والصلاحية).
-- بيظهروا في تفاصيل الفاتورة، وفي التحويلات بيتطابقوا صنف صنف مع فاتورة البيع في الفرع التاني
-- (كود مختلف لنفس الصنف، كمية مختلفة، صنف ناقص)، وتقرير الفترة بيجمع الأخطاء دي بالكود وبالدكتور.

create table if not exists public.purchase_review_invoice_lines (
  store text not null,
  serial text not null,
  line_no int not null,
  code text not null,
  name text not null,
  qty numeric not null default 0,
  bonus numeric not null default 0,
  return_qty numeric not null default 0,
  buy_price numeric not null default 0,
  buy_total numeric not null default 0,
  sell_price numeric not null default 0,
  sell_total numeric not null default 0,
  profit numeric not null default 0,
  profit_pct numeric not null default 0,
  expiry text,
  primary key (store, serial, line_no)
);
create index if not exists purchase_review_invoice_lines_code_idx on public.purchase_review_invoice_lines (code);
alter table public.purchase_review_invoice_lines enable row level security;
revoke all on public.purchase_review_invoice_lines from anon, authenticated;

create or replace function public.import_purchase_review_file_v1(p_store text, p_branch text, p_file_name text, p_report_net numeric, p_invoices jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := public.purchase_review_import_actor_v1();
  v_upload uuid;
  v_first date;
  v_last date;
  v_count integer;
  v_net numeric;
  v_replaced integer;
  v_lines integer := 0;
begin
  if p_branch not in ('فرع شكري', 'فرع الشامي') or coalesce(btrim(p_store), '') = '' then
    raise exception 'invalid_store' using errcode = '22023';
  end if;
  if jsonb_typeof(p_invoices) <> 'array' or jsonb_array_length(p_invoices) = 0 then
    raise exception 'empty_file' using errcode = '22023';
  end if;

  create temporary table tmp_purchase_review on commit drop as
  select btrim(x->>'serial') serial,
         case when x->>'payment' = 'cash' then 'cash' else 'credit' end payment,
         (x->>'invoice_at')::timestamp invoice_at,
         btrim(x->>'supplier_code') supplier_code,
         btrim(x->>'supplier_name') supplier_name,
         nullif(btrim(x->>'supplier_invoice_no'), '') supplier_invoice_no,
         coalesce((x->>'items')::int, 0) items,
         coalesce((x->>'gross')::numeric, 0) gross,
         coalesce((x->>'discount')::numeric, 0) discount,
         coalesce((x->>'expenses')::numeric, 0) expenses,
         coalesce((x->>'tax')::numeric, 0) tax,
         (x->>'net')::numeric net,
         nullif(btrim(x->>'entered_by'), '') entered_by,
         nullif(btrim(x->>'note'), '') note,
         case when jsonb_typeof(x->'lines') = 'array' then x->'lines' end lines
  from jsonb_array_elements(p_invoices) x;

  if exists (select 1 from tmp_purchase_review
             where coalesce(serial, '') = '' or invoice_at is null or net is null or coalesce(supplier_code, '') = '') then
    raise exception 'bad_rows' using errcode = '22023';
  end if;

  select min(invoice_at::date), max(invoice_at::date), count(*), sum(net)
    into v_first, v_last, v_count, v_net from tmp_purchase_review;

  insert into public.purchase_review_uploads (store, branch, file_name, first_day, last_day, invoices, net, report_net, uploaded_by)
  values (btrim(p_store), p_branch, p_file_name, v_first, v_last, v_count, v_net, p_report_net, v_actor)
  returning id into v_upload;

  delete from public.purchase_review_invoices i
   where i.store = btrim(p_store) and i.invoice_day between v_first and v_last;
  get diagnostics v_replaced = row_count;

  insert into public.purchase_review_invoices (store, serial, branch, payment, invoice_at, invoice_day, supplier_code,
    supplier_name, supplier_invoice_no, items, gross, discount, expenses, tax, net, entered_by, note, upload_id)
  select distinct on (t.serial) btrim(p_store), t.serial, p_branch, t.payment, t.invoice_at, t.invoice_at::date,
         t.supplier_code, t.supplier_name, t.supplier_invoice_no, t.items, t.gross, t.discount, t.expenses, t.tax,
         t.net, t.entered_by, t.note, v_upload
  from tmp_purchase_review t
  order by t.serial
  on conflict (store, serial) do update set
    branch = excluded.branch, payment = excluded.payment, invoice_at = excluded.invoice_at,
    invoice_day = excluded.invoice_day, supplier_code = excluded.supplier_code,
    supplier_name = excluded.supplier_name, supplier_invoice_no = excluded.supplier_invoice_no,
    items = excluded.items, gross = excluded.gross, discount = excluded.discount, expenses = excluded.expenses,
    tax = excluded.tax, net = excluded.net, entered_by = excluded.entered_by, note = excluded.note,
    upload_id = excluded.upload_id;

  -- أصناف الفواتير (لما التقرير يتصدّر بالأصناف): بتتبدّل للفواتير اللي في الملف، واللي اتمسحت فواتيره بتتمسح.
  delete from public.purchase_review_invoice_lines l
   where l.store = btrim(p_store)
     and (l.serial in (select t.serial from tmp_purchase_review t where t.lines is not null)
          or not exists (select 1 from public.purchase_review_invoices i where i.store = l.store and i.serial = l.serial));
  insert into public.purchase_review_invoice_lines (store, serial, line_no, code, name, qty, bonus, return_qty,
    buy_price, buy_total, sell_price, sell_total, profit, profit_pct, expiry)
  select distinct on (t.serial, (e->>'line_no')::int) btrim(p_store), t.serial, (e->>'line_no')::int,
         btrim(e->>'code'), left(btrim(e->>'name'), 200),
         coalesce((e->>'qty')::numeric, 0), coalesce((e->>'bonus')::numeric, 0), coalesce((e->>'return_qty')::numeric, 0),
         coalesce((e->>'buy_price')::numeric, 0), coalesce((e->>'buy_total')::numeric, 0),
         coalesce((e->>'sell_price')::numeric, 0), coalesce((e->>'sell_total')::numeric, 0),
         coalesce((e->>'profit')::numeric, 0), coalesce((e->>'profit_pct')::numeric, 0),
         nullif(btrim(e->>'expiry'), '')
  from tmp_purchase_review t
  cross join lateral jsonb_array_elements(t.lines) e
  where t.lines is not null and coalesce(btrim(e->>'code'), '') <> '' and (e->>'line_no') ~ '^\d+$'
  order by t.serial, (e->>'line_no')::int;
  get diagnostics v_lines = row_count;

  insert into public.purchase_review_supplier_terms (supplier_code, supplier_name, excluded)
  select distinct on (t.supplier_code) t.supplier_code, t.supplier_name, t.supplier_name ~ 'جر+د'
  from tmp_purchase_review t
  order by t.supplier_code, t.invoice_at desc
  on conflict (supplier_code) do nothing;

  return jsonb_build_object('upload_id', v_upload, 'first_day', v_first, 'last_day', v_last,
    'invoices', v_count, 'net', v_net, 'replaced', v_replaced, 'lines', v_lines);
end;
$function$;


-- أصناف فاتورة واحدة، لتفاصيلها في المراجعة (نفس اللي يقدر يرفع الملف).
create or replace function public.dawaa_purchase_invoice_lines_v1(p_store text, p_serial text)
returns jsonb language plpgsql stable security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor uuid := public.purchase_review_import_actor_v1();
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object('line_no', l.line_no, 'code', l.code, 'name', l.name, 'qty', l.qty,
             'bonus', l.bonus, 'return_qty', l.return_qty, 'buy_price', l.buy_price, 'buy_total', l.buy_total,
             'sell_price', l.sell_price, 'sell_total', l.sell_total, 'profit', l.profit, 'profit_pct', l.profit_pct,
             'expiry', l.expiry) order by l.line_no), '[]'::jsonb)
    from public.purchase_review_invoice_lines l
    where l.store = btrim(p_store) and l.serial = btrim(p_serial));
end;
$$;
revoke all on function public.dawaa_purchase_invoice_lines_v1(text, text) from public, anon, authenticated;
grant execute on function public.dawaa_purchase_invoice_lines_v1(text, text) to anon, authenticated;

create or replace function public.dawaa_cs_transfer_day_v1(p_day date default null, p_branch text default null)
returns jsonb language plpgsql stable security definer
set search_path = public, pg_catalog
as $$
declare
  a public.staff_accounts := public.dawaa_cs_tasks_actor_v1(false);
  v_day date := coalesce(p_day, (now() at time zone 'Africa/Cairo')::date);
  v_from timestamp := (v_day - 1) + time '09:00';
  v_to timestamp := v_day + time '09:00';
  b record;
  v_sale_branch text;
  v_code text;
begin
  select * into b from public.dawaa_cs_morning_branch_v1(a.id, p_branch, v_day);
  v_sale_branch := public.dawaa_cs_other_branch_v1(b.branch);
  v_code := public.dawaa_cs_transfer_customer_code_v1(b.branch);
  return jsonb_build_object(
    'day', v_day, 'branch', b.branch, 'sale_branch', v_sale_branch, 'can_pick', b.can_pick, 'from', v_from, 'to', v_to,
    'purchases', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'store', i.store, 'serial', i.serial, 'invoice_at', i.invoice_at, 'supplier_name', i.supplier_name,
               'supplier_invoice_no', coalesce(nullif(btrim(i.supplier_invoice_no), ''),
                 (select nullif(btrim(x.supplier_invoice_number), '') from public.base44_purchase_invoice_sync x
                  where x.branch = i.branch and x.system_invoice_number = i.serial order by x.synced_at desc limit 1)),
               'items', i.items, 'net', i.net, 'entered_by', i.entered_by, 'note', i.note,
               'lines', (select coalesce(jsonb_agg(jsonb_build_object('code', l.code, 'name', l.name, 'qty', l.qty,
                                   'bonus', l.bonus, 'price', l.buy_price, 'sell_price', l.sell_price,
                                   'total', l.buy_total) order by l.line_no), '[]'::jsonb)
                         from public.purchase_review_invoice_lines l where l.store = i.store and l.serial = i.serial),
               'check', (select jsonb_build_object('status', c.status, 'problems', to_jsonb(c.problems),
                          'sale_invoice', c.sale_invoice, 'note', c.note, 'by', c.checked_by_name, 'at', c.checked_at)
                        from public.cs_transfer_checks c
                        where c.purchase_store = i.store and c.purchase_serial = i.serial))
             order by i.invoice_at, i.serial), '[]'::jsonb)
      from public.purchase_review_invoices i
      where i.branch = b.branch and i.invoice_at >= v_from and i.invoice_at < v_to
        and public.dawaa_cs_is_transfer_supplier_v1(i.branch, i.supplier_code, i.supplier_name)),
    'sales', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'invoice', s.invoice_number,
               'at', (coalesce(s.invoice_datetime, s.invoice_date) at time zone 'Africa/Cairo'),
               'net', coalesce(s.net_amount, s.total_amount), 'seller', coalesce(s.normalized_seller_name, s.seller_name),
               'lines', coalesce(s.line_items_count, 0), 'note', s.notes,
               'items', (select coalesce(jsonb_agg(jsonb_build_object('code', it.product_code, 'name', it.product_name,
                                   'qty', it.quantity, 'price', it.unit_price, 'total', it.line_total)
                                   order by it.line_no), '[]'::jsonb)
                         from public.sales_invoice_items_v21 it where it.invoice_id = s.id),
               'check', (select jsonb_build_object('status', c.status, 'problems', to_jsonb(c.problems),
                          'purchase_serial', c.purchase_serial, 'note', c.note, 'by', c.checked_by_name, 'at', c.checked_at)
                        from public.cs_transfer_checks c
                        where c.sale_branch = v_sale_branch and c.sale_invoice = s.invoice_number))
             order by s.invoice_datetime), '[]'::jsonb)
      from public.sales_invoices s
      where s.branch = v_sale_branch and s.customer_code = v_code
        and s.invoice_date >= ((v_from - interval '6 hours') at time zone 'Africa/Cairo')
        and s.invoice_date < (v_to at time zone 'Africa/Cairo'))
  );
end;
$$;

create or replace function public.dawaa_cs_transfer_period_v1(p_from date, p_to date, p_branch text default null)
returns jsonb language plpgsql stable security definer
set search_path = public, pg_catalog
as $$
declare
  a public.staff_accounts := public.dawaa_cs_tasks_actor_v1(false);
  v_day date := least(coalesce(p_to, (now() at time zone 'Africa/Cairo')::date), (now() at time zone 'Africa/Cairo')::date);
  v_from timestamp := (greatest(coalesce(p_from, v_day), v_day - 62) - 1) + time '09:00';
  v_to timestamp := v_day + time '09:00';
  b record;
  v_sale_branch text;
  v_code text;
begin
  select * into b from public.dawaa_cs_morning_branch_v1(a.id, p_branch, v_day);
  v_sale_branch := public.dawaa_cs_other_branch_v1(b.branch);
  v_code := public.dawaa_cs_transfer_customer_code_v1(b.branch);
  return jsonb_build_object(
    'day', v_day, 'branch', b.branch, 'sale_branch', v_sale_branch, 'can_pick', b.can_pick, 'from', v_from, 'to', v_to,
    'purchases', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'store', i.store, 'serial', i.serial, 'invoice_at', i.invoice_at, 'supplier_name', i.supplier_name,
               'supplier_invoice_no', coalesce(nullif(btrim(i.supplier_invoice_no), ''),
                 (select nullif(btrim(x.supplier_invoice_number), '') from public.base44_purchase_invoice_sync x
                  where x.branch = i.branch and x.system_invoice_number = i.serial order by x.synced_at desc limit 1)),
               'items', i.items, 'net', i.net, 'entered_by', i.entered_by, 'note', i.note,
               'lines', (select coalesce(jsonb_agg(jsonb_build_object('code', l.code, 'name', l.name, 'qty', l.qty,
                                   'bonus', l.bonus, 'price', l.buy_price, 'sell_price', l.sell_price,
                                   'total', l.buy_total) order by l.line_no), '[]'::jsonb)
                         from public.purchase_review_invoice_lines l where l.store = i.store and l.serial = i.serial),
               'check', (select jsonb_build_object('status', c.status, 'problems', to_jsonb(c.problems),
                          'sale_invoice', c.sale_invoice, 'note', c.note, 'by', c.checked_by_name, 'at', c.checked_at)
                        from public.cs_transfer_checks c
                        where c.purchase_store = i.store and c.purchase_serial = i.serial))
             order by i.invoice_at, i.serial), '[]'::jsonb)
      from public.purchase_review_invoices i
      where i.branch = b.branch and i.invoice_at >= v_from and i.invoice_at < v_to
        and public.dawaa_cs_is_transfer_supplier_v1(i.branch, i.supplier_code, i.supplier_name)),
    'sales', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'invoice', s.invoice_number,
               'at', (coalesce(s.invoice_datetime, s.invoice_date) at time zone 'Africa/Cairo'),
               'net', coalesce(s.net_amount, s.total_amount), 'seller', coalesce(s.normalized_seller_name, s.seller_name),
               'lines', coalesce(s.line_items_count, 0), 'note', s.notes,
               'items', (select coalesce(jsonb_agg(jsonb_build_object('code', it.product_code, 'name', it.product_name,
                                   'qty', it.quantity, 'price', it.unit_price, 'total', it.line_total)
                                   order by it.line_no), '[]'::jsonb)
                         from public.sales_invoice_items_v21 it where it.invoice_id = s.id),
               'check', (select jsonb_build_object('status', c.status, 'problems', to_jsonb(c.problems),
                          'purchase_serial', c.purchase_serial, 'note', c.note, 'by', c.checked_by_name, 'at', c.checked_at)
                        from public.cs_transfer_checks c
                        where c.sale_branch = v_sale_branch and c.sale_invoice = s.invoice_number))
             order by s.invoice_datetime), '[]'::jsonb)
      from public.sales_invoices s
      where s.branch = v_sale_branch and s.customer_code = v_code
        and s.invoice_date >= ((v_from - interval '6 hours') at time zone 'Africa/Cairo')
        and s.invoice_date < (v_to at time zone 'Africa/Cairo'))
  );
end;
$$;

revoke all on function public.import_purchase_review_file_v1(text, text, text, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.import_purchase_review_file_v1(text, text, text, numeric, jsonb) to anon, authenticated;
revoke all on function public.dawaa_cs_transfer_day_v1(date, text) from public, anon, authenticated;
grant execute on function public.dawaa_cs_transfer_day_v1(date, text) to anon, authenticated;
revoke all on function public.dawaa_cs_transfer_period_v1(date, date, text) from public, anon, authenticated;
grant execute on function public.dawaa_cs_transfer_period_v1(date, date, text) to anon, authenticated;
