-- رصيد المخازن (صاحب الصيدلية 2026-11-26): ملف «رصيد الأصناف في المخازن» من بي كونكت بيترفع كل يوم (بالتشغيلات والصلاحية
-- والتكلفة)، أو «رصيد الأصناف» (الكمية في كل مخزن بس). منه: قيمة المخزون في كل فرع (شكري مع د وائل، الشامي مع د معاذ،
-- ومخزن كل دكتور تبع فرعه)، الطلبيات المقترحة على احتياج الفرع وفي حدود الميزانية، الرواكد والأوفر ستوك، اللي قرب
-- يخلص تاريخه في ٦ شهور، مخزن الإكسبير، طلبات العملاء اللي صنفها اتوفر، والجرد المقترح. المبيعات من
-- inventory_sales_daily (بيع كل صنف في اليوم، من غير التحويلات لكود 170 و10، وبعد خصم المرتجع).

create table if not exists public.inventory_stock_uploads (
  id uuid primary key default gen_random_uuid(),
  snapshot_day date not null,
  file_name text,
  kind text not null check (kind in ('batches', 'summary')),
  status text not null default 'loading' check (status in ('loading', 'ready')),
  rows int not null default 0,
  uploaded_by uuid,
  uploaded_by_name text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.inventory_stock_batches (
  upload_id uuid not null references public.inventory_stock_uploads(id) on delete cascade,
  store text not null,
  branch text not null,
  store_kind text not null,
  product_code text not null,
  product_name text,
  company text,
  unit text,
  qty numeric not null default 0,
  cost numeric,
  price numeric,
  expiry date,
  purchase_day date,
  supplier text,
  location text
);
create index if not exists inventory_stock_batches_upload_idx on public.inventory_stock_batches (upload_id, branch, product_code);

-- آخر تكلفة وسعر معروفين لكل صنف، عشان ملف «رصيد الأصناف» (من غير تكلفة) يتحسب بقيمته.
create table if not exists public.inventory_product_costs (
  product_code text primary key,
  cost numeric,
  price numeric,
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_stock_daily (
  snapshot_day date not null,
  store text not null,
  branch text not null,
  store_kind text not null,
  items int not null,
  qty numeric not null,
  cost_value numeric not null,
  sale_value numeric not null,
  near_expiry_value numeric not null default 0,
  expired_value numeric not null default 0,
  upload_id uuid,
  primary key (snapshot_day, store)
);

alter table public.inventory_stock_uploads enable row level security;
alter table public.inventory_stock_batches enable row level security;
alter table public.inventory_product_costs enable row level security;
alter table public.inventory_stock_daily enable row level security;
revoke all on public.inventory_stock_uploads, public.inventory_stock_batches, public.inventory_product_costs,
  public.inventory_stock_daily from anon, authenticated;

create or replace function public.dawaa_inventory_store_branch_v1(p_store text)
returns text language sql immutable set search_path = public, pg_catalog as $$
  select case when p_store ~ 'شكري|وائل' then 'فرع شكري'
              when p_store ~ 'الشامي|معاذ' then 'فرع الشامي'
              else 'المكتب' end
$$;

create or replace function public.dawaa_inventory_store_kind_v1(p_store text)
returns text language sql immutable set search_path = public, pg_catalog as $$
  select case when p_store ~* 'اكسب|إكسب|اكسيب|expir' then 'expiry'
              when p_store ~ '(مخزن|^م\.)\s*د' then 'doctor'
              when p_store ~ 'المكتب' then 'office'
              else 'main' end
$$;

-- خدمات مش أصناف (توصيل منزلي، قياس سكر وضغط، nursing): مالهاش رصيد ولا طلبية.
create or replace function public.dawaa_inventory_is_service_v1(p_name text)
returns boolean language sql immutable set search_path = public, pg_catalog as $$
  select coalesce(p_name, '') ~* '^\s*(توصيل|قياس|خدم[ةه]|nursing|delivery)'
$$;

create or replace function public.dawaa_inventory_upload_begin_v1(p_day date, p_file_name text, p_kind text)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_actor uuid := public.purchase_review_actor_v1();
  v_id uuid;
begin
  if p_kind not in ('batches', 'summary') then raise exception 'inventory_invalid_kind'; end if;
  -- رفع ماكملش قبل كده بيتمسح.
  delete from public.inventory_stock_uploads where status = 'loading' and created_at < now() - interval '1 hour';
  insert into public.inventory_stock_uploads (snapshot_day, file_name, kind, uploaded_by, uploaded_by_name)
  values (coalesce(p_day, (now() at time zone 'Africa/Cairo')::date), p_file_name, p_kind, v_actor,
          (select coalesce(nullif(btrim(name), ''), username) from public.staff_accounts where id = v_actor))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.dawaa_inventory_upload_rows_v1(p_upload uuid, p_rows jsonb)
returns int language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_actor uuid := public.purchase_review_actor_v1();
  v_n int;
begin
  if not exists (select 1 from public.inventory_stock_uploads where id = p_upload and status = 'loading') then
    raise exception 'inventory_upload_closed';
  end if;
  insert into public.inventory_stock_batches
    (upload_id, store, branch, store_kind, product_code, product_name, company, unit, qty, cost, price, expiry,
     purchase_day, supplier, location)
  select p_upload, btrim(x->>'s'), public.dawaa_inventory_store_branch_v1(x->>'s'), public.dawaa_inventory_store_kind_v1(x->>'s'),
         btrim(x->>'c'), nullif(btrim(x->>'n'), ''), nullif(btrim(x->>'co'), ''), nullif(btrim(x->>'u'), ''),
         coalesce(nullif(x->>'q', '')::numeric, 0), nullif(x->>'k', '')::numeric, nullif(x->>'p', '')::numeric,
         nullif(x->>'e', '')::date, nullif(x->>'b', '')::date, nullif(btrim(x->>'sp'), ''), nullif(btrim(x->>'l'), '')
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x
  where nullif(btrim(x->>'c'), '') is not null and nullif(btrim(x->>'s'), '') is not null;
  get diagnostics v_n = row_count;
  update public.inventory_stock_uploads set rows = rows + v_n where id = p_upload;
  return v_n;
end;
$$;

create or replace function public.dawaa_inventory_upload_finish_v1(p_upload uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_actor uuid := public.purchase_review_actor_v1();
  u public.inventory_stock_uploads;
  v_horizon date;
begin
  select * into u from public.inventory_stock_uploads where id = p_upload and status = 'loading' for update;
  if not found then raise exception 'inventory_upload_closed'; end if;
  if u.rows = 0 then raise exception 'inventory_upload_empty'; end if;
  v_horizon := u.snapshot_day + 180;

  if u.kind = 'batches' then
    -- التكلفة والسعر من أحدث شراء للصنف.
    insert into public.inventory_product_costs (product_code, cost, price, updated_at)
    select distinct on (product_code) product_code, cost, price, now()
    from public.inventory_stock_batches
    where upload_id = p_upload and coalesce(cost, 0) > 0
    order by product_code, purchase_day desc nulls last, cost desc
    on conflict (product_code) do update set cost = excluded.cost,
      price = coalesce(excluded.price, inventory_product_costs.price), updated_at = now();
  else
    update public.inventory_stock_batches b
       set cost = coalesce(b.cost, c.cost), price = coalesce(b.price, c.price)
      from public.inventory_product_costs c
     where b.upload_id = p_upload and c.product_code = b.product_code;
  end if;

  delete from public.inventory_stock_daily where snapshot_day = u.snapshot_day;
  insert into public.inventory_stock_daily
    (snapshot_day, store, branch, store_kind, items, qty, cost_value, sale_value, near_expiry_value, expired_value, upload_id)
  select u.snapshot_day, store, max(branch), max(store_kind),
         count(distinct product_code) filter (where qty > 0), coalesce(sum(qty) filter (where qty > 0), 0),
         coalesce(sum(qty * coalesce(cost, 0)) filter (where qty > 0), 0),
         coalesce(sum(qty * coalesce(price, 0)) filter (where qty > 0), 0),
         coalesce(sum(qty * coalesce(cost, 0)) filter (where qty > 0 and expiry >= u.snapshot_day and expiry <= v_horizon), 0),
         coalesce(sum(qty * coalesce(cost, 0)) filter (where qty > 0 and expiry < u.snapshot_day), 0),
         p_upload
  from public.inventory_stock_batches where upload_id = p_upload group by store;

  update public.inventory_stock_uploads set status = 'ready', finished_at = now() where id = p_upload;

  -- بنسيب آخر رفع من كل نوع بس (الملخص اليومي بيفضل للتاريخ).
  delete from public.inventory_stock_uploads x
   where x.status = 'ready' and x.id <> p_upload
     and x.id not in (select distinct on (kind) id from public.inventory_stock_uploads where status = 'ready'
                      order by kind, snapshot_day desc, created_at desc);

  return (select jsonb_build_object('rows', u.rows, 'day', u.snapshot_day,
                 'stores', coalesce(jsonb_agg(jsonb_build_object('store', store, 'value', round(cost_value)) order by store), '[]'::jsonb))
          from public.inventory_stock_daily where snapshot_day = u.snapshot_day);
end;
$$;

-- النسخة اللي التحليل شغال عليها: آخر رفع جاهز، وللصلاحية آخر رفع بالتشغيلات.
create or replace function public.dawaa_inventory_current_upload_v1(p_need_batches boolean default false)
returns uuid language sql stable security definer set search_path = public, pg_catalog as $$
  select id from public.inventory_stock_uploads
  where status = 'ready' and (not p_need_batches or kind = 'batches')
  order by snapshot_day desc, created_at desc limit 1
$$;

create or replace function public.dawaa_inventory_norm_name_v1(p text)
returns text language sql immutable set search_path = public, pg_catalog as $$
  select btrim(regexp_replace(regexp_replace(lower(coalesce(p, '')), '[^a-z0-9؀-ۿ]+', ' ', 'g'), '\s+', ' ', 'g'))
$$;

-- اسم الصنف من غير عدد العبوة ("colona 30 tab" و"colona 40 tab" ← "colona")، عشان الأصناف اللي ليها أكتر من علبة.
create or replace function public.dawaa_inventory_pack_base_v1(p text)
returns text language sql immutable set search_path = public, pg_catalog as $$
  select btrim(regexp_replace(public.dawaa_inventory_norm_name_v1(p),
    '\s\d+\s*(f\s?c\s?)?(tabs?|tablets?|caps?|capsules?|sachets?|amps?|ampoules?|vials?|supp|suppositor\w*|eff\w*|lozenges?|strips?|pcs|pieces?|pads?|diapers?|sticks?)\M.*$',
    ''))
$$;

-- بيع كل صنف في اليوم (من sales_invoice_items_v21، من غير التحويلات وبعد المرتجع، ومن غير السطور اللي اتقرت غلط وقيمتها
-- أكبر من صافي الفاتورة). جدول السطور تقيل (فيه البيانات الخام)، فبيتحسب هنا مرة: كل ساعة لآخر ٥ أيام، وبالليل لآخر ١٠٠ يوم.
create table if not exists public.inventory_sales_daily (
  day date not null,
  branch text not null,
  code text not null,
  name text,
  qty numeric not null,
  value numeric not null,
  invoices int not null,
  primary key (day, branch, code)
);
alter table public.inventory_sales_daily enable row level security;
revoke all on public.inventory_sales_daily from anon, authenticated;

create or replace function public.dawaa_inventory_sales_rebuild_v1(p_from date)
returns int language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_n int;
begin
  delete from public.inventory_sales_daily where day >= p_from;
  insert into public.inventory_sales_daily (day, branch, code, name, qty, value, invoices)
  with si as (
    select s.branch, s.invoice_number, max(s.net_amount) net from public.sales_invoices s
    where s.invoice_date >= ((p_from - 2)::timestamp at time zone 'UTC') and s.branch in ('فرع شكري', 'فرع الشامي')
    group by 1, 2)
  select (i.invoice_date at time zone 'UTC')::date, i.branch, btrim(i.product_code), max(i.product_name),
         sum(i.quantity - coalesce(nullif(i.raw_data->>'returned_quantity', '')::numeric, 0)),
         coalesce(sum(i.line_total), 0), count(distinct i.invoice_number)
  from public.sales_invoice_items_v21 i
  left join si on si.invoice_number = i.invoice_number and si.branch = i.branch
  where i.invoice_date >= (p_from::timestamp at time zone 'UTC')
    and i.branch in ('فرع شكري', 'فرع الشامي')
    and btrim(coalesce(i.customer_code, '')) not in ('170', '10')
    and nullif(btrim(coalesce(i.product_code, '')), '') is not null
    and not public.dawaa_inventory_is_service_v1(i.product_name)
    and (si.net is null or coalesce(i.line_total, 0) <= greatest(si.net, 0) * 1.3 + 50)
  group by 1, 2, 3;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.dawaa_inventory_sales_rebuild_v1(date) from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname in ('dawaa_inventory_sales_hourly', 'dawaa_inventory_sales_nightly');
select cron.schedule('dawaa_inventory_sales_hourly', '20 * * * *',
  $c$select public.dawaa_inventory_sales_rebuild_v1(((now() at time zone 'Africa/Cairo')::date - 5))$c$);
select cron.schedule('dawaa_inventory_sales_nightly', '30 1 * * *',
  $c$select public.dawaa_inventory_sales_rebuild_v1(((now() at time zone 'Africa/Cairo')::date - 100))$c$);

create or replace function public.dawaa_inventory_overview_v1(
  p_branch text default null, p_budget numeric default null, p_cover_days int default 21)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_actor uuid := public.purchase_review_actor_v1();
  v_up uuid := public.dawaa_inventory_current_upload_v1(false);
  v_bup uuid := public.dawaa_inventory_current_upload_v1(true);
  u public.inventory_stock_uploads;
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_cover int := greatest(7, least(coalesce(p_cover_days, 21), 90));
  v_out jsonb;
begin
  if v_up is null then return jsonb_build_object('empty', true); end if;
  select * into u from public.inventory_stock_uploads where id = v_up;

  -- الرصيد لكل فرع وصنف: «للبيع» = المخزن الرئيسي ومخزن الدكتور، والإكسبير لوحده.
  create temporary table inv_bp on commit drop as
    select b.branch, b.product_code code, max(b.product_name) name, max(b.company) company, max(b.unit) unit,
           coalesce(sum(b.qty) filter (where b.store_kind in ('main', 'doctor')), 0) qty,
           coalesce(sum(b.qty) filter (where b.store_kind = 'doctor'), 0) doctor_qty,
           coalesce(sum(b.qty) filter (where b.store_kind = 'expiry'), 0) exp_qty,
           coalesce(sum(b.qty * coalesce(b.cost, 0)) filter (where b.store_kind in ('main', 'doctor') and b.qty > 0), 0) value,
           coalesce(max(b.cost) filter (where b.qty > 0), max(c.cost)) cost,
           coalesce(max(b.price), max(c.price)) price,
           max(b.purchase_day) last_buy
    from public.inventory_stock_batches b
    left join public.inventory_product_costs c on c.product_code = b.product_code
    where b.upload_id = v_up and b.branch in ('فرع شكري', 'فرع الشامي')
    group by 1, 2;

  -- البيع آخر ٩٠ يوم (من غير التحويلات وبعد المرتجع).
  create temporary table inv_v on commit drop as
    select d.branch, d.code, max(d.name) name, sum(d.qty) q90,
           coalesce(sum(d.qty) filter (where d.day >= v_today - 30), 0) q30,
           coalesce(sum(d.value) filter (where d.day >= v_today - 14), 0) v30,
           coalesce(sum(d.value) filter (where d.day < v_today - 14 and d.day >= v_today - 28), 0) vprev30,
           sum(d.invoices) n90,
           sum(d.value) / nullif(sum(d.qty), 0) avg_price,
           0::bigint c90,
           max(d.day) last_sale
    from public.inventory_sales_daily d
    where d.day >= v_today - 90
    group by 1, 2;
  alter table inv_v add column rate numeric;
  update inv_v set rate = greatest(0, 0.6 * q30 / 30.0 + 0.4 * q90 / 90.0);
  create index on inv_v (code, branch);
  analyze inv_v;
  analyze inv_bp;

  -- طلبات العملاء المفتوحة بأصنافها اللي ليها كود.
  create temporary table inv_req on commit drop as
    select g.fingerprint, g.branch, g.customer_code, coalesce(g.customer_name, '') customer_name, g.customer_phone,
           g.request_day, g.status, btrim(x->>'code') code, x->>'name' item, nullif(x->>'qty', '')::numeric qty
    from public.customer_request_group_log_v1 g
    cross join lateral jsonb_array_elements(case when jsonb_typeof(g.items) = 'array' then g.items else '[]'::jsonb end) x
    where g.status in ('new', 'sourcing') and g.request_day >= v_today - 60 and nullif(btrim(x->>'code'), '') is not null;

  create temporary table inv_all on commit drop as
    select coalesce(s.branch, v.branch) branch, coalesce(s.code, v.code) code, coalesce(s.name, v.name) name, s.company,
           coalesce(s.qty, 0) qty, coalesce(s.doctor_qty, 0) doctor_qty, coalesce(s.exp_qty, 0) exp_qty,
           coalesce(s.value, 0) value, coalesce(s.cost, c.cost) cost, coalesce(s.price, c.price, v.avg_price) price, s.last_buy,
           coalesce(v.q90, 0) q90, coalesce(v.q30, 0) q30, coalesce(v.n90, 0) n90, coalesce(v.c90, 0) c90,
           coalesce(v.rate, 0) rate, v.last_sale, coalesce(v.v30, 0) v30, coalesce(v.vprev30, 0) vprev30,
           0::int requests
    from inv_bp s
    full join inv_v v on v.branch = s.branch and v.code = s.code
    left join public.inventory_product_costs c on c.product_code = coalesce(s.code, v.code);
  create index on inv_all (code, branch);
  update inv_all a set requests = r.n
    from (select branch, code, count(distinct fingerprint) n from inv_req group by 1, 2) r
   where r.branch = a.branch and r.code = a.code;
  analyze inv_all;

  v_out := jsonb_build_object(
    'upload', jsonb_build_object('day', u.snapshot_day, 'kind', u.kind, 'file', u.file_name, 'by', u.uploaded_by_name,
                                 'at', u.finished_at, 'rows', u.rows,
                                 'batches_day', (select snapshot_day from public.inventory_stock_uploads where id = v_bup)),
    'cover_days', v_cover, 'budget', p_budget,

    'stores', (select coalesce(jsonb_agg(jsonb_build_object('store', store, 'branch', branch, 'kind', store_kind,
                       'items', items, 'qty', round(qty), 'value', round(cost_value), 'sale_value', round(sale_value),
                       'near_expiry', round(near_expiry_value), 'expired', round(expired_value)) order by branch, store_kind, store), '[]'::jsonb)
               from public.inventory_stock_daily
               where snapshot_day = u.snapshot_day and (p_branch is null or branch = p_branch)),

    'trend', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'branch', branch, 'value', round(v), 'expiry', round(e)) order by d, branch), '[]'::jsonb)
              from (select snapshot_day d, branch, coalesce(sum(cost_value) filter (where store_kind <> 'expiry'), 0) v,
                           coalesce(sum(cost_value) filter (where store_kind = 'expiry'), 0) e
                    from public.inventory_stock_daily
                    where snapshot_day >= u.snapshot_day - 90 and branch in ('فرع شكري', 'فرع الشامي')
                      and (p_branch is null or branch = p_branch)
                    group by 1, 2) t),

    'branches', (select coalesce(jsonb_agg(jsonb_build_object(
                    'branch', branch, 'items', items, 'value', value, 'sale_value', sale_value,
                    'sold_value_30', sold_value_30, 'sold_value_prev30', sold_value_prev30, 'cogs_30', cogs_30,
                    'dead_value', dead_value, 'dead_items', dead_items, 'over_value', over_value,
                    'out_of_stock', out_of_stock, 'negative', negative) order by branch), '[]'::jsonb)
                 from (select a.branch,
                    count(*) filter (where a.qty > 0) items,
                    round(sum(a.value)) value,
                    round(sum(greatest(a.qty, 0) * coalesce(a.price, 0))) sale_value,
                    round(sum(a.v30)) sold_value_30,
                    round(sum(a.vprev30)) sold_value_prev30,
                    round(sum(greatest(a.q30, 0) * coalesce(a.cost, 0))) cogs_30,
                    coalesce(round(sum(a.value) filter (where a.qty > 0 and a.q90 <= 0 and coalesce(a.last_buy, '2000-01-01') < u.snapshot_day - 30)), 0) dead_value,
                    count(*) filter (where a.qty > 0 and a.q90 <= 0 and coalesce(a.last_buy, '2000-01-01') < u.snapshot_day - 30) dead_items,
                    coalesce(round(sum(greatest(a.qty - a.rate * 60, 0) * coalesce(a.cost, 0)) filter (where a.rate > 0 and a.qty / a.rate > 120)), 0) over_value,
                    count(*) filter (where a.qty <= 0 and a.n90 >= 3) out_of_stock,
                    count(*) filter (where a.qty < 0) negative
                 from inv_all a where p_branch is null or a.branch = p_branch
                 group by a.branch) t)
  );

  -- قرب الانتهاء (٦ شهور) والمنتهي في المخزن الرئيسي ومخزن الدكتور: هيتباع قبل ما يخلص ولا لأ.
  v_out := v_out || jsonb_build_object('near_expiry', (
    select coalesce(jsonb_agg(t order by (t->>'expiry'), (t->>'risk_value')::numeric desc), '[]'::jsonb) from (
      select jsonb_build_object('branch', b.branch, 'store', b.store, 'code', b.product_code, 'name', b.product_name,
               'qty', b.qty, 'expiry', b.expiry, 'days', b.expiry - v_today, 'cost', b.cost, 'value', round(b.qty * coalesce(b.cost, 0)),
               'supplier', b.supplier, 'location', b.location, 'rate30', round(coalesce(v.rate, 0) * 30, 1),
               'risk_qty', round(greatest(b.qty - coalesce(v.rate, 0) * greatest(b.expiry - v_today - 30, 0), 0), 1),
               'risk_value', round(greatest(b.qty - coalesce(v.rate, 0) * greatest(b.expiry - v_today - 30, 0), 0) * coalesce(b.cost, 0)),
               'other_rate30', round(coalesce(o.rate, 0) * 30, 1)) t
      from public.inventory_stock_batches b
      left join inv_v v on v.branch = b.branch and v.code = b.product_code
      left join inv_v o on o.branch <> b.branch and o.code = b.product_code
      where b.upload_id = v_bup and b.store_kind in ('main', 'doctor') and b.qty > 0
        and b.expiry is not null and b.expiry <= v_today + 180
        and b.branch in ('فرع شكري', 'فرع الشامي') and (p_branch is null or b.branch = p_branch)
      order by b.expiry, b.qty * coalesce(b.cost, 0) desc
      limit 400) z));

  -- مخزن الإكسبير: اللي فيه ولمين يرجع.
  v_out := v_out || jsonb_build_object('expiry_store', (
    select coalesce(jsonb_agg(t order by (t->>'value')::numeric desc), '[]'::jsonb) from (
      select jsonb_build_object('branch', b.branch, 'store', b.store, 'code', b.product_code, 'name', max(b.product_name),
               'qty', sum(b.qty), 'value', round(sum(b.qty * coalesce(b.cost, 0))), 'expiry', min(b.expiry),
               'supplier', string_agg(distinct b.supplier, '، ')) t
      from public.inventory_stock_batches b
      where b.upload_id = v_up and b.store_kind = 'expiry' and b.qty > 0 and (p_branch is null or b.branch = p_branch)
      group by b.branch, b.store, b.product_code
      order by sum(b.qty * coalesce(b.cost, 0)) desc
      limit 300) z));

  -- الرواكد: عليه رصيد ومااتباعش ولا مرة في ٩٠ يوم (ومش داخل جديد آخر ٣٠ يوم). لو الفرع التاني بيبيعه ← حوّله.
  v_out := v_out || jsonb_build_object('dead', (
    select coalesce(jsonb_agg(t order by (t->>'value')::numeric desc), '[]'::jsonb) from (
      select jsonb_build_object('branch', a.branch, 'code', a.code, 'name', a.name, 'company', a.company, 'qty', a.qty,
               'value', round(a.value), 'last_buy', a.last_buy, 'last_sale', a.last_sale,
               'other_rate30', round(coalesce(o.rate, 0) * 30, 1), 'other_qty', coalesce(o.qty, 0)) t
      from inv_all a
      left join inv_all o on o.code = a.code and o.branch <> a.branch
      where a.qty > 0 and a.q90 <= 0 and coalesce(a.last_buy, '2000-01-01') < u.snapshot_day - 30
        and (p_branch is null or a.branch = p_branch)
      order by a.value desc
      limit 400) z));

  -- الأوفر ستوك: الرصيد بيكفي أكتر من ٤ شهور؛ الزيادة = اللي فوق شهرين.
  v_out := v_out || jsonb_build_object('overstock', (
    select coalesce(jsonb_agg(t order by (t->>'excess_value')::numeric desc), '[]'::jsonb) from (
      select jsonb_build_object('branch', a.branch, 'code', a.code, 'name', a.name, 'qty', a.qty, 'rate30', round(a.rate * 30, 1),
               'cover_days', round(a.qty / a.rate), 'excess_qty', round(a.qty - a.rate * 60, 1),
               'excess_value', round((a.qty - a.rate * 60) * coalesce(a.cost, 0)), 'value', round(a.value),
               'other_rate30', round(coalesce(o.rate, 0) * 30, 1), 'other_qty', coalesce(o.qty, 0)) t
      from inv_all a
      left join inv_all o on o.code = a.code and o.branch <> a.branch
      where a.rate > 0 and a.qty / a.rate > 120 and (p_branch is null or a.branch = p_branch)
      order by (a.qty - a.rate * 60) * coalesce(a.cost, 0) desc
      limit 400) z));

  -- الطلبية المقترحة: يكفي «أيام التغطية» على معدل البيع. الأول اللي خلص والأكتر طلب وعليه طلبات عملاء؛ لو الفرع
  -- التاني عنده زيادة، الجزء ده تحويل مش شرا. الميزانية لكل فرع لو اتحددت.
  create temporary table inv_order on commit drop as
    select a.branch, a.code, a.name, a.company, a.qty, a.rate, a.n90, a.requests, coalesce(a.cost, a.price * 0.8, 0) cost,
           ceil(greatest(a.rate * v_cover - greatest(a.qty, 0), 0)) need,
           greatest(floor(coalesce(o.qty, 0) - coalesce(o.rate, 0) * v_cover * 1.5), 0) other_spare,
           a.last_sale
    from inv_all a
    left join inv_all o on o.code = a.code and o.branch <> a.branch
    where (a.rate > 0 and a.n90 >= 2 or a.requests > 0)
      and (p_branch is null or a.branch = p_branch);
  update inv_order set need = greatest(need, 1) where requests > 0 and qty <= 0;
  delete from inv_order where need <= 0;
  alter table inv_order add column transfer_qty numeric, add column buy_qty numeric, add column buy_cost numeric,
    add column priority numeric, add column running numeric;
  update inv_order set transfer_qty = least(need, other_spare), buy_qty = need - least(need, other_spare);
  update inv_order set buy_cost = round(buy_qty * cost, 2),
    priority = (case when qty <= 0 then 1000 else 0 end) + requests * 200 + n90 * 3 + least(rate * 30, 100);
  update inv_order x set running = r.run from (
    select branch, code, sum(buy_cost) over (partition by branch order by priority desc, code) run from inv_order) r
   where r.branch = x.branch and r.code = x.code;

  v_out := v_out || jsonb_build_object(
    'order_totals', (select coalesce(jsonb_agg(jsonb_build_object('branch', branch, 'lines', n, 'cost', round(coalesce(c, 0)),
                       'in_budget_cost', round(coalesce(cb, 0)), 'in_budget_lines', nb, 'transfer_lines', nt) order by branch), '[]'::jsonb)
                     from (select branch, count(*) filter (where buy_qty > 0) n, sum(buy_cost) c,
                                  sum(buy_cost) filter (where p_budget is null or running <= p_budget) cb,
                                  count(*) filter (where buy_qty > 0 and (p_budget is null or running <= p_budget)) nb,
                                  count(*) filter (where transfer_qty > 0) nt
                           from inv_order group by branch) t),
    'orders', (select coalesce(jsonb_agg(jsonb_build_object('branch', branch, 'code', code, 'name', name, 'company', company,
                 'qty', qty, 'rate30', round(rate * 30, 1), 'n90', n90, 'requests', requests, 'need', need,
                 'transfer_qty', transfer_qty, 'buy_qty', buy_qty, 'cost', round(cost, 2), 'buy_cost', round(buy_cost),
                 'in_budget', p_budget is null or running <= p_budget, 'out', qty <= 0) order by priority desc, code), '[]'::jsonb)
               from (select * from inv_order order by priority desc, code limit 700) t));

  -- طلبات العملاء اللي صنفها موجود: نطلعه ولا لأ. الرصيد القليل يروح للعميل المهم الأول.
  v_out := v_out || jsonb_build_object('requests_in_stock', (
    select coalesce(jsonb_agg(t order by (t->>'day') desc), '[]'::jsonb) from (
      select jsonb_build_object('fingerprint', r.fingerprint, 'branch', r.branch, 'day', r.request_day, 'status', r.status,
               'customer_code', r.customer_code, 'customer_name', r.customer_name, 'customer_phone', r.customer_phone,
               'code', r.code, 'item', coalesce(a.name, r.item), 'want', r.qty, 'stock', coalesce(a.qty, 0),
               'rate30', round(coalesce(a.rate, 0) * 30, 1), 'other_stock', coalesce(o.qty, 0),
               'important', coalesce(cs.spend, 0) >= 2000 or coalesce(cs.n, 0) >= 4,
               'spend90', round(coalesce(cs.spend, 0)), 'invoices90', coalesce(cs.n, 0),
               'advice', case when coalesce(a.qty, 0) > 0 and a.qty - coalesce(r.qty, 1) >= a.rate * 7 then 'release'
                              when coalesce(a.qty, 0) > 0 and (coalesce(cs.spend, 0) >= 2000 or coalesce(cs.n, 0) >= 4) then 'release_important'
                              when coalesce(a.qty, 0) > 0 then 'low'
                              else 'other_branch' end) t
      from inv_req r
      left join inv_all a on a.branch = r.branch and a.code = r.code
      left join inv_all o on o.branch <> r.branch and o.code = r.code
      left join lateral (
        select count(*) n, sum(coalesce(s.net_amount, s.amount, 0)) spend from public.sales_invoices s
        where r.customer_code is not null and btrim(s.customer_code) = r.customer_code and s.branch = r.branch
          and s.invoice_date >= (v_today - 90)::timestamp at time zone 'UTC') cs on true
      where (coalesce(a.qty, 0) > 0 or coalesce(o.qty, 0) > 0)
        and (p_branch is null or r.branch = p_branch)) z));

  -- الجرد المقترح.
  v_out := v_out || jsonb_build_object('count', (
    select coalesce(jsonb_agg(t), '[]'::jsonb) from (
      (select jsonb_build_object('reason', 'fast', 'branch', a.branch, 'code', a.code, 'name', a.name, 'qty', a.qty,
                'note', a.n90 || ' فاتورة في ٩٠ يوم') t
       from (select *, row_number() over (partition by branch order by n90 desc) rn from inv_all where qty > 0) a
       where a.rn <= 40 and (p_branch is null or a.branch = p_branch))
      union all
      (select jsonb_build_object('reason', 'negative', 'branch', a.branch, 'code', a.code, 'name', a.name, 'qty', a.qty,
                'note', 'الرصيد بالسالب على السيستم') from inv_all a
       where a.qty < 0 and (p_branch is null or a.branch = p_branch) limit 100)
      union all
      (select jsonb_build_object('reason', 'value', 'branch', a.branch, 'code', a.code, 'name', a.name, 'qty', a.qty,
                'note', 'قيمته ' || round(a.value) || ' ج')
       from (select *, row_number() over (partition by branch order by value desc) rn from inv_all where qty > 0) a
       where a.rn <= 25 and (p_branch is null or a.branch = p_branch))
      union all
      (select jsonb_build_object('reason', 'multi_code', 'branch', a.branch, 'code', a.code, 'name', a.name, 'qty', a.qty,
                'note', 'نفس الاسم على ' || g.n || ' كود: ' || g.codes)
       from inv_all a
       join (select branch, public.dawaa_inventory_norm_name_v1(name) k, count(*) n, string_agg(code, '، ' order by code) codes
             from inv_all where qty <> 0 and name is not null group by 1, 2 having count(*) > 1) g
         on g.branch = a.branch and g.k = public.dawaa_inventory_norm_name_v1(a.name)
       where a.qty <> 0 and (p_branch is null or a.branch = p_branch) limit 150)
      union all
      (select jsonb_build_object('reason', 'multi_pack', 'branch', a.branch, 'code', a.code, 'name', a.name, 'qty', a.qty,
                'note', 'ليه ' || g.n || ' علب: ' || g.names)
       from inv_all a
       join (select branch, public.dawaa_inventory_pack_base_v1(name) k, count(*) n, string_agg(name, ' / ' order by name) names
             from inv_all where qty <> 0 and name is not null and length(public.dawaa_inventory_pack_base_v1(name)) >= 4
               and public.dawaa_inventory_pack_base_v1(name) <> public.dawaa_inventory_norm_name_v1(name)
             group by 1, 2 having count(*) > 1 and count(distinct public.dawaa_inventory_norm_name_v1(name)) > 1) g
         on g.branch = a.branch and g.k = public.dawaa_inventory_pack_base_v1(a.name)
       where a.qty <> 0 and (p_branch is null or a.branch = p_branch) limit 200)
    ) z));

  -- الزيادة جاية منين: الأصناف والشركات اللي بيعها زاد أو قل آخر ٣٠ يوم عن الـ ٣٠ اللي قبلهم.
  v_out := v_out || jsonb_build_object(
    'movers_up', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
       select jsonb_build_object('branch', branch, 'code', code, 'name', name, 'v30', round(v30), 'vprev30', round(vprev30), 'diff', round(v30 - vprev30)) t
       from inv_all where (p_branch is null or branch = p_branch) and v30 > vprev30 order by v30 - vprev30 desc limit 25) z),
    'movers_down', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
       select jsonb_build_object('branch', branch, 'code', code, 'name', name, 'v30', round(v30), 'vprev30', round(vprev30), 'diff', round(v30 - vprev30)) t
       from inv_all where (p_branch is null or branch = p_branch) and v30 < vprev30 order by v30 - vprev30 limit 25) z),
    'companies', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
       select jsonb_build_object('company', company, 'value', round(sum(value)), 'v30', round(sum(v30)), 'vprev30', round(sum(vprev30)),
                'dead_value', coalesce(round(sum(value) filter (where qty > 0 and q90 <= 0)), 0)) t
       from inv_all where company is not null and (p_branch is null or branch = p_branch)
       group by company order by sum(value) desc limit 30) z));

  return v_out;
