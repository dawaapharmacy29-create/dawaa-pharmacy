-- مراجعة الصبح لفريق خدمة العملاء (صاحب الصيدلية 2026-11-24):
--   ١) فواتير مشتريات امبارح من ٩ الصبح لـ ٩ الصبح لفرع كل واحدة بمخازنه (من ملفات «مراجعة المشتريات» اللي بتترفع يومياً):
--      تعتمدها، أو تعدّل المورد/المسلسل/رقم فاتورة المورد/المخزن/القيمة، أو تقول فيها مشكلة.
--   ٢) التحويلات: فاتورة شراء الفرع المستلم من مورد الفرع التاني (شكري ← «دواء الشامي» 475، الشامي ← «دواء ابو العزم» 300)
--      قصاد فاتورة بيع الفرع اللي بعت لعميل الفرع ده (الشامي ← كود 170 «فرع ابو العزم»، شكري ← كود 10 «دواء الشامي»).
--      الربط التلقائي في الصفحة؛ هنا بيتحفظ اللي البنت أكدته أو ربطته بإيدها.
--   ٣) العملاء اللي اتكتبوا في ملاحظات الفاتورة من غير كود (أغلبهم الشامي) بيدخلوا الشيت كمهمة «مش متكود».
-- أي مشكلة بتتسجل على اللي سجّل الفاتورة في cs_purchase_doctor_errors، والجدول ده للمدير العام بس:
-- الفريق بيشوف إنه قال «فيها مشكلة» بس، لا الخصم ولا تقرير الدكاترة. الخصم بيتعمل لما المدير يعتمده،
-- بنفس نقاط «دقة إدخال الفواتير» (purchase_invoice_review_points_v1).

create table if not exists public.cs_purchase_checks (
  store text not null,
  serial text not null,
  branch text not null,
  status text not null check (status in ('ok', 'fixed', 'problem')),
  problems text[] not null default '{}',
  fix jsonb not null default '{}'::jsonb,
  note text,
  checked_by uuid,
  checked_by_name text,
  checked_at timestamptz not null default now(),
  primary key (store, serial)
);

create table if not exists public.cs_transfer_checks (
  id uuid primary key default gen_random_uuid(),
  receiving_branch text not null,
  purchase_store text,
  purchase_serial text,
  sale_branch text not null,
  sale_invoice text,
  status text not null check (status in ('ok', 'problem')),
  problems text[] not null default '{}',
  note text,
  checked_by uuid,
  checked_by_name text,
  checked_at timestamptz not null default now(),
  check (purchase_serial is not null or sale_invoice is not null)
);
create unique index if not exists cs_transfer_checks_purchase_uq
  on public.cs_transfer_checks (purchase_store, purchase_serial) where purchase_serial is not null;
create unique index if not exists cs_transfer_checks_sale_uq
  on public.cs_transfer_checks (sale_branch, sale_invoice) where sale_invoice is not null;

-- كل حفظ بيتسجل هنا: القديم والجديد ومين وإمتى.
create table if not exists public.cs_purchase_check_log (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('purchase', 'transfer')),
  ref text not null,
  before jsonb,
  after jsonb,
  by_id uuid,
  by_name text,
  at timestamptz not null default now()
);
create index if not exists cs_purchase_check_log_ref_idx on public.cs_purchase_check_log (kind, ref, at desc);

create table if not exists public.cs_purchase_doctor_errors (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('purchase', 'transfer')),
  ref text not null,
  branch text,
  invoice_day date,
  invoice_label text,
  net numeric,
  responsible_name text,
  responsible_staff_id uuid,
  problems text[] not null default '{}',
  note text,
  reported_by uuid,
  reported_by_name text,
  reported_at timestamptz not null default now(),
  decision text not null default 'pending' check (decision in ('pending', 'deducted', 'dismissed')),
  outcome text,
  points numeric,
  decided_by uuid,
  decided_by_name text,
  decided_at timestamptz,
  decision_note text,
  unique (kind, ref)
);

alter table public.cs_purchase_checks enable row level security;
alter table public.cs_transfer_checks enable row level security;
alter table public.cs_purchase_check_log enable row level security;
alter table public.cs_purchase_doctor_errors enable row level security;
revoke all on table public.cs_purchase_checks, public.cs_transfer_checks, public.cs_purchase_check_log,
  public.cs_purchase_doctor_errors from public, anon, authenticated;

create index if not exists purchase_review_invoices_branch_at_idx
  on public.purchase_review_invoices (branch, invoice_at);

