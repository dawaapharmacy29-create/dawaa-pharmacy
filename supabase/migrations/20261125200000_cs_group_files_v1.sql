-- جروبات الواتساب لفريق خدمة العملاء (صاحب الصيدلية 2026-11-25):
--   ١) جروب المتابعات: البنت ترفع التصدير، وكل حالة فيها كود أو رقم عميل بتبقى مهمة «حالة من الدكتور» في شيت النهارده
--      (بدل ما تكتبها بإيدها في «حالات الدكاترة»)، وبتتحسب للدكتور في المسابقة زي رفع المدير بالظبط.
--   ٢) جروب الطلبات: البنت ترفع التصدير، والطلبات بتتسجل بأصنافها وكمياتها، ويتابعوها بحالة
--      (جديد ← بنوفره ← اتوفر ← اتبلغ ← اتسلم / اتلغى)، وتتصدر إكسيل. لما الطلب يبقى «اتوفر» بتتعمل مهمة «طلب نواقص»
--      في شيت النهارده عشان العميل يتبلغ.
-- المدير العام لسه يقدر يرفع من صفحاته القديمة؛ نفس البصمة (fingerprint) بتمنع التكرار.

-- ---------- مين يقدر ----------
create or replace function public.dawaa_cs_group_actor_v1()
returns public.staff_accounts language plpgsql stable security definer
set search_path = public, pg_catalog
as $$
declare
  a public.staff_accounts;
begin
  if coalesce(public.dawaa_current_actor_can(array['manage_staff_accounts']), false) then
    select * into a from public.staff_accounts where id = public.dawaa_current_staff_account_id_strict();
    return a;
  end if;
  return public.dawaa_cs_tasks_actor_v1(false);
end;
$$;
revoke all on function public.dawaa_cs_group_actor_v1() from public, anon, authenticated;

-- توزيع مهمة على اللي ماسكة الفرع (وأقلهم مهام النهارده)، زي العملاء الجداد.
create or replace function public.dawaa_cs_branch_member_v1(p_branch text, p_day date)
returns text language sql stable security definer set search_path = public, pg_catalog
as $$
  select d.member
  from (
    select x->>'staff_account_id' as member, public.dawaa_cs_member_branch_v1(x, p_day) as home
    from public.customer_service_daily_task_settings s
    cross join lateral jsonb_array_elements(coalesce(s.members, '[]'::jsonb)) x
    where s.id = 1 and not coalesce((x->>'on_leave')::boolean, false) and nullif(x->>'staff_account_id', '') is not null
  ) d
  order by (d.home is not distinct from p_branch) desc,
           (select count(*) from public.customer_service_daily_queue_items z
            where z.queue_date = p_day and z.assigned_staff_id = d.member)
  limit 1
$$;
revoke all on function public.dawaa_cs_branch_member_v1(text, date) from public, anon, authenticated;

-- اسم ورقم العميل من ملف العملاء بالكود.
create or replace function public.dawaa_cs_customer_by_code_v1(p_code text, p_branch text,
  out name text, out phone text)
language sql stable security definer set search_path = public, pg_catalog
as $$
  select nullif(btrim(coalesce(c.customer_name, c.name, '')), ''),
         nullif(regexp_replace(coalesce(nullif(c.normalized_phone, ''), nullif(c.whatsapp_phone, ''), nullif(c.phone, ''),
                                        nullif(c.mobile, ''), c.customer_phone, ''), '\D', '', 'g'), '')
  from public.customers c
  where p_code is not null and p_code in (c.effective_customer_code, c.customer_code, c.code)
  order by (coalesce(c.effective_branch, c.branch, c.branch_name) = p_branch) desc nulls last
  limit 1
$$;
revoke all on function public.dawaa_cs_customer_by_code_v1(text, text) from public, anon, authenticated;