end;
$$;

-- رصيد أصناف طلبات العملاء (لفريق خدمة العملاء): في الفرع وفي الفرع التاني، من آخر ملف اترفع.
create or replace function public.dawaa_inventory_stock_for_codes_v1(p_codes text[])
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare
  a public.staff_accounts := public.dawaa_cs_group_actor_v1();
  v_up uuid := public.dawaa_inventory_current_upload_v1(false);
begin
  if v_up is null then return jsonb_build_object('day', null, 'rows', '[]'::jsonb); end if;
  return jsonb_build_object(
    'day', (select snapshot_day from public.inventory_stock_uploads where id = v_up),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object('code', product_code, 'branch', branch, 'qty', q)), '[]'::jsonb)
             from (select product_code, branch, sum(qty) q from public.inventory_stock_batches
                   where upload_id = v_up and store_kind in ('main', 'doctor') and product_code = any(p_codes)
                     and branch in ('فرع شكري', 'فرع الشامي')
                   group by 1, 2) t));
end;
$$;

-- «حوّلي للنواقص»: كل صنف في الطلب بيبقى سطر في النواقص بالعميل، والطلب بيبقى «بنوفره».
create or replace function public.dawaa_cs_group_requests_to_shortages_v1(p_fingerprints text[])
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  a public.staff_accounts := public.dawaa_cs_group_actor_v1();
  v_name text := coalesce(nullif(btrim(a.name), ''), a.username);
  g public.customer_request_group_log_v1;
  x jsonb;
  v_items int := 0;
  v_reqs int := 0;
  v_skipped int := 0;
