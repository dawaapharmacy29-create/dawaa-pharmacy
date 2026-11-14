-- «مراجعة المشتريات» v2:
-- 1. track_from: the day we start following debts. Bills that fall due from that day on are owed; anything
--    due before it counts as settled. Payments count from that day.
-- 2. One invoice can be taken out of the debt (or put back), kept across re-uploads of the same file.
-- 3. Search invoices by serial, the supplier's own invoice number, or the supplier.
-- 4. Supplier payments from «التقارير المجمعة»: cash out of خزنة شكري / خزنة الشامي under «شركات» or
--    «مخازن» is a payment to the supplier its item is linked to, for that branch.

create table if not exists public.purchase_review_settings (
  id boolean primary key default true check (id),
  track_from date not null,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.purchase_review_settings enable row level security;
revoke all on public.purchase_review_settings from public, anon, authenticated;
insert into public.purchase_review_settings (id, track_from)
values (true, date_trunc('month', now() at time zone 'Africa/Cairo')::date)
on conflict (id) do nothing;

create table if not exists public.purchase_review_invoice_flags (
  store text not null,
  serial text not null,
  excluded boolean not null default true,
  note text,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (store, serial)
);
alter table public.purchase_review_invoice_flags enable row level security;
revoke all on public.purchase_review_invoice_flags from public, anon, authenticated;

create table if not exists public.purchase_review_treasury_links (
  category_name text primary key,
  supplier_code text,
  ignored boolean not null default false,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  check (not (ignored and supplier_code is not null))
);
alter table public.purchase_review_treasury_links enable row level security;
revoke all on public.purchase_review_treasury_links from public, anon, authenticated;

insert into public.purchase_review_treasury_links (category_name, supplier_code, ignored)
values
  ('فارما اوفر سيز', '38', false),
  ('مخزن المدينه', '322', false),
  ('مخزن المعداوى', '471', false),
  ('مخزن سونيستا', '309', false),
  ('مخزن الحياه', '208', false),
  ('كيان', '295', false),
  ('اتحاد الصيادله', '53', false),
  ('ايفا', '303', false),
  ('سوفيكو', '301', false),
  ('المتحده', '74', false),
  ('تحويل لفرع ابوالعزم', null, true),
  ('تصفية حساب فرع ابوالعزم', null, true),
  ('تصفية حساب فرع زكريا', null, true),
  ('تصفية حساب مع فرع زكريا', null, true),
  ('تصفية حساب مع فرع شكرى', null, true)
on conflict (category_name) do nothing;

-- Everything the page needs since p_from (or early enough to hold every bill due from track_from on).
create or replace function public.get_purchase_review_v1(p_from date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_track date := coalesce((select s.track_from from public.purchase_review_settings s where s.id), date_trunc('month', v_today)::date);
  v_from date := least(
    coalesce(p_from, (date_trunc('month', v_today) - interval '5 months')::date),
    v_track - 160);
begin
  perform public.purchase_review_actor_v1();
  return jsonb_build_object(
    'today', v_today,
    'from', v_from,
    'track_from', v_track,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object('day', g.invoice_day, 'branch', g.branch, 'store', g.store,
               'payment', g.payment, 'supplier_code', g.supplier_code, 'excluded', g.excluded,
               'invoices', g.n, 'net', g.net)
             order by g.invoice_day, g.store, g.supplier_code)
      from (select i.invoice_day, i.branch, i.store, i.payment, i.supplier_code,
                   coalesce(f.excluded, false) excluded, count(*) n, sum(i.net) net
            from public.purchase_review_invoices i
            left join public.purchase_review_invoice_flags f on f.store = i.store and f.serial = i.serial
            where i.invoice_day >= v_from
            group by 1, 2, 3, 4, 5, 6) g), '[]'::jsonb),
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
    'treasury', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.base44_id,
               'branch', case t.vault_code when 'shokry' then 'فرع شكري' else 'فرع الشامي' end,
               'category', btrim(t.category_name), 'amount', t.amount, 'day', t.tx_date,
               'description', t.description, 'by', t.created_by_name) order by t.tx_date, t.base44_id)
      from public.accountant_transactions t
      where t.vault_code in ('shokry', 'shamy') and t.direction = 'out'
        and t.classification in ('شركات', 'مخازن') and coalesce(t.is_offset_pair, false) = false
        and coalesce(btrim(t.category_name), '') <> '' and t.tx_date >= v_from), '[]'::jsonb),
    'links', coalesce((
      select jsonb_agg(jsonb_build_object('category', l.category_name, 'supplier_code', l.supplier_code,
               'ignored', l.ignored))
      from public.purchase_review_treasury_links l), '[]'::jsonb),
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

create or replace function public.save_purchase_review_track_from_v1(p_track_from date)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := public.purchase_review_actor_v1();
begin
  if p_track_from is null or p_track_from < date '2024-01-01'
     or p_track_from > (now() at time zone 'Africa/Cairo')::date then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  insert into public.purchase_review_settings (id, track_from, updated_by, updated_at)
  values (true, p_track_from, v_actor, now())
  on conflict (id) do update set track_from = excluded.track_from, updated_by = v_actor, updated_at = now();
