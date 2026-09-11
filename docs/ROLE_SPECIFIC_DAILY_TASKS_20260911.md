# Role-specific daily tasks recovery — 2026-09-11

The employee daily task source was being generated automatically, but every employee received only three generic tasks. This prevented the notification feed from reflecting the real operational duties already defined in the application.

This change keeps the existing `employee_daily_tasks` source and notification workflow, but changes `generate_employee_daily_tasks` so the generated rows are role-specific for pharmacists, assistants, branch managers, branches managers, riders, and Team Alpha. Unknown roles continue to receive the safe generic fallback.

For the current Cairo day, only untouched pending generic auto-generated rows are replaced. Completed/history rows are never deleted.

Production verification after applying the migration showed role-specific rows including pharmacist tasks for average invoice, uncoded invoices, conversation reviews, cross-sell, and welcome messages; branch manager operational tasks; rider delivery tasks; and the Team Alpha daily track task.