-- ---------- ١) جروب المتابعات ----------
create table if not exists public.cs_group_followups (
  fingerprint text primary key,
  branch text not null,
  sent_at timestamptz not null,
  request_day date not null,
  sender text,
  staff_id uuid,
  customer_code text,
  customer_phone text,
  customer_name text,
  body text,
  task_id uuid,
  task_date date,
  file_name text,
  imported_by uuid,
  imported_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists cs_group_followups_day_idx on public.cs_group_followups (branch, request_day desc);
alter table public.cs_group_followups enable row level security;
revoke all on table public.cs_group_followups from public, anon, authenticated;

-- كل صف: {fingerprint, sender, sent_at_local, body, staff_id, customer_code, customer_phone, customer_name}.
-- الحالة اللي فيها كود أو رقم واتبعتت في آخر ٣ أيام بتبقى مهمة النهارده (مرة واحدة بس).
create or replace function public.dawaa_cs_group_followups_import_v1(p_file_name text, p_branch text, p_rows jsonb)
returns jsonb language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  a public.staff_accounts := public.dawaa_cs_group_actor_v1();
  v_name text := coalesce(nullif(btrim(a.name), ''), a.username);
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_branch text := nullif(btrim(p_branch), '');
  r record;
  v_staff uuid;
  v_cust record;
  v_key text;
  v_task uuid;
  v_doctor text;
  v_saved int := 0;
  v_tasks int := 0;
  v_credited int := 0;
  v_old int := 0;
  v_no_customer int := 0;
  v_n int;
begin
  if v_branch not in ('فرع شكري', 'فرع الشامي') then raise exception 'group_invalid_branch'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 3000 then
    raise exception 'group_invalid_rows';
  end if;

  for r in
    select nullif(btrim(x.fingerprint), '') as fingerprint, x.sender, x.sent_at_local::timestamp as sent_local,
           coalesce(x.body, '') as body, nullif(btrim(x.staff_id), '') as named,
           nullif(btrim(x.customer_code), '') as code,
           nullif(right(regexp_replace(coalesce(x.customer_phone, ''), '\D', '', 'g'), 11), '') as phone,
           left(nullif(btrim(x.customer_name), ''), 120) as cname
    from jsonb_to_recordset(p_rows) as x(fingerprint text, sender text, sent_at_local text, body text, staff_id text,
                                         customer_code text, customer_phone text, customer_name text)
  loop
    if r.fingerprint is null or r.sent_local is null then continue; end if;
    -- نفس قاعدة رفع المدير: الرقم المربوط بالدكتور، أو الدكتور المكتوب اسمه (من دكاترة المسابقة).
    v_staff := coalesce(
      (select min(x.staff_id::text)::uuid from public.staff_identity_aliases x
        where x.active and x.normalized_alias = public.dawaa_normalize_staff_alias_v1(r.sender)
       having count(distinct x.staff_id) = 1),
      (select c.staff_id::uuid from public.get_competition_doctor_accounts_v1() c where c.staff_id::text = r.named));
    if v_staff is not null then
      insert into public.doctor_followup_request_log_v1 (fingerprint, staff_id, sent_at, request_day, sender_name, file_name, imported_by, branch)
      values (md5(public.dawaa_normalize_staff_alias_v1(r.sender) || '|' || r.sent_local::text || '|' || regexp_replace(r.body, '\s+', '', 'g')),
              v_staff, r.sent_local at time zone 'Africa/Cairo', r.sent_local::date, r.sender, left(p_file_name, 200),
              a.id::text, v_branch)
      on conflict (fingerprint) do nothing;
      get diagnostics v_n = row_count;
      v_credited := v_credited + v_n;
    end if;

    insert into public.cs_group_followups as g (fingerprint, branch, sent_at, request_day, sender, staff_id, customer_code,
      customer_phone, customer_name, body, file_name, imported_by, imported_by_name)
    values (r.fingerprint, v_branch, r.sent_local at time zone 'Africa/Cairo', r.sent_local::date, r.sender, v_staff, r.code,
            r.phone, r.cname, left(r.body, 2000), left(p_file_name, 200), a.id, v_name)
    on conflict (fingerprint) do update
      set customer_code = coalesce(g.customer_code, excluded.customer_code),
          customer_phone = coalesce(g.customer_phone, excluded.customer_phone),
          customer_name = coalesce(g.customer_name, excluded.customer_name),
          staff_id = coalesce(g.staff_id, excluded.staff_id);
    v_saved := v_saved + 1;
  end loop;

  -- المهام: الحالات اللي لسه مالهاش مهمة، فيها عميل، واتبعتت في آخر ٣ أيام.
  for r in
    select g.* from public.cs_group_followups g
    where g.branch = v_branch and g.task_id is null and g.request_day >= v_today - 3
      and (g.customer_code is not null or g.customer_phone is not null)
      and g.fingerprint in (select nullif(btrim(x->>'fingerprint'), '') from jsonb_array_elements(p_rows) x)
    order by g.sent_at
  loop
    select * into v_cust from public.dawaa_cs_customer_by_code_v1(r.customer_code, v_branch);
    v_key := case when r.customer_code is not null then 'c:' || r.customer_code else 'p:' || right(r.customer_phone, 10) end;
    v_doctor := coalesce((select s.name from public.staff s where s.id = r.staff_id), r.sender);
    insert into public.customer_service_daily_queue_items as t
      (queue_date, branch, customer_key, customer_code, customer_name, customer_phone, source, priority, reason, status,
       assigned_staff_id, next_followup_date, created_by, created_by_name, metadata)
    values (v_today, v_branch, v_key, r.customer_code,
            coalesce(r.customer_name, v_cust.name, r.customer_code, r.customer_phone),
            coalesce(r.customer_phone, v_cust.phone),
            'doctor_case', '1', 'من جروب المتابعات: ' || left(regexp_replace(r.body, '\s+', ' ', 'g'), 300), 'not_started',
            public.dawaa_cs_branch_member_v1(v_branch, v_today), v_today, a.id::text, v_name,
            jsonb_build_object('doctor', v_doctor, 'group_followup', r.fingerprint, 'sent_at', r.sent_at))
    on conflict (queue_date, branch, customer_key) do update
      set reason = t.reason || ' | حالة دكتور: ' || excluded.reason,
          priority = '1',
          metadata = t.metadata || jsonb_build_object('group_followup', r.fingerprint, 'doctor', v_doctor)
    returning id into v_task;
    update public.cs_group_followups set task_id = v_task, task_date = v_today where fingerprint = r.fingerprint;
    v_tasks := v_tasks + 1;
  end loop;

  select count(*) filter (where g.customer_code is null and g.customer_phone is null),
         count(*) filter (where g.task_id is null and g.request_day < v_today - 3 and (g.customer_code is not null or g.customer_phone is not null))
    into v_no_customer, v_old
  from public.cs_group_followups g
  where g.fingerprint in (select nullif(btrim(x->>'fingerprint'), '') from jsonb_array_elements(p_rows) x);

  return jsonb_build_object('saved', v_saved, 'tasks', v_tasks, 'credited', v_credited,
                            'no_customer', v_no_customer, 'old', v_old);
end;
$$;
revoke all on function public.dawaa_cs_group_followups_import_v1(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.dawaa_cs_group_followups_import_v1(text, text, jsonb) to anon, authenticated;

-- اللي اترفع من جروب المتابعات (عشان الصفحة تعرض حالة كل رسالة: بقت مهمة، ولا محتاجة كود).
create or replace function public.dawaa_cs_group_followups_list_v1(p_branch text, p_from date default null)
returns jsonb language plpgsql stable security definer
set search_path = public, pg_catalog
as $$
declare
  a public.staff_accounts := public.dawaa_cs_group_actor_v1();
  v_from date := coalesce(p_from, (now() at time zone 'Africa/Cairo')::date - 3);
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'fingerprint', g.fingerprint, 'branch', g.branch, 'sent_at', g.sent_at, 'sender', g.sender,
             'doctor', coalesce(s.name, g.sender), 'customer_code', g.customer_code, 'customer_phone', g.customer_phone,
             'customer_name', g.customer_name, 'body', g.body, 'task_date', g.task_date,
             'result', q.result, 'assigned_name', sa.name)
           order by g.sent_at desc), '[]'::jsonb)
    from public.cs_group_followups g
    left join public.staff s on s.id = g.staff_id
    left join public.customer_service_daily_queue_items q on q.id = g.task_id
    left join public.staff_accounts sa on sa.id::text = q.assigned_staff_id
    where (p_branch is null or g.branch = p_branch) and g.request_day >= v_from);
