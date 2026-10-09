-- Synthetic fixtures: every row exists to exercise one rule, so each expected outcome is known exactly.
-- No production data. Times are Cairo wall-clock (Egypt is on summer time, UTC+3, in September 2026).
create function public.test_ts(text) returns timestamptz language sql immutable as $$ select ($1::timestamp at time zone 'Africa/Cairo') $$;
-- A date-only import as BConnect stores it: 00:00 UTC of that date.
create function public.test_date_only(text) returns timestamptz language sql immutable as $$ select ($1::date::timestamp at time zone 'UTC') $$;

insert into public.staff (id, name, branch, active, role) values
  ('11111111-0000-0000-0000-000000000001', 'د تامر سليم', 'فرع الشامي', true, 'صيدلي'),   -- D1 target doctor
  ('11111111-0000-0000-0000-000000000002', 'د منى عادل', 'فرع شكري', true, 'صيدلي'),     -- D2 colleague
  ('11111111-0000-0000-0000-000000000003', 'د سامي نور', 'فرع الشامي', true, 'صيدلي'),    -- D3 and D4 share a name
  ('11111111-0000-0000-0000-000000000004', 'د سامي نور', 'فرع شكري', true, 'صيدلي');

insert into public.staff_accounts (id, role, branch, active, can_login, staff_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'general_manager', 'فرع الشامي', true, true, null), -- GM: all branches
  ('aaaaaaaa-0000-0000-0000-000000000002', 'branch_manager', 'فرع الشامي', true, true, null),  -- SM: الشامي, sales + reviews
  ('aaaaaaaa-0000-0000-0000-000000000003', 'branch_manager', 'فرع شكري', true, true, null),    -- KM: شكري, sales
  ('aaaaaaaa-0000-0000-0000-000000000004', 'assistant', 'فرع الشامي', true, true, null),       -- AS: no permissions
  ('aaaaaaaa-0000-0000-0000-000000000005', 'branch_manager', 'فرع الشامي', true, true, null);  -- SM2: sales, no reviews
insert into public.test_actor_permissions values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'view_sales'), ('aaaaaaaa-0000-0000-0000-000000000002', 'view_reviews'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'view_sales'), ('aaaaaaaa-0000-0000-0000-000000000005', 'view_sales');

-- D1 attendance, stored with the home branch (the legacy ingest behaviour) whatever device took the punches.
insert into public.attendance_daily_summary (staff_id, attendance_date, branch, first_in, last_out, status, payroll_eligible_hours, candidate_hours) values
  ('11111111-0000-0000-0000-000000000001', '2026-09-01', 'فرع الشامي', test_ts('2026-09-01 14:00'), test_ts('2026-09-01 23:00'), 'approved', 9, 9),      -- A: الشامي device
  ('11111111-0000-0000-0000-000000000001', '2026-09-02', 'فرع الشامي', test_ts('2026-09-02 18:00'), test_ts('2026-09-03 06:00'), 'approved', 12, 12),    -- B: night shift, الشامي
  ('11111111-0000-0000-0000-000000000001', '2026-09-03', 'فرع الشامي', test_ts('2026-09-03 14:00'), test_ts('2026-09-03 23:00'), 'pending_review', null, 9), -- C: in at شكري, out at الشامي
  ('11111111-0000-0000-0000-000000000001', '2026-09-04', 'فرع الشامي', test_ts('2026-09-04 10:00'), test_ts('2026-09-04 18:00'), 'approved', 8, 8),      -- D: unknown device 105
  ('11111111-0000-0000-0000-000000000001', '2026-09-05', 'فرع الشامي', test_ts('2026-09-05 10:00'), test_ts('2026-09-05 18:00'), 'approved', 8, 8),      -- E: no punch logs
  ('11111111-0000-0000-0000-000000000001', '2026-09-06', 'فرع الشامي', test_ts('2026-09-06 10:00'), test_ts('2026-09-06 18:00'), 'approved', 8, 8);      -- F: شكري device, stored as الشامي