begin
  for g in select * from public.customer_request_group_log_v1 where fingerprint = any(p_fingerprints) for update loop
    if exists (select 1 from public.shortage_items s where s.source_request_details->>'group_request' = g.fingerprint) then
      v_skipped := v_skipped + 1; continue;
    end if;
    for x in select * from jsonb_array_elements(case when jsonb_typeof(g.items) = 'array' and jsonb_array_length(g.items) > 0
                                                     then g.items else jsonb_build_array(jsonb_build_object('name', coalesce(g.details, 'طلب عميل'))) end) loop
      continue when nullif(btrim(coalesce(x->>'name', '')), '') is null;
      insert into public.shortage_items (item_name, branch, requested_qty, priority, status, notes, source_module,
        created_by_name, registered_by_staff_name, source_customer_name, source_customer_code, source_customer_phone,
        source_request_status, source_request_details, moved_from_customer_request_at, product_id)
      values (btrim(x->>'name') || coalesce(' (' || nullif(x->>'code', '') || ')', ''), g.branch,
              coalesce(nullif(x->>'qty', '')::numeric, 1), 'high', 'shortage',
              'من طلبات العملاء · ' || to_char(g.request_day, 'DD/MM'), 'customer_request_group',
              v_name, v_name, g.customer_name, g.customer_code, g.customer_phone, g.status,
              jsonb_build_object('group_request', g.fingerprint, 'code', x->>'code', 'price', x->>'price'), now(),
              (select p.id from public.products p where nullif(x->>'code', '') is not null and p.product_code = x->>'code' limit 1));
      v_items := v_items + 1;
    end loop;
    update public.customer_request_group_log_v1
       set status = case when status = 'new' then 'sourcing' else status end,
           status_note = coalesce(status_note || ' · ', '') || 'اتحول للنواقص',
           status_by = a.id, status_by_name = v_name, status_at = now()
     where fingerprint = g.fingerprint;
    v_reqs := v_reqs + 1;
  end loop;
  return jsonb_build_object('requests', v_reqs, 'items', v_items, 'skipped', v_skipped);
