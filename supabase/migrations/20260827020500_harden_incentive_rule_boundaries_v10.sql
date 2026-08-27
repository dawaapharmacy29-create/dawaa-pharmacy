-- Architecture Hardening V10
-- Close the legacy points archive and replace permissive incentive rule policies.
-- Historical rule definitions remain readable to a valid Dawaa application actor,
-- while writes require the canonical manage_incentives permission.

-- archive_points_log_2026 is a historical snapshot, never a live app source.
revoke all privileges on table public.archive_points_log_2026 from anon, authenticated;

drop policy if exists archive_points_log_2026_insert_app on public.archive_points_log_2026;
drop policy if exists archive_points_log_2026_select_app on public.archive_points_log_2026;
drop policy if exists archive_points_log_2026_update_app on public.archive_points_log_2026;

alter table public.archive_points_log_2026 enable row level security;

-- deduction_rules
alter table public.deduction_rules enable row level security;

drop policy if exists deduction_rules_insert_app on public.deduction_rules;
drop policy if exists deduction_rules_select_app on public.deduction_rules;
drop policy if exists deduction_rules_update_app on public.deduction_rules;

create policy deduction_rules_actor_read_v10
on public.deduction_rules
for select
to anon, authenticated
using (public.dawaa_current_staff_id_v1() is not null);

create policy deduction_rules_manager_insert_v10
on public.deduction_rules
for insert
to anon, authenticated
with check (public.dawaa_can_manage_incentives());

create policy deduction_rules_manager_update_v10
on public.deduction_rules
for update
to anon, authenticated
using (public.dawaa_can_manage_incentives())
with check (public.dawaa_can_manage_incentives());

-- reward_rules
alter table public.reward_rules enable row level security;

drop policy if exists reward_rules_insert_app on public.reward_rules;
drop policy if exists reward_rules_select_app on public.reward_rules;
drop policy if exists reward_rules_update_app on public.reward_rules;

create policy reward_rules_actor_read_v10
on public.reward_rules
for select
to anon, authenticated
using (public.dawaa_current_staff_id_v1() is not null);

create policy reward_rules_manager_insert_v10
on public.reward_rules
for insert
to anon, authenticated
with check (public.dawaa_can_manage_incentives());

create policy reward_rules_manager_update_v10
on public.reward_rules
for update
to anon, authenticated
using (public.dawaa_can_manage_incentives())
with check (public.dawaa_can_manage_incentives());
