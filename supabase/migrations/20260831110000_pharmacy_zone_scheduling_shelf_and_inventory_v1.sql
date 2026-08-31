-- نظام جدول الرص والجرد الدوري لفرع الشامي (شيماء ويوسف عصام حاليًا، وشكري هينضاف
-- لاحقًا بنفس الطريقة — جدول قابل للتعديل، مش أسماء متسجلة في الكود).

create table if not exists public.pharmacy_zone_eligible_staff (
  staff_id uuid primary key references public.staff(id),
  branch text not null,
  added_at timestamptz not null default now(),
  note text
);
alter table public.pharmacy_zone_eligible_staff enable row level security;
revoke all on table public.pharmacy_zone_eligible_staff from public, anon, authenticated;

insert into public.pharmacy_zone_eligible_staff (staff_id, branch, note) values
  ('8088db32-c552-4f5b-9737-984d0d594b0c', 'فرع الشامي', 'د/ شيماء'),
  ('bc718b18-b361-43a4-90fb-f8d7f6884b9a', 'فرع الشامي', 'يوسف عصام')
on conflict (staff_id) do nothing;

-- القالب الأسبوعي: لكل (نوع مهمة، تعادل الأسبوع، اليوم، الموظف) منطقة مطلوبة.
-- بالنسبة للرص week_parity بيتبادل بين 0 و1 كل أسبوع (تبادل المناطق بين الاتنين).
-- بالنسبة للجرد بيتستخدم week_parity=0 بس (مفيش تبادل أسبوعي مطلوب حاليًا).
create table if not exists public.pharmacy_zone_schedule_template (
  id uuid primary key default gen_random_uuid(),
  task_kind text not null check (task_kind in ('shelf', 'inventory')),
  week_parity integer not null default 0 check (week_parity in (0, 1)),
  day_name text not null,
  staff_id uuid not null references public.staff(id),
  zone text not null,
  branch text not null,
  created_at timestamptz not null default now()
);
alter table public.pharmacy_zone_schedule_template enable row level security;
revoke all on table public.pharmacy_zone_schedule_template from public, anon, authenticated;

-- جدول الرص — تعادل 0
insert into public.pharmacy_zone_schedule_template (task_kind, week_parity, day_name, staff_id, zone, branch) values
  ('shelf', 0, 'الجمعة',   '8088db32-c552-4f5b-9737-984d0d594b0c', 'منطقة الأقراص والكبسول', 'فرع الشامي'),
  ('shelf', 0, 'الجمعة',   'bc718b18-b361-43a4-90fb-f8d7f6884b9a', 'المخزن الداخلي', 'فرع الشامي'),
  ('shelf', 0, 'الجمعة',   'bc718b18-b361-43a4-90fb-f8d7f6884b9a', 'الثلاجة', 'فرع الشامي'),
  ('shelf', 0, 'السبت',    '8088db32-c552-4f5b-9737-984d0d594b0c', 'منطقة المعمل', 'فرع الشامي'),
  ('shelf', 0, 'السبت',    'bc718b18-b361-43a4-90fb-f8d7f6884b9a', 'منطقة البامبرز والأولويز', 'فرع الشامي'),
  ('shelf', 0, 'الأحد',    '8088db32-c552-4f5b-9737-984d0d594b0c', 'منطقة الإكسسوار', 'فرع الشامي'),
  ('shelf', 0, 'الأحد',    'bc718b18-b361-43a4-90fb-f8d7f6884b9a', 'منطقة الأقراص والكبسول', 'فرع الشامي'),
  ('shelf', 0, 'الاثنين',  '8088db32-c552-4f5b-9737-984d0d594b0c', 'منطقة المستلزمات', 'فرع الشامي'),
  ('shelf', 0, 'الاثنين',  'bc718b18-b361-43a4-90fb-f8d7f6884b9a', 'منطقة المعمل', 'فرع الشامي'),
  ('shelf', 0, 'الثلاثاء', '8088db32-c552-4f5b-9737-984d0d594b0c', 'منطقة البامبرز والأولويز', 'فرع الشامي'),
  ('shelf', 0, 'الثلاثاء', 'bc718b18-b361-43a4-90fb-f8d7f6884b9a', 'منطقة الإكسسوار', 'فرع الشامي'),
  ('shelf', 0, 'الأربعاء', '8088db32-c552-4f5b-9737-984d0d594b0c', 'الثلاجة', 'فرع الشامي'),
  ('shelf', 0, 'الأربعاء', '8088db32-c552-4f5b-9737-984d0d594b0c', 'المخزن الداخلي', 'فرع الشامي'),
  ('shelf', 0, 'الخميس',   'bc718b18-b361-43a4-90fb-f8d7f6884b9a', 'منطقة المستلزمات', 'فرع الشامي')
