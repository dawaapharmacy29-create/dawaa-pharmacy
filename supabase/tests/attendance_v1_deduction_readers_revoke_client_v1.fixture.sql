-- Fixture for 20261016110000_attendance_v1_deduction_readers_revoke_client_v1: the two legacy V1 readers with their
-- Production grants (EXECUTE for PUBLIC/anon/authenticated/service_role). The reader is the exact Production text;
-- the unified approvals aggregator is reduced to its V1 deduction branch (only its grants are under test).
create role anon;
create role authenticated;
create role service_role bypassrls;

create table public.employee_transactions (
  id uuid primary key default gen_random_uuid(), staff_id uuid, employee_name text, branch text, month_cycle text,
  points numeric, amount numeric, description text, transaction_date date, source text, status text
);
insert into public.employee_transactions (staff_id, employee_name, branch, month_cycle, points, amount, description, transaction_date, source, status)
values ('00000000-0000-4000-8000-000000000001', 'A', 'فرع شكري', '2026-10', 3, 30, 'late', '2026-10-10', 'attendance_deduction_v1', 'pending');

-- Production definition (2026-10-16).
CREATE OR REPLACE FUNCTION public.attendance_deduction_pending_review_v1()
 RETURNS TABLE(id uuid, staff_id uuid, employee_name text, branch text, month_cycle text, points numeric, amount numeric, description text, transaction_date date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select et.id, et.staff_id, et.employee_name, et.branch, et.month_cycle, et.points, et.amount, et.description, et.transaction_date
  from public.employee_transactions et
  where et.source='attendance_deduction_v1' and et.status='pending'
  order by et.points desc;
$function$;

create or replace function public.attendance_unified_approvals_v1()
returns table(item_type text, item_id uuid, staff_id uuid, staff_name text, branch text, title text, subtitle text, amount numeric, hours numeric, requested_at timestamptz, priority integer)
language sql stable security definer set search_path to 'public', 'pg_catalog'
as $function$
  select 'deduction'::text, d.id, d.staff_id, d.employee_name, d.branch, 'خصم حضور تلقائي'::text,
    format('%s نقطة (%s ج.م)', d.points, d.amount), d.amount, null::numeric, d.transaction_date::timestamptz, 2
  from public.attendance_deduction_pending_review_v1() d;
$function$;

grant execute on function public.attendance_deduction_pending_review_v1() to public, anon, authenticated, service_role;
grant execute on function public.attendance_unified_approvals_v1() to public, anon, authenticated, service_role;

create table public.test_before as
select p.proname::text, md5(p.prosrc) src_md5 from pg_proc p
where p.proname in ('attendance_deduction_pending_review_v1', 'attendance_unified_approvals_v1');
