-- «مراجعة المشتريات»: the ePlus purchase-invoice reports of the four stores, uploaded by top management.
-- فرع شكري = «الادارة فرع شكري» + «مخزن د.وائل»; فرع الشامي = «الفرعية الشامي» + «مخزن د معاذ».
-- Every credit (آجل) invoice is owed to its supplier until paid. Each supplier has its own billing month
-- (it starts on month_start_day) and is paid pay_after_days after that month closes. Cash (نقدى) invoices
-- were paid from the drawer. Excluded suppliers (دواء الشامي, دواء ابو العزم, any «جرد» supplier) are
-- transfers between our own stores or stock counts, not purchases.

create table if not exists public.purchase_review_uploads (
  id uuid primary key default gen_random_uuid(),
  store text not null,
  branch text not null check (branch in ('فرع شكري', 'فرع الشامي')),
  file_name text,
  first_day date not null,
  last_day date not null,
  invoices integer not null,
  net numeric(14, 3) not null,
  report_net numeric(14, 3),
  uploaded_by uuid not null,
  uploaded_at timestamptz not null default now()
);
alter table public.purchase_review_uploads enable row level security;
revoke all on public.purchase_review_uploads from public, anon, authenticated;

create table if not exists public.purchase_review_invoices (
  store text not null,
  serial text not null,
  branch text not null check (branch in ('فرع شكري', 'فرع الشامي')),
  payment text not null check (payment in ('credit', 'cash')),
  invoice_at timestamp not null,
  invoice_day date not null,
  supplier_code text not null,
  supplier_name text not null,
  supplier_invoice_no text,
  items integer not null default 0,
  gross numeric(14, 3) not null default 0,
  discount numeric(14, 3) not null default 0,
  expenses numeric(14, 3) not null default 0,
  tax numeric(14, 3) not null default 0,
  net numeric(14, 3) not null,
  entered_by text,
  note text,
  upload_id uuid not null references public.purchase_review_uploads (id) on delete cascade,
  primary key (store, serial)
);
create index if not exists purchase_review_invoices_day_idx on public.purchase_review_invoices (invoice_day);
create index if not exists purchase_review_invoices_supplier_idx
  on public.purchase_review_invoices (supplier_code, branch, invoice_day);
alter table public.purchase_review_invoices enable row level security;
revoke all on public.purchase_review_invoices from public, anon, authenticated;

