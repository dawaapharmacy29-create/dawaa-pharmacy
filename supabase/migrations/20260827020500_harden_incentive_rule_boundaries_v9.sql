-- Architecture Hardening V9
-- Close the final legacy points archive and replace always-true incentive rule policies.
-- Historical rule tables remain readable to a real application actor for compatibility,
-- but only incentive-governance managers may mutate them.

-- ---------------------------------------------------------------------------
-- archive_points_log_2026: historical snapshot only, never a live write/read source.
-- ---------------------------------------------------------------------------
revoke all privileges on table public.archive_points_log_2026 from anon, authenticated;

drop policy if exists archive_points_log_2026_insert_app on public.archive_points_log_2026;
drop policy if exists archive_points_log_2026_select_app on public.archive_points_log_2026;
drop policy if exists archive_points_log_2026_update_app on public.archive_points_log_2026;

alter table public.archive_points_log_2026 enable row level security;

-- ---------------------------------------------------------------------------
-- deduction_rules
-- ---------------------------------------------------------------------------
alter table public.deduction_rules enable row level security;

drop policy if exists deduction_rules_insert_app on public.deduction_rules;
drop policy if exists deduction_rules_select_app on public.deduction_rules;
drop policy if exists deduction_rules_update_app on public.deduction_rules;

create policy deduction_rules_actor_read_v9
on public.deduction_rules
for select
to anon, authenticated
using (public.dawaa_current_staff_id_v1() is not null);

create policy deduction_rules_manager_insert_v9
on public.deduction_rules
for insert
to anon, authenticated
with check (public.dawaa_can_manage_incentives());

create policy deduction_rules_manager_update_v9
on public.deduction_rules
for update
to anon, authenticated
using (public.dawaa_can_manage_incentives())
with check (public.dawaa_can_manage_incentives());

-- ---------------------------------------------------------------------------
-- reward_rules
-- ---------------------------------------------------------------------------
alter table public.reward_rules enable row level security;

drop policy if exists reward_rules_insert_app on public.reward_rules;
drop policy if exists reward_rules_select_app on public.reward_rules;
drop policy if exists reward_rules_update_app on public.reward_rules;

create policy reward_rules_actor_read_v9
on public.reward_rules
for select
to anon, authenticated
using (public.dawaa_current_staff_id_v1() is not null);

create policy reward_rules_manager_insert_v9
on public.reward_rules
for insert
to anon, authenticated
with check (public.dawaa_can_manage_incentives());

create policy reward_rules_manager_update_v9
on public.reward_rules
for update
to anon, authenticated
using (public.dawaa_can_manage_incentives())
with check (public.dawaa_can_manage_incentives());
