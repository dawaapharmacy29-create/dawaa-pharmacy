-- تحرير المخزون (صاحب الصيدلية 2026-11-26): صفحة للإدارة فيها رأس المال اللي في المخزون في كل فرع ومخازنه، ونسبة نشاط
-- الأصناف، والرواكد، واللي قرب ينتهي في ٦ شهور من النهارده، والمنتهي اللي لسه على الرف وفي مخزن الإكسبير، ومين أكتر دكتور
-- بيصرف الأصناف التقيلة والقريبة من الانتهاء، ولكل صنف الخطوة اللي تحرّره (تحويل، مرتجع للمورد، أولوية صرف، سحب).
-- كله من آخر ملف رصيد اترفع ومن inventory_sales_daily، وبيع الدكتور من جدول صغير بيتبني في الخلفية مع جدول البيع.

-- بيع كل دكتور لكل صنف في اليوم (من غير التحويلات وبعد المرتجع)، لآخر ١٢٠ يوم بس.
create table if not exists public.inventory_sales_seller_daily (
  day date not null,
  branch text not null,
  seller text not null,
  code text not null,
  qty numeric not null,
  value numeric not null,
  invoices int not null,
  primary key (day, branch, seller, code)
);
create index if not exists inventory_sales_seller_daily_code_idx on public.inventory_sales_seller_daily (branch, code, day);
alter table public.inventory_sales_seller_daily enable row level security;
revoke all on public.inventory_sales_seller_daily from anon, authenticated;

create or replace function public.dawaa_inventory_seller_rebuild_v1(p_from date)
returns int language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_n int;
begin
  delete from public.inventory_sales_seller_daily where day >= p_from or day < (now() at time zone 'Africa/Cairo')::date - 120;
  insert into public.inventory_sales_seller_daily (day, branch, seller, code, qty, value, invoices)
  select (i.invoice_date at time zone 'UTC')::date, i.branch,
         coalesce(nullif(btrim(s.normalized_seller_name), ''), nullif(btrim(s.seller_name), ''), 'مش معروف'),
         btrim(i.product_code),
         sum(i.quantity - coalesce(nullif(i.raw_data->>'returned_quantity', '')::numeric, 0)),
         coalesce(sum(i.line_total), 0), count(distinct i.invoice_number)
  from public.sales_invoice_items_v21 i
  join public.sales_invoices s on s.id = i.invoice_id
  where i.invoice_date >= (p_from::timestamp at time zone 'UTC')
    and i.branch in ('فرع شكري', 'فرع الشامي')
    and btrim(coalesce(i.customer_code, '')) not in ('170', '10')
    and nullif(btrim(coalesce(i.product_code, '')), '') is not null
    and not public.dawaa_inventory_is_service_v1(i.product_name)
    and coalesce(i.line_total, 0) <= greatest(coalesce(s.net_amount, s.total_amount, 0), 0) * 1.3 + 50
  group by 1, 2, 3, 4;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.dawaa_inventory_seller_rebuild_v1(date) from public, anon, authenticated;

-- بيتبني مع جدول البيع: كل ساعة لآخر ٥ أيام وبالليل لآخر ١٠٠ يوم.
do $do$
declare
  d text := pg_get_functiondef('public.dawaa_inventory_sales_rebuild_v1(date)'::regprocedure);
  a text := E'  get diagnostics v_n = row_count;\n  return v_n;\nend;';
begin
  if position('dawaa_inventory_seller_rebuild_v1' in d) > 0 then return; end if;
  if position(a in d) = 0 then raise exception 'rebuild tail not found'; end if;
  d := replace(d, a, E'  get diagnostics v_n = row_count;\n  perform public.dawaa_inventory_seller_rebuild_v1(p_from);\n  return v_n;\nend;');
  execute d;
end;
$do$;

