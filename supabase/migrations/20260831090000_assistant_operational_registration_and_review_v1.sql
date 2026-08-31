-- تأمين جدولي نظام حافز المسؤولات (نور/هبة/هاجر) اللي اتعملوا في الأساس السابق
-- من غير RLS ومن غير قفل صلاحيات — كان أي طلب anon غير مسجل دخول يقدر يقرا/يعدّل/يمسح
-- منهم مباشرة، وهما اللي بيغذوا حافز حقيقي بيتحول لمرتبات. القفل هنا أولوية قبل أي حاجة تانية.
do $$
declare
  v_table text;
begin
  foreach v_table in array array['assistant_operational_logs','assistant_case_progress']
  loop
    if to_regclass('public.' || v_table) is not null then
      execute format('alter table public.%I enable row level security', v_table);
      execute format('revoke all on table public.%I from public, anon, authenticated', v_table);
    end if;
  end loop;
end
$$;

-- جدول تشغيلي بسيط لتحديد مين مسموح له يسجّل عمليات (حاليًا نور/هاجر/هبة حماده فقط،
-- حسب المسؤولية الموسعة الجديدة). جدول بدل قايمة مكتوبة جوه الكود عشان لو المسؤولية
-- اتنقلت لحد تاني الشهر الجاي، التغيير يبقى إضافة/حذف صف مش تعديل كود وdeploy.
create table if not exists public.assistant_operational_eligible_staff (
  staff_id uuid primary key references public.staff(id),
  added_at timestamptz not null default now(),
  note text
);
alter table public.assistant_operational_eligible_staff enable row level security;
revoke all on table public.assistant_operational_eligible_staff from public, anon, authenticated;

insert into public.assistant_operational_eligible_staff (staff_id, note) values
  ('82b9c2a1-6139-4b07-9937-ef80a6e926d8', 'نور'),
  ('e3640642-5c60-4815-8001-1bb93193668f', 'هاجر'),
  ('dea91886-1ae8-4766-a166-9952866a5024', 'هبه حماده')
on conflict (staff_id) do nothing;

-- خريطة النقاط التراكمية المستهدفة لكل (نوع عملية، مرحلة) — القيم دي القاعدة الرسمية
-- المتفق عليها؛ أي تغيير مستقبلي في قيم النقاط لازم يتعمل هنا فقط، مش في الفرونت إند،
-- عشان المصدر الوحيد للحقيقة يفضل في قاعدة البيانات.
create or replace function public.assistant_operational_target_points_v1(p_task_type text, p_stage text)
returns numeric
language sql
immutable
set search_path to 'public', 'pg_catalog'
as $function$
  select case p_task_type || ':' || p_stage
    when 'supplier_order:sent' then 8
    when 'branch_transfer:transferred' then 2
    when 'followup_execution:executed' then 5
    when 'followup_execution:purchased' then 15
    when 'request_fulfillment:logged' then 1
    when 'request_fulfillment:sourced' then 2
    when 'request_fulfillment:branch_notified' then 3
    when 'request_fulfillment:purchased' then 6
    when 'exceptional_followup:executed' then 2
    when 'exceptional_followup:customer_replied' then 4
    when 'exceptional_followup:exceptional_purchased' then 7
    else null
  end
$function$;
revoke all on function public.assistant_operational_target_points_v1(text, text) from public;

create or replace function public.assistant_operational_task_requires_case_v1(p_task_type text)
returns boolean
language sql
immutable
set search_path to 'public', 'pg_catalog'
as $function$
  select p_task_type in ('followup_execution', 'request_fulfillment', 'exceptional_followup')
$function$;
revoke all on function public.assistant_operational_task_requires_case_v1(text) from public;

-- تسجيل عملية جديدة من المسؤولة نفسها (نور/هاجر/هبة حماده فقط). النقاط بتتحدد من
-- الخريطة الرسمية جوه القاعدة، مش من قيمة جاية من المتصفح، عشان محدّش يقدر يبعت
-- target_cumulative_points مفبرك من الفرونت إند.
create or replace function public.submit_my_assistant_operational_log_v1(
  p_task_type text,
  p_stage text,
  p_branch text,
  p_case_key text default null,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_reference_note text default null,
  p_purchase_invoice_no text default null
) returns public.assistant_operational_logs
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_account public.staff_accounts%rowtype;
  v_subject_id uuid;
  v_target numeric;
  v_row public.assistant_operational_logs%rowtype;
begin
  select * into v_account
  from public.staff_accounts
  where id = public.dawaa_current_staff_account_id_strict()
    and coalesce(active, false) and coalesce(can_login, false);
  if not found then raise exception using errcode = '42501', message = 'active staff actor required'; end if;

  v_subject_id := public.dawaa_current_staff_subject_uuid_v1();
  if v_subject_id is null then raise exception using errcode = '42501', message = 'canonical staff identity required'; end if;

  if not exists (select 1 from public.assistant_operational_eligible_staff where staff_id = v_subject_id) then
    raise exception using errcode = '42501', message = 'assistant operational log not enabled for this staff member';
  end if;

  if p_branch not in ('فرع شكري', 'فرع الشامي') then
    raise exception using errcode = '22023', message = 'invalid branch';
  end if;

  v_target := public.assistant_operational_target_points_v1(p_task_type, p_stage);
  if v_target is null then
    raise exception using errcode = '22023', message = 'invalid task_type/stage combination';
  end if;

  if public.assistant_operational_task_requires_case_v1(p_task_type)
     and nullif(trim(coalesce(p_case_key, '')), '') is null then
    raise exception using errcode = '22023', message = 'case_key required for this task type';
  end if;

  insert into public.assistant_operational_logs (
    staff_id, branch, task_type, stage, case_key, customer_name, customer_phone,
    reference_note, purchase_invoice_no, target_cumulative_points, logged_at, review_status
  ) values (
    v_subject_id, p_branch, p_task_type, p_stage, nullif(trim(coalesce(p_case_key, '')), ''),
    nullif(trim(coalesce(p_customer_name, '')), ''), nullif(trim(coalesce(p_customer_phone, '')), ''),
    nullif(trim(coalesce(p_reference_note, '')), ''), nullif(trim(coalesce(p_purchase_invoice_no, '')), ''),
    v_target, now(), 'pending'
  ) returning * into v_row;

  return v_row;