-- فرع اللي بتراجع: عضو الفريق بيراجع فرعه في الشهر ده (dawaa_cs_member_branch_v1)، والإدارة أو اللي ملوش فرع يختار.
create or replace function public.dawaa_cs_morning_branch_v1(p_actor uuid, p_branch text, p_day date,
  out branch text, out can_pick boolean)
language plpgsql stable security definer
set search_path = public, pg_catalog
as $$
declare
  v_home text;
  v_mgr boolean := coalesce(public.dawaa_current_actor_can(array['customer_service_daily_tasks_manage']), false);
begin
  select public.dawaa_cs_member_branch_v1(m, p_day) into v_home
  from public.customer_service_daily_task_settings s
  cross join lateral jsonb_array_elements(coalesce(s.members, '[]'::jsonb)) m
  where s.id = 1 and m->>'staff_account_id' = p_actor::text
  limit 1;
  can_pick := v_mgr or v_home is null;
  branch := case when can_pick and p_branch in ('فرع شكري', 'فرع الشامي') then p_branch
                 else coalesce(v_home, 'فرع شكري') end;
end;
$$;
revoke all on function public.dawaa_cs_morning_branch_v1(uuid, text, date) from public, anon, authenticated;

create or replace function public.dawaa_cs_other_branch_v1(p_branch text)
returns text language sql immutable set search_path = public, pg_catalog
as $$ select case p_branch when 'فرع شكري' then 'فرع الشامي' when 'فرع الشامي' then 'فرع شكري' end $$;
revoke all on function public.dawaa_cs_other_branch_v1(text) from public, anon, authenticated;

-- مورد التحويل في الفرع المستلم، وكود عميل الفرع ده في الفرع اللي بيبعت.
create or replace function public.dawaa_cs_is_transfer_supplier_v1(p_branch text, p_code text, p_name text)
returns boolean language sql immutable set search_path = public, pg_catalog
as $$
  select case p_branch
    when 'فرع شكري' then p_code = '475' or btrim(coalesce(p_name, '')) = 'دواء الشامي'
    when 'فرع الشامي' then p_code = '300' or btrim(coalesce(p_name, '')) = 'دواء ابو العزم'
    else false end
$$;
revoke all on function public.dawaa_cs_is_transfer_supplier_v1(text, text, text) from public, anon, authenticated;

create or replace function public.dawaa_cs_transfer_customer_code_v1(p_receiving_branch text)
returns text language sql immutable set search_path = public, pg_catalog
as $$ select case p_receiving_branch when 'فرع شكري' then '170' when 'فرع الشامي' then '10' end $$;
revoke all on function public.dawaa_cs_transfer_customer_code_v1(text) from public, anon, authenticated;

-- اللي سجّل الفاتورة: من تزامن Base44 لو موجود، وإلا من الاسم المكتوب في الملف.
create or replace function public.dawaa_cs_purchase_registrar_v1(p_branch text, p_serial text, p_name text)
returns uuid language sql stable security definer set search_path = public, pg_catalog
as $$
  select coalesce(
    (select b.entered_by_staff_id from public.base44_purchase_invoice_sync b
     where b.branch = p_branch and b.system_invoice_number = p_serial and b.entered_by_staff_id is not null
     order by b.synced_at desc limit 1),
    public.customer_request_resolve_staff_id_v1(p_name))
$$;
revoke all on function public.dawaa_cs_purchase_registrar_v1(text, text, text) from public, anon, authenticated;

-- مشكلة جديدة أو متعدلة بتتسجل للمدير؛ لو اتشالت المشكلة قبل ما المدير يقرر بتتمسح. اللي المدير قرر فيه مايتلمسش.
create or replace function public.dawaa_cs_record_doctor_error_v1(
  p_kind text, p_ref text, p_branch text, p_day date, p_label text, p_net numeric,
  p_name text, p_staff uuid, p_problems text[], p_note text, p_by uuid, p_by_name text)
returns void language plpgsql security definer set search_path = public, pg_catalog
as $$
begin
  if coalesce(array_length(p_problems, 1), 0) = 0 then
    delete from public.cs_purchase_doctor_errors where kind = p_kind and ref = p_ref and decision = 'pending';
    return;
  end if;
  insert into public.cs_purchase_doctor_errors as e
    (kind, ref, branch, invoice_day, invoice_label, net, responsible_name, responsible_staff_id, problems, note,
     reported_by, reported_by_name, reported_at)
  values (p_kind, p_ref, p_branch, p_day, p_label, p_net, nullif(btrim(p_name), ''), p_staff, p_problems,
          nullif(btrim(p_note), ''), p_by, p_by_name, now())
  on conflict (kind, ref) do update
    set problems = excluded.problems, note = excluded.note, net = excluded.net,
        responsible_name = excluded.responsible_name, responsible_staff_id = excluded.responsible_staff_id,
        reported_by = excluded.reported_by, reported_by_name = excluded.reported_by_name, reported_at = now()
    where e.decision = 'pending';
