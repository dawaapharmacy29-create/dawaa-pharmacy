-- Dawaa Pharmacy 2027 - Customer Operations Auto Fix
-- شغّل هذا الملف مرة واحدة من Supabase SQL Editor.
-- الهدف: تفعيل تصحيح الفروع، CRM، مرحلة الدلع، ومراجعة الولاء بأقل اعتماد على أعمدة اختيارية.

create extension if not exists pgcrypto;

-- 1) سجل تصحيح مركزي
create table if not exists public.dawaa_customer_repair_log (
  id uuid primary key default gen_random_uuid(),
  repair_type text not null,
  customer_code text,
  customer_name text,
  old_value text,
  new_value text,
  status text not null default 'done',
  reviewed_by text,
  note text,
  created_at timestamptz not null default now()
);

-- 2) جداول CRM لو غير موجودة
create table if not exists public.crm_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default '00000000-0000-0000-0000-000000000000',
  customer_id text,
  customer_code text,
  customer_name text not null default 'عميل غير محدد',
  customer_phone text,
  title text not null default 'طلب عميل',
  description text,
  request_type text not null default 'followup',
  source text not null default 'system',
  status text not null default 'open',
  priority text not null default 'normal',
  branch_id text,
  branch_name text,
  assigned_to text,
  assigned_to_name text,
  created_by text,
  created_by_name text,
  due_at timestamptz,
  last_interaction_at timestamptz default now(),
  closed_at timestamptz,
  closed_by text,
  closed_by_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_timeline (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default '00000000-0000-0000-0000-000000000000',
  request_id uuid references public.crm_requests(id) on delete cascade,
  event_type text not null default 'note',
  note text,
  old_status text,
  new_status text,
  created_by text,
  created_by_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- 3) جداول مرحلة الدلع
create table if not exists public.customer_incubation_cases (
  id uuid primary key default gen_random_uuid(),
  customer_key text,
  customer_code text,
  customer_name text,
  customer_phone text,
  branch text,
  assigned_doctor text,
  assigned_customer_service text,
  status text not null default 'active',
  priority text not null default 'high',
  target_note text,
  voucher_code text,
  voucher_value numeric,
  discount_percent numeric,
  baseline_invoice_count numeric default 0,
  baseline_total_spent numeric default 0,
  baseline_purchase_count_current_month numeric default 0,
  baseline_purchase_count_previous_month numeric default 0,
  after_invoice_count numeric default 0,
  after_total_spent numeric default 0,
  after_purchase_count numeric default 0,
  started_at timestamptz default now(),
  ended_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_incubation_steps (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references public.customer_incubation_cases(id) on delete cascade,
  customer_key text,
  step_type text not null default 'followup',
  step_title text,
  step_note text,
  step_status text not null default 'done',
  doctor_name text,
  customer_service_name text,
  created_by text,
  created_at timestamptz not null default now()
);

-- 4) دوال مساعدة
create or replace function public.dawaa_best_customer_branch(p_customer_code text)
returns text
language plpgsql
security definer
as $$
declare
  v_branch text;
begin
  if to_regclass('public.sales_invoices') is not null then
    execute $q$
      select branch::text
      from public.sales_invoices
      where customer_code::text = $1 and coalesce(branch::text, '') <> ''
      group by branch::text
      order by count(*) desc, max(invoice_date) desc
      limit 1
    $q$ into v_branch using p_customer_code;
  end if;
  return v_branch;
exception when others then
  return null;
end;
$$;

create or replace function public.approve_customer_branch_repair_v14(
  p_customer_code text,
  p_reviewed_by text default 'app'
)
returns table(ok boolean, message text, old_branch text, new_branch text)
language plpgsql
security definer
as $$
declare
  v_new text;
  v_old text;
  v_updated int := 0;
