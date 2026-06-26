-- Customer engagement ledgers + safer write paths for quick replies/followup edits.
-- The app uses a staff_accounts based login, so writes go through SECURITY DEFINER
-- functions that validate the staff account role before touching RLS-protected tables.

alter table if exists public.quick_reply_scripts
  add column if not exists active boolean not null default true,
  add column if not exists usage_count integer not null default 0,
  add column if not exists updated_at timestamptz null;

create table if not exists public.customer_followup_edit_logs (
  id uuid primary key default gen_random_uuid(),
  followup_id uuid not null,
  customer_code text null,
  customer_phone text null,
  customer_name text null,
  old_status text null,
  new_status text null,
  old_result text null,
  new_result text null,
  old_notes text null,
  new_notes text null,
  changed_fields jsonb null,
  edited_by text null,
  edited_by_name text null,
  edited_at timestamptz default now()
);

create table if not exists public.customer_points_ledger (
  id uuid primary key default gen_random_uuid(),
  customer_id text null,
  customer_code text null,
  customer_name text null,
  customer_phone text null,
  branch text null,
  points_amount numeric not null,
  transaction_type text not null default 'credit',
  source_type text not null default 'manual',
  points_reason text null,
  related_invoice_number text null,
  expiry_date date null,
  notes text null,
  created_by text null,
  created_by_name text null,
  created_at timestamptz default now()
);

create table if not exists public.customer_welcome_message_logs (
  id uuid primary key default gen_random_uuid(),
  followup_id uuid null,
  customer_id text null,
  customer_code text null,
  customer_name text null,
  customer_phone text null,
  branch text null,
  doctor_id text null,
  doctor_name text null,
  message_body text not null,
  channel text not null default 'whatsapp',
  status text not null default 'sent',
  sent_by text null,
  sent_by_name text null,
  sent_at timestamptz default now(),
  notes text null,
  created_at timestamptz default now()
);

create index if not exists idx_customer_followup_edit_logs_followup_id on public.customer_followup_edit_logs (followup_id);
create index if not exists idx_customer_followup_edit_logs_customer_code on public.customer_followup_edit_logs (customer_code);
create index if not exists idx_customer_followup_edit_logs_edited_at on public.customer_followup_edit_logs (edited_at desc);

create index if not exists idx_customer_points_ledger_customer_code on public.customer_points_ledger (customer_code);
create index if not exists idx_customer_points_ledger_customer_phone on public.customer_points_ledger (customer_phone);
create index if not exists idx_customer_points_ledger_created_at on public.customer_points_ledger (created_at desc);
create index if not exists idx_customer_points_ledger_source_type on public.customer_points_ledger (source_type);

create index if not exists idx_customer_welcome_logs_customer_code on public.customer_welcome_message_logs (customer_code);
create index if not exists idx_customer_welcome_logs_customer_phone on public.customer_welcome_message_logs (customer_phone);
create index if not exists idx_customer_welcome_logs_doctor_name on public.customer_welcome_message_logs (doctor_name);
create index if not exists idx_customer_welcome_logs_branch on public.customer_welcome_message_logs (branch);
create index if not exists idx_customer_welcome_logs_sent_at on public.customer_welcome_message_logs (sent_at desc);

alter table if exists public.quick_reply_scripts enable row level security;
alter table public.customer_followup_edit_logs enable row level security;
alter table public.customer_points_ledger enable row level security;
alter table public.customer_welcome_message_logs enable row level security;

drop policy if exists quick_reply_scripts_select on public.quick_reply_scripts;
drop policy if exists quick_reply_scripts_insert on public.quick_reply_scripts;
drop policy if exists quick_reply_scripts_update on public.quick_reply_scripts;
drop policy if exists quick_reply_scripts_soft_delete on public.quick_reply_scripts;
drop policy if exists customer_followup_edit_logs_select on public.customer_followup_edit_logs;
drop policy if exists customer_points_ledger_select on public.customer_points_ledger;
drop policy if exists customer_welcome_message_logs_select on public.customer_welcome_message_logs;

create policy quick_reply_scripts_select
  on public.quick_reply_scripts for select
  using (true);

create policy customer_followup_edit_logs_select
  on public.customer_followup_edit_logs for select
  using (true);

create policy customer_points_ledger_select
  on public.customer_points_ledger for select
  using (true);

create policy customer_welcome_message_logs_select
  on public.customer_welcome_message_logs for select
  using (true);

create or replace function public.app_staff_role(p_actor_id text)
returns text
language sql
security definer
set search_path = public
as $$
  select lower(coalesce(role, ''))
  from public.staff_accounts
  where id::text = p_actor_id
    and coalesce(active, true) = true
    and coalesce(can_login, true) = true
  limit 1
$$;

create or replace function public.app_role_allowed(p_actor_id text, p_allowed text[])
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce(public.app_staff_role(p_actor_id), '') = any(p_allowed)
$$;