end;
$$;
revoke all on function public.dawaa_cs_record_doctor_error_v1(text, text, text, date, text, numeric, text, uuid, text[], text, uuid, text)
  from public, anon, authenticated;

-- ١) فواتير مشتريات امبارح.
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
      select coalesce(jsonb_agg(jsonb_build_object(
               'store', i.store, 'serial', i.serial, 'invoice_at', i.invoice_at, 'supplier_code', i.supplier_code,
               'supplier_name', i.supplier_name,
               'supplier_invoice_no', coalesce(nullif(btrim(i.supplier_invoice_no), ''),
                 (select nullif(btrim(x.supplier_invoice_number), '') from public.base44_purchase_invoice_sync x
                  where x.branch = i.branch and x.system_invoice_number = i.serial order by x.synced_at desc limit 1)),
               'items', i.items,
               'net', i.net, 'payment', i.payment, 'entered_by', i.entered_by, 'note', i.note,
               'check', case when c.serial is null then null else jsonb_build_object(
                 'status', c.status, 'problems', to_jsonb(c.problems), 'fix', c.fix, 'note', c.note,
                 'by', c.checked_by_name, 'at', c.checked_at) end)
             order by i.invoice_at, i.serial), '[]'::jsonb)
      from public.purchase_review_invoices i
      left join public.cs_purchase_checks c on c.store = i.store and c.serial = i.serial
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

create or replace function public.dawaa_cs_purchase_check_save_v1(
  p_store text, p_serial text, p_status text, p_problems text[], p_fix jsonb, p_note text, p_day date default null)
returns jsonb language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  a public.staff_accounts := public.dawaa_cs_tasks_actor_v1(false);
  v_name text := coalesce(nullif(btrim(a.name), ''), a.username);
  v_day date := coalesce(p_day, (now() at time zone 'Africa/Cairo')::date);
  b record;
  i public.purchase_review_invoices;
  v_before jsonb;
  v_problems text[] := coalesce(p_problems, '{}');
  v_fix jsonb := coalesce(p_fix, '{}'::jsonb);
begin
  if p_status not in ('ok', 'fixed', 'problem') then raise exception 'invalid_status'; end if;
  select * into i from public.purchase_review_invoices where store = p_store and serial = p_serial;
  if not found then raise exception 'unknown_invoice'; end if;
  select * into b from public.dawaa_cs_morning_branch_v1(a.id, i.branch, v_day);
  if b.branch <> i.branch then raise exception 'not_your_branch'; end if;
  if p_status = 'ok' then v_problems := '{}'; v_fix := '{}'::jsonb; end if;
  if p_status = 'fixed' and v_fix = '{}'::jsonb then raise exception 'empty_fix'; end if;
  if p_status = 'problem' and coalesce(array_length(v_problems, 1), 0) = 0 then raise exception 'no_problem'; end if;

  select to_jsonb(c) into v_before from public.cs_purchase_checks c where c.store = p_store and c.serial = p_serial;
  insert into public.cs_purchase_checks as c (store, serial, branch, status, problems, fix, note, checked_by, checked_by_name, checked_at)
  values (p_store, p_serial, i.branch, p_status, v_problems, v_fix, nullif(btrim(p_note), ''), a.id, v_name, now())
  on conflict (store, serial) do update
    set status = excluded.status, problems = excluded.problems, fix = excluded.fix, note = excluded.note,
        checked_by = excluded.checked_by, checked_by_name = excluded.checked_by_name, checked_at = now();
  insert into public.cs_purchase_check_log (kind, ref, before, after, by_id, by_name)
  values ('purchase', p_store || '|' || p_serial, v_before,
          jsonb_build_object('status', p_status, 'problems', to_jsonb(v_problems), 'fix', v_fix, 'note', p_note,
                             'invoice', jsonb_build_object('supplier', i.supplier_name, 'supplier_code', i.supplier_code,
                               'supplier_invoice_no', i.supplier_invoice_no, 'net', i.net)),
          a.id, v_name);

  perform public.dawaa_cs_record_doctor_error_v1('purchase', p_store || '|' || p_serial, i.branch, i.invoice_day,
    i.store || ' · مسلسل ' || i.serial || ' · ' || i.supplier_name, i.net, i.entered_by,
    public.dawaa_cs_purchase_registrar_v1(i.branch, i.serial, i.entered_by), v_problems, p_note, a.id, v_name);
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.dawaa_cs_purchase_check_save_v1(text, text, text, text[], jsonb, text, date) from public, anon, authenticated;
grant execute on function public.dawaa_cs_purchase_check_save_v1(text, text, text, text[], jsonb, text, date) to anon, authenticated;