begin
  v_new := public.dawaa_best_customer_branch(p_customer_code);

  if v_new is null then
    select suggested_branch into v_new
    from public.dawaa_customer_branch_review_queue_v14
    where customer_code::text = p_customer_code
    limit 1;
  end if;

  if v_new is null or trim(v_new) = '' then
    return query select false, 'لا يوجد فرع مقترح لهذا العميل', null::text, null::text;
    return;
  end if;

  if to_regclass('public.customers') is not null then
    execute 'select branch::text from public.customers where customer_code::text = $1 or code::text = $1 limit 1'
      into v_old using p_customer_code;
    execute 'update public.customers set branch = $1 where customer_code::text = $2 or code::text = $2'
      using v_new, p_customer_code;
    get diagnostics v_updated = row_count;
  end if;

  if v_updated = 0 and to_regclass('public.customer_analysis') is not null then
    execute 'update public.customer_analysis set branch = $1 where customer_code::text = $2 or code::text = $2'
      using v_new, p_customer_code;
    get diagnostics v_updated = row_count;
  end if;

  insert into public.dawaa_customer_repair_log(repair_type, customer_code, old_value, new_value, reviewed_by, note)
  values ('branch_approved', p_customer_code, v_old, v_new, p_reviewed_by, 'اعتماد تصحيح الفرع من التطبيق');

  return query select true, 'تم اعتماد تصحيح الفرع', v_old, v_new;
end;
$$;

create or replace function public.ignore_customer_branch_repair_v14(
  p_customer_code text,
  p_reviewed_by text default 'app',
  p_reason text default null
)
returns table(ok boolean, message text)
language plpgsql
security definer
as $$
begin
  insert into public.dawaa_customer_repair_log(repair_type, customer_code, status, reviewed_by, note)
  values ('branch_ignored', p_customer_code, 'ignored', p_reviewed_by, p_reason);
  return query select true, 'تم تجاهل التصحيح';
end;
$$;

create or replace function public.update_customer_phone_v14_6(
  p_customer_code text,
  p_new_phone text,
  p_reviewed_by text default 'app'
)
returns table(ok boolean, message text)
language plpgsql
security definer
as $$
declare v_updated int := 0;
begin
  if to_regclass('public.customers') is not null then
    execute 'update public.customers set phone = $1 where customer_code::text = $2 or code::text = $2'
      using p_new_phone, p_customer_code;
    get diagnostics v_updated = row_count;
  end if;

  if v_updated = 0 and to_regclass('public.customer_analysis') is not null then
    execute 'update public.customer_analysis set customer_phone = $1 where customer_code::text = $2 or code::text = $2'
      using p_new_phone, p_customer_code;
    get diagnostics v_updated = row_count;
  end if;

  insert into public.dawaa_customer_repair_log(repair_type, customer_code, new_value, reviewed_by, note)
  values ('phone_update', p_customer_code, p_new_phone, p_reviewed_by, 'تحديث رقم العميل من مراجعة البيانات');

  return query select (v_updated > 0), case when v_updated > 0 then 'تم تحديث الرقم' else 'لم يتم العثور على العميل' end;
end;
$$;

-- 5) View مرحلة الدلع من العملاء الأعلى قيمة
create or replace view public.dawaa_incubation_candidates_v1 as
select
  coalesce(c.customer_code::text, c.code::text, c.id::text) as customer_key,
  coalesce(c.customer_code::text, c.code::text) as customer_code,
  coalesce(c.customer_name::text, c.name::text, 'عميل بدون اسم') as customer_name,
  coalesce(c.customer_phone::text, c.phone::text) as customer_phone,
  c.branch::text as branch,
  coalesce(c.total_spent, c.total_purchases, 0)::numeric as total_spent,
  coalesce(c.invoices_count, c.total_invoices, 0)::numeric as total_invoice_count,
  coalesce(c.avg_invoice, 0)::numeric as avg_invoice,
  coalesce(c.avg_monthly, 0)::numeric as avg_monthly,
  coalesce(c.first_purchase, null)::date as first_purchase,
  coalesce(c.last_purchase, c.last_invoice_date, null)::date as last_purchase,
  coalesce(c.segment::text, c.type::text, c.retention_status::text, 'غير محدد') as segment,
  coalesce(c.status::text, c.customer_status::text, 'active') as customer_status,
  true as recommended_for_incubation,
  'ترشيح تلقائي من قيمة العميل وتكرار الشراء' as incubation_recommendation,
  case when coalesce(c.total_spent, c.total_purchases, 0) >= 8000 then 'vip' else 'normal' end as incubation_priority,
  row_number() over(partition by c.branch order by coalesce(c.total_spent, c.total_purchases, 0) desc) as branch_rank,
  ic.id as case_id,
  ic.status as incubation_status,
  ic.assigned_doctor,
  ic.assigned_customer_service,
  ic.after_total_spent,
  ic.after_invoice_count,
  ic.after_purchase_count
from public.customers c
left join public.customer_incubation_cases ic
  on ic.customer_code = coalesce(c.customer_code::text, c.code::text)
