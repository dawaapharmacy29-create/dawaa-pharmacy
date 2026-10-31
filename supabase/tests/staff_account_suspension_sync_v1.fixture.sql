-- Synthetic isolated fixture (no production IDs).
create role anon nologin;
create role authenticated nologin;

create table public.staff(id uuid primary key, name text, status text, active boolean, is_active boolean,
  visible_in_schedule boolean);
create table public.staff_accounts(id uuid primary key, name text, staff_id text, active boolean, can_login boolean);
create table public.shift_schedules(id uuid primary key default gen_random_uuid(), staff_id uuid, day_name text,
  effective_from date, effective_to date,
  constraint shift_schedules_effective_range_chk check (effective_to is null or effective_to >= effective_from));
create table public.staff_login_sessions(id uuid primary key default gen_random_uuid(), staff_account_id uuid,
  expires_at timestamptz, revoked_at timestamptz);

insert into public.staff values
  ('00000000-0000-4000-9000-000000000001', 'مستمرة', 'نشط', true, true, true),
  ('00000000-0000-4000-9000-000000000002', 'موقوفة قديمًا', 'نشط', true, true, true),
  ('00000000-0000-4000-9000-000000000003', 'حسابين', 'نشط', true, true, true),
  ('00000000-0000-4000-9000-000000000004', 'منتهية', 'terminated', false, false, true);
insert into public.staff_accounts values
  ('00000000-0000-4000-8000-000000000101', 'مستمرة', '00000000-0000-4000-9000-000000000001', true, true),
  ('00000000-0000-4000-8000-000000000102', 'موقوفة قديمًا', '00000000-0000-4000-9000-000000000002', false, true),
  ('00000000-0000-4000-8000-000000000103', 'حسابين قديم', '00000000-0000-4000-9000-000000000003', false, true),
  ('00000000-0000-4000-8000-000000000113', 'حسابين جديد', '00000000-0000-4000-9000-000000000003', true, true),
  ('00000000-0000-4000-8000-000000000104', 'منتهية', '00000000-0000-4000-9000-000000000004', false, false);
insert into public.shift_schedules(staff_id, day_name, effective_from, effective_to) values
  ('00000000-0000-4000-9000-000000000001', 'السبت', current_date - 30, null),
  ('00000000-0000-4000-9000-000000000001', 'الأحد', current_date + 3, null),
  ('00000000-0000-4000-9000-000000000002', 'السبت', current_date - 30, null),
  ('00000000-0000-4000-9000-000000000002', 'الأحد', current_date - 60, current_date - 31),
  ('00000000-0000-4000-9000-000000000003', 'السبت', current_date - 30, null),
  ('00000000-0000-4000-9000-000000000004', 'السبت', current_date - 30, null);
insert into public.staff_login_sessions(staff_account_id, expires_at) values
  ('00000000-0000-4000-8000-000000000101', now() + interval '6 hours');