-- ٢) التحويلات اللي دخلت فرعها امبارح، والبيع المقابل في الفرع التاني (بفسحة ٦ ساعات قبل الفترة).
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
               'items', (select coalesce(jsonb_agg(jsonb_build_object('name', it.product_name, 'qty', it.quantity,
                                   'total', it.line_total) order by it.line_no), '[]'::jsonb)
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
revoke all on function public.dawaa_cs_transfer_day_v1(date, text) from public, anon, authenticated;
grant execute on function public.dawaa_cs_transfer_day_v1(date, text) to anon, authenticated;

-- حفظ تحويل: فاتورة شراء (مع البيع اللي قصادها لو فيه) أو فاتورة بيع ملهاش شراء.
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
    select to_jsonb(c) into v_before from public.cs_transfer_checks c where c.sale_branch = v_sale_branch and c.sale_invoice = v_sale;
    if v_before ? 'purchase_serial' and v_before->>'purchase_serial' is not null then raise exception 'sale_already_paired'; end if;
    insert into public.cs_transfer_checks as c (receiving_branch, purchase_store, purchase_serial, sale_branch, sale_invoice,
      status, problems, note, checked_by, checked_by_name, checked_at)
    values (b.branch, null, null, v_sale_branch, v_sale, p_status, v_problems, nullif(btrim(p_note), ''), a.id, v_name, now())
    on conflict (sale_branch, sale_invoice) where sale_invoice is not null do update
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

-- تقرير أخطاء التسجيل: للمدير العام والتنفيذي بس (purchase_review_actor_v1).
create or replace function public.dawaa_cs_doctor_errors_v1(p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor uuid := public.purchase_review_actor_v1();
  v_to date := coalesce(p_to, (now() at time zone 'Africa/Cairo')::date);
  v_from date := coalesce(p_from, v_to - 30);
begin
  return jsonb_build_object(
    'from', v_from, 'to', v_to,
    'rows', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', e.id, 'kind', e.kind, 'branch', e.branch, 'day', e.invoice_day, 'label', e.invoice_label, 'net', e.net,
               'responsible', coalesce(st.name, e.responsible_name), 'responsible_staff_id', e.responsible_staff_id,
               'problems', to_jsonb(e.problems), 'note', e.note, 'reported_by', e.reported_by_name, 'reported_at', e.reported_at,
               'decision', e.decision, 'outcome', e.outcome, 'points', e.points, 'decided_by', e.decided_by_name,
               'decided_at', e.decided_at, 'decision_note', e.decision_note)
             order by e.invoice_day desc, e.reported_at desc), '[]'::jsonb)
      from public.cs_purchase_doctor_errors e
      left join public.staff st on st.id = e.responsible_staff_id
      where e.invoice_day between v_from and v_to),
    'staff', (
      select coalesce(jsonb_agg(jsonb_build_object('id', st.id, 'name', st.name, 'branch', st.branch) order by st.name), '[]'::jsonb)
      from public.staff st where coalesce(st.active, false))
  );
end;
$$;
revoke all on function public.dawaa_cs_doctor_errors_v1(date, date) from public, anon, authenticated;
grant execute on function public.dawaa_cs_doctor_errors_v1(date, date) to anon, authenticated;

-- قرار المدير: تجاهل، أو خصم بنقاط «دقة إدخال الفواتير» على اللي سجّل.
create or replace function public.dawaa_cs_doctor_error_decide_v1(p_id uuid, p_outcome text, p_staff_id uuid default null,
  p_note text default null)
returns jsonb language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor uuid := public.purchase_review_actor_v1();
  v_account public.staff_accounts;
  v_by text;
  e public.cs_purchase_doctor_errors;
  v_target public.staff;
  v_points numeric;
  v_label text;
  v_review public.purchase_invoice_entry_reviews;
  v_problem_labels text;
