-- Cover Delivery Payroll foreign keys used by quarterly/partial-cycle approval records.
-- Existing composite indexes already cover partial_cycle_decisions.staff_id and quarterly_assessments.quarter_cycle_id.

create index if not exists idx_delivery_payroll_partial_cycle_decisions_approved_by
  on public.delivery_payroll_partial_cycle_decisions_v1 (approved_by);

create index if not exists idx_delivery_payroll_quarterly_assessments_approved_by
  on public.delivery_payroll_quarterly_assessments_v1 (approved_by);

create index if not exists idx_delivery_payroll_quarterly_assessments_staff_id
  on public.delivery_payroll_quarterly_assessments_v1 (staff_id);
