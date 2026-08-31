-- نظام حافز نور/هبة/هاجر التشغيلي الجديد: مسؤولية كاملة عن الفرعين في
-- المشتريات وخدمة العملاء. كل عملية بتتسجل من المسؤولة نفسها، وتُعتمد
-- يوميًا من مدير الفروع قبل ما تتحول لنقاط حقيقية.
--
-- 5 أنواع عمليات:
-- 1) supplier_order: تجهيز وإرسال طلبية مورد — حدث واحد، +8 نقطة
-- 2) branch_transfer: تنفيذ تحويل صنف بين الفرعين — حدث واحد، +2 نقطة
-- 3) followup_execution: متابعة عميل تنفّذها المسؤولة بنفسها — تنفيذ=+5،
--    شراء خلال 3 أيام (برقم فاتورة إجباري)=+10 إضافية (15 إجمالي)
-- 4) request_fulfillment: تنفيذ طلب عميل — تسجيل=+1، توفير=+1 (2 إجمالي)،
--    إبلاغ الفرع=+1 (3 إجمالي)، شراء برقم فاتورة=+3 إضافية (6 إجمالي)
-- 5) exceptional_followup: متابعة استثنائية — تنفيذ=+2، رد العميل=+4
--    إجمالي، شراء خلال يومين بالظبط برقم فاتورة إجباري=+7 إجمالي
--
-- طُبّق هذا النظام على قاعدة الإنتاج بتاريخ 2026-08-29 بعد اختبار شامل
-- (8 سيناريوهات: كل نوع عملية + رفض الشراء بدون فاتورة + رفض الشراء بعد
-- انتهاء المهلة + قبول الشراء داخل المهلة + منع تكرار نفس المعاملة) داخل
-- معاملة تم التراجع عنها (rollback) قبل الاعتماد النهائي. هذا الملف يمثل
-- النسخة المصححة النهائية بعد إصلاح خطأين حقيقيين اكتُشفا أثناء الاختبار:
-- (أ) خلط نوع بيانات في متغير مؤقت كان سيفشل أول اعتماد لأي مرحلة شراء،
-- (ب) اعتماد first_action_at على وقت الإدخال الفعلي بدل الوقت المسجّل
-- للحدث، مما كان يُفسد فحص المهلة الزمنية.

create table if not exists public.assistant_case_progress (
  case_key text primary key,
  staff_id uuid not null references public.staff(id),
  task_type text not null check (task_type in ('followup_execution','request_fulfillment','exceptional_followup')),
  current_cumulative_points numeric not null default 0,
  branch text,
  customer_name text,
  customer_phone text,
  first_action_at timestamptz not null default now(),
  last_action_at timestamptz not null default now()
);

create table if not exists public.assistant_operational_logs (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id),
  branch text,
  task_type text not null check (task_type in ('supplier_order','branch_transfer','followup_execution','request_fulfillment','exceptional_followup')),
  stage text not null,
  case_key text,
  customer_name text,
  customer_phone text,
  reference_note text,
  purchase_invoice_no text,
  target_cumulative_points numeric,
  logged_at timestamptz not null default now(),
  review_status text not null default 'pending' check (review_status in ('pending','approved','rejected')),
  reviewed_by_staff_id uuid references public.staff(id),
  reviewed_by_name text,
  reviewed_at timestamptz,
  reviewer_note text,
  points_awarded numeric,
  month_cycle text,
  created_at timestamptz not null default now()
);
create index if not exists idx_assistant_ops_staff_status on public.assistant_operational_logs(staff_id, review_status);
create index if not exists idx_assistant_ops_case on public.assistant_operational_logs(case_key);

create or replace function public.trg_assistant_operational_log_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  if new.case_key is not null then
    insert into public.assistant_case_progress (case_key, staff_id, task_type, branch, customer_name, customer_phone, first_action_at, last_action_at)
    values (new.case_key, new.staff_id, new.task_type, new.branch, new.customer_name, new.customer_phone, new.logged_at, new.logged_at)
    on conflict (case_key) do nothing;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_assistant_operational_log_insert on public.assistant_operational_logs;