create or replace function public.save_quick_reply_script(
  p_id uuid,
  p_shortcut text,
  p_title text,
  p_category text,
  p_script_type text,
  p_doctor_name text,
  p_branch text,
  p_message_body text,
  p_questions jsonb,
  p_suggested_products jsonb,
  p_tags jsonb,
  p_active boolean,
  p_actor_id text,
  p_actor_name text
)
returns public.quick_reply_scripts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.quick_reply_scripts;
begin
  if not public.app_role_allowed(p_actor_id, array['general_manager','admin','customer_service_manager','branch_manager']) then
    raise exception 'ليس لديك صلاحية حفظ الردود السريعة أو لم يتم تفعيل صلاحيات الجدول.';
  end if;

  if p_id is not null then
    update public.quick_reply_scripts
    set shortcut = case when left(trim(p_shortcut), 1) = '/' then trim(p_shortcut) else '/' || trim(p_shortcut) end,
        title = trim(p_title),
        category = coalesce(nullif(trim(p_category), ''), 'عام'),
        script_type = coalesce(nullif(trim(p_script_type), ''), 'quick_reply'),
        doctor_name = nullif(trim(coalesce(p_doctor_name, '')), ''),
        branch = nullif(trim(coalesce(p_branch, '')), ''),
        message_body = trim(p_message_body),
        questions = p_questions,
        suggested_products = p_suggested_products,
        tags = p_tags,
        active = coalesce(p_active, true),
        created_by = coalesce(created_by, p_actor_id),
        created_by_name = coalesce(created_by_name, p_actor_name),
        updated_at = now()
    where id = p_id
    returning * into v_row;
  else
    insert into public.quick_reply_scripts (
      shortcut, title, category, script_type, doctor_name, branch, message_body,
      questions, suggested_products, tags, active, usage_count, created_by, created_by_name, created_at, updated_at
    )
    values (
      case when left(trim(p_shortcut), 1) = '/' then trim(p_shortcut) else '/' || trim(p_shortcut) end,
      trim(p_title),
      coalesce(nullif(trim(p_category), ''), 'عام'),
      coalesce(nullif(trim(p_script_type), ''), 'quick_reply'),
      nullif(trim(coalesce(p_doctor_name, '')), ''),
      nullif(trim(coalesce(p_branch, '')), ''),
      trim(p_message_body),
      p_questions,
      p_suggested_products,
      p_tags,
      coalesce(p_active, true),
      0,
      p_actor_id,
      p_actor_name,
      now(),
      now()
    )
    returning * into v_row;
  end if;
  return v_row;
end;
$$;

create or replace function public.increment_quick_reply_usage(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.quick_reply_scripts
  set usage_count = coalesce(usage_count, 0) + 1,
      updated_at = now()
  where id = p_id;
$$;

create or replace function public.insert_customer_followup_edit_log(p_payload jsonb)
returns public.customer_followup_edit_logs
language sql
security definer
set search_path = public
as $$
  insert into public.customer_followup_edit_logs (
    followup_id, customer_code, customer_phone, customer_name,
    old_status, new_status, old_result, new_result, old_notes, new_notes,
    changed_fields, edited_by, edited_by_name
  )
  values (
    (p_payload->>'followup_id')::uuid,
    p_payload->>'customer_code',
    p_payload->>'customer_phone',
    p_payload->>'customer_name',
    p_payload->>'old_status',
    p_payload->>'new_status',
    p_payload->>'old_result',
    p_payload->>'new_result',
    p_payload->>'old_notes',
    p_payload->>'new_notes',
    p_payload->'changed_fields',
    p_payload->>'edited_by',
    p_payload->>'edited_by_name'
  )
  returning *;
$$;

create or replace function public.insert_customer_points_ledger(p_payload jsonb)
returns public.customer_points_ledger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.customer_points_ledger;
begin
  if not public.app_role_allowed(p_payload->>'created_by', array['general_manager','admin','customer_service_manager','branch_manager','customer_service']) then
    raise exception 'ليس لديك صلاحية احتساب نقاط العملاء.';
  end if;

  insert into public.customer_points_ledger (
    customer_id, customer_code, customer_name, customer_phone, branch,
    points_amount, transaction_type, source_type, points_reason,
    related_invoice_number, expiry_date, notes, created_by, created_by_name
  )
  values (
    p_payload->>'customer_id',
    p_payload->>'customer_code',
    p_payload->>'customer_name',
    p_payload->>'customer_phone',
    p_payload->>'branch',
    (p_payload->>'points_amount')::numeric,
    coalesce(nullif(p_payload->>'transaction_type', ''), 'credit'),
    coalesce(nullif(p_payload->>'source_type', ''), 'manual'),
    p_payload->>'points_reason',
    p_payload->>'related_invoice_number',
    nullif(p_payload->>'expiry_date', '')::date,
    p_payload->>'notes',
    p_payload->>'created_by',
    p_payload->>'created_by_name'
  )
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.insert_customer_welcome_message_log(p_payload jsonb)
returns public.customer_welcome_message_logs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.customer_welcome_message_logs;
begin
  if not public.app_role_allowed(p_payload->>'sent_by', array['general_manager','admin','customer_service_manager','branch_manager','customer_service','pharmacist']) then
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
$$;
