-- بيع واحد على أكتر من فاتورة شراء (2026-11-25): الفرع التاني ساعات بيسجل التحويل الواحد على فاتورتين شراء
-- (مثال: بيع 84254 بـ 5,088 = شراء 13128 بـ 4,000 + شراء 13130 بـ 1,088). فاتورة البيع بقى ممكن تتسجل على كذا
-- فاتورة شراء، وفاتورة البيع اللي ملهاش شراء لسه مرة واحدة بس.

drop index if exists public.cs_transfer_checks_sale_uq;
create unique index if not exists cs_transfer_checks_sale_only_uq
  on public.cs_transfer_checks (sale_branch, sale_invoice) where purchase_serial is null;
create index if not exists cs_transfer_checks_sale_idx
  on public.cs_transfer_checks (sale_branch, sale_invoice) where sale_invoice is not null;

create or replace function public.dawaa_cs_transfer_check_save_v1(
  p_purchase_store text, p_purchase_serial text, p_sale_invoice text, p_status text, p_problems text[], p_note text,
  p_branch text default null, p_day date default null)
returns jsonb language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  a public.staff_accounts := public.dawaa_cs_tasks_actor_v1(false);
  v_name text := coalesce(nullif(btrim(a.name), ''), a.username);
  v_day date := coalesce(p_day, (now() at time zone 'Africa/Cairo')::date);
  b record;
  v_sale_branch text;
  i public.purchase_review_invoices;
  s public.sales_invoices;
  v_sale text := nullif(btrim(p_sale_invoice), '');
  v_problems text[] := coalesce(p_problems, '{}');
  v_ref text;
  v_before jsonb;
