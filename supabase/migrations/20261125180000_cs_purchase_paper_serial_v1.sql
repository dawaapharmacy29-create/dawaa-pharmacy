-- فواتير المشتريات في مراجعة الصبح (صاحب الصيدلية 2026-11-25):
--   ١) الدكتور اللي بيدخل الفاتورة على بي كونكت لازم يكتب المسلسل بإيده على الفاتورة الورق. اللي بتراجع تقول لكل فاتورة:
--      «مكتوب» أو «مش مكتوب»، وده بيتحسب على اللي سجّل الفاتورة (تقرير للمدير العام: كل دكتور كتب كام ونسي كام).
--   ٢) ملحوظة مرتجعات على الفاتورة.
--   ٣) اعتماد جماعي لفواتير مختارة (مثلاً كل فواتير موظف معين)، ومعاه «المسلسل مكتوب/مش مكتوب» لو اتحدد.
--   ٤) بحث برقم الفاتورة (المسلسل أو رقم فاتورة المورد) أو اسم الدكتور أو المورد في آخر ٩٠ يوم.
-- المسلسل والمرتجعات في جدول لوحدهم عشان مايتلخبطوش مع حالة المراجعة (اعتماد/تعديل/مشكلة).

create table if not exists public.cs_purchase_marks (
  store text not null,
  serial text not null,
  branch text not null,
  invoice_day date,
  paper_serial text check (paper_serial in ('yes', 'no')),
  returns_note text,
  responsible_name text,
  responsible_staff_id uuid,
  updated_by uuid,
  updated_by_name text,
  updated_at timestamptz not null default now(),
  primary key (store, serial)
);
create index if not exists cs_purchase_marks_day_idx on public.cs_purchase_marks (invoice_day);
alter table public.cs_purchase_marks enable row level security;
revoke all on table public.cs_purchase_marks from public, anon, authenticated;

create index if not exists purchase_review_invoices_day_idx on public.purchase_review_invoices (invoice_day);

-- شكل الفاتورة الواحد في القايمة وفي البحث.
create or replace function public.dawaa_cs_purchase_invoice_json_v1(i public.purchase_review_invoices)
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'store', i.store, 'serial', i.serial, 'invoice_at', i.invoice_at, 'invoice_day', i.invoice_day,
    'branch', i.branch, 'supplier_code', i.supplier_code, 'supplier_name', i.supplier_name,
    'supplier_invoice_no', coalesce(nullif(btrim(i.supplier_invoice_no), ''),
      (select nullif(btrim(x.supplier_invoice_number), '') from public.base44_purchase_invoice_sync x
       where x.branch = i.branch and x.system_invoice_number = i.serial order by x.synced_at desc limit 1)),
    'items', i.items, 'net', i.net, 'payment', i.payment, 'entered_by', i.entered_by, 'note', i.note,
    'check', (select jsonb_build_object('status', c.status, 'problems', to_jsonb(c.problems), 'fix', c.fix,
                'note', c.note, 'by', c.checked_by_name, 'at', c.checked_at)
              from public.cs_purchase_checks c where c.store = i.store and c.serial = i.serial),
    'paper_serial', m.paper_serial, 'returns_note', m.returns_note)
  from (select 1) one
  left join public.cs_purchase_marks m on m.store = i.store and m.serial = i.serial
$$;
revoke all on function public.dawaa_cs_purchase_invoice_json_v1(public.purchase_review_invoices) from public, anon, authenticated;

-- نفس فواتير امبارح، ومعاها المسلسل على الورق والمرتجعات.
create or replace function public.dawaa_cs_purchase_day_v1(p_day date default null, p_branch text default null)
returns jsonb language plpgsql stable security definer
set search_path = public, pg_catalog
as $$
declare
  a public.staff_accounts := public.dawaa_cs_tasks_actor_v1(false);
  v_day date := coalesce(p_day, (now() at time zone 'Africa/Cairo')::date);
  v_from timestamp := (v_day - 1) + time '09:00';
  v_to timestamp := v_day + time '09:00';
  b record;
