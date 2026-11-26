-- «تحرير المخزون» على أول ملف حقيقي (2026-11-26):
-- ١) الصلاحية في بي كونكت شهر بس (بتتسجل يوم ١): المنتج صالح لآخر الشهر، فالأيام والمنتهي بيتحسبوا من آخر يوم في الشهر.
-- ٢) «موردين» الجرد (جرد يوم ...، مورد جرد ...) مش موردين حقيقيين: مفيش مرتجع ليهم.
-- ٣) اسم الدكتور بيتكتب بأكتر من شكل (اميرة/اميره، وائل/وايل): بيتجمع على شكل واحد.
-- ٤) إجماليات قرب الانتهاء والمنتهي من كل السطور، مش من أول ٦٠٠ اللي بتتعرض.

create or replace function public.dawaa_expiry_end_v1(d date)
returns date language sql immutable parallel safe as $$
  select case when d is null then null when extract(day from d) = 1 then (d + interval '1 month' - interval '1 day')::date else d end
$$;

create or replace function public.dawaa_real_supplier_v1(s text)
returns text language sql immutable parallel safe as $$
  select case when nullif(btrim(s), '') is null or s like '%جرد%' then null else btrim(s) end
$$;

create or replace function public.dawaa_seller_key_v1(s text)
returns text language sql immutable parallel safe as $$
  select nullif(regexp_replace(regexp_replace(translate(btrim(coalesce(s, '')), 'ةىئأإآ', 'هييااا'), '^د\s*\.\s*', 'د '), '\s+', ' ', 'g'), '')
$$;

do $do$
declare
  d text := pg_get_functiondef('public.dawaa_inventory_seller_rebuild_v1(date)'::regprocedure);
  a text := $a$coalesce(nullif(btrim(s.normalized_seller_name), ''), nullif(btrim(s.seller_name), ''), 'مش معروف')$a$;
begin
  if position('dawaa_seller_key_v1' in d) > 0 then return; end if;
  if position(a in d) = 0 then raise exception 'seller expr not found'; end if;
  d := replace(d, a, $b$coalesce(public.dawaa_seller_key_v1(s.normalized_seller_name), public.dawaa_seller_key_v1(s.seller_name), 'مش معروف')$b$);
  execute d;
end;
$do$;

do $do$
declare
  d text := pg_get_functiondef('public.dawaa_stock_liberation_v1(text)'::regprocedure);
  pairs text[] := array[
    $a$filter (where nullif(btrim(b.supplier), '') is not null))[1] supplier$a$,
    $b$filter (where public.dawaa_real_supplier_v1(b.supplier) is not null))[1] supplier$b$,
    $a$'supplier', b.supplier, 'location'$a$,
    $b$'supplier', public.dawaa_real_supplier_v1(b.supplier), 'location'$b$,
    $a$nullif(btrim(b.supplier), '') is not null then 'return'$a$,
    $b$public.dawaa_real_supplier_v1(b.supplier) is not null then 'return'$b$,
    $a$string_agg(distinct b.supplier, '، ')$a$,
    $b$string_agg(distinct public.dawaa_real_supplier_v1(b.supplier), '، ')$b$,
    $a$'near_expiry', round(near_expiry_value), 'expired', round(expired_value))$a$,
    $b$'near_expiry', round(coalesce((select sum(b.qty * coalesce(b.cost, 0)) from public.inventory_stock_batches b
                            where b.upload_id = coalesce(v_bup, v_up) and b.branch = inventory_stock_daily.branch and b.store = inventory_stock_daily.store
                              and b.qty > 0 and public.dawaa_expiry_end_v1(b.expiry) between v_today and v_today + 180), 0)),
                       'expired', round(coalesce((select sum(b.qty * coalesce(b.cost, 0)) from public.inventory_stock_batches b
                            where b.upload_id = coalesce(v_bup, v_up) and b.branch = inventory_stock_daily.branch and b.store = inventory_stock_daily.store
                              and b.qty > 0 and (inventory_stock_daily.store_kind = 'expiry' or public.dawaa_expiry_end_v1(b.expiry) < v_today)), 0)))$b$
  ];
  i int;
begin
  if position('dawaa_expiry_end_v1' in d) > 0 then return; end if;
  for i in 1 .. array_length(pairs, 1) by 2 loop
    if position(pairs[i] in d) = 0 then raise exception 'pattern % not found', i; end if;
    d := replace(d, pairs[i], pairs[i + 1]);
  end loop;
  -- every batch expiry → end of its month (after the capital patch, which already uses the function)
  d := replace(d, 'b.expiry', 'public.dawaa_expiry_end_v1(b.expiry)');
  d := replace(d, 'public.dawaa_expiry_end_v1(public.dawaa_expiry_end_v1(b.expiry))', 'public.dawaa_expiry_end_v1(b.expiry)');
  -- totals over all rows (the lists stop at 600 / 400)
  if position(E'  return v_out;\nend;' in d) = 0 then raise exception 'tail not found'; end if;
  d := replace(d, E'  return v_out;\nend;', $t$  v_out := v_out || jsonb_build_object('totals', (
    select jsonb_build_object('near_rows', count(*), 'near_value', round(coalesce(sum(b.qty * coalesce(b.cost, 0)), 0)),
             'near_risk', round(coalesce(sum(greatest(b.qty - coalesce(a.rate, 0) * greatest(public.dawaa_expiry_end_v1(b.expiry) - v_today - 30, 0), 0) * coalesce(b.cost, 0)), 0)),
             'near60_rows', count(*) filter (where public.dawaa_expiry_end_v1(b.expiry) - v_today <= 60
                                              and b.qty - coalesce(a.rate, 0) * greatest(public.dawaa_expiry_end_v1(b.expiry) - v_today - 30, 0) > 0),
             'near60_risk', round(coalesce(sum(greatest(b.qty - coalesce(a.rate, 0) * greatest(public.dawaa_expiry_end_v1(b.expiry) - v_today - 30, 0), 0) * coalesce(b.cost, 0))
                                            filter (where public.dawaa_expiry_end_v1(b.expiry) - v_today <= 60), 0)))
    from public.inventory_stock_batches b
    left join lb_a a on a.branch = b.branch and a.code = b.product_code
    where b.upload_id = v_bup and b.store_kind in ('main', 'doctor') and b.qty > 0
      and public.dawaa_expiry_end_v1(b.expiry) between v_today and v_today + 180
      and b.branch in ('فرع شكري', 'فرع الشامي') and (p_branch is null or b.branch = p_branch))
    || (select jsonb_build_object('expired_shelf_rows', count(*), 'expired_shelf', round(coalesce(sum(b.qty * coalesce(b.cost, 0)), 0)))
        from public.inventory_stock_batches b
        where b.upload_id = coalesce(v_bup, v_up) and b.qty > 0 and b.store_kind in ('main', 'doctor')
          and public.dawaa_expiry_end_v1(b.expiry) < v_today
          and b.branch in ('فرع شكري', 'فرع الشامي') and (p_branch is null or b.branch = p_branch)));

  return v_out;
end;$t$);
  execute d;
end;
$do$;

grant execute on function public.dawaa_stock_liberation_v1(text) to anon, authenticated;

-- rebuild the doctors table with the merged names
select public.dawaa_inventory_seller_rebuild_v1(((now() at time zone 'Africa/Cairo')::date - 120));