where coalesce(c.total_spent, c.total_purchases, 0) >= 1500;

-- 6) Views مراجعة الفروع إذا لم تكن موجودة بنفس المنطق
create or replace view public.dawaa_customer_branch_review_queue_v14 as
with inv as (
  select customer_code::text customer_code, branch::text suggested_branch, count(*) invoices_count, sum(coalesce(net_amount, discounted_amount, amount, gross_amount, total_amount, 0)) total_spent, max(invoice_date) last_invoice_date
  from public.sales_invoices
  where coalesce(customer_code::text,'') <> '' and coalesce(branch::text,'') <> ''
  group by customer_code::text, branch::text
), best as (
  select *, row_number() over(partition by customer_code order by invoices_count desc, last_invoice_date desc) rn
  from inv
)
select
  coalesce(c.customer_code::text, c.code::text) as customer_code,
  coalesce(c.customer_name::text, c.name::text, 'عميل بدون اسم') as customer_name,
  coalesce(c.customer_phone::text, c.phone::text) as customer_phone,
  c.branch::text as current_branch,
  b.suggested_branch,
  b.invoices_count,
  b.total_spent,
  b.last_invoice_date,
  case when b.invoices_count >= 3 then 'high' else 'medium' end as confidence_level,
  'pending' as repair_status,
  'مراجعة فرع العميل' as review_label
from public.customers c
join best b on b.customer_code = coalesce(c.customer_code::text, c.code::text) and b.rn = 1
where coalesce(c.branch::text,'') is distinct from coalesce(b.suggested_branch,'');

create or replace view public.dawaa_customer_branch_review_summary_v14 as
select confidence_level, repair_status, count(*) customers_count, sum(total_spent) total_spent, sum(invoices_count) invoices_count
from public.dawaa_customer_branch_review_queue_v14
group by confidence_level, repair_status;

-- 7) إصلاح شامل بضغطة واحدة
create or replace function public.dawaa_run_customer_operations_autofix(p_reviewed_by text default 'system')
returns table(step text, affected_count int, message text)
language plpgsql
security definer
as $$
declare
  r record;
  v_count int := 0;
begin
  v_count := 0;
  for r in select customer_code from public.dawaa_customer_branch_review_queue_v14 limit 5000 loop
    perform * from public.approve_customer_branch_repair_v14(r.customer_code, p_reviewed_by);
    v_count := v_count + 1;
  end loop;
  return query select 'branch_repair', v_count, 'تم تصحيح فروع العملاء حسب أكثر فرع ظهرت فيه فواتيرهم';

  insert into public.crm_requests(company_id, customer_code, customer_name, customer_phone, title, description, request_type, source, priority, branch_name, metadata)
  select '00000000-0000-0000-0000-000000000000', customer_code, customer_name, customer_phone,
         'متابعة عميل مهم', 'تم إنشاء طلب متابعة تلقائي من نظام صحة البيانات', 'followup', 'autofix',
         case when total_spent >= 8000 then 'high' else 'normal' end, branch,
         jsonb_build_object('source','dawaa_run_customer_operations_autofix')
  from public.dawaa_incubation_candidates_v1 x
  where branch_rank <= 10
    and not exists (select 1 from public.crm_requests cr where cr.customer_code = x.customer_code and cr.status not in ('closed','resolved'));
  get diagnostics v_count = row_count;
  return query select 'crm_seed', v_count, 'تم إنشاء طلبات CRM للعملاء المهمين غير الموجودين';
end;
$$;

grant select on public.dawaa_incubation_candidates_v1 to authenticated, anon;
grant select on public.dawaa_customer_branch_review_queue_v14 to authenticated, anon;
grant select on public.dawaa_customer_branch_review_summary_v14 to authenticated, anon;
grant select, insert, update on public.crm_requests to authenticated, anon;
grant select, insert, update on public.crm_timeline to authenticated, anon;
grant select, insert, update on public.customer_incubation_cases to authenticated, anon;
grant select, insert, update on public.customer_incubation_steps to authenticated, anon;
grant execute on function public.approve_customer_branch_repair_v14(text,text) to authenticated, anon;
grant execute on function public.ignore_customer_branch_repair_v14(text,text,text) to authenticated, anon;
grant execute on function public.update_customer_phone_v14_6(text,text,text) to authenticated, anon;
grant execute on function public.dawaa_run_customer_operations_autofix(text) to authenticated, anon;