begin
  select * into b from public.dawaa_cs_morning_branch_v1(a.id, p_branch, v_day);
  return jsonb_build_object(
    'day', v_day, 'branch', b.branch, 'can_pick', b.can_pick, 'from', v_from, 'to', v_to,
    'uploads', (
      select coalesce(jsonb_agg(jsonb_build_object('store', u.store, 'uploaded_at', u.uploaded_at,
               'last_invoice_at', (select max(i.invoice_at) from public.purchase_review_invoices i where i.store = u.store))
             order by u.store), '[]'::jsonb)
      from (select distinct on (store) store, uploaded_at from public.purchase_review_uploads
            where branch = b.branch order by store, uploaded_at desc) u),
    'invoices', (
      select coalesce(jsonb_agg(public.dawaa_cs_purchase_invoice_json_v1(i) order by i.invoice_at, i.serial), '[]'::jsonb)
      from public.purchase_review_invoices i
      where i.branch = b.branch and i.invoice_at >= v_from and i.invoice_at < v_to
        and not public.dawaa_cs_is_transfer_supplier_v1(i.branch, i.supplier_code, i.supplier_name)),
    'suppliers', (
      select coalesce(jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name) order by s.name), '[]'::jsonb)
      from (select distinct on (supplier_code) supplier_code as code, supplier_name as name
            from public.purchase_review_invoices where invoice_day >= v_day - 180
            order by supplier_code, invoice_at desc) s)
  );
end;
$$;
revoke all on function public.dawaa_cs_purchase_day_v1(date, text) from public, anon, authenticated;
grant execute on function public.dawaa_cs_purchase_day_v1(date, text) to anon, authenticated;

-- البحث: رقم المسلسل أو رقم فاتورة المورد أو اسم اللي سجّل أو المورد، في فرعها، آخر ٩٠ يوم، أحدث ١٠٠.
create or replace function public.dawaa_cs_purchase_search_v1(p_q text, p_branch text default null)
returns jsonb language plpgsql stable security definer
set search_path = public, pg_catalog
as $$
declare
  a public.staff_accounts := public.dawaa_cs_tasks_actor_v1(false);
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_q text := btrim(coalesce(p_q, ''));
  v_digits text := translate(v_q, '٠١٢٣٤٥٦٧٨٩', '0123456789');
  b record;
begin
  select * into b from public.dawaa_cs_morning_branch_v1(a.id, p_branch, v_today);
  if length(v_q) < 2 then return '[]'::jsonb; end if;
  return (
    select coalesce(jsonb_agg(x.j order by x.at desc), '[]'::jsonb)
    from (
      select public.dawaa_cs_purchase_invoice_json_v1(i) as j, i.invoice_at as at
      from public.purchase_review_invoices i
      where i.branch = b.branch and i.invoice_day >= v_today - 90
        and not public.dawaa_cs_is_transfer_supplier_v1(i.branch, i.supplier_code, i.supplier_name)
        and (i.serial = v_digits
             or btrim(coalesce(i.supplier_invoice_no, '')) = v_digits
             or exists (select 1 from public.base44_purchase_invoice_sync x
                        where x.branch = i.branch and x.system_invoice_number = i.serial
                          and btrim(coalesce(x.supplier_invoice_number, '')) = v_digits)
             or i.entered_by ilike '%' || v_q || '%'
             or i.supplier_name ilike '%' || v_q || '%')
      order by i.invoice_at desc
      limit 100) x);
end;
$$;
revoke all on function public.dawaa_cs_purchase_search_v1(text, text) from public, anon, authenticated;
grant execute on function public.dawaa_cs_purchase_search_v1(text, text) to anon, authenticated;

