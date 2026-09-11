# Production verification

After applying `20260911063000_role_specific_employee_daily_tasks.sql` to production, today's task source was regenerated safely from pending generic rows.

Observed role-specific totals for the Cairo day:
- pharmacist: 65 tasks across 5 real operating duties
- assistant: 35 tasks across 5 duties
- branch_manager: 12 tasks across 6 duties
- branches_manager: 6 tasks across 6 duties
- rider: 60 tasks across 5 duties
- team_dawaa_alpha: 3 daily-track tasks

Generic fallback remains only for roles that do not yet have a dedicated profile. Completed and historical tasks were not removed.