begin
  select * into v_account from public.staff_accounts where id = v_actor;
  v_by := coalesce(nullif(btrim(v_account.staff_name), ''), nullif(btrim(v_account.name), ''), v_account.username);
  select * into e from public.cs_purchase_doctor_errors where id = p_id for update;
  if not found then raise exception 'unknown_invoice'; end if;
  if e.decision <> 'pending' then raise exception 'already_decided'; end if;

  if p_outcome = 'dismissed' then
    update public.cs_purchase_doctor_errors
       set decision = 'dismissed', outcome = 'dismissed', decided_by = v_actor, decided_by_name = v_by, decided_at = now(),
           decision_note = nullif(btrim(p_note), '')
     where id = p_id;
    return jsonb_build_object('ok', true);
  end if;

  v_points := public.purchase_invoice_review_points_v1(p_outcome);
  if v_points is null or v_points >= 0 then raise exception 'invalid_outcome'; end if;
  select * into v_target from public.staff where id = coalesce(p_staff_id, e.responsible_staff_id) and coalesce(active, false);
  if not found then raise exception 'unknown_staff'; end if;

  v_label := case p_outcome
    when 'mixup_unregistered' then 'لغبطة أو عدم تسجيل فاتورة'
    when 'negligence' then 'إهمال في إدخال فاتورة'
    when 'customer_problem' then 'خطأ إدخال فاتورة سبب مشكلة مع عميل' end;
  v_problem_labels := array_to_string(e.problems, '، ');

  insert into public.purchase_invoice_entry_reviews (staff_id, branch, invoice_reference, outcome, points,
    reviewed_by_staff_id, reviewed_by_name, notes, review_date)
  values (v_target.id, coalesce(e.branch, v_target.branch), e.invoice_label, p_outcome, v_points,
    public.dawaa_current_staff_subject_uuid_v1(), v_by,
    nullif(btrim(concat_ws(' — ', e.note, nullif(btrim(p_note), ''))), ''), coalesce(e.invoice_day, current_date))
  returning * into v_review;

  insert into public.employee_transactions (
    staff_id, employee_id, employee_name, type, title, reason, amount, points, points_delta,
    source, source_id, transaction_date, created_at, description, month_cycle, branch,
    status, category, employee_visible, created_by)
  values (
    v_target.id, v_target.id, v_target.name, 'penalty', v_label, v_label, 0, abs(v_points), v_points,
    'purchase_invoice_entry_review', v_review.id, coalesce(e.invoice_day, current_date), now(),
    concat_ws(' — ', e.invoice_label, nullif(v_problem_labels, ''), nullif(btrim(p_note), '')),
    public.dawaa_current_points_cycle_label_v1(), v_review.branch, 'active', 'دقة إدخال الفواتير', true, v_by);

  update public.cs_purchase_doctor_errors
     set decision = 'deducted', outcome = p_outcome, points = v_points, responsible_staff_id = v_target.id,
         decided_by = v_actor, decided_by_name = v_by, decided_at = now(), decision_note = nullif(btrim(p_note), '')
   where id = p_id;
  return jsonb_build_object('ok', true, 'points', v_points);
end;
$$;
revoke all on function public.dawaa_cs_doctor_error_decide_v1(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.dawaa_cs_doctor_error_decide_v1(uuid, text, uuid, text) to anon, authenticated;

-- ٣) العملاء المكتوبين في ملاحظات فواتير امبارح من غير كود (كود فاضي أو 7): الاسم من الملاحظة والرقم المصري.
create or replace function public.dawaa_cs_note_customer_name_v1(p_note text, p_phone text)
returns text language sql immutable set search_path = public, pg_catalog
as $$
  select nullif(left(btrim(regexp_replace(
           regexp_replace(regexp_replace(t.part, '[0-9٠-٩+]+', ' ', 'g'),
             '(اسمها|اسمه|الاسم|اسم|الاستاذ|الأستاذ|استاذ|أستاذ|مدام)\s*[:：]?\s*', '', 'g'),
           '\s+', ' ', 'g')), 40), '')
  from regexp_split_to_table(replace(coalesce(p_note, ''), coalesce(p_phone, ''), '/'), '[/|،,\-–_]+') with ordinality as t(part, ord)
  where t.part ~ '[ء-ي]' and t.part !~ '(متكود|مكود|كود|بيقول|فرع)'
  order by t.ord
  limit 1
$$;
revoke all on function public.dawaa_cs_note_customer_name_v1(text, text) from public, anon, authenticated;