on conflict do nothing;

-- جدول الرص — تعادل 1 (نفس المناطق بس متبادلة بين الاتنين، كل واحد على أيامه الحقيقية)
insert into public.pharmacy_zone_schedule_template (task_kind, week_parity, day_name, staff_id, zone, branch) values
  ('shelf', 1, 'الجمعة',   'bc718b18-b361-43a4-90fb-f8d7f6884b9a', 'منطقة الأقراص والكبسول', 'فرع الشامي'),
  ('shelf', 1, 'الجمعة',   '8088db32-c552-4f5b-9737-984d0d594b0c', 'المخزن الداخلي', 'فرع الشامي'),
  ('shelf', 1, 'الجمعة',   '8088db32-c552-4f5b-9737-984d0d594b0c', 'الثلاجة', 'فرع الشامي'),
  ('shelf', 1, 'السبت',    'bc718b18-b361-43a4-90fb-f8d7f6884b9a', 'منطقة المعمل', 'فرع الشامي'),
  ('shelf', 1, 'السبت',    '8088db32-c552-4f5b-9737-984d0d594b0c', 'منطقة البامبرز والأولويز', 'فرع الشامي'),
  ('shelf', 1, 'الأحد',    'bc718b18-b361-43a4-90fb-f8d7f6884b9a', 'منطقة الإكسسوار', 'فرع الشامي'),
  ('shelf', 1, 'الأحد',    '8088db32-c552-4f5b-9737-984d0d594b0c', 'منطقة الأقراص والكبسول', 'فرع الشامي'),
  ('shelf', 1, 'الاثنين',  'bc718b18-b361-43a4-90fb-f8d7f6884b9a', 'منطقة المستلزمات', 'فرع الشامي'),
  ('shelf', 1, 'الاثنين',  '8088db32-c552-4f5b-9737-984d0d594b0c', 'منطقة المعمل', 'فرع الشامي'),
  ('shelf', 1, 'الثلاثاء', 'bc718b18-b361-43a4-90fb-f8d7f6884b9a', 'منطقة البامبرز والأولويز', 'فرع الشامي'),
  ('shelf', 1, 'الثلاثاء', '8088db32-c552-4f5b-9737-984d0d594b0c', 'منطقة الإكسسوار', 'فرع الشامي'),
  ('shelf', 1, 'الأربعاء', '8088db32-c552-4f5b-9737-984d0d594b0c', 'منطقة المستلزمات', 'فرع الشامي'),
  ('shelf', 1, 'الخميس',   'bc718b18-b361-43a4-90fb-f8d7f6884b9a', 'الثلاجة', 'فرع الشامي'),
  ('shelf', 1, 'الخميس',   'bc718b18-b361-43a4-90fb-f8d7f6884b9a', 'المخزن الداخلي', 'فرع الشامي')
on conflict do nothing;

-- جدول الجرد — مستقل تمامًا عن الرص، منطقة واحدة كل يوم، الصيدلية كلها تتجرد مرة
-- كل أسبوع بالتبادل بين الاتنين. week_parity=0 دايمًا (مفيش تبادل أسبوعي هنا).
insert into public.pharmacy_zone_schedule_template (task_kind, week_parity, day_name, staff_id, zone, branch) values
  ('inventory', 0, 'الجمعة',   '8088db32-c552-4f5b-9737-984d0d594b0c', 'منطقة الأقراص والكبسول', 'فرع الشامي'),
  ('inventory', 0, 'السبت',    'bc718b18-b361-43a4-90fb-f8d7f6884b9a', 'منطقة المعمل', 'فرع الشامي'),
  ('inventory', 0, 'الأحد',    '8088db32-c552-4f5b-9737-984d0d594b0c', 'منطقة الإكسسوار', 'فرع الشامي'),
  ('inventory', 0, 'الاثنين',  'bc718b18-b361-43a4-90fb-f8d7f6884b9a', 'منطقة المستلزمات', 'فرع الشامي'),
  ('inventory', 0, 'الثلاثاء', '8088db32-c552-4f5b-9737-984d0d594b0c', 'منطقة البامبرز والأولويز', 'فرع الشامي'),
  ('inventory', 0, 'الأربعاء', '8088db32-c552-4f5b-9737-984d0d594b0c', 'الثلاجة', 'فرع الشامي'),
  ('inventory', 0, 'الخميس',   'bc718b18-b361-43a4-90fb-f8d7f6884b9a', 'المخزن الداخلي', 'فرع الشامي')