create table if not exists public.purchase_review_supplier_terms (
  supplier_code text primary key,
  supplier_name text not null,
  month_start_day integer not null default 1 check (month_start_day between 1 and 28),
  pay_after_days integer not null default 0 check (pay_after_days between 0 and 120),
  excluded boolean not null default false,
  note text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.purchase_review_supplier_terms enable row level security;
revoke all on public.purchase_review_supplier_terms from public, anon, authenticated;

create table if not exists public.purchase_review_payments (
  id uuid primary key default gen_random_uuid(),
  supplier_code text not null,
  branch text not null check (branch in ('فرع شكري', 'فرع الشامي')),
  amount numeric(14, 2) not null check (amount <> 0),
  paid_on date not null,
  note text,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists purchase_review_payments_supplier_idx
  on public.purchase_review_payments (supplier_code, branch, paid_on);
alter table public.purchase_review_payments enable row level security;
revoke all on public.purchase_review_payments from public, anon, authenticated;

-- Billing months from «supplier_month_start» (per-branch days there agree, except سونيستا 15/16 → 15),
-- and the suppliers that are not purchases.
insert into public.purchase_review_supplier_terms (supplier_code, supplier_name, month_start_day, excluded)
values
  ('38', 'فارما اوفر سيز', 16, false),
  ('322', 'مخزن المدينة', 10, false),
  ('471', 'مخزن المعداوي', 15, false),
  ('309', 'مخزن سونيستا فارما', 15, false),
  ('208', 'مخزن الحياه', 1, false),
  ('290', 'الحياه اكسسوار', 15, false),
  ('295', 'كيان اكسسوار', 15, false),
  ('317', 'المدينة المنورة اكسسوار', 15, false),
  ('53', 'اتحاد الصيادله', 15, false),
  ('303', 'ايفا', 1, false),
  ('301', 'سوفيكو فارم', 1, false),
  ('399', 'شحن خارجي', 15, false),
  ('288', 'مورد متنوع', 15, false),
  ('197', 'د.حسين', 15, false),
  ('479', 'دواء زكريا', 17, false),
  ('320', 'احمد اسماعيل مستلزمات', 1, false),
  ('74', 'المتحدة  للتوزيع', 1, false),
  ('475', 'دواء الشامي', 1, true),
  ('300', 'دواء ابو العزم', 1, true),
  ('102', 'مورد جرد 27/12/2025', 1, true),
  ('57', 'جرد 17/5 د اميره', 1, true),
  ('362', 'جرد 25-5-2025', 1, true),
  ('302', 'مورد جررررد 5/7/2026', 1, true)
on conflict (supplier_code) do nothing;

-- Top management only, same as «مراجعتي اليومية».
create or replace function public.purchase_review_actor_v1()
returns uuid
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := public.dawaa_current_staff_account_id_strict();
begin
  if v_actor is null or not exists (
    select 1 from public.staff_accounts sa
    where sa.id = v_actor and sa.active is true and sa.can_login is true
      and lower(btrim(coalesce(sa.role, ''))) in ('general_manager', 'admin', 'executive_manager')
  ) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return v_actor;
end;
$function$;
revoke all on function public.purchase_review_actor_v1() from public, anon, authenticated;

-- One ePlus report of one store. It replaces that store's invoices between the report's first and last
-- day, so uploading a longer or newer report never double counts. New supplier codes get default terms;
-- a «جرد» supplier is excluded by default.
create or replace function public.import_purchase_review_file_v1(
  p_store text,
  p_branch text,
  p_file_name text,
  p_report_net numeric,
  p_invoices jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := public.purchase_review_actor_v1();
  v_upload uuid;
  v_first date;
  v_last date;
  v_count integer;
  v_net numeric;
  v_replaced integer;
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
         nullif(btrim(x->>'note'), '') note
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

  insert into public.purchase_review_supplier_terms (supplier_code, supplier_name, excluded)
  select distinct on (t.supplier_code) t.supplier_code, t.supplier_name, t.supplier_name ~ 'جر+د'
  from tmp_purchase_review t
  order by t.supplier_code, t.invoice_at desc
  on conflict (supplier_code) do nothing;

  return jsonb_build_object('upload_id', v_upload, 'first_day', v_first, 'last_day', v_last,
    'invoices', v_count, 'net', v_net, 'replaced', v_replaced);
end;
$function$;
revoke all on function public.import_purchase_review_file_v1(text, text, text, numeric, jsonb) from public, anon;
grant execute on function public.import_purchase_review_file_v1(text, text, text, numeric, jsonb) to authenticated;

-- Everything the page needs since p_from: invoices summed per day/store/supplier/payment (the page
-- works out months, billing windows, due dates and balances), the supplier terms, payments and uploads.
create or replace function public.get_purchase_review_v1(p_from date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_from date := coalesce(p_from, (date_trunc('month', now() at time zone 'Africa/Cairo') - interval '5 months')::date);
begin
  perform public.purchase_review_actor_v1();
  return jsonb_build_object(
    'today', (now() at time zone 'Africa/Cairo')::date,
    'from', v_from,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object('day', g.invoice_day, 'branch', g.branch, 'store', g.store,
               'payment', g.payment, 'supplier_code', g.supplier_code, 'invoices', g.n, 'net', g.net)
             order by g.invoice_day, g.store, g.supplier_code)
      from (select i.invoice_day, i.branch, i.store, i.payment, i.supplier_code, count(*) n, sum(i.net) net
            from public.purchase_review_invoices i
            where i.invoice_day >= v_from
            group by 1, 2, 3, 4, 5) g), '[]'::jsonb),
    'suppliers', coalesce((
      select jsonb_agg(jsonb_build_object('code', t.supplier_code, 'name', t.supplier_name,
               'month_start_day', t.month_start_day, 'pay_after_days', t.pay_after_days,
               'excluded', t.excluded, 'note', t.note) order by t.supplier_name)
      from public.purchase_review_supplier_terms t), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'supplier_code', p.supplier_code, 'branch', p.branch,
               'amount', p.amount, 'paid_on', p.paid_on, 'note', p.note,
               'by', coalesce(sa.name, sa.username)) order by p.paid_on, p.created_at)
      from public.purchase_review_payments p
      left join public.staff_accounts sa on sa.id = p.created_by), '[]'::jsonb),
    'uploads', coalesce((
      select jsonb_agg(u order by u.uploaded_at desc) from (
        select distinct on (x.store) x.store, x.branch, x.file_name, x.first_day, x.last_day, x.invoices,
               x.net, x.report_net, x.uploaded_at, coalesce(sa.name, sa.username) uploaded_by
        from public.purchase_review_uploads x
        left join public.staff_accounts sa on sa.id = x.uploaded_by
        order by x.store, x.uploaded_at desc) u), '[]'::jsonb)
  );