begin
  if p_status not in ('ok', 'problem') then raise exception 'invalid_status'; end if;
  if p_status = 'ok' then v_problems := '{}'; end if;
  if p_status = 'problem' and coalesce(array_length(v_problems, 1), 0) = 0 then raise exception 'no_problem'; end if;
  if nullif(btrim(p_purchase_serial), '') is null and v_sale is null then raise exception 'unknown_invoice'; end if;

  if nullif(btrim(p_purchase_serial), '') is not null then
    select * into i from public.purchase_review_invoices where store = p_purchase_store and serial = p_purchase_serial;
    if not found or not public.dawaa_cs_is_transfer_supplier_v1(i.branch, i.supplier_code, i.supplier_name) then
      raise exception 'unknown_invoice';
    end if;
    select * into b from public.dawaa_cs_morning_branch_v1(a.id, i.branch, v_day);
    if b.branch <> i.branch then raise exception 'not_your_branch'; end if;
  else
    select * into b from public.dawaa_cs_morning_branch_v1(a.id, p_branch, v_day);
  end if;
  v_sale_branch := public.dawaa_cs_other_branch_v1(b.branch);

  if v_sale is not null then
    select * into s from public.sales_invoices
    where branch = v_sale_branch and invoice_number = v_sale
    order by invoice_date desc limit 1;
    if not found then raise exception 'unknown_sale'; end if;
  end if;
  if p_status = 'ok' and (i.serial is null or s.invoice_number is null) then raise exception 'pair_required'; end if;

  if i.serial is not null then
    v_ref := i.store || '|' || i.serial;
    select to_jsonb(c) into v_before from public.cs_transfer_checks c where c.purchase_store = i.store and c.purchase_serial = i.serial;
    -- البيع ده كان متسجل لوحده أو مع فاتورة شراء تانية: يتفك من هناك.
    if v_sale is not null then
      delete from public.cs_transfer_checks
      where sale_branch = v_sale_branch and sale_invoice = v_sale
        and (purchase_serial is null or purchase_store <> i.store or purchase_serial <> i.serial);
    end if;
    insert into public.cs_transfer_checks as c (receiving_branch, purchase_store, purchase_serial, sale_branch, sale_invoice,
      status, problems, note, checked_by, checked_by_name, checked_at)
    values (b.branch, i.store, i.serial, v_sale_branch, v_sale, p_status, v_problems, nullif(btrim(p_note), ''), a.id, v_name, now())
    on conflict (purchase_store, purchase_serial) where purchase_serial is not null do update
      set sale_invoice = excluded.sale_invoice, status = excluded.status, problems = excluded.problems, note = excluded.note,
          checked_by = excluded.checked_by, checked_by_name = excluded.checked_by_name, checked_at = now();
  else
    v_ref := 'sale|' || v_sale_branch || '|' || v_sale;
    select to_jsonb(c) into v_before from public.cs_transfer_checks c where c.sale_branch = v_sale_branch and c.sale_invoice = v_sale
      order by c.purchase_serial nulls last limit 1;
    if v_before ? 'purchase_serial' and v_before->>'purchase_serial' is not null then raise exception 'sale_already_paired'; end if;
    insert into public.cs_transfer_checks as c (receiving_branch, purchase_store, purchase_serial, sale_branch, sale_invoice,
      status, problems, note, checked_by, checked_by_name, checked_at)
    values (b.branch, null, null, v_sale_branch, v_sale, p_status, v_problems, nullif(btrim(p_note), ''), a.id, v_name, now())
    on conflict (sale_branch, sale_invoice) where purchase_serial is null do update
      set status = excluded.status, problems = excluded.problems, note = excluded.note,
          checked_by = excluded.checked_by, checked_by_name = excluded.checked_by_name, checked_at = now();
  end if;

  insert into public.cs_purchase_check_log (kind, ref, before, after, by_id, by_name)
  values ('transfer', v_ref, v_before,
          jsonb_build_object('status', p_status, 'problems', to_jsonb(v_problems), 'sale_invoice', v_sale, 'note', p_note),
          a.id, v_name);

  perform public.dawaa_cs_record_doctor_error_v1('transfer', v_ref, coalesce(i.branch, v_sale_branch),
    coalesce(i.invoice_day, (s.invoice_date at time zone 'Africa/Cairo')::date),
    case when i.serial is not null
         then 'تحويل · ' || i.store || ' · مسلسل ' || i.serial || coalesce(' · بيع ' || v_sale_branch || ' ' || v_sale, '')
         else 'تحويل · بيع ' || v_sale_branch || ' ' || v_sale || ' ملهوش شراء في ' || b.branch end,
    coalesce(i.net, s.net_amount),
    case when i.serial is not null then i.entered_by else coalesce(s.normalized_seller_name, s.seller_name) end,
    case when i.serial is not null then public.dawaa_cs_purchase_registrar_v1(i.branch, i.serial, i.entered_by)
         else coalesce(case when s.staff_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then s.staff_id::uuid end,
                       public.customer_request_resolve_staff_id_v1(coalesce(s.normalized_seller_name, s.seller_name))) end,
    v_problems, p_note, a.id, v_name);
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.dawaa_cs_transfer_check_save_v1(text, text, text, text, text[], text, text, date) from public, anon, authenticated;
grant execute on function public.dawaa_cs_transfer_check_save_v1(text, text, text, text, text[], text, text, date) to anon, authenticated;


-- تأكيد «مطابق» لبيع واحد اتسجل شراء على أكتر من فاتورة: كل فاتورة شراء بتتسجل على نفس فاتورة البيع.
create or replace function public.dawaa_cs_transfer_split_save_v1(p_purchases jsonb, p_sale_invoice text, p_note text default null)
returns jsonb language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  a public.staff_accounts := public.dawaa_cs_tasks_actor_v1(false);
  v_name text := coalesce(nullif(btrim(a.name), ''), a.username);
  v_day date := (now() at time zone 'Africa/Cairo')::date;
  v_sale text := nullif(btrim(p_sale_invoice), '');
  v_branch text;
  v_sale_branch text;
  b record;
  x jsonb;
  i public.purchase_review_invoices;
  v_keys text[] := '{}';
  v_ref text;
  v_before jsonb;