insert into public.biometric_attendance_logs (staff_id, punch_time, device_id, raw_payload) values
  ('11111111-0000-0000-0000-000000000001', test_ts('2026-09-01 14:00'), null, '{"external_device_id":"GED7242701324"}'),
  ('11111111-0000-0000-0000-000000000001', test_ts('2026-09-01 23:00'), null, '{"external_device_id":"GED7242701324"}'),
  ('11111111-0000-0000-0000-000000000001', test_ts('2026-09-02 18:00'), null, '{"external_device_id":"GED7242701324"}'),
  ('11111111-0000-0000-0000-000000000001', test_ts('2026-09-03 06:00'), null, '{"external_device_id":"GED7242701324"}'),
  ('11111111-0000-0000-0000-000000000001', test_ts('2026-09-03 14:00'), null, '{"external_device_id":"GED7242701315"}'),
  ('11111111-0000-0000-0000-000000000001', test_ts('2026-09-03 23:00'), null, '{"external_device_id":"GED7242701324"}'),
  ('11111111-0000-0000-0000-000000000001', test_ts('2026-09-04 10:00'), null, '{"external_device_id":"105","device_location":"بسيسه"}'),
  ('11111111-0000-0000-0000-000000000001', test_ts('2026-09-04 18:00'), null, '{"external_device_id":"105","device_location":"بسيسه"}'),
  ('11111111-0000-0000-0000-000000000001', test_ts('2026-09-06 10:00'), null, '{"external_device_id":"GED7242701315"}'),
  ('11111111-0000-0000-0000-000000000001', test_ts('2026-09-06 18:00'), null, '{"external_device_id":"GED7242701315"}');

insert into public.sales_invoices (id, branch, invoice_number, invoice_date, staff_id, seller_name, customer_code, net_total) values
  ('i1', 'فرع الشامي', 'S1', test_ts('2026-09-01 15:00'), '11111111-0000-0000-0000-000000000001', null, 'K0', 100),          -- inside shift A
  ('i2', 'فرع الشامي', 'S2', test_ts('2026-09-03 01:30'), null, 'د تامر سليم', 'K0', 200),                                   -- night tail of B, by name
  ('i3', 'فرع شكري', 'S3', test_ts('2026-09-03 15:00'), '11111111-0000-0000-0000-000000000001', null, 'K0', 300),            -- C after شكري check-in
  ('i4', 'فرع الشامي', 'S4', test_ts('2026-09-03 16:00'), '11111111-0000-0000-0000-000000000001', null, 'K0', 400),          -- C while still at شكري
  ('i5', 'فرع الشامي', 'S5', test_ts('2026-09-04 12:00'), '11111111-0000-0000-0000-000000000001', null, 'K0', 500),          -- D unknown device
  ('i6', 'فرع الشامي', 'S6', test_date_only('2026-09-01'), '11111111-0000-0000-0000-000000000001', null, 'K0', 600),         -- date-only, day proven
  ('i7', 'فرع الشامي', 'S7', test_date_only('2026-09-03'), '11111111-0000-0000-0000-000000000001', null, 'K0', 700),         -- date-only, day touches mixed C
  ('i8', 'فرع الشامي', 'S8', test_ts('2026-09-10 16:00'), '11111111-0000-0000-0000-000000000001', null, 'K0', 800),          -- no shift
  ('i9', 'فرع الشامي', 'S9', test_date_only('2026-09-10'), '11111111-0000-0000-0000-000000000001', null, 'K0', 900),         -- date-only, no shift
  ('i10', 'فرع الشامي', 'S10', test_ts('2026-09-01 16:00'), '11111111-0000-0000-0000-000000000001', null, 'K0', 0),          -- zero
  ('i11a', 'فرع الشامي', 'DUP1', test_ts('2026-09-01 17:00'), '11111111-0000-0000-0000-000000000001', null, 'K0', 50),       -- duplicate number
  ('i11b', 'فرع الشامي', 'DUP1', test_ts('2026-09-01 17:05'), '11111111-0000-0000-0000-000000000001', null, 'K0', 50),
  ('i12', 'فرع شكري', 'S12', test_ts('2026-09-06 12:00'), '11111111-0000-0000-0000-000000000001', null, 'K0', 120),          -- F at شكري (stored الشامي)
  ('i13', 'فرع الشامي', 'S13', test_ts('2026-09-01 18:00'), null, 'د سامي نور', 'K0', 70),                                  -- shared seller name
  -- Conversion invoices (no shift that day; they are identity_only for productivity).
  ('c1', 'فرع الشامي', 'C1', test_ts('2026-09-20 10:30'), '11111111-0000-0000-0000-000000000001', null, 'K1', 10),
  ('c2', 'فرع الشامي', 'C2', test_ts('2026-09-20 09:10'), '11111111-0000-0000-0000-000000000001', null, 'K2', 10),
  ('c3', 'فرع الشامي', 'C3', test_ts('2026-09-20 11:00'), '11111111-0000-0000-0000-000000000002', null, 'K3', 10),
  ('c4', 'فرع الشامي', 'C4', test_ts('2026-09-20 11:30'), '11111111-0000-0000-0000-000000000001', null, 'K4x', 10),
  ('c5', 'فرع الشامي', 'C5', test_ts('2026-09-20 12:30'), '11111111-0000-0000-0000-000000000001', null, 'K5', 10),
  ('c7', 'فرع شكري', 'C7', test_ts('2026-09-20 13:30'), '11111111-0000-0000-0000-000000000001', null, 'K7', 10),
  ('c12a', 'فرع الشامي', 'C12', test_ts('2026-09-20 14:30'), '11111111-0000-0000-0000-000000000001', null, 'K12', 10),
  ('c12b', 'فرع شكري', 'C12', test_ts('2026-09-20 14:40'), '11111111-0000-0000-0000-000000000001', null, 'K12', 10);

