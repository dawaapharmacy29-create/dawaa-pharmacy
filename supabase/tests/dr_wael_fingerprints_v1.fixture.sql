-- Synthetic isolated fixture; no production connections. The migration seeds the two real viewer accounts
-- (they do not exist here); the test adds its own synthetic viewer.
create role anon;
create role authenticated;
create role service_role;
create table public.staff_accounts(id uuid primary key, name text, role text, branch text, active boolean, can_login boolean);
create function public.dawaa_current_staff_account_id_strict() returns uuid language sql stable as $$
  select nullif(current_setting('test.actor', true), '')::uuid $$;

create table public.staff(id uuid primary key, name text, branch text, role text, type text, is_active boolean, join_date date);
create table public.attendance_daily_summary(id uuid primary key default gen_random_uuid(), staff_id uuid,
  attendance_date date, branch text, first_in timestamptz, last_out timestamptz, total_hours numeric,
  payroll_eligible_hours numeric, late_minutes integer, early_leave_minutes integer, missing_punch boolean,
  status text, resolution_status text, review_required boolean, scheduled_start_at timestamptz,
  scheduled_end_at timestamptz, time_off_request_id uuid);
create table public.biometric_attendance_logs(id uuid primary key default gen_random_uuid(), device_id text,
  biometric_user_id text, staff_id uuid, staff_name_snapshot text, branch text, punch_time timestamptz, punch_type text);
create table public.staff_time_off_requests(id uuid primary key default gen_random_uuid(), staff_id uuid,
  request_kind text, request_label text, status text, start_date date, end_date date, start_time time,
  end_time time, duration_minutes integer, reason text, decided_by_name text);
-- Production has a view; a table with the same columns is enough here.
create table public.staff_payroll_incentive_truth_v1(staff_id uuid, month_cycle text, performance_incentive numeric,
  target_bonus numeric, automated_incentives_total numeric);
create table public.employee_transactions(id uuid primary key default gen_random_uuid(), staff_id uuid, type text,
  category text, title text, reason text, display_reason text, amount numeric, transaction_date date,
  month_cycle text, status text);
create table public.staff_payroll_manual_entries_v1(id uuid primary key default gen_random_uuid(), staff_id uuid,
  month_cycle text, entry_kind text, category text, amount numeric, signed_amount numeric, reason text,
  reversal_of uuid, created_by_name text, created_at timestamptz default now());
-- Stand-in for the canonical per-day schedule resolver: 10:00–18:00 every day except Friday.
create function public.attendance_schedule_for_date_v1(p_staff_id uuid, p_date date)
returns table(schedule_id uuid, staff_id uuid, branch text, day_name text, shift_start time, shift_end time,
  is_off boolean, is_day_off boolean, source_kind text) language sql stable as $$
  select null::uuid, p_staff_id, null::text, null::text, time '10:00', time '18:00',
    extract(dow from p_date) = 5, false, 'fixture' $$;

insert into public.staff_accounts values
  ('00000000-0000-4000-8000-000000000001', 'مشاهد', 'executive_manager', null, true, true),
  ('00000000-0000-4000-8000-000000000002', 'مدير عام آخر', 'general_manager', null, true, true),
  ('00000000-0000-4000-8000-000000000003', 'مشاهد موقوف', 'executive_manager', null, false, false);

insert into public.staff values
  ('00000000-0000-4000-9000-000000000001', 'صيدلي شكري', 'فرع شكري', 'pharmacist', 'Pharmacist', true, null),
  ('00000000-0000-4000-9000-000000000002', 'مساعد الشامي', 'فرع الشامي', 'assistant', 'مساعد', true, null),
  ('00000000-0000-4000-9000-000000000003', 'أمين المخزن', 'المخزن', 'warehouse', 'مخزن', true, null),
  ('00000000-0000-4000-9000-000000000004', 'موظف فرع تاني', 'فرع زكريا', 'pharmacist', 'Pharmacist', true, null),
  ('00000000-0000-4000-9000-000000000005', 'دليفري شكري', 'فرع شكري', 'delivery', 'Delivery', true, null),
  ('00000000-0000-4000-9000-000000000006', 'موظف سابق', 'فرع شكري', 'pharmacist', 'Pharmacist', false, null);