begin
  if v_sale is null or jsonb_typeof(p_purchases) <> 'array' or jsonb_array_length(p_purchases) < 2
     or jsonb_array_length(p_purchases) > 4 then
    raise exception 'pair_required';
  end if;
  for x in select * from jsonb_array_elements(p_purchases) loop
    select * into i from public.purchase_review_invoices where store = x->>'store' and serial = x->>'serial';
    if not found or not public.dawaa_cs_is_transfer_supplier_v1(i.branch, i.supplier_code, i.supplier_name) then
      raise exception 'unknown_invoice';
    end if;
    if v_branch is null then
      select * into b from public.dawaa_cs_morning_branch_v1(a.id, i.branch, v_day);
      v_branch := b.branch;
    end if;
    if i.branch <> v_branch then raise exception 'not_your_branch'; end if;
    v_keys := v_keys || (i.store || '|' || i.serial);
  end loop;
  v_sale_branch := public.dawaa_cs_other_branch_v1(v_branch);
  if not exists (select 1 from public.sales_invoices where branch = v_sale_branch and invoice_number = v_sale) then
    raise exception 'unknown_sale';
  end if;

  -- البيع ده كان متسجل لوحده أو مع فواتير شراء تانية: يتفك من هناك.
  delete from public.cs_transfer_checks
  where sale_branch = v_sale_branch and sale_invoice = v_sale
    and (purchase_serial is null or not ((purchase_store || '|' || purchase_serial) = any (v_keys)));
  delete from public.cs_purchase_doctor_errors
  where kind = 'transfer' and ref = 'sale|' || v_sale_branch || '|' || v_sale and decision = 'pending';

  for x in select * from jsonb_array_elements(p_purchases) loop
    select * into i from public.purchase_review_invoices where store = x->>'store' and serial = x->>'serial';
    v_ref := i.store || '|' || i.serial;
    select to_jsonb(c) into v_before from public.cs_transfer_checks c where c.purchase_store = i.store and c.purchase_serial = i.serial;
    insert into public.cs_transfer_checks as c (receiving_branch, purchase_store, purchase_serial, sale_branch, sale_invoice,
      status, problems, note, checked_by, checked_by_name, checked_at)
    values (v_branch, i.store, i.serial, v_sale_branch, v_sale, 'ok', '{}', nullif(btrim(p_note), ''), a.id, v_name, now())
    on conflict (purchase_store, purchase_serial) where purchase_serial is not null do update
      set sale_invoice = excluded.sale_invoice, status = 'ok', problems = '{}', note = excluded.note,
          checked_by = excluded.checked_by, checked_by_name = excluded.checked_by_name, checked_at = now();
    insert into public.cs_purchase_check_log (kind, ref, before, after, by_id, by_name)
    values ('transfer', v_ref, v_before,
            jsonb_build_object('status', 'ok', 'problems', '[]'::jsonb, 'sale_invoice', v_sale, 'note', p_note,
                               'split_with', to_jsonb(v_keys)),
            a.id, v_name);
    delete from public.cs_purchase_doctor_errors where kind = 'transfer' and ref = v_ref and decision = 'pending';
  end loop;
  return jsonb_build_object('ok', true, 'saved', array_length(v_keys, 1));
end;
$$;
revoke all on function public.dawaa_cs_transfer_split_save_v1(jsonb, text, text) from public, anon, authenticated;
grant execute on function public.dawaa_cs_transfer_split_save_v1(jsonb, text, text) to anon, authenticated;

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
                        where c.sale_branch = v_sale_branch and c.sale_invoice = s.invoice_number
                        order by c.purchase_serial nulls first limit 1))
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
                        where c.sale_branch = v_sale_branch and c.sale_invoice = s.invoice_number
                        order by c.purchase_serial nulls first limit 1))
             order by s.invoice_datetime), '[]'::jsonb)
      from public.sales_invoices s
      where s.branch = v_sale_branch and s.customer_code = v_code
        and s.invoice_date >= ((v_from - interval '6 hours')::date::timestamp at time zone 'UTC')
        and s.invoice_date < ((v_to::date + 1)::timestamp at time zone 'UTC'))
  );
end;
$$;