end;
$function$;
revoke all on function public.submit_my_assistant_operational_log_v1(text, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_my_assistant_operational_log_v1(text, text, text, text, text, text, text, text) to anon, authenticated;

-- اعتماد/رفض من مدير الفروع (أو من فوقه) فقط. الرفض آمن دايمًا؛ الاعتماد على مرحلة
-- شراء ناقصها رقم فاتورة أو خارج المهلة هيرجّع استثناء من settle_assistant_operational_log
-- نفسها (زي ما هي مبنية بالفعل) — الفرونت إند لازم يمسك الرسالة دي ويوضحها للمدير.
create or replace function public.review_assistant_operational_log_v1(
  p_log_id uuid,
  p_status text,
  p_reviewer_note text default null
) returns public.assistant_operational_logs
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_account public.staff_accounts%rowtype;
  v_reviewer_staff_id uuid;
  v_row public.assistant_operational_logs%rowtype;
begin
  if p_status not in ('approved', 'rejected') then
    raise exception using errcode = '22023', message = 'invalid review status';
  end if;

  select * into v_account
  from public.staff_accounts
  where id = public.dawaa_current_staff_account_id_strict()
    and coalesce(active, false) and coalesce(can_login, false);
  if not found then raise exception using errcode = '42501', message = 'active staff actor required'; end if;

  if lower(trim(coalesce(v_account.role, ''))) not in ('branches_manager', 'general_manager', 'executive_manager', 'admin')
     or not public.user_has_permission(v_account.id, 'view_team') then
    raise exception using errcode = '42501', message = 'assistant operational log review permission required';
  end if;

  v_reviewer_staff_id := public.dawaa_current_staff_subject_uuid_v1();

  update public.assistant_operational_logs set
    review_status = p_status,
    reviewed_by_staff_id = v_reviewer_staff_id,
    reviewed_by_name = coalesce(nullif(trim(v_account.staff_name), ''), nullif(trim(v_account.name), ''), v_account.username),
    reviewed_at = now(),
    reviewer_note = case when p_status = 'rejected' then nullif(trim(coalesce(p_reviewer_note, '')), '') else null end
  where id = p_log_id and review_status = 'pending'
  returning * into v_row;

  if not found then
    raise exception using errcode = '22023', message = 'assistant operational log not found or already reviewed';
  end if;

  return v_row;
end;
$function$;
revoke all on function public.review_assistant_operational_log_v1(uuid, text, text) from public, anon, authenticated;
grant execute on function public.review_assistant_operational_log_v1(uuid, text, text) to anon, authenticated;

create or replace function public.list_my_assistant_operational_logs_v1(p_limit integer default 30)
returns setof public.assistant_operational_logs
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select l.* from public.assistant_operational_logs l
  where l.staff_id = public.dawaa_current_staff_subject_uuid_v1()
  order by l.logged_at desc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$function$;
revoke all on function public.list_my_assistant_operational_logs_v1(integer) from public, anon, authenticated;
grant execute on function public.list_my_assistant_operational_logs_v1(integer) to anon, authenticated;

create or replace function public.list_my_assistant_open_cases_v1()
returns setof public.assistant_case_progress
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select c.* from public.assistant_case_progress c
  where c.staff_id = public.dawaa_current_staff_subject_uuid_v1()
  order by c.last_action_at desc
  limit 50;
$function$;
revoke all on function public.list_my_assistant_open_cases_v1() from public, anon, authenticated;
grant execute on function public.list_my_assistant_open_cases_v1() to anon, authenticated;

create or replace function public.list_pending_assistant_operational_logs_v1()
returns table (
  id uuid,
  staff_id uuid,
  staff_name text,
  branch text,
  task_type text,
  stage text,
  case_key text,
  customer_name text,
  customer_phone text,
  reference_note text,
  purchase_invoice_no text,
  target_cumulative_points numeric,
  logged_at timestamptz
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

  if lower(trim(coalesce(v_account.role, ''))) not in ('branches_manager', 'general_manager', 'executive_manager', 'admin')
     or not public.user_has_permission(v_account.id, 'view_team') then
    raise exception using errcode = '42501', message = 'assistant operational log review permission required';
  end if;

  return query
    select l.id, l.staff_id, s.name, l.branch, l.task_type, l.stage, l.case_key, l.customer_name,
           l.customer_phone, l.reference_note, l.purchase_invoice_no, l.target_cumulative_points, l.logged_at
    from public.assistant_operational_logs l
    join public.staff s on s.id = l.staff_id
    where l.review_status = 'pending'
    order by l.logged_at asc
    limit 100;
end;
$function$;
revoke all on function public.list_pending_assistant_operational_logs_v1() from public, anon, authenticated;
grant execute on function public.list_pending_assistant_operational_logs_v1() to anon, authenticated;

notify pgrst, 'reload schema';