end;
$$;

-- مرتجعات التحويلات: سطور بيع التحويل (كود 170 و10) اللي عليها كمية مرتجعة في بي كونكت.
create or replace function public.dawaa_cs_transfer_returns_v1(p_from date, p_to date, p_branch text default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare
  a public.staff_accounts := public.dawaa_cs_group_actor_v1();
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
             'from_branch', i.branch,
             'to_branch', case when i.branch = 'فرع الشامي' then 'فرع شكري' else 'فرع الشامي' end,
             'day', (i.invoice_date at time zone 'UTC')::date, 'invoice', i.invoice_number, 'line', i.line_no,
             'code', i.product_code, 'name', i.product_name, 'qty', i.quantity,
             'returned', nullif(i.raw_data->>'returned_quantity', '')::numeric,
             'unit_price', i.unit_price,
             'value', round(nullif(i.raw_data->>'returned_quantity', '')::numeric * coalesce(i.unit_price, 0), 2))
           order by i.invoice_date desc, i.invoice_number, i.line_no), '[]'::jsonb)
          from public.sales_invoice_items_v21 i
          where btrim(coalesce(i.customer_code, '')) in ('170', '10')
            and i.branch in ('فرع شكري', 'فرع الشامي')
            and coalesce(nullif(i.raw_data->>'returned_quantity', '')::numeric, 0) > 0
            and i.invoice_date >= (p_from::timestamp at time zone 'UTC')
            and i.invoice_date < ((p_to + 1)::timestamp at time zone 'UTC')
            and (p_branch is null or i.branch = p_branch
                 or (case when i.branch = 'فرع الشامي' then 'فرع شكري' else 'فرع الشامي' end) = p_branch));
