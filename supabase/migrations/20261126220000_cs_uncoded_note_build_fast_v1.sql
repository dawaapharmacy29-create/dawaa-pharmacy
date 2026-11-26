-- عملاء الشامي اللي في ملاحظات الفواتير ماكانوش بيظهروا (2026-11-26): dawaa_cs_uncoded_note_tasks_build_v1 كانت بتبني
-- قايمة بكل أرقام الفواتير المتكودة (لف على الجدول كله بـ regexp) فبتقع بالـ statement timeout أول ما ملف مبيعات الشامي
-- يترفع ويبقى فيه أرقام في الملاحظات. دلوقتي بتسأل عن كل رقم بالفهرس.

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
  v_carried integer := 0;
  v_dropped integer := 0;
  r record;
  v_member text;
begin
  create temporary table cs_on on commit drop as
    select * from public.dawaa_cs_onboarded_keys_v1(v_day - 180);

  create temporary table cs_duty on commit drop as
    select x->>'staff_account_id' as member, public.dawaa_cs_member_branch_v1(x, v_day) as home
    from public.customer_service_daily_task_settings s
    cross join lateral jsonb_array_elements(coalesce(s.members, '[]'::jsonb)) x
    where s.id = 1 and not coalesce((x->>'on_leave')::boolean, false) and nullif(x->>'staff_account_id', '') is not null;

  -- ١) اللي ماخلصش (ناقصه الكود أو التليفون أو الترحيب) بيرجع النهارده باللي اتعمل فيه، لحد ٣ أيام.
  with c as (
    insert into public.customer_service_daily_queue_items as t
      (queue_date, branch, customer_key, customer_id, customer_code, customer_name, customer_phone, source, priority, reason,
       status, assigned_staff_id, attempt_no, created_by, created_by_name, metadata)
    select v_day, q.branch, q.customer_key, q.customer_id, q.customer_code, q.customer_name, q.customer_phone, q.source, '2',
           q.reason, 'not_started',
           case when exists (select 1 from cs_duty d where d.member = q.assigned_staff_id
                                                       and (d.home is null or d.home = q.branch))
                then q.assigned_staff_id end,
           q.attempt_no + 1, a.id::text, coalesce(a.name, a.username),
           coalesce(q.metadata, '{}'::jsonb) || jsonb_build_object('carried_from', q.id, 'carried_from_date', q.queue_date)
    from (
      select distinct on (branch, customer_key) *
      from public.customer_service_daily_queue_items
      where queue_date between v_day - 3 and v_day - 1
        and source in ('new_customer', 'uncoded_note') and priority <> '1'
      order by branch, customer_key, queue_date desc
    ) q
    where q.result is null and q.attempt_no < 3
    on conflict (queue_date, branch, customer_key) do update
      set source = excluded.source, priority = '2', reason = excluded.reason, attempt_no = excluded.attempt_no,
          metadata = coalesce(t.metadata, '{}'::jsonb) || excluded.metadata, customer_code = coalesce(t.customer_code, excluded.customer_code)
      where t.result is null and t.priority <> '1' and t.source not in ('new_customer', 'uncoded_note', 'doctor_case')
    returning 1
  )
  select count(*) into v_carried from c;

  -- ٢) «عميل جديد» لحد اتكود واترحب بيه قبل كده (من الملاحظة، أو في الفرع التاني) مايتعملش تاني.
  with d as (
    delete from public.customer_service_daily_queue_items q
    where q.queue_date = v_day and q.source = 'new_customer' and q.result is null
      and q.metadata->'onboard' is null and not (q.metadata ? 'carried_from')
      and exists (
        select 1 from cs_on o
        where (o.code is not null and o.code = q.customer_code)
           or (o.phone is not null and o.phone = nullif(right(regexp_replace(coalesce(q.customer_phone, ''), '\D', '', 'g'), 10), '')))
    returning 1
  )
  select count(*) into v_dropped from d;

  -- ٣) الجديد: فواتير امبارح على كود ٧ أو من غير كود، والرقم مكتوب في الملاحظة.
  with n as (
    select distinct on (o.branch, p.ph) o.branch, p.ph, o.invoice_number, coalesce(o.net_amount, o.total_amount, 0) as net,
           coalesce(o.normalized_seller_name, o.seller_name) as seller, o.notes, o.invoice_date, o.invoice_datetime
    from public.sales_invoices o
    cross join lateral (select (regexp_match(regexp_replace(coalesce(o.notes, ''), '[\s\-]', '', 'g'), '(01[0125][0-9]{8})'))[1] as ph) p
    where o.branch in ('فرع شكري', 'فرع الشامي')
      and o.invoice_date >= v_y_from and o.invoice_date < v_y_to
      and coalesce(nullif(btrim(o.customer_code), ''), '7') = '7'
      and p.ph is not null
    order by o.branch, p.ph, o.invoice_date desc
  ), ins as (
    insert into public.customer_service_daily_queue_items
      (queue_date, branch, customer_key, customer_code, customer_name, customer_phone, source, priority, reason, status,
       created_by, created_by_name, metadata)
    select v_day, n.branch, 'p:' || n.ph, null,
           coalesce(public.dawaa_cs_note_customer_name_v1(n.notes, n.ph), 'عميل ' || n.ph), n.ph, 'uncoded_note', '2',
           'مش متكود: اتكتب في ملاحظة فاتورة ' || n.invoice_number || ' بـ ' || round(n.net) ||
             ' ج. كوّده على بي كونكت وسجّله على التليفون وابعت الترحيب',
           'not_started', a.id::text, coalesce(a.name, a.username),
           jsonb_build_object('invoice', n.invoice_number, 'value', round(n.net), 'seller', n.seller, 'note', n.notes,
                              'invoice_at', coalesce(n.invoice_datetime, n.invoice_date))
    from n
    where not exists (
        select 1 from public.customers c
        where c.normalized_phone = n.ph or c.phone = n.ph or c.whatsapp_phone = n.ph or c.mobile = n.ph or c.customer_phone = n.ph)
      -- رقم متسجل على كود حقيقي في فاتورة قبل كده (العميل متكود، حتى لو في الفرع التاني). بالفهرس على كل عمود
      -- لوحده: النسخة القديمة كانت بتلف على كل الفواتير وبتعدّي الـ statement timeout أول ما يبقى فيه أرقام.
      and not exists (select 1 from public.sales_invoices o2
                      where o2.customer_phone = n.ph and btrim(coalesce(o2.customer_code, '')) not in ('', '7'))
      and not exists (select 1 from public.sales_invoices o2
                      where o2.whatsapp_phone = n.ph and btrim(coalesce(o2.customer_code, '')) not in ('', '7'))
      and not exists (select 1 from cs_on o where o.phone = right(n.ph, 10))
    on conflict (queue_date, branch, customer_key) do nothing
    returning id, branch
  )
  select count(*) into v_added from ins;

  -- التوزيع: على اللي ماسكة الفرع ده الشهر ده، وأقلهم مهام النهارده.
  for r in
    select q.id, q.branch from public.customer_service_daily_queue_items q
    where q.queue_date = v_day and q.source in ('uncoded_note', 'new_customer') and q.assigned_staff_id is null
  loop
    select d.member into v_member
    from cs_duty d
    order by (d.home is not distinct from r.branch) desc,
             (select count(*) from public.customer_service_daily_queue_items z
              where z.queue_date = v_day and z.assigned_staff_id = d.member)
    limit 1;
    if v_member is not null then
      update public.customer_service_daily_queue_items set assigned_staff_id = v_member where id = r.id;
    end if;
  end loop;

  return jsonb_build_object('added', v_added, 'carried', v_carried, 'dropped', v_dropped);
end;
$$;
revoke all on function public.dawaa_cs_uncoded_note_tasks_build_v1() from public, anon, authenticated;
grant execute on function public.dawaa_cs_uncoded_note_tasks_build_v1() to anon, authenticated;
