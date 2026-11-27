-- «بحث صنف» في رصيد المخازن (صاحب الصيدلية 2026-11-27): القوايم الجاهزة بتعرض الأصناف اللي عليها علامة بس، فصنف رصيده
-- سليم مكانش بيبان في أي حتة. الدالة دي بتجيب رصيد أي صنف من آخر ملف اترفع (الفرعين، المخزن الرئيسي ومخزن الدكتور،
-- والإكسبير لوحده) وأقرب صلاحية والبيع آخر ٣٠ يوم، بالكود أو بالاسم (كل كلمات البحث لازم تبقى في الاسم).
-- قايمة كلمات = سطر لكل صنف؛ ومن غير كلمات = كل الأصناف (للتصدير إكسيل).

create or replace function public.dawaa_inventory_item_search_v1(p_terms text[] default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare
  v_actor uuid := public.purchase_review_actor_v1();
  v_up uuid := public.dawaa_inventory_current_upload_v1(false);
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_terms text[];
  v_all boolean;
begin
  if v_up is null then return jsonb_build_object('empty', true); end if;
  select coalesce(array_agg(t), '{}') into v_terms
  from (select distinct public.dawaa_inventory_norm_name_v1(x) t from unnest(coalesce(p_terms, '{}')) x) z
  where length(t) >= 2;
  v_all := cardinality(v_terms) = 0;
  if cardinality(v_terms) > 300 then raise exception 'inventory_search_too_many'; end if;

  return (
    with stock as (
      select b.product_code code, max(b.product_name) name, max(b.company) company,
             coalesce(sum(b.qty) filter (where b.branch = 'فرع شكري' and b.store_kind in ('main', 'doctor')), 0) shokry,
             coalesce(sum(b.qty) filter (where b.branch = 'فرع الشامي' and b.store_kind in ('main', 'doctor')), 0) shami,
             coalesce(sum(b.qty) filter (where b.store_kind = 'expiry'), 0) expiry_store,
             min(b.expiry) filter (where b.qty > 0 and b.store_kind in ('main', 'doctor')) nearest_expiry,
             max(b.cost) filter (where b.qty > 0) cost, max(b.price) price
      from public.inventory_stock_batches b
      where b.upload_id = v_up and b.branch in ('فرع شكري', 'فرع الشامي')
      group by 1),
    sold as (
      select d.code, max(d.name) name,
             coalesce(sum(d.qty) filter (where d.branch = 'فرع شكري'), 0) s_shokry,
             coalesce(sum(d.qty) filter (where d.branch = 'فرع الشامي'), 0) s_shami
      from public.inventory_sales_daily d
      where d.day >= v_today - 30
      group by 1),
    items as materialized (
      select coalesce(s.code, v.code) code, coalesce(s.name, v.name) name, s.company,
             coalesce(s.shokry, 0) shokry, coalesce(s.shami, 0) shami, coalesce(s.expiry_store, 0) expiry_store,
             s.nearest_expiry, s.cost, s.price, coalesce(v.s_shokry, 0) sold30_shokry, coalesce(v.s_shami, 0) sold30_shami,
             public.dawaa_inventory_norm_name_v1(coalesce(s.name, v.name)) k
      from stock s full join sold v on v.code = s.code),
    terms as materialized (
      select x term, array(select '%' || w || '%' from regexp_split_to_table(x, ' ') w where w <> '') pats
      from unnest(v_terms) x),
    matched as (
      select i.*, (select t.term from terms t where i.code = t.term or i.k like all (t.pats) limit 1) term
      from items i),
    hits as (select * from matched where v_all or term is not null)
    select jsonb_build_object(
      'day', (select snapshot_day from public.inventory_stock_uploads where id = v_up),
      'rows', coalesce((select jsonb_agg(jsonb_build_object(
                 'code', code, 'name', name, 'company', company, 'term', term,
                 'shokry', shokry, 'shami', shami, 'expiry_store', expiry_store, 'nearest_expiry', nearest_expiry,
                 'cost', cost, 'price', price, 'sold30_shokry', sold30_shokry, 'sold30_shami', sold30_shami)
               order by name) from (select * from hits order by name limit 15000) z), '[]'::jsonb),
      'unmatched', coalesce((select jsonb_agg(x) from unnest(v_terms) x
                             where not exists (select 1 from hits h where h.term = x)), '[]'::jsonb))
  );
end;
$$;

revoke all on function public.dawaa_inventory_item_search_v1(text[]) from public, anon, authenticated;
grant execute on function public.dawaa_inventory_item_search_v1(text[]) to anon, authenticated;
