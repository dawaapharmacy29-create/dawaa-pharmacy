-- نظام إدخال ومراجعة فواتير المشتريات — داخل التطبيق بالكامل، بنفس عمق
-- البيانات المعمارية الموجودة في Base44 (المورد، نوع العملية، سبب الاستثناء،
-- التصنيف...) بس بمراجعة حقيقية (اعتماد/رفض) بدل مجرد حالة تسجيلية.
-- الإدخال مقصور على فريق دواء (نفس جدول assistant_operational_eligible_staff)
-- عشان يبقى الشغل كله من دلوقتي على التطبيق بدل Base44.

create table if not exists public.purchase_suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  payment_type text,
  payment_terms_days integer not null default 30,
  supplier_type text not null default 'external_supplier' check (supplier_type in ('external_supplier', 'internal_branch')),
  linked_branch text,
  default_purchase_category text not null default 'none' check (default_purchase_category in ('medicines', 'supplies_accessories', 'mixed', 'none')),
  default_payment_method text not null default 'none' check (default_payment_method in ('cash', 'credit', 'mixed', 'none')),
  exclude_from_net_purchases boolean not null default false,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.purchase_suppliers enable row level security;
revoke all on table public.purchase_suppliers from public, anon, authenticated;

create table if not exists public.purchase_invoices (
  id uuid primary key default gen_random_uuid(),
  system_invoice_number text not null unique,
  supplier_invoice_number text,
  transfer_authorization_number text,
  supplier_id uuid references public.purchase_suppliers(id),
  branch text not null check (branch in ('فرع شكري', 'فرع الشامي')),
  entered_by_staff_id uuid not null references public.staff(id),
  invoice_date date not null default current_date,
  total_value numeric not null default 0,
  returned_value numeric not null default 0,
  paid_value numeric not null default 0,
  cash_amount numeric not null default 0,
  payment_type text,
  status text not null default 'بانتظار المراجعة' check (status in ('بانتظار المراجعة', 'معتمدة', 'معلقة', 'مرفوضة')),
  notes text,
  purchase_category text not null default 'unclassified' check (purchase_category in ('medicines', 'supplies_accessories', 'unclassified')),
  purchase_category_source text not null default 'manual' check (purchase_category_source in ('supplier_default', 'manual')),
  transaction_type text not null default 'external_purchase' check (transaction_type in ('external_purchase', 'internal_transfer')),
  source_branch text,
  destination_branch text,
  net_purchase_mode text not null default 'inherit' check (net_purchase_mode in ('inherit', 'include', 'exclude')),
  exclusion_reason text check (exclusion_reason in ('internal_transfer', 'not_actual_purchase', 'tracking_only', 'excluded_supplier', 'settlement', 'duplicate_review', 'other')),
  exclusion_note text,
  excluded_by_staff_id uuid references public.staff(id),
  excluded_at timestamptz,
  reviewed_by_staff_id uuid references public.staff(id),
  reviewed_by_name text,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.purchase_invoices enable row level security;
revoke all on table public.purchase_invoices from public, anon, authenticated;
create index if not exists idx_purchase_invoices_branch_status on public.purchase_invoices (branch, status);
create index if not exists idx_purchase_invoices_entered_by on public.purchase_invoices (entered_by_staff_id);

-- سجل تاريخ الحالة الكامل — لكل تغيير حالة، مين غيّرها وإمتى ولية.
create table if not exists public.purchase_invoice_status_history (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.purchase_invoices(id) on delete cascade,
  old_status text,
  new_status text not null,
  changed_by_staff_id uuid references public.staff(id),
  changed_by_name text,
  note text,
  changed_at timestamptz not null default now()
);
alter table public.purchase_invoice_status_history enable row level security;
revoke all on table public.purchase_invoice_status_history from public, anon, authenticated;

-- عداد رقم الفاتورة التسلسلي لكل فرع (زي Base44 بالظبط — رقم متتابع لكل فرع).
create table if not exists public.purchase_invoice_number_seq (
  branch text primary key,
  next_number integer not null default 1
);
alter table public.purchase_invoice_number_seq enable row level security;
revoke all on table public.purchase_invoice_number_seq from public, anon, authenticated;
insert into public.purchase_invoice_number_seq (branch, next_number) values
  ('فرع شكري', 20000), ('فرع الشامي', 10000)
on conflict (branch) do nothing;

create or replace function public.dawaa_next_purchase_invoice_number_v1(p_branch text)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_number integer;
begin
  update public.purchase_invoice_number_seq
  set next_number = next_number + 1
  where branch = p_branch
  returning next_number - 1 into v_number;

  if v_number is null then
    insert into public.purchase_invoice_number_seq (branch, next_number) values (p_branch, 2)
    returning 1 into v_number;
  end if;

  return v_number::text;
end;
$function$;
revoke all on function public.dawaa_next_purchase_invoice_number_v1(text) from public, anon, authenticated;

-- من المسموح له يدخل فواتير (فريق دواء) أو يراجعها (مدير فرع/فروع/إدارة عليا).
create or replace function public.dawaa_is_purchase_invoice_entrant_v1(p_staff_id uuid)
returns boolean
language sql
stable
set search_path to 'public', 'pg_catalog'
as $function$
  select exists (select 1 from public.assistant_operational_eligible_staff where staff_id = p_staff_id)
$function$;
revoke all on function public.dawaa_is_purchase_invoice_entrant_v1(uuid) from public;

create or replace function public.dawaa_is_purchase_invoice_reviewer_v1(p_role text)
returns boolean
language sql
immutable
set search_path to 'public', 'pg_catalog'
as $function$
  select lower(trim(coalesce(p_role, ''))) in ('branch_manager', 'branches_manager', 'general_manager', 'executive_manager', 'admin')
$function$;
revoke all on function public.dawaa_is_purchase_invoice_reviewer_v1(text) from public;

create or replace function public.list_purchase_suppliers_v1()
returns setof public.purchase_suppliers
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select * from public.purchase_suppliers where active = true order by name;
$function$;
revoke all on function public.list_purchase_suppliers_v1() from public, anon, authenticated;
grant execute on function public.list_purchase_suppliers_v1() to anon, authenticated;

-- تسجيل فاتورة جديدة — بس فريق دواء. الرقم بيتحدد تلقائي، والتصنيف بيتوارث من
-- المورد لو موجود، وحالتها الأولية دايمًا "بانتظار المراجعة".
create or replace function public.create_purchase_invoice_v1(
  p_supplier_id uuid,
  p_branch text,
  p_transaction_type text,
  p_total_value numeric,
  p_invoice_date date default current_date,
  p_supplier_invoice_number text default null,
  p_transfer_authorization_number text default null,
  p_payment_type text default null,
  p_paid_value numeric default 0,
  p_cash_amount numeric default 0,
  p_source_branch text default null,
  p_destination_branch text default null,
  p_notes text default null
) returns public.purchase_invoices
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_subject_id uuid;
  v_supplier public.purchase_suppliers%rowtype;
  v_row public.purchase_invoices%rowtype;
  v_number text;
  v_category text := 'unclassified';
  v_category_source text := 'manual';
begin
  if public.dawaa_current_staff_account_id_strict() is null then
    raise exception using errcode = '42501', message = 'active staff actor required';
  end if;

  v_subject_id := public.dawaa_current_staff_subject_uuid_v1();
  if v_subject_id is null or not public.dawaa_is_purchase_invoice_entrant_v1(v_subject_id) then
    raise exception using errcode = '42501', message = 'purchase invoice entry not enabled for this staff member';
  end if;

  if p_branch not in ('فرع شكري', 'فرع الشامي') then
    raise exception using errcode = '22023', message = 'invalid branch';
  end if;

  if p_transaction_type not in ('external_purchase', 'internal_transfer') then
    raise exception using errcode = '22023', message = 'invalid transaction type';
  end if;

  if p_transaction_type = 'internal_transfer' and (p_source_branch is null or p_destination_branch is null) then
    raise exception using errcode = '22023', message = 'internal transfer requires source and destination branch';
  end if;

  if p_supplier_id is not null then
    select * into v_supplier from public.purchase_suppliers where id = p_supplier_id and active = true;
    if found then
      v_category := case when v_supplier.default_purchase_category in ('medicines', 'supplies_accessories') then v_supplier.default_purchase_category else 'unclassified' end;
      v_category_source := 'supplier_default';
    end if;
  end if;

  v_number := public.dawaa_next_purchase_invoice_number_v1(p_branch);

  insert into public.purchase_invoices (
    system_invoice_number, supplier_invoice_number, transfer_authorization_number, supplier_id, branch,
    entered_by_staff_id, invoice_date, total_value, paid_value, cash_amount, payment_type,
    transaction_type, source_branch, destination_branch, purchase_category, purchase_category_source,
    notes, status
  ) values (
    v_number, nullif(trim(p_supplier_invoice_number), ''), nullif(trim(p_transfer_authorization_number), ''), p_supplier_id, p_branch,
    v_subject_id, p_invoice_date, coalesce(p_total_value, 0), coalesce(p_paid_value, 0), coalesce(p_cash_amount, 0), nullif(trim(p_payment_type), ''),
    p_transaction_type, nullif(trim(p_source_branch), ''), nullif(trim(p_destination_branch), ''), v_category, v_category_source,
    nullif(trim(p_notes), ''), 'بانتظار المراجعة'
  ) returning * into v_row;

  insert into public.purchase_invoice_status_history (invoice_id, old_status, new_status, changed_by_staff_id, note)
  values (v_row.id, null, 'بانتظار المراجعة', v_subject_id, 'تسجيل أولي');

  return v_row;
end;
$function$;
revoke all on function public.create_purchase_invoice_v1(uuid, text, text, numeric, date, text, text, text, numeric, numeric, text, text, text) from public, anon, authenticated;
grant execute on function public.create_purchase_invoice_v1(uuid, text, text, numeric, date, text, text, text, numeric, numeric, text, text, text) to anon, authenticated;

-- تعديل فاتورة لسه بانتظار المراجعة (فريق دواء بس، وبس لو هي فاتورتهم هما).
create or replace function public.update_purchase_invoice_v1(
  p_invoice_id uuid,
  p_supplier_id uuid default null,
  p_supplier_invoice_number text default null,
  p_total_value numeric default null,
  p_paid_value numeric default null,
  p_cash_amount numeric default null,
  p_payment_type text default null,
  p_notes text default null
) returns public.purchase_invoices
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_subject_id uuid;
  v_row public.purchase_invoices%rowtype;
begin
  v_subject_id := public.dawaa_current_staff_subject_uuid_v1();
  if v_subject_id is null then raise exception using errcode = '42501', message = 'active staff actor required'; end if;

  select * into v_row from public.purchase_invoices where id = p_invoice_id;
  if not found then raise exception using errcode = '22023', message = 'invoice not found'; end if;
  if v_row.status <> 'بانتظار المراجعة' then
    raise exception using errcode = '22023', message = 'invoice already reviewed, cannot edit';
  end if;
  if v_row.entered_by_staff_id <> v_subject_id then
    raise exception using errcode = '42501', message = 'not your invoice';
  end if;

  update public.purchase_invoices set
    supplier_id = coalesce(p_supplier_id, supplier_id),
    supplier_invoice_number = coalesce(nullif(trim(p_supplier_invoice_number), ''), supplier_invoice_number),
    total_value = coalesce(p_total_value, total_value),
    paid_value = coalesce(p_paid_value, paid_value),
    cash_amount = coalesce(p_cash_amount, cash_amount),
    payment_type = coalesce(nullif(trim(p_payment_type), ''), payment_type),
    notes = coalesce(nullif(trim(p_notes), ''), notes),
    updated_at = now()
  where id = p_invoice_id
  returning * into v_row;

  return v_row;
end;
$function$;
revoke all on function public.update_purchase_invoice_v1(uuid, uuid, text, numeric, numeric, numeric, text, text) from public, anon, authenticated;
grant execute on function public.update_purchase_invoice_v1(uuid, uuid, text, numeric, numeric, numeric, text, text) to anon, authenticated;

-- مراجعة الفاتورة: اعتماد / تعليق / رفض. مدير الفرع بس على فرعه، مدير الفروع
-- والإدارة العليا على أي فرع. الاعتماد بيسجّل تلقائيًا "إدخال صحيح" في نظام
-- دقة إدخال الفواتير الموجود بالفعل (+2 نقطة لفريق دواء).
create or replace function public.review_purchase_invoice_v1(
  p_invoice_id uuid,
  p_status text,
  p_note text default null
) returns public.purchase_invoices
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_account public.staff_accounts%rowtype;
  v_reviewer_staff_id uuid;
  v_row public.purchase_invoices%rowtype;
  v_old_status text;
begin
  if p_status not in ('معتمدة', 'معلقة', 'مرفوضة') then
    raise exception using errcode = '22023', message = 'invalid review status';
  end if;

  select * into v_account
  from public.staff_accounts
  where id = public.dawaa_current_staff_account_id_strict()
    and coalesce(active, false) and coalesce(can_login, false);
  if not found then raise exception using errcode = '42501', message = 'active staff actor required'; end if;

  if not public.dawaa_is_purchase_invoice_reviewer_v1(v_account.role) or not public.user_has_permission(v_account.id, 'view_team') then
    raise exception using errcode = '42501', message = 'purchase invoice review permission required';
  end if;

  select * into v_row from public.purchase_invoices where id = p_invoice_id;
  if not found then raise exception using errcode = '22023', message = 'invoice not found'; end if;
  if v_row.status <> 'بانتظار المراجعة' then
    raise exception using errcode = '22023', message = 'invoice already reviewed';
  end if;

  if lower(trim(v_account.role)) = 'branch_manager' and coalesce(v_row.branch, '') <> coalesce(v_account.branch, '') then
    raise exception using errcode = '42501', message = 'branch scope denied';
  end if;

  v_reviewer_staff_id := public.dawaa_current_staff_subject_uuid_v1();
  v_old_status := v_row.status;

  update public.purchase_invoices set
    status = p_status,
    reviewed_by_staff_id = v_reviewer_staff_id,
    reviewed_by_name = coalesce(nullif(trim(v_account.staff_name), ''), nullif(trim(v_account.name), ''), v_account.username),
    reviewed_at = now(),
    review_note = nullif(trim(p_note), ''),
    updated_at = now()
  where id = p_invoice_id
  returning * into v_row;

  insert into public.purchase_invoice_status_history (invoice_id, old_status, new_status, changed_by_staff_id, changed_by_name, note)
  values (v_row.id, v_old_status, p_status, v_reviewer_staff_id,
    coalesce(nullif(trim(v_account.staff_name), ''), nullif(trim(v_account.name), ''), v_account.username), p_note);

  -- عند الاعتماد، نسجّل "إدخال صحيح" مباشرة في نظام دقة إدخال الفواتير
  -- الموجود بالفعل (بدون المرور على الدالة المحمية بصلاحية منفصلة، عشان
  -- مدير الفرع -- وهو مُراجع شرعي هنا -- مش بالضرورة يملك صلاحية
  -- dawaa_is_customer_service_evaluator_v1 اللي بتحكم أداة المراجعة اليدوية).
  if p_status = 'معتمدة' and not exists (
    select 1 from public.purchase_invoice_entry_reviews
    where invoice_reference = v_row.system_invoice_number and staff_id = v_row.entered_by_staff_id
  ) then
    insert into public.purchase_invoice_entry_reviews (
      staff_id, branch, invoice_reference, outcome, points,
      reviewed_by_staff_id, reviewed_by_name, notes, review_date
    ) values (
      v_row.entered_by_staff_id, v_row.branch, v_row.system_invoice_number, 'correct',
      public.purchase_invoice_review_points_v1('correct'),
      v_reviewer_staff_id,
      coalesce(nullif(trim(v_account.staff_name), ''), nullif(trim(v_account.name), ''), v_account.username),
      'اعتماد فاتورة رقم ' || v_row.system_invoice_number, v_row.invoice_date
    );

    insert into public.employee_transactions (
      staff_id, employee_id, employee_name, type, title, reason, amount, points, points_delta,
      source, source_id, transaction_date, created_at, description, month_cycle, branch,
      status, category, employee_visible, created_by
    )
    select
      v_row.entered_by_staff_id, v_row.entered_by_staff_id, st.name, 'reward', 'إدخال فاتورة صحيح', 'إدخال فاتورة صحيح',
      0, public.purchase_invoice_review_points_v1('correct'), public.purchase_invoice_review_points_v1('correct'),
      'purchase_invoice_entry_review', v_row.id, v_row.invoice_date, now(),
      'اعتماد فاتورة رقم ' || v_row.system_invoice_number, public.dawaa_current_points_cycle_label_v1(), v_row.branch,
      'active', 'دقة إدخال الفواتير', true,
      coalesce(nullif(trim(v_account.staff_name), ''), nullif(trim(v_account.name), ''), v_account.username)
    from public.staff st where st.id = v_row.entered_by_staff_id;
  end if;

  return v_row;
end;
$function$;
revoke all on function public.review_purchase_invoice_v1(uuid, text, text) from public, anon, authenticated;
grant execute on function public.review_purchase_invoice_v1(uuid, text, text) to anon, authenticated;

-- استثناء فاتورة من صافي المشتريات — إدارة عليا بس (قرار تصنيف مالي).
create or replace function public.exclude_purchase_invoice_v1(
  p_invoice_id uuid,
  p_reason text,
  p_note text default null
) returns public.purchase_invoices
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_account public.staff_accounts%rowtype;
  v_staff_id uuid;
  v_row public.purchase_invoices%rowtype;
begin
  select * into v_account
  from public.staff_accounts
  where id = public.dawaa_current_staff_account_id_strict()
    and coalesce(active, false) and coalesce(can_login, false);
  if not found then raise exception using errcode = '42501', message = 'active staff actor required'; end if;

  if lower(trim(coalesce(v_account.role, ''))) not in ('branches_manager', 'general_manager', 'executive_manager', 'admin') then
    raise exception using errcode = '42501', message = 'exclusion permission required';
  end if;

  v_staff_id := public.dawaa_current_staff_subject_uuid_v1();

  update public.purchase_invoices set
    net_purchase_mode = 'exclude',
    exclusion_reason = p_reason,
    exclusion_note = nullif(trim(p_note), ''),
    excluded_by_staff_id = v_staff_id,
    excluded_at = now(),
    updated_at = now()
  where id = p_invoice_id
  returning * into v_row;

  if not found then raise exception using errcode = '22023', message = 'invoice not found'; end if;

  return v_row;
end;
$function$;
revoke all on function public.exclude_purchase_invoice_v1(uuid, text, text) from public, anon, authenticated;
grant execute on function public.exclude_purchase_invoice_v1(uuid, text, text) to anon, authenticated;

-- قائمة الفواتير — مجالها حسب الدور: فريق دواء يشوف بتاعه، مدير فرع يشوف فرعه،
-- مدير الفروع/الإدارة العليا يشوفوا الكل.
create or replace function public.list_purchase_invoices_v1(
  p_branch text default null,
  p_status text default null,
  p_limit integer default 50
) returns table (
  id uuid, system_invoice_number text, supplier_invoice_number text, supplier_id uuid, supplier_name text,
  branch text, entered_by_staff_id uuid, entered_by_name text, invoice_date date, total_value numeric,
  paid_value numeric, cash_amount numeric, payment_type text, status text, transaction_type text,
  source_branch text, destination_branch text, purchase_category text, net_purchase_mode text,
  reviewed_by_name text, reviewed_at timestamptz, notes text, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_account public.staff_accounts%rowtype;
  v_subject_id uuid;
  v_is_reviewer boolean;
  v_scope_branch text;
begin
  select * into v_account
  from public.staff_accounts
  where id = public.dawaa_current_staff_account_id_strict()
    and coalesce(active, false) and coalesce(can_login, false);
  if not found then raise exception using errcode = '42501', message = 'active staff actor required'; end if;

  v_subject_id := public.dawaa_current_staff_subject_uuid_v1();
  v_is_reviewer := public.dawaa_is_purchase_invoice_reviewer_v1(v_account.role);

  if not v_is_reviewer and not (v_subject_id is not null and public.dawaa_is_purchase_invoice_entrant_v1(v_subject_id)) then
    raise exception using errcode = '42501', message = 'purchase invoice access not enabled for this staff member';
  end if;

  v_scope_branch := case when lower(trim(coalesce(v_account.role, ''))) = 'branch_manager' then v_account.branch else null end;

  return query
    select pi.id, pi.system_invoice_number, pi.supplier_invoice_number, pi.supplier_id, s.name,
           pi.branch, pi.entered_by_staff_id, st.name, pi.invoice_date, pi.total_value,
           pi.paid_value, pi.cash_amount, pi.payment_type, pi.status, pi.transaction_type,
           pi.source_branch, pi.destination_branch, pi.purchase_category, pi.net_purchase_mode,
           pi.reviewed_by_name, pi.reviewed_at, pi.notes, pi.created_at
    from public.purchase_invoices pi
    left join public.purchase_suppliers s on s.id = pi.supplier_id
    left join public.staff st on st.id = pi.entered_by_staff_id
    where (p_branch is null or pi.branch = p_branch)
      and (p_status is null or pi.status = p_status)
      and (v_scope_branch is null or pi.branch = v_scope_branch)
      and (v_is_reviewer or pi.entered_by_staff_id = v_subject_id)
    order by pi.created_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$function$;
revoke all on function public.list_purchase_invoices_v1(text, text, integer) from public, anon, authenticated;
grant execute on function public.list_purchase_invoices_v1(text, text, integer) to anon, authenticated;

notify pgrst, 'reload schema';
