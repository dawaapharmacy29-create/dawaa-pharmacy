-- Synthetic isolated fixture; reuses the on-duty fixture (no production IDs).
\ir shift_handover_on_duty_corrections_v1.fixture.sql

-- Production: shift_handovers reads through a role-free RLS policy.
drop policy if exists shift_handovers_read on public.shift_handovers;
create policy shift_handovers_read on public.shift_handovers for select using (true);