-- Cycle 2026-11 = 2026-10-26 … 2026-11-25.
insert into public.attendance_daily_summary(staff_id, attendance_date, branch, first_in, last_out, total_hours,
  payroll_eligible_hours, late_minutes, early_leave_minutes, missing_punch, status, resolution_status, review_required) values
  ('00000000-0000-4000-9000-000000000001', date '2026-11-01', 'فرع شكري', '2026-11-01 08:10+00', '2026-11-01 16:00+00', 7.83, 8, 10, 0, false, 'approved', 'late', false),
  ('00000000-0000-4000-9000-000000000001', date '2026-11-02', 'فرع شكري', '2026-11-02 08:00+00', null, 0, 0, 0, 0, true, 'pending_review', 'missing_checkout', true),
  ('00000000-0000-4000-9000-000000000002', date '2026-10-26', 'فرع الشامي', '2026-10-26 08:00+00', '2026-10-26 16:00+00', 8, 8, 0, 0, false, 'approved', 'on_time', false),
  -- A former employee still has a day in the cycle, so they appear.
  ('00000000-0000-4000-9000-000000000006', date '2026-10-27', 'فرع شكري', '2026-10-27 08:00+00', '2026-10-27 16:00+00', 8, 8, 0, 0, false, 'approved', 'on_time', false),
  -- Outside the three branches or outside the cycle: never shown.
  ('00000000-0000-4000-9000-000000000004', date '2026-11-01', 'فرع زكريا', null, null, 0, 0, 0, 0, true, 'pending_review', 'absence_review', true),
  ('00000000-0000-4000-9000-000000000001', date '2026-10-25', 'فرع شكري', null, null, 0, 0, 0, 0, true, 'pending_review', 'absence_review', true),
  ('00000000-0000-4000-9000-000000000001', date '2026-11-26', 'فرع شكري', null, null, 0, 0, 0, 0, true, 'pending_review', 'absence_review', true);

-- Two punches on 2026-11-01 Cairo, one at 01:00 Cairo on 2026-11-02 (night of the 1st), one in another branch.
insert into public.biometric_attendance_logs(staff_id, staff_name_snapshot, branch, biometric_user_id, punch_time, punch_type, device_id) values
  ('00000000-0000-4000-9000-000000000001', 'صيدلي شكري', 'فرع شكري', '11', '2026-11-01 08:10+00', 'in', 'd1'),
  ('00000000-0000-4000-9000-000000000001', 'صيدلي شكري', 'فرع شكري', '11', '2026-11-01 16:00+00', 'out', 'd1'),
  ('00000000-0000-4000-9000-000000000002', 'مساعد الشامي', 'فرع الشامي', '22', '2026-11-01 23:00+00', 'in', 'd2'),
  ('00000000-0000-4000-9000-000000000004', 'موظف فرع تاني', 'فرع زكريا', '44', '2026-11-01 09:00+00', 'in', 'd9');

insert into public.staff_time_off_requests(staff_id, request_kind, request_label, status, start_date, end_date) values
  ('00000000-0000-4000-9000-000000000002', 'annual_leave', 'إجازة اعتيادية', 'approved', date '2026-11-03', date '2026-11-04'),
  ('00000000-0000-4000-9000-000000000002', 'annual_leave', 'إجازة اعتيادية', 'cancelled', date '2026-11-05', date '2026-11-05'),
  ('00000000-0000-4000-9000-000000000004', 'annual_leave', 'إجازة اعتيادية', 'approved', date '2026-11-03', date '2026-11-03');

insert into public.staff_payroll_incentive_truth_v1 values
  ('00000000-0000-4000-9000-000000000001', '2026-11', 300, 200, 500),
  ('00000000-0000-4000-9000-000000000001', '2026-10', 999, 0, 999),
  ('00000000-0000-4000-9000-000000000004', '2026-11', 700, 0, 700);

insert into public.employee_transactions(staff_id, type, category, title, amount, transaction_date, month_cycle, status) values
  ('00000000-0000-4000-9000-000000000001', 'reward', 'target_bonus', 'تارجت', 250, date '2026-11-01', '2026-11', 'active'),
  ('00000000-0000-4000-9000-000000000001', 'penalty', 'attendance', 'تأخير', 50, date '2026-11-02', '2026-11', 'approved'),
  ('00000000-0000-4000-9000-000000000001', 'penalty', 'attendance', 'ملغي', 80, date '2026-11-02', '2026-11', 'cancelled'),
  ('00000000-0000-4000-9000-000000000001', 'reward', null, 'نقاط بس', 0, date '2026-11-02', '2026-11', 'active');

insert into public.staff_payroll_manual_entries_v1(staff_id, month_cycle, entry_kind, category, amount, signed_amount, reason) values
  ('00000000-0000-4000-9000-000000000002', '2026-11', 'deduction', 'other', 400, -400, 'سلفة'),
  ('00000000-0000-4000-9000-000000000004', '2026-11', 'deduction', 'other', 900, -900, 'فرع تاني');
