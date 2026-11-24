-- فريق خدمة العملاء: رفع ملفات الصبح (المبيعات وأصنافها، العملاء، المشتريات) + متابعة العميل الجديد خطوة بخطوة.
--
-- ١) البنات بيرفعوا ملفات الصبح بنفسهم أول ما يوصلوا:
--    - المبيعات وأصنافها والعملاء: صلاحيات import_sales_invoices / view_invoice_import / import_customers، ونطاقهم الفرعين
--      (الحساب متسجل على «المخزن» أو فرع واحد، والفرع بتاعهم بيتبدل كل شهر). الحذف ممنوع عليهم.
--    - المشتريات: import_purchase_review_file_v1 بقت بتقبلهم كمان، وباقي صفحة مراجعة المشتريات (الحسابات والدفع) لسه للمدير بس.
-- ٢) العميل الجديد (متكود من امبارح) والعميل اللي مش متكود (اسمه ورقمه في ملاحظة الفاتورة، أغلبه الشامي) ليهم شيت لوحدهم:
--    كود بي كونكت ← تسجيل على التليفون ← رسالة الترحيب. اللي يخلص مايرجعش تاني، واللي ناقص يرجع بكرة باللي اتعمل فيه
--    (لحد ٣ أيام). العميل اللي اتكود واترحب بيه مايتعملش له «عميل جديد» تاني لما يشتري بكوده الجديد.

-- ─── ١) صلاحيات الرفع ─────────────────────────────────────────────────────────────────────────────────────────────

create or replace function public.dawaa_cs_is_team_member_v1(p_actor uuid)
returns boolean language sql stable security definer
set search_path = public, pg_catalog
as $$
  select p_actor is not null and exists (
    select 1
    from public.customer_service_daily_task_settings s
    cross join lateral jsonb_array_elements(coalesce(s.members, '[]'::jsonb)) m
    where s.id = 1 and m->>'staff_account_id' = p_actor::text
  );
$$;
revoke all on function public.dawaa_cs_is_team_member_v1(uuid) from public, anon, authenticated;
grant execute on function public.dawaa_cs_is_team_member_v1(uuid) to anon, authenticated;

create or replace function public.dawaa_current_sales_invoice_scope_v1(p_permissions text[])
returns text language plpgsql stable security definer
set search_path to ''
as $function$
declare
  v_actor_id uuid;
  v_role text;
  v_branch_key text;
begin
  v_actor_id := public.dawaa_current_staff_account_id_strict();
  if v_actor_id is null or not public.dawaa_current_actor_can(p_permissions) then
    return 'NONE';
  end if;
  select pg_catalog.lower(pg_catalog.btrim(coalesce(sa.role, ''))), public.dawaa_customer_request_branch_key(sa.branch)
    into v_role, v_branch_key
  from public.staff_accounts sa
  where sa.id = v_actor_id and coalesce(sa.active, false) and coalesce(sa.can_login, false)
  limit 1;
  if not found then return 'NONE'; end if;
  if v_role in ('general_manager','executive_manager','branches_manager','admin') then return 'ALL'; end if;
  -- فريق خدمة العملاء بيرفع ملف الفرعين، وفرعه بيتبدل كل شهر.
  if public.dawaa_cs_is_team_member_v1(v_actor_id) then return 'ALL'; end if;
  if v_branch_key = 'shokry' then return 'فرع شكري'; end if;
  if v_branch_key = 'elshamy' then return 'فرع الشامي'; end if;
  return 'NONE';
end;
$function$;

-- الحذف للإدارة بس، حتى لو النطاق ALL.
drop policy if exists sales_invoices_global_import_delete on public.sales_invoices;
create policy sales_invoices_global_import_delete on public.sales_invoices
  for delete to anon, authenticated
  using (
    ((select public.dawaa_current_sales_invoice_scope_v1(array['import_sales_invoices'])) = 'ALL')
    and not (select public.dawaa_cs_is_team_member_v1(public.dawaa_current_staff_account_id_strict()))
  );

drop policy if exists customer_analysis_delete_write_scope_v1 on public.customer_analysis;
create policy customer_analysis_delete_write_scope_v1 on public.customer_analysis
  for delete to anon, authenticated
  using (
    ((select public.dawaa_current_sales_invoice_scope_v1(array['import_sales_invoices'])) <> 'NONE')
    and not (select public.dawaa_cs_is_team_member_v1(public.dawaa_current_staff_account_id_strict()))
  );