end;
$$;
revoke all on function public.dawaa_cs_group_followups_list_v1(text, date) from public, anon, authenticated;
grant execute on function public.dawaa_cs_group_followups_list_v1(text, date) to anon, authenticated;

-- ---------- ٢) جروب الطلبات ----------
alter table public.customer_request_group_log_v1
  add column if not exists items jsonb not null default '[]'::jsonb,
  add column if not exists status text not null default 'new',
  add column if not exists status_note text,
  add column if not exists status_by uuid,
  add column if not exists status_by_name text,
  add column if not exists status_at timestamptz,
  add column if not exists notify_task_id uuid;
do $$ begin
  alter table public.customer_request_group_log_v1
    add constraint customer_request_group_log_v1_status_check
    check (status in ('new', 'sourcing', 'available', 'notified', 'delivered', 'cancelled'));
exception when duplicate_object then null; end $$;
create index if not exists customer_request_group_log_v1_day_idx on public.customer_request_group_log_v1 (branch, request_day desc);

create table if not exists public.cs_group_request_log (
  id bigint generated always as identity primary key,
  fingerprint text not null,
  before jsonb,
  after jsonb,
  by_id uuid,
  by_name text,
  at timestamptz not null default now()
);
create index if not exists cs_group_request_log_fp_idx on public.cs_group_request_log (fingerprint, at desc);
alter table public.cs_group_request_log enable row level security;
revoke all on table public.cs_group_request_log from public, anon, authenticated;