end;
$function$;
revoke all on function public.get_purchase_review_v1(date) from public, anon;
grant execute on function public.get_purchase_review_v1(date) to authenticated;

-- The invoices behind one supplier (or one day), for the drill-down.
create or replace function public.list_purchase_review_invoices_v1(
  p_from date,
  p_to date,
  p_supplier_code text default null,
  p_branch text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  perform public.purchase_review_actor_v1();
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('store', i.store, 'serial', i.serial, 'branch', i.branch,
             'payment', i.payment, 'invoice_at', i.invoice_at, 'supplier_code', i.supplier_code,
             'supplier_name', i.supplier_name, 'supplier_invoice_no', i.supplier_invoice_no, 'items', i.items,
             'gross', i.gross, 'discount', i.discount, 'net', i.net, 'entered_by', i.entered_by, 'note', i.note)
           order by i.invoice_at desc)
    from (select * from public.purchase_review_invoices i
          where i.invoice_day between p_from and p_to
            and (p_supplier_code is null or i.supplier_code = p_supplier_code)
            and (p_branch is null or i.branch = p_branch)
          order by i.invoice_at desc
          limit 1000) i), '[]'::jsonb);
end;
$function$;
revoke all on function public.list_purchase_review_invoices_v1(date, date, text, text) from public, anon;
grant execute on function public.list_purchase_review_invoices_v1(date, date, text, text) to authenticated;

create or replace function public.save_purchase_supplier_terms_v1(
  p_code text,
  p_month_start_day integer,
  p_pay_after_days integer,
  p_excluded boolean,
  p_note text
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := public.purchase_review_actor_v1();
begin
  update public.purchase_review_supplier_terms set
    month_start_day = p_month_start_day,
    pay_after_days = p_pay_after_days,
    excluded = coalesce(p_excluded, false),
    note = nullif(btrim(coalesce(p_note, '')), ''),
    updated_by = v_actor,
    updated_at = now()
  where supplier_code = p_code;
  if not found then
    raise exception 'unknown_supplier' using errcode = '22023';
  end if;
end;
$function$;
revoke all on function public.save_purchase_supplier_terms_v1(text, integer, integer, boolean, text) from public, anon;
grant execute on function public.save_purchase_supplier_terms_v1(text, integer, integer, boolean, text) to authenticated;

create or replace function public.add_purchase_review_payment_v1(
  p_supplier_code text,
  p_branch text,
  p_amount numeric,
  p_paid_on date,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := public.purchase_review_actor_v1();
  v_id uuid;
begin
  if not exists (select 1 from public.purchase_review_supplier_terms where supplier_code = p_supplier_code) then
    raise exception 'unknown_supplier' using errcode = '22023';
  end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 100000000 or p_paid_on is null
     or p_paid_on > (now() at time zone 'Africa/Cairo')::date + 1 then
    raise exception 'invalid_payment' using errcode = '22023';
  end if;
  insert into public.purchase_review_payments (supplier_code, branch, amount, paid_on, note, created_by)
  values (p_supplier_code, p_branch, round(p_amount, 2), p_paid_on, nullif(btrim(coalesce(p_note, '')), ''), v_actor)
  returning id into v_id;
  return v_id;
end;
$function$;
revoke all on function public.add_purchase_review_payment_v1(text, text, numeric, date, text) from public, anon;
grant execute on function public.add_purchase_review_payment_v1(text, text, numeric, date, text) to authenticated;

create or replace function public.delete_purchase_review_payment_v1(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  perform public.purchase_review_actor_v1();
  delete from public.purchase_review_payments where id = p_id;
end;
$function$;
revoke all on function public.delete_purchase_review_payment_v1(uuid) from public, anon;
grant execute on function public.delete_purchase_review_payment_v1(uuid) to authenticated;