on conflict do nothing;

-- سجل تنفيذ فعلي لكل مهمة رص/جرد (زي assistant_operational_logs بالظبط فلسفةً).
create table if not exists public.pharmacy_zone_operational_logs (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id),
  branch text not null,
  task_kind text not null check (task_kind in ('shelf', 'inventory')),
  zone text not null,
  log_date date not null,
  notes text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  points numeric not null default 0,
  reviewed_by_staff_id uuid references public.staff(id),
  reviewed_by_name text,
  reviewed_at timestamptz,
  reviewer_note text,
  created_at timestamptz not null default now(),
  unique (staff_id, task_kind, zone, log_date)
);
alter table public.pharmacy_zone_operational_logs enable row level security;
revoke all on table public.pharmacy_zone_operational_logs from public, anon, authenticated;

-- أصناف الجرد بالتفصيل (لما يترفع ملف إكسل) — الفرق بيتحسب أوتوماتيك.
create table if not exists public.pharmacy_inventory_count_items (
  id uuid primary key default gen_random_uuid(),
  log_id uuid not null references public.pharmacy_zone_operational_logs(id) on delete cascade,
  item_name text not null,
  expected_qty numeric,
  actual_qty numeric,
  variance numeric generated always as (coalesce(actual_qty, 0) - coalesce(expected_qty, 0)) stored,
  expiry_date date,
  unit_price numeric,
  reason text,
  action text,
  notes text,
  created_at timestamptz not null default now()
);
alter table public.pharmacy_inventory_count_items enable row level security;
revoke all on table public.pharmacy_inventory_count_items from public, anon, authenticated;

-- النقاط الثابتة لكل نوع مهمة.
create or replace function public.pharmacy_zone_task_points_v1(p_task_kind text)
returns numeric
language sql
immutable
set search_path to 'public', 'pg_catalog'
as $function$
  select case p_task_kind when 'shelf' then 5 when 'inventory' then 15 else null end
$function$;
revoke all on function public.pharmacy_zone_task_points_v1(text) from public;

-- تعادل الأسبوع (0/1) بناءً على تاريخ ثابت مرجعي (سبت 29 أغسطس 2026 = تعادل 0).
create or replace function public.pharmacy_week_parity_v1(p_date date)
returns integer
language sql
immutable
set search_path to 'public', 'pg_catalog'
as $function$
  select ((((p_date - date '2026-08-29') / 7) % 2) + 2) % 2
$function$;
revoke all on function public.pharmacy_week_parity_v1(date) from public;

create or replace function public.pharmacy_arabic_day_name_v1(p_date date)
returns text
language sql
immutable
set search_path to 'public', 'pg_catalog'
as $function$
  select case extract(dow from p_date)::int
    when 0 then 'الأحد' when 1 then 'الاثنين' when 2 then 'الثلاثاء'
    when 3 then 'الأربعاء' when 4 then 'الخميس' when 5 then 'الجمعة' else 'السبت' end
$function$;
revoke all on function public.pharmacy_arabic_day_name_v1(date) from public;