-- المسلسل على الورق والمرتجعات، لفاتورة أو أكتر. كل صف: {store, serial, paper_serial?: yes|no|null, returns_note?}.
-- المفتاح اللي مش مبعوت مابيتغيرش.
create or replace function public.dawaa_cs_purchase_marks_save_v1(p_rows jsonb)
returns jsonb language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  a public.staff_accounts := public.dawaa_cs_tasks_actor_v1(false);
  v_name text := coalesce(nullif(btrim(a.name), ''), a.username);
  v_day date := (now() at time zone 'Africa/Cairo')::date;
  r jsonb;
  i public.purchase_review_invoices;
  b record;
  v_paper text;
  v_before jsonb;
  v_saved int := 0;
  v_skipped jsonb := '[]'::jsonb;
begin
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    select * into i from public.purchase_review_invoices where store = r->>'store' and serial = r->>'serial';
    if not found then
      v_skipped := v_skipped || jsonb_build_object('serial', r->>'serial', 'why', 'unknown_invoice');
      continue;
    end if;
    select * into b from public.dawaa_cs_morning_branch_v1(a.id, i.branch, v_day);
    if b.branch <> i.branch then
      v_skipped := v_skipped || jsonb_build_object('serial', i.serial, 'why', 'not_your_branch');
      continue;
    end if;
    v_paper := nullif(r->>'paper_serial', '');
    if v_paper is not null and v_paper not in ('yes', 'no') then raise exception 'invalid_paper_serial'; end if;

    select to_jsonb(m) into v_before from public.cs_purchase_marks m where m.store = i.store and m.serial = i.serial;
    insert into public.cs_purchase_marks as m (store, serial, branch, invoice_day, paper_serial, returns_note,
      responsible_name, responsible_staff_id, updated_by, updated_by_name, updated_at)
    values (i.store, i.serial, i.branch, i.invoice_day,
      case when r ? 'paper_serial' then v_paper end,
      case when r ? 'returns_note' then nullif(btrim(r->>'returns_note'), '') end,
      nullif(btrim(i.entered_by), ''), public.dawaa_cs_purchase_registrar_v1(i.branch, i.serial, i.entered_by),
      a.id, v_name, now())
    on conflict (store, serial) do update
      set paper_serial = case when r ? 'paper_serial' then v_paper else m.paper_serial end,
          returns_note = case when r ? 'returns_note' then nullif(btrim(r->>'returns_note'), '') else m.returns_note end,
          responsible_name = excluded.responsible_name, responsible_staff_id = excluded.responsible_staff_id,
          updated_by = excluded.updated_by, updated_by_name = excluded.updated_by_name, updated_at = now();
    insert into public.cs_purchase_check_log (kind, ref, before, after, by_id, by_name)
    values ('purchase', i.store || '|' || i.serial, v_before,
            jsonb_build_object('marks', r - 'store' - 'serial'), a.id, v_name);
    v_saved := v_saved + 1;
  end loop;
  return jsonb_build_object('saved', v_saved, 'skipped', v_skipped);
end;
$$;
revoke all on function public.dawaa_cs_purchase_marks_save_v1(jsonb) from public, anon, authenticated;
grant execute on function public.dawaa_cs_purchase_marks_save_v1(jsonb) to anon, authenticated;

-- اعتماد جماعي: الفواتير اللي لسه ماتراجعتش بس (المتعدلة أو اللي فيها مشكلة مابتتلمسش)، ومعاها المسلسل لو اتحدد.
create or replace function public.dawaa_cs_purchase_bulk_approve_v1(p_rows jsonb, p_paper_serial text default null)
returns jsonb language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  r jsonb;
  v_approved int := 0;
  v_kept int := 0;
  v_marks jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
