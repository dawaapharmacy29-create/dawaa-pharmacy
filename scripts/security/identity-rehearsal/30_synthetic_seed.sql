-- Synthetic seed for the isolated security rehearsal clone ONLY (dawaa_sec_rehearsal). No Production rows.
-- Accounts:  A1 GM (shokry) | A2 branch_manager (shokry) | A3 pharmacist (shokry) | A4 pharmacist (shamy) | A5 customer_service_manager (shokry)
begin;
insert into public.staff (id, name, role, branch, status, is_active, active) values
 ('51000000-0000-4000-8000-000000000001','GM One','general_manager','فرع شكري','active',true,true),
 ('51000000-0000-4000-8000-000000000002','BM Shokry','branch_manager','فرع شكري','active',true,true),
 ('51000000-0000-4000-8000-000000000003','PH Shokry','pharmacist','فرع شكري','active',true,true),
 ('51000000-0000-4000-8000-000000000004','PH Shamy','pharmacist','فرع الشامي','active',true,true),
 ('51000000-0000-4000-8000-000000000005','CSM Shokry','customer_service_manager','فرع شكري','active',true,true);

insert into public.staff_accounts (id, username, staff_id, staff_name, name, role, branch, active, is_active, can_login, status, permissions) values
 ('a1000000-0000-4000-8000-000000000001','gm','51000000-0000-4000-8000-000000000001','GM One','GM One','general_manager','فرع شكري',true,true,true,'active','{}'),
 ('a1000000-0000-4000-8000-000000000002','bm','51000000-0000-4000-8000-000000000002','BM Shokry','BM Shokry','branch_manager','فرع شكري',true,true,true,'active','{}'),
 ('a1000000-0000-4000-8000-000000000003','ph1','51000000-0000-4000-8000-000000000003','PH Shokry','PH Shokry','pharmacist','فرع شكري',true,true,true,'active','{}'),
 ('a1000000-0000-4000-8000-000000000004','ph2','51000000-0000-4000-8000-000000000004','PH Shamy','PH Shamy','pharmacist','فرع الشامي',true,true,true,'active','{}'),
 ('a1000000-0000-4000-8000-000000000005','csm','51000000-0000-4000-8000-000000000005','CSM Shokry','CSM Shokry','customer_service_manager','فرع شكري',true,true,true,'active','{}');

-- Session tokens are synthetic: "tok-<role>-" padded to 40 chars. Only their sha256 is stored, as in Production.
insert into public.staff_login_sessions (id, staff_account_id, token_hash, created_at, expires_at)
select gen_random_uuid(), a.id, encode(extensions.digest(t.tok, 'sha256'), 'hex'), now(), now() + interval '12 hours'
from (values
  ('a1000000-0000-4000-8000-000000000001'::uuid, 'tok-gm-000000000000000000000000000000000001'),
  ('a1000000-0000-4000-8000-000000000002'::uuid, 'tok-bm-000000000000000000000000000000000002'),
  ('a1000000-0000-4000-8000-000000000003'::uuid, 'tok-ph1-00000000000000000000000000000000003'),
  ('a1000000-0000-4000-8000-000000000004'::uuid, 'tok-ph2-00000000000000000000000000000000004'),
  ('a1000000-0000-4000-8000-000000000005'::uuid, 'tok-csm-00000000000000000000000000000000005')
) t(acc, tok) join public.staff_accounts a on a.id = t.acc;

insert into public.employee_monthly_statements (id, staff_id, staff_name, branch, cycle_start, cycle_end, net_salary, status)
select gen_random_uuid(), s.id::text, s.name, s.branch, date '2026-09-26', date '2026-10-25', 1000 + row_number() over (order by s.id), 'draft'
from public.staff s;

insert into public.employee_compensation_profiles (staff_id, staff_name, branch, monthly_base_salary, active)
select s.id::text, s.name, s.branch, 5000, true from public.staff s;

insert into public.employee_events (id, subject_staff_id, subject_name, branch, category, event_type, title, event_at)
select gen_random_uuid(), s.id::text, s.name, s.branch, 'hr', 'note', 'event for '||s.name, now() from public.staff s;

insert into public.manager_weekly_evaluations (id, evaluation_type, subject_staff_id, subject_name, branch, evaluator_staff_id, evaluator_name, week_start, week_end, status)
values (gen_random_uuid(), 'pharmacist', '51000000-0000-4000-8000-000000000003', 'PH Shokry', 'فرع شكري', '51000000-0000-4000-8000-000000000002', 'BM Shokry', date '2026-10-10', date '2026-10-16', 'draft'),
       (gen_random_uuid(), 'pharmacist', '51000000-0000-4000-8000-000000000004', 'PH Shamy', 'فرع الشامي', '51000000-0000-4000-8000-000000000001', 'GM One', date '2026-10-10', date '2026-10-16', 'draft');

insert into public.manager_daily_checklist (id, staff_id, staff_name, role, branch, task_date, task_key, completed)
select gen_random_uuid(), s.id, s.name, s.role, s.branch, current_date, 'open_branch', false from public.staff s;

insert into public.branch_sales_targets (id, branch_name, cycle_start_day, target_amount, active)
values (gen_random_uuid(), 'فرع شكري', 26, 100000, true), (gen_random_uuid(), 'فرع الشامي', 26, 90000, true);

insert into public.branch_daily_tasks (id, task_date, branch, category, title, status)
values ('b0000000-0000-4000-8000-000000000001', current_date, 'فرع شكري', 'ops', 'Seed task', 'pending');

insert into public.deduction_rules (id, name, category, target_type, default_points, severity, is_active)
values (gen_random_uuid(), 'late', 'attendance', 'staff', 1, 'low', true);
commit;