-- المناطق المطلوبة من الموظف الحالي في تاريخ معيّن (افتراضيًا النهارده).
create or replace function public.get_my_pharmacy_zone_assignment_v1(p_date date default current_date)
returns table (task_kind text, zone text, branch text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_subject_id uuid;
  v_day text;
begin
  v_subject_id := public.dawaa_current_staff_subject_uuid_v1();
  if v_subject_id is null or not exists (
    select 1 from public.pharmacy_zone_eligible_staff where staff_id = v_subject_id
  ) then
    return;
  end if;

  v_day := public.pharmacy_arabic_day_name_v1(p_date);

  return query
    select t.task_kind, t.zone, t.branch
    from public.pharmacy_zone_schedule_template t
    where t.staff_id = v_subject_id
      and t.day_name = v_day
      and (
        (t.task_kind = 'shelf' and t.week_parity = public.pharmacy_week_parity_v1(p_date))
        or (t.task_kind = 'inventory' and t.week_parity = 0)
      );
end;
$function$;
revoke all on function public.get_my_pharmacy_zone_assignment_v1(date) from public, anon, authenticated;
grant execute on function public.get_my_pharmacy_zone_assignment_v1(date) to anon, authenticated;

-- تسجيل تنفيذ مهمة (لازم تكون منطقة مجدولة فعليًا للموظف في نفس اليوم).
create or replace function public.submit_my_pharmacy_zone_task_v1(
  p_task_kind text,
  p_zone text,
  p_log_date date default current_date,
  p_notes text default null
) returns public.pharmacy_zone_operational_logs
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_subject_id uuid;
  v_branch text;
  v_points numeric;
  v_row public.pharmacy_zone_operational_logs%rowtype;
begin
  if public.dawaa_current_staff_account_id_strict() is null then
    raise exception using errcode = '42501', message = 'active staff actor required';
  end if;

  v_subject_id := public.dawaa_current_staff_subject_uuid_v1();
  if v_subject_id is null or not exists (
    select 1 from public.pharmacy_zone_eligible_staff where staff_id = v_subject_id
  ) then
    raise exception using errcode = '42501', message = 'staff member not eligible for pharmacy zone tasks';
  end if;

  select t.branch into v_branch
  from public.pharmacy_zone_schedule_template t
  where t.staff_id = v_subject_id
    and t.task_kind = p_task_kind
    and t.zone = p_zone
    and t.day_name = public.pharmacy_arabic_day_name_v1(p_log_date)
    and (
      (p_task_kind = 'shelf' and t.week_parity = public.pharmacy_week_parity_v1(p_log_date))
      or (p_task_kind = 'inventory' and t.week_parity = 0)
    )
  limit 1;

  if v_branch is null then
    raise exception using errcode = '22023', message = 'this zone is not scheduled for you on this date';
  end if;

  v_points := public.pharmacy_zone_task_points_v1(p_task_kind);

  insert into public.pharmacy_zone_operational_logs (
    staff_id, branch, task_kind, zone, log_date, notes, points, status
  ) values (
    v_subject_id, v_branch, p_task_kind, p_zone, p_log_date, nullif(trim(coalesce(p_notes, '')), ''), v_points, 'pending'
  )
  on conflict (staff_id, task_kind, zone, log_date) do update
    set notes = excluded.notes
  returning * into v_row;

  return v_row;
end;
$function$;
revoke all on function public.submit_my_pharmacy_zone_task_v1(text, text, date, text) from public, anon, authenticated;
grant execute on function public.submit_my_pharmacy_zone_task_v1(text, text, date, text) to anon, authenticated;

-- اعتماد/رفض من مدير الفرع (أو مدير الفروع/فوقهم) — بيدّي النقاط الحقيقية عند الاعتماد.
create or replace function public.review_pharmacy_zone_task_v1(
  p_log_id uuid,
  p_status text,
  p_reviewer_note text default null
) returns public.pharmacy_zone_operational_logs
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_account public.staff_accounts%rowtype;
  v_reviewer_staff_id uuid;
  v_row public.pharmacy_zone_operational_logs%rowtype;
  v_staff_name text;
  v_month_cycle text;
begin
  if p_status not in ('approved', 'rejected') then
    raise exception using errcode = '22023', message = 'invalid review status';
  end if;

  select * into v_account
  from public.staff_accounts
  where id = public.dawaa_current_staff_account_id_strict()
    and coalesce(active, false) and coalesce(can_login, false);
  if not found then raise exception using errcode = '42501', message = 'active staff actor required'; end if;

  if lower(trim(coalesce(v_account.role, ''))) not in ('branch_manager', 'branches_manager', 'general_manager', 'executive_manager', 'admin')
     or not public.user_has_permission(v_account.id, 'view_team') then
    raise exception using errcode = '42501', message = 'pharmacy zone task review permission required';
  end if;

  v_reviewer_staff_id := public.dawaa_current_staff_subject_uuid_v1();

  update public.pharmacy_zone_operational_logs set
    status = p_status,
    reviewed_by_staff_id = v_reviewer_staff_id,
    reviewed_by_name = coalesce(nullif(trim(v_account.staff_name), ''), nullif(trim(v_account.name), ''), v_account.username),
    reviewed_at = now(),
    reviewer_note = case when p_status = 'rejected' then nullif(trim(coalesce(p_reviewer_note, '')), '') else null end
  where id = p_log_id and status = 'pending'
  returning * into v_row;

  if not found then
    raise exception using errcode = '22023', message = 'pharmacy zone task not found or already reviewed';
  end if;

  if p_status = 'approved' then
    select name into v_staff_name from public.staff where id = v_row.staff_id;
    v_month_cycle := public.dawaa_current_points_cycle_label_v1();
    insert into public.employee_transactions (
      staff_id, employee_id, employee_name, type, title, reason, amount, points, points_delta,
      source, source_id, transaction_date, created_at, description, month_cycle, branch,
      status, category, employee_visible, created_by
    ) values (
      v_row.staff_id, v_row.staff_id, v_staff_name, 'reward',
      case v_row.task_kind when 'shelf' then 'رص ' || v_row.zone else 'جرد ' || v_row.zone end,
      case v_row.task_kind when 'shelf' then 'رص ' || v_row.zone else 'جرد ' || v_row.zone end,
      0, v_row.points, v_row.points,
      'pharmacy_zone_task', v_row.id, v_row.log_date, now(),
      case v_row.task_kind when 'shelf' then 'رص منطقة ' || v_row.zone || ' بتاريخ ' || v_row.log_date::text
        else 'جرد منطقة ' || v_row.zone || ' بتاريخ ' || v_row.log_date::text end,
      v_month_cycle, v_row.branch, 'active',
      case v_row.task_kind when 'shelf' then 'رص وترتيب' else 'جرد' end,
      true, coalesce(nullif(trim(v_account.staff_name), ''), nullif(trim(v_account.name), ''), v_account.username)
    );
  end if;

  return v_row;
end;
$function$;
revoke all on function public.review_pharmacy_zone_task_v1(uuid, text, text) from public, anon, authenticated;
grant execute on function public.review_pharmacy_zone_task_v1(uuid, text, text) to anon, authenticated;

create or replace function public.list_my_pharmacy_zone_tasks_v1(p_limit integer default 30)
returns setof public.pharmacy_zone_operational_logs
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select l.* from public.pharmacy_zone_operational_logs l
  where l.staff_id = public.dawaa_current_staff_subject_uuid_v1()
  order by l.log_date desc, l.created_at desc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$function$;
revoke all on function public.list_my_pharmacy_zone_tasks_v1(integer) from public, anon, authenticated;
grant execute on function public.list_my_pharmacy_zone_tasks_v1(integer) to anon, authenticated;

create or replace function public.list_pending_pharmacy_zone_tasks_v1()
returns table (
  id uuid, staff_id uuid, staff_name text, branch text, task_kind text, zone text,
  log_date date, notes text, points numeric, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_account public.staff_accounts%rowtype;
begin
  select * into v_account
  from public.staff_accounts
  where id = public.dawaa_current_staff_account_id_strict()
    and coalesce(active, false) and coalesce(can_login, false);
  if not found then raise exception using errcode = '42501', message = 'active staff actor required'; end if;

  if lower(trim(coalesce(v_account.role, ''))) not in ('branch_manager', 'branches_manager', 'general_manager', 'executive_manager', 'admin')
     or not public.user_has_permission(v_account.id, 'view_team') then
    raise exception using errcode = '42501', message = 'pharmacy zone task review permission required';
  end if;

  return query
    select l.id, l.staff_id, s.name, l.branch, l.task_kind, l.zone, l.log_date, l.notes, l.points, l.created_at
    from public.pharmacy_zone_operational_logs l
    join public.staff s on s.id = l.staff_id
    where l.status = 'pending'
    order by l.log_date asc, l.created_at asc
    limit 100;
end;
$function$;
revoke all on function public.list_pending_pharmacy_zone_tasks_v1() from public, anon, authenticated;
grant execute on function public.list_pending_pharmacy_zone_tasks_v1() to anon, authenticated;

-- رفع أصناف الجرد (بديل عن التأكيد البسيط، أو إضافة له).
create or replace function public.submit_pharmacy_inventory_items_v1(
  p_log_id uuid,
  p_items jsonb
) returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_subject_id uuid;
  v_log public.pharmacy_zone_operational_logs%rowtype;
  v_count integer;
begin
  v_subject_id := public.dawaa_current_staff_subject_uuid_v1();
  if v_subject_id is null then raise exception using errcode = '42501', message = 'active staff actor required'; end if;

  select * into v_log from public.pharmacy_zone_operational_logs where id = p_log_id;
  if not found or v_log.staff_id <> v_subject_id then
    raise exception using errcode = '42501', message = 'not your inventory log';
  end if;
  if v_log.task_kind <> 'inventory' then
    raise exception using errcode = '22023', message = 'items can only be attached to inventory logs';
  end if;
  if v_log.status <> 'pending' then
    raise exception using errcode = '22023', message = 'log already reviewed';
  end if;

  insert into public.pharmacy_inventory_count_items (
    log_id, item_name, expected_qty, actual_qty, expiry_date, unit_price, reason, action, notes
  )
  select
    p_log_id,
    nullif(trim(item ->> 'item_name'), ''),
    nullif(item ->> 'expected_qty', '')::numeric,
    nullif(item ->> 'actual_qty', '')::numeric,
    nullif(item ->> 'expiry_date', '')::date,
    nullif(item ->> 'unit_price', '')::numeric,
    nullif(trim(item ->> 'reason'), ''),
    nullif(trim(item ->> 'action'), ''),
    nullif(trim(item ->> 'notes'), '')
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as item
  where nullif(trim(item ->> 'item_name'), '') is not null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;
revoke all on function public.submit_pharmacy_inventory_items_v1(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.submit_pharmacy_inventory_items_v1(uuid, jsonb) to anon, authenticated;

create or replace function public.get_pharmacy_inventory_variance_report_v1(p_log_id uuid)
returns setof public.pharmacy_inventory_count_items
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_subject_id uuid;
  v_account public.staff_accounts%rowtype;
  v_log public.pharmacy_zone_operational_logs%rowtype;
  v_is_reviewer boolean := false;
begin
  select * into v_log from public.pharmacy_zone_operational_logs where id = p_log_id;
  if not found then return; end if;

  v_subject_id := public.dawaa_current_staff_subject_uuid_v1();

  select * into v_account from public.staff_accounts where id = public.dawaa_current_staff_account_id_strict();
  if found then
    v_is_reviewer := lower(trim(coalesce(v_account.role, ''))) in ('branch_manager', 'branches_manager', 'general_manager', 'executive_manager', 'admin')
      and public.user_has_permission(v_account.id, 'view_team');
  end if;

  if v_subject_id is distinct from v_log.staff_id and not v_is_reviewer then
    raise exception using errcode = '42501', message = 'not authorized to view this report';
  end if;

  return query
    select * from public.pharmacy_inventory_count_items
    where log_id = p_log_id
    order by abs(variance) desc nulls last;
end;
$function$;
revoke all on function public.get_pharmacy_inventory_variance_report_v1(uuid) from public, anon, authenticated;
grant execute on function public.get_pharmacy_inventory_variance_report_v1(uuid) to anon, authenticated;

create or replace function public.list_pharmacy_inventory_recent_variances_v1(p_limit integer default 50)
returns table (
  log_id uuid, staff_name text, zone text, log_date date, item_name text,
  expected_qty numeric, actual_qty numeric, variance numeric, reason text
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_account public.staff_accounts%rowtype;
begin
  select * into v_account
  from public.staff_accounts
  where id = public.dawaa_current_staff_account_id_strict()
    and coalesce(active, false) and coalesce(can_login, false);
  if not found then raise exception using errcode = '42501', message = 'active staff actor required'; end if;

  if lower(trim(coalesce(v_account.role, ''))) not in ('branch_manager', 'branches_manager', 'general_manager', 'executive_manager', 'admin')
     or not public.user_has_permission(v_account.id, 'view_team') then
    raise exception using errcode = '42501', message = 'pharmacy zone task review permission required';
  end if;

  return query
    select l.id, s.name, l.zone, l.log_date, i.item_name, i.expected_qty, i.actual_qty, i.variance, i.reason
    from public.pharmacy_inventory_count_items i
    join public.pharmacy_zone_operational_logs l on l.id = i.log_id
    join public.staff s on s.id = l.staff_id
    where coalesce(i.variance, 0) <> 0
    order by abs(i.variance) desc nulls last, l.log_date desc
    limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$function$;
revoke all on function public.list_pharmacy_inventory_recent_variances_v1(integer) from public, anon, authenticated;
grant execute on function public.list_pharmacy_inventory_recent_variances_v1(integer) to anon, authenticated;

notify pgrst, 'reload schema';