end;
$function$;
revoke all on function public.save_purchase_review_track_from_v1(date) from public, anon;
grant execute on function public.save_purchase_review_track_from_v1(date) to authenticated;

-- Take one invoice out of the debt (p_excluded true) or put it back (false).
create or replace function public.set_purchase_invoice_excluded_v1(
  p_store text,
  p_serial text,
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
  if not exists (select 1 from public.purchase_review_invoices i where i.store = p_store and i.serial = p_serial) then
    raise exception 'unknown_invoice' using errcode = '22023';
  end if;
  if coalesce(p_excluded, false) then
    insert into public.purchase_review_invoice_flags (store, serial, excluded, note, updated_by, updated_at)
    values (p_store, p_serial, true, nullif(btrim(coalesce(p_note, '')), ''), v_actor, now())
    on conflict (store, serial) do update set excluded = true, note = excluded.note,
      updated_by = v_actor, updated_at = now();
  else
    delete from public.purchase_review_invoice_flags f where f.store = p_store and f.serial = p_serial;
  end if;
end;
$function$;
revoke all on function public.set_purchase_invoice_excluded_v1(text, text, boolean, text) from public, anon;
grant execute on function public.set_purchase_invoice_excluded_v1(text, text, boolean, text) to authenticated;

-- Link one treasury item to a supplier (p_supplier_code), mark it «not a supplier» (p_ignored), or clear it.
create or replace function public.link_purchase_treasury_item_v1(
  p_category text,
  p_supplier_code text,
  p_ignored boolean
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := public.purchase_review_actor_v1();
  v_code text := nullif(btrim(coalesce(p_supplier_code, '')), '');
begin
  if coalesce(btrim(p_category), '') = '' then
    raise exception 'invalid_store' using errcode = '22023';
  end if;
  if v_code is not null and not exists (
    select 1 from public.purchase_review_supplier_terms t where t.supplier_code = v_code) then
    raise exception 'unknown_supplier' using errcode = '22023';
  end if;
  if v_code is null and not coalesce(p_ignored, false) then
    delete from public.purchase_review_treasury_links l where l.category_name = btrim(p_category);
    return;
  end if;
  insert into public.purchase_review_treasury_links (category_name, supplier_code, ignored, updated_by, updated_at)
  values (btrim(p_category), v_code, v_code is null, v_actor, now())
  on conflict (category_name) do update set supplier_code = excluded.supplier_code, ignored = excluded.ignored,
    updated_by = v_actor, updated_at = now();
end;
$function$;
revoke all on function public.link_purchase_treasury_item_v1(text, text, boolean) from public, anon;
grant execute on function public.link_purchase_treasury_item_v1(text, text, boolean) to authenticated;

-- The drill-down, now with each invoice's exclusion.
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
             'gross', i.gross, 'discount', i.discount, 'net', i.net, 'entered_by', i.entered_by, 'note', i.note,
             'excluded', coalesce(f.excluded, false), 'excluded_note', f.note)
           order by i.invoice_at desc)
    from (select * from public.purchase_review_invoices i
          where i.invoice_day between p_from and p_to
            and (p_supplier_code is null or i.supplier_code = p_supplier_code)
            and (p_branch is null or i.branch = p_branch)
          order by i.invoice_at desc
          limit 1000) i
    left join public.purchase_review_invoice_flags f on f.store = i.store and f.serial = i.serial), '[]'::jsonb);
end;
$function$;

-- Search by our serial, the supplier's invoice number, or the supplier's name or code.
create or replace function public.search_purchase_review_invoices_v1(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_q text := btrim(coalesce(p_query, ''));
begin
  perform public.purchase_review_actor_v1();
  if length(v_q) < 2 then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('store', i.store, 'serial', i.serial, 'branch', i.branch,
             'payment', i.payment, 'invoice_at', i.invoice_at, 'supplier_code', i.supplier_code,
             'supplier_name', i.supplier_name, 'supplier_invoice_no', i.supplier_invoice_no, 'items', i.items,
             'gross', i.gross, 'discount', i.discount, 'net', i.net, 'entered_by', i.entered_by, 'note', i.note,
             'excluded', coalesce(f.excluded, false), 'excluded_note', f.note)
           order by i.invoice_at desc)
    from (select * from public.purchase_review_invoices i
          where i.serial = v_q or i.supplier_invoice_no ilike v_q || '%' or i.supplier_code = v_q
             or i.supplier_name ilike '%' || v_q || '%' or i.note ilike '%' || v_q || '%'
          order by i.invoice_at desc
          limit 150) i
    left join public.purchase_review_invoice_flags f on f.store = i.store and f.serial = i.serial), '[]'::jsonb);
end;
$function$;
revoke all on function public.search_purchase_review_invoices_v1(text) from public, anon;
grant execute on function public.search_purchase_review_invoices_v1(text) to authenticated;
