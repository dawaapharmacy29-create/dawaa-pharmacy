-- فهم رسايل جروب المتابعات (صاحب الصيدلية 2026-11-25): الصفحة بتقرا كل رسالة وتطلّع نوع المتابعة والمطلوب من البنت
-- والأصناف والمريض وميعاد المتابعة لو الدكتور حدده، والبنت بتراجعها قبل الحفظ. هنا بيتحفظوا مع الحالة، والمهمة
-- بتتكتب بيهم في الشيت، وبتنزل في يوم الميعاد اللي الدكتور طلبه (حتى لو الرسالة أقدم من ٣ أيام).

alter table public.cs_group_followups
  add column if not exists kind text,
  add column if not exists brief text,
  add column if not exists due_date date,
  add column if not exists items jsonb not null default '[]'::jsonb,
  add column if not exists patient text,
  add column if not exists urgent boolean not null default false;
create index if not exists cs_group_followups_due_idx on public.cs_group_followups (branch, due_date) where due_date is not null;

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
           left(nullif(btrim(x.customer_name), ''), 120) as cname,
           case when x.kind in ('health', 'treatment', 'refill', 'price', 'shortage', 'complaint', 'win_back', 'congrats',
                                'register', 'general') then x.kind end as kind,
           left(nullif(btrim(x.brief), ''), 900) as brief,
           case when x.due_date ~ '^\d{4}-\d{2}-\d{2}$' then x.due_date::date end as due_date,
           case when jsonb_typeof(x.items) = 'array' then x.items else '[]'::jsonb end as items,
           left(nullif(btrim(x.patient), ''), 60) as patient,
           coalesce(x.urgent, false) as urgent
    from jsonb_to_recordset(p_rows) as x(fingerprint text, sender text, sent_at_local text, body text, staff_id text,
                                         customer_code text, customer_phone text, customer_name text, kind text,
                                         brief text, due_date text, items jsonb, patient text, urgent boolean)
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
      customer_phone, customer_name, body, file_name, imported_by, imported_by_name, kind, brief, due_date, items, patient, urgent)
    values (r.fingerprint, v_branch, r.sent_local at time zone 'Africa/Cairo', r.sent_local::date, r.sender, v_staff, r.code,
            r.phone, r.cname, left(r.body, 2000), left(p_file_name, 200), a.id, v_name, r.kind, r.brief,
            case when r.due_date between r.sent_local::date and r.sent_local::date + 60 then r.due_date end,
            r.items, r.patient, r.urgent)
    on conflict (fingerprint) do update
      set customer_code = coalesce(g.customer_code, excluded.customer_code),
          customer_phone = coalesce(g.customer_phone, excluded.customer_phone),
          customer_name = coalesce(g.customer_name, excluded.customer_name),
          staff_id = coalesce(g.staff_id, excluded.staff_id),
          kind = coalesce(excluded.kind, g.kind),
          brief = coalesce(excluded.brief, g.brief),
          due_date = coalesce(excluded.due_date, g.due_date),
          items = case when excluded.items <> '[]'::jsonb then excluded.items else g.items end,
          patient = coalesce(excluded.patient, g.patient),
          urgent = excluded.urgent or g.urgent;
    v_saved := v_saved + 1;
  end loop;

  -- المهام: الحالات اللي لسه مالهاش مهمة، فيها عميل، واتبعتت في آخر ٣ أيام.
  for r in
    select g.* from public.cs_group_followups g
    where g.branch = v_branch and g.task_id is null and (g.request_day >= v_today - 3 or g.due_date >= v_today)
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
    values (greatest(v_today, coalesce(r.due_date, v_today)), v_branch, v_key, r.customer_code,
            coalesce(r.customer_name, v_cust.name, r.customer_code, r.customer_phone),
            coalesce(r.customer_phone, v_cust.phone),
            'doctor_case', '1',
            coalesce(r.brief, 'من جروب المتابعات: ' || left(regexp_replace(r.body, '\s+', ' ', 'g'), 300)), 'not_started',
            public.dawaa_cs_branch_member_v1(v_branch, greatest(v_today, coalesce(r.due_date, v_today))),
            greatest(v_today, coalesce(r.due_date, v_today)), a.id::text, v_name,
            jsonb_build_object('doctor', v_doctor, 'group_followup', r.fingerprint, 'sent_at', r.sent_at,
                               'kind', r.kind, 'items', r.items, 'due_date', r.due_date, 'patient', r.patient,
                               'urgent', r.urgent, 'doctor_note', left(r.body, 600)))
    on conflict (queue_date, branch, customer_key) do update
      set reason = t.reason || E'\n—\n' || excluded.reason,
          priority = '1',
          metadata = t.metadata || jsonb_build_object('group_followup', r.fingerprint, 'doctor', v_doctor)
    returning id into v_task;
    update public.cs_group_followups set task_id = v_task, task_date = greatest(v_today, coalesce(r.due_date, v_today))
    where fingerprint = r.fingerprint;
    v_tasks := v_tasks + 1;
  end loop;

  select count(*) filter (where g.customer_code is null and g.customer_phone is null),
         count(*) filter (where g.task_id is null and g.request_day < v_today - 3 and coalesce(g.due_date, v_today - 1) < v_today
                          and (g.customer_code is not null or g.customer_phone is not null))
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
             'result', q.result, 'assigned_name', sa.name, 'kind', g.kind, 'brief', g.brief, 'due_date', g.due_date,
             'items', g.items, 'patient', g.patient, 'urgent', g.urgent)
           order by g.sent_at desc), '[]'::jsonb)
    from public.cs_group_followups g
    left join public.staff s on s.id = g.staff_id
    left join public.customer_service_daily_queue_items q on q.id = g.task_id
    left join public.staff_accounts sa on sa.id::text = q.assigned_staff_id
    where (p_branch is null or g.branch = p_branch) and (g.request_day >= v_from or g.due_date >= v_from));
end;
$$;
revoke all on function public.dawaa_cs_group_followups_list_v1(text, date) from public, anon, authenticated;
grant execute on function public.dawaa_cs_group_followups_list_v1(text, date) to anon, authenticated;