create or replace function public.dawaa_cs_uncoded_note_tasks_build_v1()
returns jsonb language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  a public.staff_accounts := public.dawaa_cs_tasks_actor_v1(false);
  v_day date := (now() at time zone 'Africa/Cairo')::date;
  v_y_from timestamptz := (v_day - 1)::timestamp at time zone 'Africa/Cairo';
  v_y_to timestamptz := v_day::timestamp at time zone 'Africa/Cairo';
  v_added integer := 0;
  r record;
  v_member text;
begin
  with n as (
    select distinct on (o.branch, p.ph) o.branch, p.ph, o.invoice_number, coalesce(o.net_amount, o.total_amount, 0) as net,
           coalesce(o.normalized_seller_name, o.seller_name) as seller, o.notes
    from public.sales_invoices o
    cross join lateral (select (regexp_match(regexp_replace(coalesce(o.notes, ''), '[\s\-]', '', 'g'), '(01[0125][0-9]{8})'))[1] as ph) p
    where o.branch in ('فرع شكري', 'فرع الشامي')
      and o.invoice_date >= v_y_from and o.invoice_date < v_y_to
      and coalesce(nullif(btrim(o.customer_code), ''), '7') = '7'
      and p.ph is not null
    order by o.branch, p.ph, o.invoice_date desc
  ), known as (
    -- أرقام متسجلة على كود حقيقي في أي فاتورة قبل كده (يعني العميل متكود، حتى لو في الفرع التاني).
    select distinct regexp_replace(coalesce(nullif(o2.whatsapp_phone, ''), nullif(o2.customer_phone, ''), o2.phone, ''), '\D', '', 'g') as ph
    from public.sales_invoices o2
    where nullif(btrim(o2.customer_code), '') is not null and btrim(o2.customer_code) <> '7'
  ), ins as (
    insert into public.customer_service_daily_queue_items
      (queue_date, branch, customer_key, customer_code, customer_name, customer_phone, source, priority, reason, status,
       created_by, created_by_name, metadata)
    select v_day, n.branch, 'p:' || n.ph, null,
           coalesce(public.dawaa_cs_note_customer_name_v1(n.notes, n.ph), 'عميل ' || n.ph), n.ph, 'uncoded_note', '2',
           'مش متكود: اتكتب في ملاحظة فاتورة ' || n.invoice_number || ' بـ ' || round(n.net) ||
             ' ج. كوّده على بي كونكت وسجّله على التليفون وابعت الترحيب',
           'not_started', a.id::text, coalesce(a.name, a.username),
           jsonb_build_object('invoice', n.invoice_number, 'value', round(n.net), 'seller', n.seller, 'note', n.notes)
    from n
    where not exists (
        select 1 from public.customers c
        where c.normalized_phone = n.ph or c.phone = n.ph or c.whatsapp_phone = n.ph or c.mobile = n.ph or c.customer_phone = n.ph)
      and not exists (select 1 from known k where k.ph = n.ph)
    on conflict (queue_date, branch, customer_key) do nothing
    returning id, branch
  )
  select count(*) into v_added from ins;

  -- التوزيع: على اللي ماسكة الفرع ده الشهر ده، وأقلهم مهام النهارده.
  for r in
    select q.id, q.branch from public.customer_service_daily_queue_items q
    where q.queue_date = v_day and q.source = 'uncoded_note' and q.assigned_staff_id is null
  loop
    select m.member into v_member
    from (
      select x->>'staff_account_id' as member, public.dawaa_cs_member_branch_v1(x, v_day) as home
      from public.customer_service_daily_task_settings s
      cross join lateral jsonb_array_elements(coalesce(s.members, '[]'::jsonb)) x
      where s.id = 1 and not coalesce((x->>'on_leave')::boolean, false) and nullif(x->>'staff_account_id', '') is not null
    ) m
    order by (m.home is not distinct from r.branch) desc,
             (select count(*) from public.customer_service_daily_queue_items z
              where z.queue_date = v_day and z.assigned_staff_id = m.member)
    limit 1;
    if v_member is not null then
      update public.customer_service_daily_queue_items set assigned_staff_id = v_member where id = r.id;
    end if;
  end loop;

  return jsonb_build_object('added', v_added);
end;
$$;
revoke all on function public.dawaa_cs_uncoded_note_tasks_build_v1() from public, anon, authenticated;
grant execute on function public.dawaa_cs_uncoded_note_tasks_build_v1() to anon, authenticated;
