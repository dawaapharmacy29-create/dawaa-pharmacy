-- Payroll V14 defense in depth: browser roles may read scoped rows only.
-- All writes/status transitions go through save_staff_payroll_monthly_v14.

revoke all privileges on table public.staff_payroll_monthly_v13 from anon,authenticated;
grant select on table public.staff_payroll_monthly_v13 to anon,authenticated;

comment on table public.staff_payroll_monthly_v13 is
  'Payroll monthly truth. Browser roles are read-only; writes and status transitions go only through save_staff_payroll_monthly_v14.';