-- نفس import_customer_request_group_v2، بس الفريق يقدر يرفع، والأصناف بكمياتها بتتسجل.
create or replace function public.import_customer_request_group_v3(p_file_name text, p_branch text, p_rows jsonb)
returns jsonb language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  a public.staff_accounts := public.dawaa_cs_group_actor_v1();
  v_branch text := nullif(btrim(p_branch), '');
  v_total integer;
  v_new integer := 0;
  v_updated integer := 0;
  v_credited integer := 0;
  v_customers integer := 0;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'group_requests_invalid_rows' using errcode = '22023';
  end if;
  if v_branch is null or v_branch not in ('فرع شكري', 'فرع الشامي') then
    raise exception 'group_requests_invalid_branch' using errcode = '22023';
  end if;
  v_total := jsonb_array_length(p_rows);

  with rows_in as (
    select nullif(btrim(r.fingerprint), '') as fingerprint, r.sent_at_local::timestamp as sent_local, r.sender,
           nullif(btrim(r.customer_code), '') as customer_code, nullif(btrim(r.customer_phone), '') as customer_phone,
           left(coalesce(r.body, ''), 2000) as body, left(r.attribution, 40) as attribution,
           left(nullif(btrim(r.customer_name), ''), 120) as customer_name, left(nullif(btrim(r.details), ''), 400) as details,
           (select s.id from public.staff s where s.id::text = nullif(btrim(r.staff_id), '')) as staff_id,
           case when jsonb_typeof(r.items) = 'array' then r.items else '[]'::jsonb end as items
    from jsonb_to_recordset(p_rows) as r(fingerprint text, sent_at_local text, sender text, customer_code text,
                                         customer_phone text, body text, attribution text, staff_id text,
                                         customer_name text, details text, items jsonb)
  ), matched as (
    select i.*,
           coalesce(
             (select c.id from public.customers c
               where i.customer_code is not null and nullif(btrim(c.customer_code), '') = i.customer_code
               limit 1),
             (select min(c.id::text)::uuid from public.customers c
               where i.customer_phone is not null
                 and public.dawaa_sync_norm_phone(coalesce(c.customer_phone, c.phone, c.mobile, c.whatsapp_phone, c.whatsapp))
                     = public.dawaa_sync_norm_phone(i.customer_phone)
               having count(*) = 1)
           ) as customer_id
    from rows_in i
    where i.fingerprint is not null and (i.customer_code is not null or i.customer_phone is not null)
  ), upserted as (
    insert into public.customer_request_group_log_v1
      (fingerprint, staff_id, branch, sent_at, request_day, sender_name, customer_code, customer_phone, body,
       attribution, file_name, imported_by, customer_id, customer_name, details, items)
    select m.fingerprint, m.staff_id, v_branch, m.sent_local at time zone 'Africa/Cairo', m.sent_local::date, m.sender,
           m.customer_code, m.customer_phone, m.body, m.attribution, left(p_file_name, 200),
           a.id::text, m.customer_id, m.customer_name, m.details, m.items
    from matched m
    on conflict (fingerprint) do update set
      staff_id = coalesce(customer_request_group_log_v1.staff_id, excluded.staff_id),
      attribution = case when customer_request_group_log_v1.staff_id is null and excluded.staff_id is not null
                         then excluded.attribution else customer_request_group_log_v1.attribution end,
      customer_id = coalesce(customer_request_group_log_v1.customer_id, excluded.customer_id),
      customer_name = coalesce(customer_request_group_log_v1.customer_name, excluded.customer_name),
      details = coalesce(customer_request_group_log_v1.details, excluded.details),
      -- الأصناف اللي اتعدلت بإيد مابتتغيرش.
      items = case when customer_request_group_log_v1.items = '[]'::jsonb then excluded.items
                   else customer_request_group_log_v1.items end
    returning (xmax = 0) as inserted, staff_id, customer_id
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted),
         count(*) filter (where inserted and staff_id is not null), count(*) filter (where inserted and customer_id is not null)
    into v_new, v_updated, v_credited, v_customers
  from upserted;

  return jsonb_build_object('total', v_total, 'new', v_new, 'already', v_updated,
                            'credited', v_credited, 'customers', v_customers);
