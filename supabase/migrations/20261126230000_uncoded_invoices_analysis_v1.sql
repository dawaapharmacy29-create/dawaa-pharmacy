-- تحليل الفواتير اللي مش على كود عميل حقيقي (صاحب الصيدلية 2026-11-26): كام فاتورة على كود ٧ أو من غير كود في كل فرع،
-- مكتوب عليها ملاحظة ولا لأ، والملاحظة بتقول إيه (بيانات العميل، رفض، طفل، مستعجل...)، ولكل دكتور. صفحة للإدارة بس
-- (/uncoded-invoices) عشان لو ظهرت مشكلة تدخل في التقييم بعدين؛ مش داخلة في أي تقييم دلوقتي.

create or replace function public.dawaa_uncoded_note_reason_v1(p_note text)
returns text language sql immutable
set search_path = public, pg_catalog
as $$
  select case
    when nullif(btrim(coalesce(p_note, '')), '') is null then 'none'
    when regexp_replace(p_note, '[\s\-]', '', 'g') ~ '(^|[^0-9])0?1[0125][0-9]{8}($|[^0-9])' then 'data'
    when regexp_replace(p_note, '[\s\-]', '', 'g') ~ '(^|[^0-9])0?1[0-9]{8,9}($|[^0-9])' then 'bad_number'
    when p_note ~ 'طفل|صغير|بنت|ولد' then 'child'
    when p_note ~ 'رفض|رافض|عايز|عاوز|عاز|راضي|يريد|حابب' then 'refused'
    when p_note ~ 'مستعجل|تعبان|مستشفى|مستشفي' then 'hurry'
    when p_note ~ 'تليفون|رقم|موبايل' then 'no_phone'
    else 'other'
  end
$$;

create or replace function public.dawaa_uncoded_invoices_analysis_v1(p_from date default null, p_to date default null)
returns jsonb language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor uuid := public.purchase_review_actor_v1();
  v_to date := coalesce(p_to, (now() at time zone 'Africa/Cairo')::date);
  v_from date := coalesce(p_from, date_trunc('month', v_to)::date);
begin
  create temporary table u_inv on commit drop as
    select s.branch, (s.invoice_date at time zone 'UTC')::date as day,
           coalesce(nullif(btrim(s.normalized_seller_name), ''), nullif(btrim(s.seller_name), ''), 'مش معروف') as seller,
           coalesce(nullif(btrim(s.customer_code), ''), '7') in ('7', '.') as uncoded,
           public.dawaa_uncoded_note_reason_v1(s.notes) as reason
    from public.sales_invoices s
    where s.branch in ('فرع شكري', 'فرع الشامي')
      and s.invoice_date >= (v_from::timestamp at time zone 'UTC')
      and s.invoice_date < ((v_to + 1)::timestamp at time zone 'UTC');

  return jsonb_build_object(
    'from', v_from, 'to', v_to,
    'branches', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'branch', branch, 'total', total, 'uncoded', uncoded,
               'with_note', uncoded - no_note, 'no_note', no_note, 'reasons', reasons) order by branch), '[]'::jsonb)
      from (
        select branch, count(*) total, count(*) filter (where uncoded) uncoded,
               count(*) filter (where uncoded and reason = 'none') no_note,
               (select coalesce(jsonb_object_agg(reason, n), '{}'::jsonb)
                from (select reason, count(*) n from u_inv x where x.branch = b.branch and x.uncoded group by reason) r) reasons
        from u_inv b group by branch
      ) t),
    'doctors', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'branch', branch, 'seller', seller, 'total', total, 'uncoded', uncoded, 'no_note', no_note,
               'data', data, 'refused', refused, 'child', child, 'hurry', hurry)
             order by no_note desc, uncoded desc), '[]'::jsonb)
      from (
        select branch, seller, count(*) total, count(*) filter (where uncoded) uncoded,
               count(*) filter (where uncoded and reason = 'none') no_note,
               count(*) filter (where uncoded and reason = 'data') data,
               count(*) filter (where uncoded and reason = 'refused') refused,
               count(*) filter (where uncoded and reason = 'child') child,
               count(*) filter (where uncoded and reason = 'hurry') hurry
        from u_inv group by branch, seller
        having count(*) filter (where uncoded) > 0
      ) t),
    'days', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'day', day, 'branch', branch, 'total', total, 'uncoded', uncoded, 'no_note', no_note)
             order by day, branch), '[]'::jsonb)
      from (
        select day, branch, count(*) total, count(*) filter (where uncoded) uncoded,
               count(*) filter (where uncoded and reason = 'none') no_note
        from u_inv group by day, branch
      ) t)
  );
end;
$$;

revoke all on function public.dawaa_uncoded_invoices_analysis_v1(date, date) from public, anon, authenticated;
grant execute on function public.dawaa_uncoded_invoices_analysis_v1(date, date) to anon, authenticated;