-- الصفحة.
create or replace function public.dawaa_stock_liberation_v1(p_branch text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_actor uuid := public.purchase_review_actor_v1();
  v_up uuid := public.dawaa_inventory_current_upload_v1(false);
  v_bup uuid := public.dawaa_inventory_current_upload_v1(true);
  u public.inventory_stock_uploads;
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_out jsonb;
begin
  if v_up is null then return jsonb_build_object('empty', true); end if;
  select * into u from public.inventory_stock_uploads where id = v_up;

  -- الرصيد لكل فرع وصنف من آخر ملف: «للبيع» = المخزن الرئيسي ومخازن الدكاترة.
  create temporary table lb_s on commit drop as
    select b.branch, b.product_code code, max(b.product_name) name, max(b.company) company,
           coalesce(sum(b.qty) filter (where b.store_kind in ('main', 'doctor')), 0) qty,
           coalesce(sum(b.qty) filter (where b.store_kind = 'doctor'), 0) doctor_qty,
           coalesce(sum(b.qty * coalesce(b.cost, c.cost, 0)) filter (where b.store_kind in ('main', 'doctor') and b.qty > 0), 0) value,
           coalesce(max(b.cost) filter (where b.qty > 0), max(c.cost)) cost,
           max(b.purchase_day) last_buy,
           (array_agg(b.supplier order by b.purchase_day desc nulls last) filter (where nullif(btrim(b.supplier), '') is not null))[1] supplier
    from public.inventory_stock_batches b
    left join public.inventory_product_costs c on c.product_code = b.product_code
    where b.upload_id = v_up and b.branch in ('فرع شكري', 'فرع الشامي')
    group by 1, 2;
  create index on lb_s (code, branch);

  create temporary table lb_v on commit drop as
    select d.branch, d.code, coalesce(sum(d.qty) filter (where d.day >= v_today - 30), 0) q30, sum(d.qty) q90,
           max(d.day) last_sale
    from public.inventory_sales_daily d
    where d.day >= v_today - 90
    group by 1, 2;
  create index on lb_v (code, branch);

  -- حالة كل صنف عليه رصيد: نشط (اتباع آخر ٣٠ يوم)، بطيء (اتباع في ٩٠ يوم بس مش آخر ٣٠)، راكد (ولا مرة في ٩٠ يوم)،
  -- جديد (داخل آخر ٣٠ يوم ولسه ماتباعش، مابيتحكمش عليه).
  create temporary table lb_a on commit drop as
    select s.*, coalesce(v.q30, 0) q30, coalesce(v.q90, 0) q90, v.last_sale,
           greatest(0, 0.6 * coalesce(v.q30, 0) / 30.0 + 0.4 * coalesce(v.q90, 0) / 90.0) rate,
           case when coalesce(v.q30, 0) > 0 then 'active'
                when coalesce(v.q90, 0) > 0 then 'slow'
                when s.last_buy >= u.snapshot_day - 30 then 'new'
                else 'dead' end status
    from lb_s s left join lb_v v on v.branch = s.branch and v.code = s.code
    where s.qty > 0;
  create index on lb_a (code, branch);
  analyze lb_a;

  -- الفرع التاني: بيبيع الصنف قد إيه وعنده منه قد إيه.
  create temporary table lb_o on commit drop as
    select a.branch, a.code,
           coalesce((select 0.6 * v.q30 / 30.0 + 0.4 * v.q90 / 90.0 from lb_v v where v.code = a.code and v.branch <> a.branch), 0) other_rate,
           coalesce((select s.qty from lb_s s where s.code = a.code and s.branch <> a.branch), 0) other_qty
    from lb_a a;
  create index on lb_o (code, branch);

  v_out := jsonb_build_object(
    'upload', jsonb_build_object('day', u.snapshot_day, 'kind', u.kind, 'by', u.uploaded_by_name, 'at', u.finished_at,
                                 'batches_day', (select snapshot_day from public.inventory_stock_uploads where id = v_bup)),
    'today', v_today,

    -- رأس المال في كل فرع ومخازنه (المخزن الرئيسي، مخازن الدكاترة، الإكسبير، المكتب).
    'capital', (select coalesce(jsonb_agg(jsonb_build_object('branch', branch, 'store', store, 'kind', store_kind,
                       'items', items, 'value', round(cost_value), 'sale_value', round(sale_value),
                       'near_expiry', round(near_expiry_value), 'expired', round(expired_value)) order by branch, store_kind, store), '[]'::jsonb)
                from public.inventory_stock_daily
                where snapshot_day = u.snapshot_day and branch in ('فرع شكري', 'فرع الشامي')
                  and (p_branch is null or branch = p_branch)),

    -- قيمة المخزون من ٩٠ يوم لحد النهارده، عشان نشوف التحرير ماشي ولا لأ.
    'trend', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'branch', branch, 'value', round(v), 'expiry', round(e)) order by d, branch), '[]'::jsonb)
              from (select snapshot_day d, branch, coalesce(sum(cost_value) filter (where store_kind <> 'expiry'), 0) v,
                           coalesce(sum(cost_value) filter (where store_kind = 'expiry'), 0) e
                    from public.inventory_stock_daily
                    where snapshot_day >= u.snapshot_day - 90 and branch in ('فرع شكري', 'فرع الشامي')
                      and (p_branch is null or branch = p_branch)
                    group by 1, 2) t),

    -- نسبة النشاط: قيمة وعدد الأصناف في كل حالة، والأوفر ستوك (رصيد يكفي أكتر من ٤ شهور).
    'activity', (select coalesce(jsonb_agg(jsonb_build_object('branch', branch,
                    'items', items, 'value', round(value),
                    'active_items', active_items, 'active_value', round(active_value),
                    'slow_items', slow_items, 'slow_value', round(slow_value),
                    'dead_items', dead_items, 'dead_value', round(dead_value),
                    'new_items', new_items, 'new_value', round(new_value),
                    'over_items', over_items, 'over_value', round(over_value)) order by branch), '[]'::jsonb)
                 from (select branch, count(*) items, sum(value) value,
                         count(*) filter (where status = 'active') active_items, coalesce(sum(value) filter (where status = 'active'), 0) active_value,
                         count(*) filter (where status = 'slow') slow_items, coalesce(sum(value) filter (where status = 'slow'), 0) slow_value,
                         count(*) filter (where status = 'dead') dead_items, coalesce(sum(value) filter (where status = 'dead'), 0) dead_value,
                         count(*) filter (where status = 'new') new_items, coalesce(sum(value) filter (where status = 'new'), 0) new_value,
                         count(*) filter (where status = 'active' and qty / nullif(rate, 0) > 120) over_items,
                         coalesce(sum(greatest(qty - rate * 60, 0) * coalesce(cost, 0)) filter (where status = 'active' and qty / nullif(rate, 0) > 120), 0) over_value
                       from lb_a where p_branch is null or branch = p_branch group by branch) t)
  );

  -- الرواكد والبطيء: الخطوة اللي تحرّر كل صنف.
  v_out := v_out || jsonb_build_object('dead', (
    select coalesce(jsonb_agg(t order by (t->>'value')::numeric desc), '[]'::jsonb) from (
      select jsonb_build_object('branch', a.branch, 'code', a.code, 'name', a.name, 'company', a.company, 'status', a.status,
               'qty', a.qty, 'doctor_qty', a.doctor_qty, 'value', round(a.value), 'last_buy', a.last_buy, 'last_sale', a.last_sale,
               'supplier', a.supplier, 'other_rate30', round(o.other_rate * 30, 1), 'other_qty', o.other_qty,
               'action', case when o.other_rate * 30 >= 1 then 'transfer'
                              when a.last_buy >= v_today - 180 and a.supplier is not null then 'return'
                              else 'push' end) t
      from lb_a a join lb_o o on o.branch = a.branch and o.code = a.code
      where a.status in ('dead', 'slow') and (p_branch is null or a.branch = p_branch)
      order by a.value desc
      limit 500) z));

  -- قرب الانتهاء (من النهارده لحد ٦ شهور) في المخزن الرئيسي ومخازن الدكاترة: هيتباع قبل ما يفضل له شهر ولا لأ.
  v_out := v_out || jsonb_build_object('near_expiry', (
    select coalesce(jsonb_agg(t order by (t->>'expiry'), (t->>'risk_value')::numeric desc), '[]'::jsonb) from (
      select jsonb_build_object('branch', b.branch, 'store', b.store, 'kind', b.store_kind, 'code', b.product_code,
               'name', b.product_name, 'qty', b.qty, 'expiry', b.expiry, 'days', b.expiry - v_today,
               'value', round(b.qty * coalesce(b.cost, 0)), 'supplier', b.supplier, 'location', b.location,
               'rate30', round(coalesce(a.rate, 0) * 30, 1), 'other_rate30', round(coalesce(o.other_rate, 0) * 30, 1),
               'risk_qty', r.risk_qty, 'risk_value', round(r.risk_qty * coalesce(b.cost, 0)),
               'action', case when r.risk_qty <= 0 then 'ok'
                              when b.expiry - v_today <= 60 and nullif(btrim(b.supplier), '') is not null then 'return'
                              when coalesce(o.other_rate, 0) > coalesce(a.rate, 0) then 'transfer'
                              when b.expiry - v_today <= 60 then 'push_now'
                              else 'push' end) t
      from public.inventory_stock_batches b
      left join lb_a a on a.branch = b.branch and a.code = b.product_code
      left join lb_o o on o.branch = b.branch and o.code = b.product_code
      cross join lateral (select round(greatest(b.qty - coalesce(a.rate, 0) * greatest(b.expiry - v_today - 30, 0), 0), 1) risk_qty) r
      where b.upload_id = v_bup and b.store_kind in ('main', 'doctor') and b.qty > 0
        and b.expiry is not null and b.expiry >= v_today and b.expiry <= v_today + 180
        and b.branch in ('فرع شكري', 'فرع الشامي') and (p_branch is null or b.branch = p_branch)
      order by b.expiry, b.qty * coalesce(b.cost, 0) desc
      limit 600) z));

  -- المنتهي: اللي لسه على الرف (المخزن الرئيسي ومخازن الدكاترة) لازم يتسحب، واللي في مخزن الإكسبير يرجع للمورد.
  v_out := v_out || jsonb_build_object('expired', (
    select coalesce(jsonb_agg(t order by (t->>'value')::numeric desc), '[]'::jsonb) from (
      select jsonb_build_object('branch', b.branch, 'store', b.store, 'kind', b.store_kind, 'code', b.product_code,
               'name', max(b.product_name), 'qty', sum(b.qty), 'value', round(sum(b.qty * coalesce(b.cost, 0))),
               'expiry', min(b.expiry), 'supplier', string_agg(distinct b.supplier, '، '),
               'action', case when b.store_kind = 'expiry' then 'return' else 'pull' end) t
      from public.inventory_stock_batches b
      where b.upload_id = coalesce(v_bup, v_up) and b.qty > 0 and b.branch in ('فرع شكري', 'فرع الشامي')
        and (b.store_kind = 'expiry' or (b.store_kind in ('main', 'doctor') and b.expiry is not null and b.expiry < v_today))
        and (p_branch is null or b.branch = p_branch)
      group by b.branch, b.store, b.store_kind, b.product_code
      order by sum(b.qty * coalesce(b.cost, 0)) desc
      limit 400) z));

  -- الدكاترة: مين صرف آخر ٣٠ يوم أكتر من الأصناف التقيلة (البطيئة، والأوفر ستوك، واللي عليها رصيد بيكفي أكتر من ٣ شهور)
  -- واللي قرب ينتهي. قيمة ده ونسبته من بيع الدكتور.
  create temporary table lb_heavy on commit drop as
    select a.branch, a.code,
           bool_or(exists (select 1 from public.inventory_stock_batches b
                           where b.upload_id = v_bup and b.branch = a.branch and b.product_code = a.code and b.qty > 0
                             and b.store_kind in ('main', 'doctor') and b.expiry between v_today and v_today + 180)) near,
           bool_or(a.status in ('slow', 'dead') or (a.rate > 0 and a.qty / a.rate > 90)) heavy
    from lb_a a group by 1, 2;
  delete from lb_heavy where not near and not heavy;
  create index on lb_heavy (code, branch);

  v_out := v_out || jsonb_build_object('doctors', (
    select coalesce(jsonb_agg(t order by (t->>'value')::numeric desc), '[]'::jsonb) from (
      select jsonb_build_object('branch', d.branch, 'seller', d.seller,
               'value', round(sum(d.value) filter (where h.code is not null)),
               'near_value', round(coalesce(sum(d.value) filter (where h.near), 0)),
               'heavy_value', round(coalesce(sum(d.value) filter (where h.heavy), 0)),
               'qty', round(coalesce(sum(d.qty) filter (where h.code is not null), 0)),
               'items', count(distinct d.code) filter (where h.code is not null),
               'total', round(sum(d.value)),
               'share', round(100.0 * coalesce(sum(d.value) filter (where h.code is not null), 0) / nullif(sum(d.value), 0), 1),
               'top', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                         select jsonb_build_object('code', d2.code, 'name', max(a2.name), 'qty', round(sum(d2.qty)), 'value', round(sum(d2.value))) x
                         from public.inventory_sales_seller_daily d2
                         join lb_heavy h2 on h2.branch = d2.branch and h2.code = d2.code
                         left join lb_s a2 on a2.branch = d2.branch and a2.code = d2.code
                         where d2.branch = d.branch and d2.seller = d.seller and d2.day >= v_today - 30
                         group by d2.code order by sum(d2.value) desc limit 3) z2)) t
      from public.inventory_sales_seller_daily d
      left join lb_heavy h on h.branch = d.branch and h.code = d.code
      where d.day >= v_today - 30 and d.seller <> 'مش معروف' and (p_branch is null or d.branch = p_branch)
      group by d.branch, d.seller
      having coalesce(sum(d.value) filter (where h.code is not null), 0) > 0
      order by sum(d.value) filter (where h.code is not null) desc
      limit 40) z));

  return v_out;
end;
$$;
revoke all on function public.dawaa_stock_liberation_v1(text) from public;
grant execute on function public.dawaa_stock_liberation_v1(text) to anon, authenticated;