end;
$$;
revoke all on function public.import_customer_request_group_v3(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.import_customer_request_group_v3(text, text, jsonb) to anon, authenticated;

-- القايمة: بحث بالعميل (اسم/كود/رقم) أو الصنف أو الدكتور، وفلتر بالفرع والحالة والفترة.
create or replace function public.dawaa_cs_group_requests_list_v1(p_from date default null, p_to date default null,
  p_branch text default null, p_status text default null, p_q text default null)
returns jsonb language plpgsql stable security definer
set search_path = public, pg_catalog
as $$
declare
  a public.staff_accounts := public.dawaa_cs_group_actor_v1();
  v_to date := coalesce(p_to, (now() at time zone 'Africa/Cairo')::date);
  v_from date := coalesce(p_from, v_to - 30);
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
  v_digits text := translate(coalesce(v_q, ''), '٠١٢٣٤٥٦٧٨٩', '0123456789');
begin
  return jsonb_build_object(
    'from', v_from, 'to', v_to,
    'rows', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'fingerprint', g.fingerprint, 'branch', g.branch, 'sent_at', g.sent_at, 'day', g.request_day,
               'sender', g.sender_name, 'doctor', s.name, 'customer_code', g.customer_code,
               'customer_phone', coalesce(g.customer_phone, cust.phone), 'customer_name', coalesce(g.customer_name, cust.name),
               'details', g.details, 'body', g.body, 'items', g.items, 'status', g.status, 'status_note', g.status_note,
               'status_by', g.status_by_name, 'status_at', g.status_at, 'notify_task', g.notify_task_id is not null)
             order by g.sent_at desc), '[]'::jsonb)
      from public.customer_request_group_log_v1 g
      left join public.staff s on s.id = g.staff_id
      left join lateral public.dawaa_cs_customer_by_code_v1(g.customer_code, g.branch) cust on true
      where g.request_day between v_from and v_to
        and (p_branch is null or g.branch = p_branch)
        and (p_status is null or (p_status = 'open' and g.status in ('new', 'sourcing', 'available')) or g.status = p_status)
        and (v_q is null
             or g.customer_code = v_digits
             or right(regexp_replace(coalesce(g.customer_phone, ''), '\D', '', 'g'), 10) = right(v_digits, 10) and length(v_digits) >= 10
             or coalesce(g.customer_name, '') ilike '%' || v_q || '%'
             or coalesce(g.details, '') ilike '%' || v_q || '%'
             or g.items::text ilike '%' || v_q || '%'
             or coalesce(s.name, g.sender_name, '') ilike '%' || v_q || '%'))
  );
end;
$$;
revoke all on function public.dawaa_cs_group_requests_list_v1(date, date, text, text, text) from public, anon, authenticated;
grant execute on function public.dawaa_cs_group_requests_list_v1(date, date, text, text, text) to anon, authenticated;

-- تحديث طلب أو أكتر: الحالة و/أو الأصناف و/أو ملاحظة. كل صف: {fingerprint, status?, items?, note?}.
-- «اتوفر» بيعمل مهمة «طلب نواقص» في شيت النهارده عشان العميل يتبلغ (مرة واحدة للطلب).
create or replace function public.dawaa_cs_group_requests_update_v1(p_rows jsonb)
returns jsonb language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  a public.staff_accounts := public.dawaa_cs_group_actor_v1();
  v_name text := coalesce(nullif(btrim(a.name), ''), a.username);
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  r jsonb;
  g public.customer_request_group_log_v1;
  v_status text;
  v_items jsonb;
  v_task uuid;
  v_cust record;
  v_what text;
  v_saved int := 0;
  v_tasks int := 0;
