-- Doctor personal workspace: scoped notifications, assignments and manual payroll controls.
-- Designed to be additive and safe with existing data.

begin;

create extension if not exists pgcrypto;

alter table if exists public.notifications
  add column if not exists recipient_staff_id uuid,
  add column if not exists notification_type text,
  add column if not exists priority text not null default 'normal',
  add column if not exists entity_type text,
  add column if not exists entity_id text,
  add column if not exists action_url text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists dedupe_key text,
  add column if not exists is_global boolean not null default false,
  add column if not exists read_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists created_by_staff_id uuid;

create unique index if not exists notifications_dedupe_key_uidx
  on public.notifications (dedupe_key)
  where dedupe_key is not null;

create index if not exists notifications_recipient_staff_created_idx
  on public.notifications (recipient_staff_id, created_at desc);

create index if not exists notifications_global_created_idx
  on public.notifications (is_global, created_at desc)
  where is_global = true;

create or replace function public.create_staff_notification(
  p_recipient_staff_id uuid,
  p_notification_type text,
  p_title text,
  p_message text,
  p_entity_type text default null,
  p_entity_id text default null,
  p_action_url text default null,
  p_priority text default 'normal',
  p_metadata jsonb default '{}'::jsonb,
  p_dedupe_key text default null,
  p_created_by_staff_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_recipient_staff_id is null then
    raise exception 'recipient_staff_id is required';
  end if;

  insert into public.notifications (
    recipient_staff_id,
    notification_type,
    title,
    message,
    entity_type,
    entity_id,
    action_url,
    priority,
    metadata,
    dedupe_key,
    created_by_staff_id,
    is_global,
    is_read,
    created_at
  ) values (
    p_recipient_staff_id,
    nullif(trim(p_notification_type), ''),
    coalesce(nullif(trim(p_title), ''), 'إشعار جديد'),
    coalesce(p_message, ''),
    nullif(trim(p_entity_type), ''),
    nullif(trim(p_entity_id), ''),
    nullif(trim(p_action_url), ''),
    case when p_priority in ('low','normal','high','urgent') then p_priority else 'normal' end,
    coalesce(p_metadata, '{}'::jsonb),
    nullif(trim(p_dedupe_key), ''),
    p_created_by_staff_id,
    false,
    false,
    now()
  )
  on conflict (dedupe_key) where dedupe_key is not null
  do update set
    title = excluded.title,
    message = excluded.message,
    priority = excluded.priority,
    metadata = excluded.metadata,
    action_url = excluded.action_url,
    is_read = false,
    read_at = null,
    created_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_staff_notification(uuid,text,text,text,text,text,text,text,jsonb,text,uuid) from public;
grant execute on function public.create_staff_notification(uuid,text,text,text,text,text,text,text,jsonb,text,uuid) to authenticated;

create table if not exists public.staff_assignments (
  id uuid primary key default gen_random_uuid(),
  assigned_to_staff_id uuid not null,
  assigned_by_staff_id uuid,
  assignment_type text not null default 'task',
  title text not null,
  description text,
  priority text not null default 'normal',
  status text not null default 'new',
  due_at timestamptz,
  progress_percent integer not null default 0 check (progress_percent between 0 and 100),
  evaluation_method text,
  expected_points numeric not null default 0,
  awarded_points numeric not null default 0,
  doctor_notes text,
  manager_notes text,
  completed_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by_staff_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists staff_assignments_assignee_status_idx
  on public.staff_assignments (assigned_to_staff_id, status, due_at);

create table if not exists public.staff_payroll_manual_entries (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null,
  cycle_start date not null,
  cycle_end date not null,
  entry_type text not null check (entry_type in ('base_salary','allowance','bonus','incentive','deduction','advance','overtime','manual_note')),
  amount numeric not null default 0,
  title text not null,
  details text,
  visible_to_staff boolean not null default true,
  created_by_staff_id uuid,
  updated_by_staff_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists staff_payroll_manual_entries_staff_cycle_idx
  on public.staff_payroll_manual_entries (staff_id, cycle_end desc);

create table if not exists public.staff_payroll_manual_entry_audit (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null,
  staff_id uuid not null,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  changed_by_staff_id uuid,
  changed_at timestamptz not null default now()
);

create or replace function public.audit_staff_payroll_manual_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.staff_payroll_manual_entry_audit (
    entry_id, staff_id, action, old_data, new_data, changed_by_staff_id
  ) values (
    coalesce(new.id, old.id),
    coalesce(new.staff_id, old.staff_id),
    tg_op,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
    coalesce(new.updated_by_staff_id, new.created_by_staff_id, old.updated_by_staff_id, old.created_by_staff_id)
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_audit_staff_payroll_manual_entry on public.staff_payroll_manual_entries;
create trigger trg_audit_staff_payroll_manual_entry
after insert or update or delete on public.staff_payroll_manual_entries
for each row execute function public.audit_staff_payroll_manual_entry();

create or replace function public.notify_doctor_on_conversation_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_staff_id uuid;
  v_score numeric;
  v_impact numeric;
  v_reviewer text;
  v_action text := lower(tg_op);
begin
  begin
    v_staff_id := nullif(coalesce(v_row->>'staff_id', v_row->>'doctor_id'), '')::uuid;
  exception when invalid_text_representation then
    v_staff_id := null;
  end;

  if v_staff_id is null then
    return new;
  end if;

  v_score := coalesce(nullif(v_row->>'final_score','')::numeric, nullif(v_row->>'total_score','')::numeric, 0);
  v_impact := coalesce(nullif(v_row->>'doctor_points_impact','')::numeric, nullif(v_row->>'point_impact','')::numeric, 0);
  v_reviewer := coalesce(nullif(v_row->>'reviewer_name',''), 'مراجع خدمة العملاء');

  perform public.create_staff_notification(
    v_staff_id,
    'chat_evaluation',
    case when tg_op = 'INSERT' then 'تم تسجيل تقييم محادثة جديد' else 'تم تعديل تقييم محادثتك' end,
    format('الدرجة %s من 100، وتأثير النقاط %s. التقييم بواسطة %s.', v_score, v_impact, v_reviewer),
    'conversation_sales_review',
    new.id::text,
    '/doctor-dashboard?tab=reviews&review=' || new.id::text,
    case when v_score < 70 then 'high' else 'normal' end,
    jsonb_build_object('score', v_score, 'pointsImpact', v_impact, 'reviewer', v_reviewer, 'action', v_action),
    format('chat-review:%s:%s', new.id, v_action),
    null
  );

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.conversation_sales_reviews') is not null then
    execute 'drop trigger if exists trg_notify_doctor_on_conversation_review on public.conversation_sales_reviews';
    execute 'create trigger trg_notify_doctor_on_conversation_review after insert or update on public.conversation_sales_reviews for each row execute function public.notify_doctor_on_conversation_review()';
  end if;
end $$;

create or replace function public.notify_doctor_on_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.create_staff_notification(
    new.assigned_to_staff_id,
    new.assignment_type,
    case when tg_op = 'INSERT' then 'مطلوب جديد: ' || new.title else 'تم تحديث المطلوب: ' || new.title end,
    coalesce(new.description, 'افتح قسم المطلوب مني لمراجعة التفاصيل.'),
    'staff_assignment',
    new.id::text,
    '/doctor-dashboard?tab=requirements&assignment=' || new.id::text,
    new.priority,
    jsonb_build_object('status', new.status, 'dueAt', new.due_at, 'progress', new.progress_percent),
    format('staff-assignment:%s:%s:%s', new.id, tg_op, new.updated_at),
    new.assigned_by_staff_id
  );
  return new;
end;
$$;

drop trigger if exists trg_notify_doctor_on_assignment on public.staff_assignments;
create trigger trg_notify_doctor_on_assignment
after insert or update on public.staff_assignments
for each row execute function public.notify_doctor_on_assignment();

create or replace function public.notify_doctor_on_payroll_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.visible_to_staff then
    perform public.create_staff_notification(
      new.staff_id,
      'payroll',
      case
        when new.entry_type = 'deduction' then 'تم تسجيل خصم مالي'
        when new.entry_type in ('bonus','incentive') then 'تم تسجيل مكافأة أو حافز'
        else 'تم تحديث تفاصيل القبض'
      end,
      new.title || case when new.amount <> 0 then format(' — %s جنيه', new.amount) else '' end,
      'staff_payroll_manual_entry',
      new.id::text,
      '/doctor-dashboard?tab=payroll',
      case when new.entry_type = 'deduction' then 'high' else 'normal' end,
      jsonb_build_object('entryType', new.entry_type, 'amount', new.amount, 'cycleStart', new.cycle_start, 'cycleEnd', new.cycle_end),
      format('payroll-entry:%s:%s', new.id, new.updated_at),
      coalesce(new.updated_by_staff_id, new.created_by_staff_id)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_doctor_on_payroll_entry on public.staff_payroll_manual_entries;
create trigger trg_notify_doctor_on_payroll_entry
after insert or update on public.staff_payroll_manual_entries
for each row execute function public.notify_doctor_on_payroll_entry();

alter table public.staff_assignments enable row level security;
alter table public.staff_payroll_manual_entries enable row level security;
alter table public.staff_payroll_manual_entry_audit enable row level security;

-- Existing permission helpers differ between deployments; policies intentionally use staff_accounts
-- and auth.uid() only when the expected mapping exists.
do $$
begin
  if to_regclass('public.staff_accounts') is not null then
    execute $policy$
      create policy staff_assignments_personal_read on public.staff_assignments
      for select to authenticated
      using (
        assigned_to_staff_id in (select staff_id from public.staff_accounts where auth_user_id = auth.uid())
        or exists (
          select 1 from public.staff_accounts
          where auth_user_id = auth.uid()
            and role in ('general_manager','branches_manager','customer_service_manager','branch_manager','admin')
            and coalesce(is_active, true) = true
        )
      )
    $policy$;

    execute $policy$
      create policy payroll_entries_personal_read on public.staff_payroll_manual_entries
      for select to authenticated
      using (
        (visible_to_staff = true and staff_id in (select staff_id from public.staff_accounts where auth_user_id = auth.uid()))
        or exists (
          select 1 from public.staff_accounts
          where auth_user_id = auth.uid()
            and role in ('general_manager','admin')
            and coalesce(is_active, true) = true
        )
      )
    $policy$;

    execute $policy$
      create policy payroll_entries_general_manager_write on public.staff_payroll_manual_entries
      for all to authenticated
      using (exists (
        select 1 from public.staff_accounts
        where auth_user_id = auth.uid()
          and role in ('general_manager','admin')
          and coalesce(is_active, true) = true
      ))
      with check (exists (
        select 1 from public.staff_accounts
        where auth_user_id = auth.uid()
          and role in ('general_manager','admin')
          and coalesce(is_active, true) = true
      ))
    $policy$;
  end if;
exception when duplicate_object then
  null;
end $$;

commit;