begin
  perform public.dawaa_cs_tasks_actor_v1(false);
  if p_paper_serial is not null and p_paper_serial not in ('yes', 'no') then raise exception 'invalid_paper_serial'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    if exists (select 1 from public.cs_purchase_checks c
               where c.store = r->>'store' and c.serial = r->>'serial' and c.status <> 'ok') then
      v_kept := v_kept + 1;
    else
      begin
        perform public.dawaa_cs_purchase_check_save_v1(r->>'store', r->>'serial', 'ok', '{}', '{}'::jsonb, null, null);
        v_approved := v_approved + 1;
      exception when others then
        v_skipped := v_skipped || jsonb_build_object('serial', r->>'serial', 'why', sqlerrm);
        continue;
      end;
    end if;
    if p_paper_serial is not null then
      v_marks := v_marks || jsonb_build_object('store', r->>'store', 'serial', r->>'serial', 'paper_serial', p_paper_serial);
    end if;
  end loop;
  if jsonb_array_length(v_marks) > 0 then
    perform public.dawaa_cs_purchase_marks_save_v1(v_marks);
  end if;
  return jsonb_build_object('approved', v_approved, 'kept', v_kept, 'skipped', v_skipped);
end;
$$;
revoke all on function public.dawaa_cs_purchase_bulk_approve_v1(jsonb, text) from public, anon, authenticated;
grant execute on function public.dawaa_cs_purchase_bulk_approve_v1(jsonb, text) to anon, authenticated;

-- تقرير المدير العام: كل اللي سجّل فواتير مشتريات في الفترة، كام فاتورة، كام اتحدد فيها المسلسل، كتب كام ونسي كام،
-- والفواتير اللي نسيها. التحويلات مش داخلة (مش في مراجعة المسلسل).
create or replace function public.dawaa_cs_paper_serial_report_v1(p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor uuid := public.purchase_review_actor_v1();
  v_to date := coalesce(p_to, (now() at time zone 'Africa/Cairo')::date);
  v_from date := coalesce(p_from, v_to - 30);
begin
  return (
    with inv as (
      select i.store, i.serial, i.branch, i.invoice_day, i.supplier_name, i.net,
             coalesce(st.name, m.responsible_name, nullif(btrim(i.entered_by), ''), 'مش معروف') as who,
             m.paper_serial, m.returns_note, m.updated_by_name
      from public.purchase_review_invoices i
      left join public.cs_purchase_marks m on m.store = i.store and m.serial = i.serial
      left join public.staff st on st.id = m.responsible_staff_id
      where i.invoice_day between v_from and v_to
        and not public.dawaa_cs_is_transfer_supplier_v1(i.branch, i.supplier_code, i.supplier_name))
    select jsonb_build_object(
      'from', v_from, 'to', v_to,
      'people', coalesce((
        select jsonb_agg(jsonb_build_object('name', p.who, 'branches', p.branches, 'invoices', p.invoices,
                 'checked', p.checked, 'wrote', p.wrote, 'forgot', p.forgot)
               order by p.forgot desc, p.invoices desc)
        from (select who, string_agg(distinct branch, '، ') as branches, count(*) as invoices,
                     count(paper_serial) as checked, count(*) filter (where paper_serial = 'yes') as wrote,
                     count(*) filter (where paper_serial = 'no') as forgot
              from inv group by who) p), '[]'::jsonb),
      'forgotten', coalesce((
        select jsonb_agg(jsonb_build_object('store', f.store, 'serial', f.serial, 'branch', f.branch, 'day', f.invoice_day,
                 'supplier', f.supplier_name, 'net', f.net, 'who', f.who, 'by', f.updated_by_name)
               order by f.invoice_day desc, f.serial)
        from inv f where f.paper_serial = 'no'), '[]'::jsonb),
      'returns', coalesce((
        select jsonb_agg(jsonb_build_object('store', f.store, 'serial', f.serial, 'branch', f.branch, 'day', f.invoice_day,
                 'supplier', f.supplier_name, 'net', f.net, 'who', f.who, 'note', f.returns_note, 'by', f.updated_by_name)
               order by f.invoice_day desc, f.serial)
        from inv f where f.returns_note is not null), '[]'::jsonb))
    from (select 1) one);
end;
$$;
revoke all on function public.dawaa_cs_paper_serial_report_v1(date, date) from public, anon, authenticated;
grant execute on function public.dawaa_cs_paper_serial_report_v1(date, date) to anon, authenticated;
