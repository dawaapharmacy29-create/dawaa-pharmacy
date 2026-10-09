create index if not exists idx_delivery_payroll_partial_cycle_decisions_approved_by
  on public.delivery_payroll_partial_cycle_decisions_v1 (approved_by);

create index if not exists idx_delivery_payroll_quarterly_assessments_approved_by
  on public.delivery_payroll_quarterly_assessments_v1 (approved_by);

create index if not exists idx_delivery_payroll_quarterly_assessments_staff_id
  on public.delivery_payroll_quarterly_assessments_v1 (staff_id);