-- Twelve reviews of D1 (all labelled الشامي), one per conversion class.
insert into public.conversation_sales_reviews_canonical_v2 (id, doctor_id, branch, invoice_number, converted_to_sale, conversation_date, first_customer_message_at, customer_code) values
  ('cccccccc-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'فرع الشامي', 'C1', true, test_ts('2026-09-20 10:00'), test_ts('2026-09-20 10:00'), 'K1'),   -- verified
  ('cccccccc-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'فرع الشامي', 'C2', true, test_ts('2026-09-20 10:00'), test_ts('2026-09-20 10:00'), 'K2'),   -- invoice 50 min before the first message
  ('cccccccc-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 'فرع الشامي', 'C3', true, test_ts('2026-09-20 10:30'), test_ts('2026-09-20 10:30'), 'K3'),   -- rung up by colleague D2
  ('cccccccc-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', 'فرع الشامي', 'C4', true, test_ts('2026-09-20 11:00'), test_ts('2026-09-20 11:00'), 'K4'),   -- other customer
  ('cccccccc-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001', 'فرع الشامي', 'C5', true, test_ts('2026-09-20 12:00'), test_ts('2026-09-20 12:00'), 'K5'),   -- same invoice claimed twice
  ('cccccccc-0000-0000-0000-000000000006', '11111111-0000-0000-0000-000000000001', 'فرع الشامي', 'C5', true, test_ts('2026-09-20 12:05'), test_ts('2026-09-20 12:05'), 'K5'),
  ('cccccccc-0000-0000-0000-000000000007', '11111111-0000-0000-0000-000000000001', 'فرع الشامي', 'C7', true, test_ts('2026-09-20 13:00'), test_ts('2026-09-20 13:00'), 'K7'),   -- sale at شكري, review labelled الشامي
  ('cccccccc-0000-0000-0000-000000000008', '11111111-0000-0000-0000-000000000001', 'فرع الشامي', null, false, test_ts('2026-09-20 15:00'), test_ts('2026-09-20 15:00'), 'K8'),  -- no sale
  ('cccccccc-0000-0000-0000-000000000009', '11111111-0000-0000-0000-000000000001', 'فرع الشامي', null, null, test_ts('2026-09-20 15:10'), test_ts('2026-09-20 15:10'), 'K9'),   -- unknown
  ('cccccccc-0000-0000-0000-000000000010', '11111111-0000-0000-0000-000000000001', 'فرع الشامي', null, true, test_ts('2026-09-20 15:20'), test_ts('2026-09-20 15:20'), 'K10'),  -- converted without invoice
  ('cccccccc-0000-0000-0000-000000000011', '11111111-0000-0000-0000-000000000001', 'فرع الشامي', 'C11', true, test_ts('2026-09-20 15:30'), test_ts('2026-09-20 15:30'), 'K11'), -- invoice does not exist
  ('cccccccc-0000-0000-0000-000000000012', '11111111-0000-0000-0000-000000000001', 'فرع الشامي', 'C12', true, test_ts('2026-09-20 14:00'), test_ts('2026-09-20 14:00'), 'K12'); -- number in two branches, same customer