create trigger trg_assistant_operational_log_insert
  before insert on public.assistant_operational_logs
  for each row
  execute function public.trg_assistant_operational_log_insert();

create or replace function public.settle_assistant_operational_log(p_log_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_log public.assistant_operational_logs%rowtype;
  v_staff record;
  v_points numeric;
  v_previous_cumulative numeric := 0;
  v_case_first_action timestamptz;
  v_month_cycle text;
  v_existing_txn_id uuid;
  v_purchase_deadline interval;
begin
  select * into v_log from public.assistant_operational_logs where id = p_log_id;
  if not found or v_log.review_status = 'pending' then
    return;
  end if;

  select id, name, branch into v_staff from public.staff s where s.id = v_log.staff_id and coalesce(s.active, true);
  if not found then
    return;
  end if;

  select id into v_existing_txn_id from public.employee_transactions
  where source = 'assistant_operational_log' and source_id = p_log_id;

  if v_log.review_status = 'rejected' then
    if v_existing_txn_id is not null then
      update public.employee_transactions set status = 'cancelled', updated_at = now() where id = v_existing_txn_id;
    end if;
    return;
  end if;

  if v_log.case_key is not null then
    select coalesce(current_cumulative_points, 0), first_action_at
    into v_previous_cumulative, v_case_first_action
    from public.assistant_case_progress
    where case_key = v_log.case_key;
  else
    v_previous_cumulative := 0;
  end if;

  if v_log.stage in ('purchased', 'exceptional_purchased') then
    if v_log.purchase_invoice_no is null or btrim(v_log.purchase_invoice_no) = '' then
      raise exception 'purchase_invoice_required';
    end if;
    v_purchase_deadline := case
      when v_log.task_type = 'exceptional_followup' then interval '2 days'
      else interval '3 days'
    end;
    if v_case_first_action is not null and v_log.logged_at > v_case_first_action + v_purchase_deadline then
      raise exception 'purchase_window_expired';
    end if;
  end if;

  v_points := greatest(0, coalesce(v_log.target_cumulative_points, 0) - v_previous_cumulative);

  if v_log.case_key is not null then
    update public.assistant_case_progress
    set current_cumulative_points = greatest(current_cumulative_points, coalesce(v_log.target_cumulative_points, current_cumulative_points)),
        last_action_at = v_log.logged_at
    where case_key = v_log.case_key;
  end if;

  if v_points <= 0 then
    return;
  end if;

  v_month_cycle := public.dawaa_current_points_cycle_label_v1();

  if v_existing_txn_id is null then
    insert into public.employee_transactions (
      staff_id, employee_id, employee_name, type, title, reason, amount, points, points_delta,
      source, source_id, transaction_date, created_at, description, month_cycle, branch,
      status, category, employee_visible, created_by
    ) values (
      v_staff.id, v_staff.id, v_staff.name, 'reward', 'عملية تشغيلية معتمدة', 'عملية تشغيلية معتمدة',
      0, v_points, v_points, 'assistant_operational_log', p_log_id, current_date, now(),
      v_log.task_type || ' / ' || v_log.stage || coalesce(' — ' || v_log.customer_name, '') || coalesce(' — فاتورة ' || v_log.purchase_invoice_no, ''),
      v_month_cycle, coalesce(v_log.branch, v_staff.branch), 'active', 'مسؤولية المشتريات وخدمة العملاء', true,
      coalesce(v_log.reviewed_by_name, 'branches_manager')
    );
  end if;
  update public.assistant_operational_logs set points_awarded = v_points, month_cycle = v_month_cycle where id = p_log_id;
end;
$function$;

create or replace function public.trg_assistant_operational_log_review()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  if new.review_status in ('approved','rejected') and (old.review_status is distinct from new.review_status) then
    perform public.settle_assistant_operational_log(new.id);
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_assistant_operational_log_review on public.assistant_operational_logs;
create trigger trg_assistant_operational_log_review
  after insert or update of review_status
  on public.assistant_operational_logs
  for each row
  execute function public.trg_assistant_operational_log_review();