begin
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    select * into g from public.customer_request_group_log_v1 where fingerprint = r->>'fingerprint' for update;
    if not found then continue; end if;
    v_status := coalesce(nullif(r->>'status', ''), g.status);
    if v_status not in ('new', 'sourcing', 'available', 'notified', 'delivered', 'cancelled') then
      raise exception 'group_invalid_status';
    end if;
    v_items := case when jsonb_typeof(r->'items') = 'array' then r->'items' else g.items end;

    insert into public.cs_group_request_log (fingerprint, before, after, by_id, by_name)
    values (g.fingerprint, jsonb_build_object('status', g.status, 'items', g.items, 'note', g.status_note),
            r - 'fingerprint', a.id, v_name);

    update public.customer_request_group_log_v1
       set status = v_status, items = v_items,
           status_note = case when r ? 'note' then nullif(btrim(r->>'note'), '') else status_note end,
           status_by = a.id, status_by_name = v_name, status_at = now()
     where fingerprint = g.fingerprint;
    v_saved := v_saved + 1;

    if v_status = 'available' and g.notify_task_id is null then
      select * into v_cust from public.dawaa_cs_customer_by_code_v1(g.customer_code, g.branch);
      v_what := coalesce(
        (select string_agg(coalesce(x->>'name', '') || coalesce(' × ' || nullif(x->>'qty', ''), ''), '، ')
         from jsonb_array_elements(v_items) x where nullif(btrim(x->>'name'), '') is not null),
        g.details, 'الطلب');
      insert into public.customer_service_daily_queue_items as t
        (queue_date, branch, customer_key, customer_code, customer_name, customer_phone, source, priority, reason, status,
         assigned_staff_id, next_followup_date, created_by, created_by_name, metadata)
      values (v_today, g.branch,
              case when g.customer_code is not null then 'c:' || g.customer_code
                   else 'p:' || right(regexp_replace(g.customer_phone, '\D', '', 'g'), 10) end,
              g.customer_code, coalesce(g.customer_name, v_cust.name, g.customer_code, g.customer_phone),
              coalesce(nullif(regexp_replace(coalesce(g.customer_phone, ''), '\D', '', 'g'), ''), v_cust.phone),
              'request', '1', 'طلبه اتوفر: ' || left(v_what, 250), 'not_started',
              public.dawaa_cs_branch_member_v1(g.branch, v_today), v_today, a.id::text, v_name,
              jsonb_build_object('group_request', g.fingerprint))
      on conflict (queue_date, branch, customer_key) do update
        set reason = t.reason || ' | ' || excluded.reason, priority = '1',
            metadata = t.metadata || jsonb_build_object('group_request', g.fingerprint)
      returning id into v_task;
      update public.customer_request_group_log_v1 set notify_task_id = v_task where fingerprint = g.fingerprint;
      v_tasks := v_tasks + 1;
    end if;
  end loop;
  return jsonb_build_object('saved', v_saved, 'tasks', v_tasks);
end;
$$;
revoke all on function public.dawaa_cs_group_requests_update_v1(jsonb) from public, anon, authenticated;
grant execute on function public.dawaa_cs_group_requests_update_v1(jsonb) to anon, authenticated;

-- الدكاترة (اللي بيتحسبلهم في المسابقة) عشان الصفحة تعرف مين اتكتب اسمه في الرسالة.
create or replace function public.dawaa_cs_group_doctors_v1()
returns jsonb language plpgsql stable security definer
set search_path = public, pg_catalog
as $$
declare
  a public.staff_accounts := public.dawaa_cs_group_actor_v1();
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('staff_id', c.staff_id, 'name', c.name, 'branch', c.branch)
                                    order by c.name), '[]'::jsonb)
          from public.get_competition_doctor_accounts_v1() c);
end;
$$;
revoke all on function public.dawaa_cs_group_doctors_v1() from public, anon, authenticated;
grant execute on function public.dawaa_cs_group_doctors_v1() to anon, authenticated;
