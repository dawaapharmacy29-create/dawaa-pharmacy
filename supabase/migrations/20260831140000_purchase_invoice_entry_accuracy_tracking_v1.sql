-- تتبع دقة إدخال الفواتير/الطلبيات — نور/هاجر/هبة (أو مدير) بيسجّلوا تقييم كل عملية
-- إدخال شافوها (سواء دخلها دكتور بنفسه أو أي حد تاني)، والنقاط بتتحول مباشرة
-- لصاحب العملية (مش لفريق دواء نفسه). المرحلة دي تسجيل يدوي (مراجعة بشرية لـ
-- Base44) لحد ما تتظبط مزامنة حقيقية.
create table if not exists public.purchase_invoice_entry_reviews (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id),
  branch text,
  invoice_reference text,
  outcome text not null check (outcome in ('correct', 'mixup_unregistered', 'negligence', 'customer_problem')),
  points numeric not null,
  reviewed_by_staff_id uuid references public.staff(id),
  reviewed_by_name text,
  notes text,
  review_date date not null default current_date,
  created_at timestamptz not null default now()
);
alter table public.purchase_invoice_entry_reviews enable row level security;
revoke all on table public.purchase_invoice_entry_reviews from public, anon, authenticated;

create or replace function public.purchase_invoice_review_points_v1(p_outcome text)
returns numeric
language sql
immutable
set search_path to 'public', 'pg_catalog'
as $function$
  select case p_outcome
    when 'correct' then 2
    when 'mixup_unregistered' then -1
    when 'negligence' then -2
    when 'customer_problem' then -4
    else null
  end
$function$;
revoke all on function public.purchase_invoice_review_points_v1(text) from public;

-- تسجيل مراجعة عملية إدخال. المُقيَّم عليه (staff_id) ممكن يكون أي موظف نشط —
-- مش مقصور على الدكاترة، لأن أي حد ممكن يدخل طلبية بنفسه في Base44.
create or replace function public.log_purchase_invoice_entry_review_v1(
  p_staff_id uuid,
  p_outcome text,
  p_branch text default null,
  p_invoice_reference text default null,
  p_notes text default null,
  p_review_date date default current_date
) returns public.purchase_invoice_entry_reviews
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_account public.staff_accounts%rowtype;
  v_reviewer_staff_id uuid;
  v_target public.staff%rowtype;
  v_points numeric;
  v_month_cycle text;
  v_row public.purchase_invoice_entry_reviews%rowtype;
  v_outcome_label text;
begin
  select * into v_account
  from public.staff_accounts
  where id = public.dawaa_current_staff_account_id_strict()
    and coalesce(active, false) and coalesce(can_login, false);
  if not found then raise exception using errcode = '42501', message = 'active staff actor required'; end if;

  if not public.dawaa_is_customer_service_evaluator_v1(public.dawaa_current_staff_subject_uuid_v1(), lower(trim(coalesce(v_account.role, '')))) then
    raise exception using errcode = '42501', message = 'purchase invoice review permission required';
  end if;

  v_points := public.purchase_invoice_review_points_v1(p_outcome);
  if v_points is null then
    raise exception using errcode = '22023', message = 'invalid outcome';
  end if;

  select * into v_target from public.staff where id = p_staff_id and coalesce(active, false);
  if not found then
    raise exception using errcode = '22023', message = 'target staff member not found or inactive';
  end if;

  v_reviewer_staff_id := public.dawaa_current_staff_subject_uuid_v1();

  insert into public.purchase_invoice_entry_reviews (
    staff_id, branch, invoice_reference, outcome, points,
    reviewed_by_staff_id, reviewed_by_name, notes, review_date
  ) values (
    p_staff_id, coalesce(nullif(trim(p_branch), ''), v_target.branch), nullif(trim(p_invoice_reference), ''),
    p_outcome, v_points, v_reviewer_staff_id,
    coalesce(nullif(trim(v_account.staff_name), ''), nullif(trim(v_account.name), ''), v_account.username),
    nullif(trim(p_notes), ''), p_review_date
  ) returning * into v_row;

  v_month_cycle := public.dawaa_current_points_cycle_label_v1();
  v_outcome_label := case p_outcome
    when 'correct' then 'إدخال فاتورة صحيح'
    when 'mixup_unregistered' then 'لغبطة أو عدم تسجيل فاتورة'
    when 'negligence' then 'إهمال في إدخال فاتورة'
    when 'customer_problem' then 'خطأ إدخال فاتورة سبب مشكلة مع عميل'
  end;

  insert into public.employee_transactions (
    staff_id, employee_id, employee_name, type, title, reason, amount, points, points_delta,
    source, source_id, transaction_date, created_at, description, month_cycle, branch,
    status, category, employee_visible, created_by
  ) values (
    v_target.id, v_target.id, v_target.name, case when v_points < 0 then 'penalty' else 'reward' end,
    v_outcome_label, v_outcome_label, 0, abs(v_points), v_points,
    'purchase_invoice_entry_review', v_row.id, p_review_date, now(),
    coalesce(nullif(trim(p_notes), ''), v_outcome_label), v_month_cycle, v_row.branch,
    'active', 'دقة إدخال الفواتير', true,
    coalesce(nullif(trim(v_account.staff_name), ''), nullif(trim(v_account.name), ''), v_account.username)
  );

  return v_row;
end;
$function$;
revoke all on function public.log_purchase_invoice_entry_review_v1(uuid, text, text, text, text, date) from public, anon, authenticated;
grant execute on function public.log_purchase_invoice_entry_review_v1(uuid, text, text, text, text, date) to anon, authenticated;

create or replace function public.list_purchase_invoice_entry_reviews_v1(p_staff_id uuid default null, p_limit integer default 50)
returns table (
  id uuid, staff_id uuid, staff_name text, branch text, invoice_reference text,
  outcome text, points numeric, notes text, review_date date, reviewed_by_name text
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

  if not public.dawaa_is_customer_service_evaluator_v1(public.dawaa_current_staff_subject_uuid_v1(), lower(trim(coalesce(v_account.role, '')))) then
    raise exception using errcode = '42501', message = 'purchase invoice review permission required';
  end if;

  return query
    select r.id, r.staff_id, s.name, r.branch, r.invoice_reference, r.outcome, r.points, r.notes, r.review_date, r.reviewed_by_name
    from public.purchase_invoice_entry_reviews r
    join public.staff s on s.id = r.staff_id
    where p_staff_id is null or r.staff_id = p_staff_id
    order by r.review_date desc, r.created_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$function$;
revoke all on function public.list_purchase_invoice_entry_reviews_v1(uuid, integer) from public, anon, authenticated;
grant execute on function public.list_purchase_invoice_entry_reviews_v1(uuid, integer) to anon, authenticated;

notify pgrst, 'reload schema';