delete from public.staff_permission_overrides o
using public.customer_service_daily_task_settings s
cross join lateral jsonb_array_elements(coalesce(s.members, '[]'::jsonb)) m
where s.id = 1 and o.staff_account_id::text = m->>'staff_account_id'
  and o.permission_key in ('import_sales_invoices', 'view_invoice_import', 'import_customers');

insert into public.staff_permission_overrides (staff_account_id, permission_key, allowed, reason)
select (m->>'staff_account_id')::uuid, k, true, 'فريق خدمة العملاء: رفع ملفات الصبح'
from public.customer_service_daily_task_settings s
cross join lateral jsonb_array_elements(coalesce(s.members, '[]'::jsonb)) m
cross join unnest(array['import_sales_invoices', 'view_invoice_import', 'import_customers']) k
where s.id = 1 and nullif(m->>'staff_account_id', '') is not null;

-- المشتريات: الرفع بس، مش الحسابات.
create or replace function public.purchase_review_import_actor_v1()
returns uuid language plpgsql stable security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor uuid := public.dawaa_current_staff_account_id_strict();
begin
  if v_actor is not null and exists (
    select 1 from public.staff_accounts sa
    where sa.id = v_actor and sa.active is true and sa.can_login is true
      and lower(btrim(coalesce(sa.role, ''))) in ('general_manager', 'admin', 'executive_manager')
  ) then
    return v_actor;
  end if;
  if public.dawaa_cs_is_team_member_v1(v_actor)
     and public.dawaa_current_actor_can(array['customer_service_daily_tasks']) then
    return v_actor;
  end if;
  raise exception 'not_authorized' using errcode = '42501';
end;
$$;
revoke all on function public.purchase_review_import_actor_v1() from public, anon, authenticated;
grant execute on function public.purchase_review_import_actor_v1() to anon, authenticated;

