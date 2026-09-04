-- تصحيحين إضافيين اتكشفوا من صور فعلية لحساب هاجر/نور:
--
-- 1. رسائل الترحيب: fetch_customer_welcome_message_logs /
--    insert_customer_welcome_message_log / update_customer_welcome_message_status
--    الثلاثة عندهم فحص دور مكتوب مباشرة في الكود (مش عن طريق نظام
--    الصلاحيات خالص) بمصفوفة أدوار ثابتة ما فيهاش 'assistant' أبدًا —
--    فمهما فتحنا صلاحيات، الدالة نفسها كانت ترفض فريق دواء دايمًا.
--    أضفنا استثناء صريح لفريق دواء (عن طريق دالة مساعدة جديدة) بدل ما
--    نفتح الوظيفة لكل "assistant" في الصيدلية عمومًا.
--
-- 2. assign_base44_invoice_entered_by_v1: التصحيح السابق استثنى بس
--    الموظفين المسجلين بفرع إداري ("المخزن"/"كل الفروع")، لكن نور
--    نفسها متسجلة بفرع حقيقي واحد (فرع الشامي) رغم إن مسؤوليتها
--    الفعلية تغطي الفرعين — فالفحص كان لسه بيرفض تعيين فواتير فرع
--    شكري ليها. الاستثناء دلوقتي بيتحقق من عضوية فريق دواء مباشرة،
--    مش بس من شكل الفرع المسجل.
create or replace function public.app_actor_is_team_dawaa(p_actor_id text)
returns boolean
language sql
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
    from public.staff_accounts sa
    join public.assistant_operational_eligible_staff e on e.staff_id::text = sa.staff_id
    where sa.id::text = p_actor_id
      and coalesce(sa.active, true)
      and coalesce(sa.can_login, true)
  )
$function$;
revoke all on function public.app_actor_is_team_dawaa(text) from public;

create or replace function public.fetch_customer_welcome_message_logs(
  p_actor_id text default null,
  p_customer_code text default null,
  p_customer_phone text default null,
  p_customer_id text default null,
  p_search text default null,
  p_branch text default null,
  p_status text default null,
  p_doctor text default null,
  p_from date default null,
  p_to date default null
)
returns setof public.customer_welcome_message_logs
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    public.app_role_allowed(p_actor_id, array['general_manager','admin','customer_service_manager','customer_service','branch_manager','pharmacist'])
    or public.app_actor_is_team_dawaa(p_actor_id)
  ) then
    raise exception 'ليس لديك صلاحية مشاهدة الرسائل الترحيبية';
  end if;

  return query
  select *
  from public.customer_welcome_message_logs l
  where (p_customer_code is null or l.customer_code = p_customer_code)
    and (p_customer_phone is null or l.customer_phone = p_customer_phone)
    and (p_customer_id is null or l.customer_id = p_customer_id)
    and (p_search is null or l.customer_name ilike '%' || p_search || '%' or l.customer_phone ilike '%' || p_search || '%' or l.customer_code ilike '%' || p_search || '%')
    and (p_branch is null or l.branch = p_branch)
    and (p_status is null or l.status = p_status)
    and (p_doctor is null or l.doctor_name = p_doctor)
    and (p_from is null or l.sent_at::date >= p_from)
    and (p_to is null or l.sent_at::date <= p_to)
  order by l.sent_at desc;
end;
$$;

create or replace function public.insert_customer_welcome_message_log(p_payload jsonb)
returns customer_welcome_message_logs
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.customer_welcome_message_logs;
begin
  if not (
    public.app_role_allowed(p_payload->>'sent_by', array['general_manager','admin','customer_service_manager','branch_manager','customer_service','pharmacist'])
    or public.app_actor_is_team_dawaa(p_payload->>'sent_by')
  ) then
    raise exception 'ليس لديك صلاحية تسجيل الرسائل الترحيبية.';
  end if;

  insert into public.customer_welcome_message_logs (
    followup_id, customer_id, customer_code, customer_name, customer_phone, branch,
    doctor_id, doctor_name, message_body, channel, status, sent_by, sent_by_name, sent_at, notes
  )
  values (
    nullif(p_payload->>'followup_id', '')::uuid,
    p_payload->>'customer_id',
    p_payload->>'customer_code',
    p_payload->>'customer_name',
    p_payload->>'customer_phone',
    p_payload->>'branch',
    p_payload->>'doctor_id',
    p_payload->>'doctor_name',
    p_payload->>'message_body',
    coalesce(nullif(p_payload->>'channel', ''), 'whatsapp'),
    coalesce(nullif(p_payload->>'status', ''), 'sent'),
    p_payload->>'sent_by',
    p_payload->>'sent_by_name',
    coalesce(nullif(p_payload->>'sent_at', '')::timestamptz, now()),
    p_payload->>'notes'
  )
  returning * into v_row;
  return v_row;
end;
$function$;

create or replace function public.update_customer_welcome_message_status(p_id uuid, p_status text, p_actor_id text default null, p_actor_name text default null)
returns customer_welcome_message_logs
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.customer_welcome_message_logs;
begin
  if not (
    public.app_role_allowed(p_actor_id, array['general_manager','admin','customer_service_manager','customer_service','branch_manager','pharmacist'])
    or public.app_actor_is_team_dawaa(p_actor_id)
  ) then
    raise exception 'ليس لديك صلاحية تحديث الرسائل الترحيبية';
  end if;

  update public.customer_welcome_message_logs
  set status = coalesce(nullif(trim(p_status), ''), status),
      sent_by = coalesce(p_actor_id, sent_by),
      sent_by_name = coalesce(p_actor_name, sent_by_name)
  where id = p_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'لم يتم العثور على الرسالة الترحيبية';
  end if;

  return v_row;
end;
$function$;

create or replace function public.assign_base44_invoice_entered_by_v1(p_sync_id uuid, p_staff_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_account public.staff_accounts%rowtype;
  v_sync public.base44_purchase_invoice_sync%rowtype;
  v_staff_branch text;
begin
  select sa.* into v_account
  from public.staff_accounts sa
  where sa.id = public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active, false)
    and coalesce(sa.can_login, false);

  if not found then
    raise exception using errcode = '42501', message = 'active staff actor required';
  end if;

  if not public.dawaa_is_customer_service_evaluator_v1(
    public.dawaa_current_staff_subject_uuid_v1(),
    lower(trim(coalesce(v_account.role, '')))
  ) then
    raise exception using errcode = '42501', message = 'purchase invoice review permission required';
  end if;

  select b.* into v_sync
  from public.base44_purchase_invoice_sync b
  where b.id = p_sync_id
    and b.review_id is null;

  if not found then
    raise exception using errcode = '22023', message = 'pending synced invoice not found';
  end if;

  select s.branch into v_staff_branch
  from public.staff s
  where s.id = p_staff_id
    and coalesce(s.active, false);

  if not found then
    raise exception using errcode = '22023', message = 'target staff member not found or inactive';
  end if;

  if v_staff_branch in ('فرع شكري', 'فرع الشامي')
     and not exists (select 1 from public.assistant_operational_eligible_staff where staff_id = p_staff_id)
     and nullif(trim(coalesce(v_sync.branch, '')), '') is not null
     and trim(v_sync.branch) <> trim(v_staff_branch) then
    raise exception using errcode = '22023', message = 'staff branch does not match invoice branch';
  end if;

  update public.base44_purchase_invoice_sync
  set entered_by_staff_id = p_staff_id,
      match_status = 'matched'
  where id = p_sync_id;

  return true;
end;
$function$;

notify pgrst, 'reload schema';