end;
$$;

revoke all on function public.dawaa_inventory_current_upload_v1(boolean) from public, anon, authenticated;
revoke all on function public.dawaa_inventory_upload_begin_v1(date, text, text) from public, anon, authenticated;
revoke all on function public.dawaa_inventory_upload_rows_v1(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.dawaa_inventory_upload_finish_v1(uuid) from public, anon, authenticated;
revoke all on function public.dawaa_inventory_overview_v1(text, numeric, int) from public, anon, authenticated;
revoke all on function public.dawaa_inventory_stock_for_codes_v1(text[]) from public, anon, authenticated;
revoke all on function public.dawaa_cs_group_requests_to_shortages_v1(text[]) from public, anon, authenticated;
revoke all on function public.dawaa_cs_transfer_returns_v1(date, date, text) from public, anon, authenticated;
grant execute on function public.dawaa_inventory_upload_begin_v1(date, text, text) to anon, authenticated;
grant execute on function public.dawaa_inventory_upload_rows_v1(uuid, jsonb) to anon, authenticated;
grant execute on function public.dawaa_inventory_upload_finish_v1(uuid) to anon, authenticated;
grant execute on function public.dawaa_inventory_overview_v1(text, numeric, int) to anon, authenticated;
grant execute on function public.dawaa_inventory_stock_for_codes_v1(text[]) to anon, authenticated;
grant execute on function public.dawaa_cs_group_requests_to_shortages_v1(text[]) to anon, authenticated;
grant execute on function public.dawaa_cs_transfer_returns_v1(date, date, text) to anon, authenticated;