create or replace function public.import_purchase_review_file_v1(p_store text, p_branch text, p_file_name text, p_report_net numeric, p_invoices jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := public.purchase_review_import_actor_v1();
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

-- أسماء الموردين وأكوادهم، عشان تقرير المشتريات المجمّع بالمورد (فيه أسماء بس) يتملا أكواده.
create or replace function public.dawaa_cs_purchase_suppliers_v1()
returns jsonb language plpgsql stable security definer
set search_path = public, pg_catalog
as $$
begin
  perform public.purchase_review_import_actor_v1();
  return coalesce((
    select jsonb_agg(jsonb_build_object('code', t.supplier_code, 'name', t.supplier_name) order by t.supplier_code)
    from public.purchase_review_supplier_terms t
    where nullif(btrim(t.supplier_code), '') is not null and nullif(btrim(t.supplier_name), '') is not null
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.dawaa_cs_purchase_suppliers_v1() from public, anon, authenticated;
grant execute on function public.dawaa_cs_purchase_suppliers_v1() to anon, authenticated;

-- آخر رفع لكل ملف، عشان التشيك ليست تقول اترفع ولا لسه.
create or replace function public.dawaa_cs_morning_uploads_v1()
returns jsonb language plpgsql stable security definer
set search_path = public, pg_catalog
as $$
declare
  a public.staff_accounts := public.dawaa_cs_tasks_actor_v1(false);
  v_since timestamptz := now() - interval '10 days';
begin
  return jsonb_build_object(
    'now', now(),
    'purchases', coalesce((
      select jsonb_agg(jsonb_build_object('store', u.store, 'branch', u.branch, 'uploaded_at', u.uploaded_at,
               'last_day', u.last_day,
               'last_invoice_at', (select max(i.invoice_at) from public.purchase_review_invoices i where i.store = u.store))
             order by u.branch, u.store)
      from (select distinct on (store) store, branch, uploaded_at, last_day
            from public.purchase_review_uploads order by store, uploaded_at desc) u
    ), '[]'::jsonb),
    'sales', coalesce((
      select jsonb_agg(jsonb_build_object('branch', s.branch, 'last_invoice_at', s.last_at, 'uploaded_at', s.up_at))
      from (select branch, max(invoice_date) last_at, max(created_at) up_at
            from public.sales_invoices
            where branch in ('فرع شكري', 'فرع الشامي') and invoice_date >= v_since
            group by branch) s
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('branch', s.branch, 'last_invoice_at', s.last_at, 'uploaded_at', s.up_at))
      from (select branch, max(invoice_date) last_at, max(created_at) up_at
            from public.sales_invoice_items_v21
            where branch in ('فرع شكري', 'فرع الشامي') and invoice_date >= v_since
            group by branch) s
    ), '[]'::jsonb),
    'customers', jsonb_build_object(
      'uploaded_at', (select max(c.updated_at) from public.customers c where c.updated_at >= v_since),
      'added_at', (select max(c.created_at) from public.customers c where c.created_at >= v_since))
  );
end;
$$;
revoke all on function public.dawaa_cs_morning_uploads_v1() from public, anon, authenticated;
grant execute on function public.dawaa_cs_morning_uploads_v1() to anon, authenticated;

-- ─── ٢) العميل الجديد خطوة بخطوة ─────────────────────────────────────────────────────────────────────────────────

-- رسالة الترحيب باسم العميل والفرع (القالب النشط اللي عليه الدور).
create or replace function public.dawaa_cs_welcome_text_v1(p_name text, p_branch text)
returns text language sql stable security definer
set search_path = public, pg_catalog
as $$
  select replace(replace(replace(coalesce(
      (select coalesce(t.body, t.message_body)
       from public.customer_welcome_message_templates t
       where coalesce(t.is_active, t.active, false)
         and coalesce(t.customer_segment, '') = ''
         and (t.branch in (p_branch, 'حسب الفرع', 'عام') or t.branch_name in (p_branch, 'حسب الفرع', 'عام'))
       order by (t.branch = p_branch or t.branch_name = p_branch) desc,
                (t.branch = 'حسب الفرع' or t.branch_name = 'حسب الفرع') desc, t.priority desc nulls last
       limit 1),
      'أهلاً بحضرتك أ/ {customer_name} 🌷' || chr(10) || 'صيدليات دواء {branch_name} بتتشرف بانضمام حضرتك لعملائنا.'),
    '{customer_name}', coalesce(nullif(btrim(p_name), ''), 'حضرتك')),
    '{branch_name}', replace(coalesce(p_branch, ''), 'فرع ', '')),
    chr(13), '');
$$;
revoke all on function public.dawaa_cs_welcome_text_v1(text, text) from public, anon, authenticated;
grant execute on function public.dawaa_cs_welcome_text_v1(text, text) to anon, authenticated;

-- عملاء اتقفلوا قبل كده (اتكودوا واترحب بيهم، أو اتقفلوا بمشكلة): رقم أو كود.
create or replace function public.dawaa_cs_onboarded_keys_v1(p_since date)
returns table (phone text, code text)
language sql stable security definer
set search_path = public, pg_catalog
as $$
  select nullif(right(regexp_replace(coalesce(q.customer_phone, ''), '\D', '', 'g'), 10), ''),
         coalesce(nullif(q.metadata->'onboard'->>'code', ''), q.customer_code)
  from public.customer_service_daily_queue_items q
  where q.source in ('new_customer', 'uncoded_note') and q.priority <> '1'
    and q.queue_date >= p_since and q.result is not null;
$$;
revoke all on function public.dawaa_cs_onboarded_keys_v1(date) from public, anon, authenticated;

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
           jsonb_build_object('invoice', n.invoice_number, 'value', round(n.net), 'seller', n.seller, 'note', n.notes,
                              'invoice_at', coalesce(n.invoice_datetime, n.invoice_date))
    from n
    where not exists (
        select 1 from public.customers c
        where c.normalized_phone = n.ph or c.phone = n.ph or c.whatsapp_phone = n.ph or c.mobile = n.ph or c.customer_phone = n.ph)
      and not exists (select 1 from known k where k.ph = n.ph)
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

-- شيت العملاء الجداد: كل اللي البنت محتاجاه عشان تكوّد وتسجّل وترحّب من غير ما تفتح حاجة تانية.
create or replace function public.dawaa_cs_onboarding_list_v1(p_date date, p_staff_account_id text default null, p_all boolean default false)
returns jsonb language plpgsql stable security definer
set search_path = public, pg_catalog
as $$
declare
  a public.staff_accounts := public.dawaa_cs_tasks_actor_v1(false);
  v_manage boolean := coalesce(public.dawaa_current_actor_can(array['customer_service_daily_tasks_manage']), false);
  v_who text;
begin
  v_who := case when v_manage and p_all then null
                when v_manage then coalesce(nullif(p_staff_account_id, ''), a.id::text)
                else a.id::text end;
  return coalesce((
    select jsonb_agg(x order by x->>'branch', x->>'source' desc, (x->>'invoice_at') nulls last)
    from (
      select jsonb_build_object(
        'id', q.id, 'queue_date', q.queue_date, 'branch', q.branch, 'source', q.source,
        'customer_code', q.customer_code, 'customer_name', q.customer_name,
        'customer_phone', coalesce(nullif(q.customer_phone, ''), cph.phone),
        'phone_from_file', nullif(q.customer_phone, '') is null and cph.phone is not null,
        'attempt_no', q.attempt_no, 'assigned_name', sa.name, 'result', q.result,
        'carried_from_date', q.metadata->>'carried_from_date',
        'invoice', coalesce(q.metadata->>'invoice', inv.invoice_number),
        'value', coalesce((q.metadata->>'value')::numeric, inv.net),
        'seller', coalesce(q.metadata->>'seller', inv.seller),
        'invoice_at', coalesce(inv.at_time, (q.metadata->>'invoice_at')::timestamptz),
        'note', coalesce(q.metadata->>'note', inv.notes),
        'items', it.items,
        'onboard', q.metadata->'onboard',
        'welcome', public.dawaa_cs_welcome_text_v1(
                     coalesce(nullif(btrim(q.metadata->'onboard'->>'name'), ''), q.customer_name), q.branch),
        'code_check', ck.c
      ) as x
      from public.customer_service_daily_queue_items q
      left join public.staff_accounts sa on sa.id::text = q.assigned_staff_id
      left join lateral (
        -- العميل الجديد في شكري بيبقى من غير رقم لحد ما ملف العملاء يترفع.
        select nullif(regexp_replace(coalesce(nullif(c.normalized_phone, ''), nullif(c.whatsapp_phone, ''), nullif(c.phone, ''),
                                              nullif(c.mobile, ''), c.customer_phone, ''), '\D', '', 'g'), '') as phone
        from public.customers c
        where nullif(q.customer_phone, '') is null and q.customer_code is not null
          and q.customer_code in (c.effective_customer_code, c.customer_code, c.code)
        order by (coalesce(c.effective_branch, c.branch, c.branch_name) = q.branch) desc nulls last
        limit 1
      ) cph on true
      left join lateral (
        select o.invoice_number, o.invoice_date, coalesce(o.invoice_datetime, o.invoice_date) as at_time, coalesce(o.net_amount, o.total_amount, 0) net,
               coalesce(o.normalized_seller_name, o.seller_name) seller, o.notes
        from public.sales_invoices o
        where o.branch = q.branch
          and o.invoice_date >= (q.queue_date - 1 - (q.attempt_no - 1))::timestamp at time zone 'Africa/Cairo'
          and o.invoice_date < (q.queue_date - (q.attempt_no - 1))::timestamp at time zone 'Africa/Cairo'
          and (case when q.metadata ? 'invoice' then o.invoice_number = q.metadata->>'invoice'
                    else btrim(o.customer_code) = q.customer_code end)
        order by o.invoice_date desc
        limit 1
      ) inv on true
      left join lateral (
        select jsonb_agg(jsonb_build_object('name', l.product_name, 'qty', l.quantity) order by l.line_total desc nulls last) items
        from (
          select l.product_name, l.quantity, l.line_total
          from public.sales_invoice_items_v21 l
          where inv.invoice_number is not null and l.branch = q.branch and l.invoice_number = inv.invoice_number
            and l.invoice_date >= inv.invoice_date - interval '1 day' and l.invoice_date <= inv.invoice_date + interval '1 day'
          order by l.line_total desc nulls last
          limit 6
        ) l
      ) it on true
      left join lateral (
        -- بعد ما ملف العملاء يترفع: الكود اللي اتكتب لقيناه؟ وبنفس الرقم؟
        select case
          when nullif(q.metadata->'onboard'->>'code', '') is null then null
          else coalesce((
            select jsonb_build_object(
              'status', case when bool_or(regexp_replace(coalesce(c.normalized_phone, '') || ' ' || coalesce(c.phone, '') || ' ' ||
                                    coalesce(c.whatsapp_phone, '') || ' ' || coalesce(c.customer_phone, ''), '[^0-9 ]', '', 'g')
                                    like '%' || right(regexp_replace(coalesce(q.customer_phone, ''), '\D', '', 'g'), 10) || '%')
                             then 'match' else 'other_phone' end,
              'name', max(coalesce(c.customer_name, c.name)))
            from public.customers c
            where q.metadata->'onboard'->>'code' in (c.effective_customer_code, c.customer_code, c.code)
            having count(*) > 0
          ), jsonb_build_object('status', 'not_yet'))
        end c
      ) ck on true
      where q.queue_date = p_date
        and q.source in ('new_customer', 'uncoded_note') and q.priority <> '1'
        and (v_who is null or q.assigned_staff_id = v_who)
    ) t
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.dawaa_cs_onboarding_list_v1(date, text, boolean) from public, anon, authenticated;
grant execute on function public.dawaa_cs_onboarding_list_v1(date, text, boolean) to anon, authenticated;

-- رفع شيت العملاء الجداد. الصف بيتقفل لما يخلص (الكود للي مش متكود + اتسجل على التليفون + الترحيب اتبعت أو مالوش واتساب)
-- أو لما يتقفل بمشكلة؛ غير كده بيتحفظ اللي اتعمل ويرجع بكرة.
create or replace function public.dawaa_cs_onboarding_submit_v1(p_rows jsonb)
returns jsonb language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  a public.staff_accounts := public.dawaa_cs_tasks_actor_v1(false);
  v_manage boolean := coalesce(public.dawaa_current_actor_can(array['customer_service_daily_tasks_manage']), false);
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  r jsonb;
  q public.customer_service_daily_queue_items;
  v_code text;
  v_saved boolean;
  v_welcome text;
  v_problem text;
  v_onboard jsonb;
  v_done boolean;
  v_result text;
  v_other record;
  v_done_n integer := 0;
  v_partial_n integer := 0;
  v_warnings jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 400 then
    raise exception 'الشيت فيه صفوف أكتر من المسموح';
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    select * into q from public.customer_service_daily_queue_items where id = nullif(r->>'id', '')::uuid for update;
    if not found then v_skipped := v_skipped || jsonb_build_object('id', r->>'id', 'why', 'العميل ده مش موجود في المهام'); continue; end if;
    if q.source not in ('new_customer', 'uncoded_note') then continue; end if;
    if q.queue_date < v_today - 3 then v_skipped := v_skipped || jsonb_build_object('id', q.id, 'name', q.customer_name, 'why', 'شيت قديم'); continue; end if;
    if q.assigned_staff_id is distinct from a.id::text and not v_manage then
      v_skipped := v_skipped || jsonb_build_object('id', q.id, 'name', q.customer_name, 'why', 'العميل ده مش عليك'); continue;
    end if;
    if q.result is not null then continue; end if;

    v_code := nullif(regexp_replace(translate(coalesce(r->>'code', ''), '٠١٢٣٤٥٦٧٨٩', '0123456789'), '\D', '', 'g'), '');
    if nullif(btrim(coalesce(r->>'code', '')), '') is not null and v_code is null then
      v_skipped := v_skipped || jsonb_build_object('id', q.id, 'name', q.customer_name, 'why', 'الكود لازم يبقى أرقام بس');
      continue;
    end if;
    if v_code in ('7', '5', '10', '20', '54', '170', '4902', '12820') then
      v_skipped := v_skipped || jsonb_build_object('id', q.id, 'name', q.customer_name,
        'why', 'الكود ' || v_code || ' ده كود عام مش كود عميل');
      continue;
    end if;
    v_saved := case r->>'saved' when 'yes' then true when 'no' then false end;
    v_welcome := case when r->>'welcome' in ('sent', 'no_whatsapp', 'pending') then r->>'welcome' end;
    v_problem := case when r->>'problem' in ('wrong_number', 'not_customer', 'refused', 'already_coded') then r->>'problem' end;
    if v_problem = 'already_coded' and v_code is null and q.source = 'uncoded_note' then
      v_skipped := v_skipped || jsonb_build_object('id', q.id, 'name', q.customer_name,
        'why', '«متكود قبل كده»: اكتبي الكود القديم في خانة الكود');
      continue;
    end if;
    if v_saved is null and v_welcome is null and v_problem is null and v_code is null
       and nullif(btrim(coalesce(r->>'note', '')), '') is null then
      continue;
    end if;

    -- الكود مكتوب لعميل تاني في ملف العملاء؟
    if v_code is not null and q.source = 'uncoded_note' then
      select coalesce(c.customer_name, c.name) as name,
             nullif(regexp_replace(coalesce(nullif(c.normalized_phone, ''), nullif(c.whatsapp_phone, ''), nullif(c.phone, ''), c.customer_phone, ''), '\D', '', 'g'), '') as phone
        into v_other
      from public.customers c
      where v_code in (c.effective_customer_code, c.customer_code, c.code)
      limit 1;
      if found and v_other.phone is not null
         and right(v_other.phone, 10) <> right(regexp_replace(coalesce(q.customer_phone, ''), '\D', '', 'g'), 10) then
        v_warnings := v_warnings || jsonb_build_object('id', q.id, 'name', q.customer_name,
          'why', format('الكود %s متسجل في ملف العملاء باسم «%s» برقم تاني (%s). اتأكدي إنك كتبتي الكود الصح.',
                        v_code, coalesce(v_other.name, '—'), v_other.phone));
      end if;
    end if;

    v_onboard := coalesce(q.metadata->'onboard', '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
      'code', v_code, 'saved', v_saved, 'welcome', v_welcome, 'problem', v_problem,
      'by', coalesce(a.name, a.username), 'at', now()));
    v_done := v_problem is not null
      or (coalesce((v_onboard->>'saved')::boolean, false)
          and v_onboard->>'welcome' in ('sent', 'no_whatsapp')
          and (q.source <> 'uncoded_note' or nullif(v_onboard->>'code', '') is not null));

    if v_done then
      v_result := case v_problem
        when 'wrong_number' then 'wrong_number'
        when 'not_customer' then 'not_needed'
        when 'refused' then 'not_needed'
        else 'registered' end;
      update public.customer_service_daily_queue_items
      set result = v_result,
          reach = case when v_problem = 'wrong_number' then 'wrong_number' else 'answered' end,
          outcome = case v_result when 'registered' then 'registered' when 'not_needed' then 'not_needed' end,
          contact_channel = case when v_onboard->>'welcome' = 'no_whatsapp' then 'call' else 'whatsapp' end,
          customer_code = coalesce(customer_code, nullif(v_onboard->>'code', '')),
          result_note = coalesce(nullif(btrim(coalesce(r->>'note', '')), ''), result_note),
          next_followup_date = case when v_result = 'registered' then queue_date + 7 end,
          status = 'completed', started_at = coalesce(started_at, now()), completed_at = now(), last_action_at = now(),
          assigned_staff_id = coalesce(assigned_staff_id, a.id::text),
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('onboard', v_onboard)
      where id = q.id;
      v_done_n := v_done_n + 1;
    else
      update public.customer_service_daily_queue_items
      set status = 'in_progress', started_at = coalesce(started_at, now()), last_action_at = now(),
          result_note = coalesce(nullif(btrim(coalesce(r->>'note', '')), ''), result_note),
          assigned_staff_id = coalesce(assigned_staff_id, a.id::text),
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('onboard', v_onboard)
      where id = q.id;
      v_partial_n := v_partial_n + 1;
    end if;

    insert into public.customer_service_followup_events (queue_item_id, event_type, event_status, actor_staff_id, actor_name, notes, metadata)
    values (q.id, 'onboarding_step', case when v_done then coalesce(v_result, 'done') else 'partial' end,
            a.id::text, coalesce(a.name, a.username), nullif(btrim(coalesce(r->>'note', '')), ''),
            jsonb_build_object('source', q.source, 'via', 'sheet', 'onboard', v_onboard));
  end loop;

  return jsonb_build_object('done', v_done_n, 'partial', v_partial_n, 'warnings', v_warnings, 'skipped', v_skipped);
end;
$$;
revoke all on function public.dawaa_cs_onboarding_submit_v1(jsonb) from public, anon, authenticated;
grant execute on function public.dawaa_cs_onboarding_submit_v1(jsonb) to anon, authenticated;

-- «آخر تحديث للعملاء» في ملفات الصبح كان بيقرا الجدول كله.
create index if not exists customers_updated_at_idx_v1 on public.customers (updated_at);
