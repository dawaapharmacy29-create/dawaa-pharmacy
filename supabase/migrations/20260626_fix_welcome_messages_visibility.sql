-- Hotfix: welcome messages visibility, secure RPC access, and complete log schema.

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
  sent_at timestamptz not null default now(),
  notes text null,
  created_at timestamptz not null default now()
);

alter table public.customer_welcome_message_logs
  add column if not exists followup_id uuid null,
  add column if not exists customer_id text null,
  add column if not exists customer_code text null,
  add column if not exists customer_name text null,
  add column if not exists customer_phone text null,
  add column if not exists branch text null,
  add column if not exists doctor_id text null,
  add column if not exists doctor_name text null,
  add column if not exists message_body text,
  add column if not exists channel text not null default 'whatsapp',
  add column if not exists status text not null default 'sent',
  add column if not exists sent_by text null,
  add column if not exists sent_by_name text null,
  add column if not exists sent_at timestamptz not null default now(),
  add column if not exists notes text null,
  add column if not exists created_at timestamptz not null default now();

update public.customer_welcome_message_logs
set message_body = ''
where message_body is null;

alter table public.customer_welcome_message_logs
  alter column message_body set not null;

create index if not exists idx_customer_welcome_message_logs_customer_code
  on public.customer_welcome_message_logs (customer_code);
create index if not exists idx_customer_welcome_message_logs_customer_phone
  on public.customer_welcome_message_logs (customer_phone);
create index if not exists idx_customer_welcome_message_logs_doctor_name
  on public.customer_welcome_message_logs (doctor_name);
create index if not exists idx_customer_welcome_message_logs_branch
  on public.customer_welcome_message_logs (branch);
create index if not exists idx_customer_welcome_message_logs_sent_at
  on public.customer_welcome_message_logs (sent_at desc);

alter table public.customer_welcome_message_logs enable row level security;

drop policy if exists customer_welcome_message_logs_select on public.customer_welcome_message_logs;
drop policy if exists customer_welcome_message_logs_insert on public.customer_welcome_message_logs;
drop policy if exists customer_welcome_message_logs_update on public.customer_welcome_message_logs;

create policy customer_welcome_message_logs_select
  on public.customer_welcome_message_logs
  for select
  using (auth.role() = 'authenticated');

create policy customer_welcome_message_logs_insert
  on public.customer_welcome_message_logs
  for insert
  with check (auth.role() = 'authenticated');

create policy customer_welcome_message_logs_update
  on public.customer_welcome_message_logs
  for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

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
  if not public.app_role_allowed(
    p_actor_id,
    array['general_manager','admin','customer_service_manager','customer_service','branch_manager','pharmacist']
  ) then
    raise exception 'ليس لديك صلاحية مشاهدة الرسائل الترحيبية';
  end if;

  return query
  select *
  from public.customer_welcome_message_logs l
  where (p_customer_code is null or l.customer_code = p_customer_code)
    and (p_customer_phone is null or l.customer_phone = p_customer_phone)
    and (p_customer_id is null or l.customer_id = p_customer_id)
    and (p_branch is null or p_branch = '' or l.branch = p_branch)
    and (p_status is null or p_status = '' or l.status = p_status)
    and (p_doctor is null or p_doctor = '' or l.doctor_name ilike '%' || p_doctor || '%')
    and (p_from is null or l.sent_at::date >= p_from)
    and (p_to is null or l.sent_at::date <= p_to)
    and (
      p_search is null or p_search = ''
      or l.customer_name ilike '%' || p_search || '%'
      or l.customer_code ilike '%' || p_search || '%'
      or l.customer_phone ilike '%' || p_search || '%'
      or l.doctor_name ilike '%' || p_search || '%'
      or l.message_body ilike '%' || p_search || '%'
    )
  order by l.sent_at desc
  limit 300;
end;
$$;

create or replace function public.update_customer_welcome_message_status(
  p_id uuid,
  p_status text,
  p_actor_id text default null,
  p_actor_name text default null
)
returns public.customer_welcome_message_logs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.customer_welcome_message_logs;
begin
  if not public.app_role_allowed(
    p_actor_id,
    array['general_manager','admin','customer_service_manager','customer_service','branch_manager','pharmacist']
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
$$;
