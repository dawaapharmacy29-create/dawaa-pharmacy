-- تسجيل أصناف طلبات العملاء من كتالوج الأصناف (صاحب الصيدلية 2026-11-26):
--   البحث بيحصل في الصفحة نفسها على نسخة مضغوطة من الكتالوج (أسرع من سؤال السيرفر مع كل حرف)،
--   ومعاها عدد مرات البيع آخر ١٢٠ يوم عشان الأصناف اللي بتتباع أكتر تطلع الأول.
--   الطلب ممكن يتسجل من الصفحة مباشرة (مش لازم من الجروب)، والصنف ممكن يبقى من الكتالوج أو جديد أو بصورة.

-- [[code, name, price, sold]] + نسخة عشان الصفحة تعرف إمتى تحدّث اللي عندها.
create or replace function public.dawaa_products_compact_v1()
returns jsonb language plpgsql stable security definer
set search_path = public, pg_catalog
as $$
begin
  if not (auth.uid() is not null or public.dawaa_has_active_app_session()) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return (
    with sold as (
      select s.product_code, count(*) as n
      from public.sales_invoice_items_v21 s
      where s.invoice_date >= current_date - 120 and s.product_code is not null
      group by s.product_code
    )
    select jsonb_build_object(
      'version', (select count(*)::text || '-' || coalesce(extract(epoch from max(coalesce(updated_at, created_at)))::bigint::text, '0')
                  from public.products),
      'rows', coalesce(jsonb_agg(jsonb_build_array(p.product_code, p.name, p.price, coalesce(sold.n, 0))), '[]'::jsonb))
    from public.products p
    left join sold on sold.product_code = p.product_code
    where nullif(btrim(p.name), '') is not null
  );
end;
$$;
revoke all on function public.dawaa_products_compact_v1() from public, anon, authenticated;
grant execute on function public.dawaa_products_compact_v1() to anon, authenticated;

-- طلب جديد من الصفحة: العميل والأصناف (كل صنف {name, qty, code?, product_id?, price?, image?, new?}).
-- الدكتور اختياري؛ لو اتحدد الطلب بيتحسبله زي طلب الجروب اللي اسمه مكتوب فيه.
create or replace function public.dawaa_cs_group_request_create_v1(
  p_branch text, p_customer_code text, p_customer_phone text, p_customer_name text, p_items jsonb,
  p_note text default null, p_staff_id uuid default null)
returns jsonb language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  a public.staff_accounts := public.dawaa_cs_group_actor_v1();
  v_name text := coalesce(nullif(btrim(a.name), ''), a.username);
  v_code text := nullif(regexp_replace(translate(coalesce(p_customer_code, ''), '٠١٢٣٤٥٦٧٨٩', '0123456789'), '\D', '', 'g'), '');
  v_phone text := nullif(regexp_replace(translate(coalesce(p_customer_phone, ''), '٠١٢٣٤٥٦٧٨٩', '0123456789'), '\D', '', 'g'), '');
  v_items jsonb := case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end;
  v_fp text := 'app-' || gen_random_uuid()::text;
  v_now timestamp := (now() at time zone 'Africa/Cairo');
  v_cust uuid;
begin
  if p_branch not in ('فرع شكري', 'فرع الشامي') then raise exception 'group_invalid_branch'; end if;
  if v_code is null and v_phone is null then raise exception 'request_needs_customer'; end if;
  if jsonb_array_length(v_items) = 0 then raise exception 'request_needs_items'; end if;
  if p_staff_id is not null and not exists (select 1 from public.staff s where s.id = p_staff_id) then
    raise exception 'unknown_staff';
  end if;

  v_cust := coalesce(
    (select c.id from public.customers c where v_code is not null and nullif(btrim(c.customer_code), '') = v_code limit 1),
    (select min(c.id::text)::uuid from public.customers c
      where v_phone is not null
        and public.dawaa_sync_norm_phone(coalesce(c.customer_phone, c.phone, c.mobile, c.whatsapp_phone, c.whatsapp))
            = public.dawaa_sync_norm_phone(v_phone)
      having count(*) = 1));

  insert into public.customer_request_group_log_v1
    (fingerprint, staff_id, branch, sent_at, request_day, sender_name, customer_code, customer_phone, body, attribution,
     file_name, imported_by, customer_id, customer_name, details, items, status, status_note, status_by, status_by_name, status_at)
  values (v_fp, p_staff_id, p_branch, now(), v_now::date, v_name, v_code, v_phone,
          'اتسجل من التطبيق: ' || coalesce((select string_agg(coalesce(x->>'name', '') || coalesce(' × ' || nullif(x->>'qty', ''), ''), '، ')
                                            from jsonb_array_elements(v_items) x), ''),
          case when p_staff_id is null then 'none' else 'manual' end,
          'app', a.id::text, v_cust, left(nullif(btrim(p_customer_name), ''), 120),
          left((select string_agg(x->>'name', ' · ') from jsonb_array_elements(v_items) x), 400),
          v_items, 'new', nullif(btrim(p_note), ''), a.id, v_name, now());

  insert into public.cs_group_request_log (fingerprint, before, after, by_id, by_name)
  values (v_fp, null, jsonb_build_object('created', true, 'items', v_items, 'note', p_note), a.id, v_name);
  return jsonb_build_object('fingerprint', v_fp);
end;
$$;
revoke all on function public.dawaa_cs_group_request_create_v1(text, text, text, text, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.dawaa_cs_group_request_create_v1(text, text, text, text, jsonb, text, uuid) to anon, authenticated;

-- آخر رفع لكل جروب (لصفحة ملفات الصبح).
create or replace function public.dawaa_cs_group_uploads_v1()
returns jsonb language plpgsql stable security definer
set search_path = public, pg_catalog
as $$
declare
  a public.staff_accounts := public.dawaa_cs_group_actor_v1();
begin
  return jsonb_build_object(
    'followups', (select jsonb_build_object('at', max(created_at), 'last_message', max(sent_at)) from public.cs_group_followups),
    'requests', (select jsonb_build_object('at', max(created_at), 'last_message', max(sent_at))
                 from public.customer_request_group_log_v1 where coalesce(file_name, '') <> 'app'));
end;
$$;
revoke all on function public.dawaa_cs_group_uploads_v1() from public, anon, authenticated;
grant execute on function public.dawaa_cs_group_uploads_v1() to anon, authenticated;
