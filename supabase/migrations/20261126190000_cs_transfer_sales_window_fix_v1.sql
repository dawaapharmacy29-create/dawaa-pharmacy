-- إصلاح فواتير البيع في التحويلات (2026-11-25): تاريخ فاتورة البيع متخزن نص الليل بتاريخ اليوم (00:00 UTC)، ووقتها
-- (invoice_datetime) متخزن بساعة مصر كأنه UTC. الصفحة كانت بتدور على فواتير بعد ٣ الفجر بتوقيت مصر، فكل فواتير
-- يوم امبارح كانت بتقع برّه وتظهر «مفيش ولا فاتورة بيع»، والوقت كان بيظهر متأخر ساعتين.
-- دلوقتي: بيع أي يوم من يوم بداية الفترة لحد يوم نهايتها، والوقت زي ما هو متسجل.

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
               'at', (coalesce(s.invoice_datetime, s.invoice_date) at time zone 'UTC'),
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
        and s.invoice_date >= ((v_from - interval '6 hours')::date::timestamp at time zone 'UTC')
        and s.invoice_date < ((v_to::date + 1)::timestamp at time zone 'UTC'))
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
               'at', (coalesce(s.invoice_datetime, s.invoice_date) at time zone 'UTC'),
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
        and s.invoice_date >= ((v_from - interval '6 hours')::date::timestamp at time zone 'UTC')
        and s.invoice_date < ((v_to::date + 1)::timestamp at time zone 'UTC'))
  );
end;
$$;

