# Full Audit Report

Date: 2026-05-22

## Official Data Sources

The app now has a central table registry in `src/lib/supabaseTables.ts`.

- `public.staff`
- `public.staff_accounts`
- `public.shift_schedules`
- `public.employee_transactions`
- `public.permissions`
- `public.user_permissions`
- `public.user_permission_overrides`
- `public.shift_performance_reviews`
- `public.shift_performance_review_members`
- `public.shift_exceptions`

## Existing Pages

- `ActivityLog.tsx`
- `Analytics.tsx`
- `Customers.tsx`
- `CustomerService.tsx`
- `Dashboard.tsx`
- `Delivery.tsx`
- `DoctorDashboard.tsx`
- `IncentiveMedicines.tsx`
- `Index.tsx`
- `Invoices.tsx`
- `Login.tsx`
- `NotFound.tsx`
- `PenaltyIncentiveManagement.tsx`
- `Points.tsx`
- `Reviews.tsx`
- `RolesPermissions.tsx`
- `Schedule.tsx`
- `ShiftPerformance.tsx`
- `StaffAccounts.tsx`
- `StaffDashboard.tsx`
- `StaffDetail.tsx`
- `StagnantMedicines.tsx`
- `Team.tsx`
- `TimeOff.tsx`

## Pages Used In Routes

Routes are defined in `src/App.tsx`.

- `/` -> `Dashboard`
- `/login` -> `Login`
- `/customers` -> `Customers`
- `/customer-service` -> `CustomerService`
- `/team` -> `Team`
- `/staff/:id` -> `StaffDetail`
- `/schedule` -> `Schedule`
- `/points` -> `Points`
- `/reviews` -> `Reviews`
- `/shift-performance` -> `ShiftPerformance`
- `/time-off` -> `TimeOff`
- `/doctor-dashboard` -> `DoctorDashboard`
- `/stagnant-medicines` -> `StagnantMedicines`
- `/incentive-medicines` -> `IncentiveMedicines`
- `/staff-accounts` -> `StaffAccounts`
- `/roles-permissions` -> `RolesPermissions`
- `/delivery` -> `Delivery`
- `/analytics` and `/analytics-sales` -> `Analytics`
- `/invoices` -> `Invoices`
- `/activity-log` -> `ActivityLog`
- `/penalty-incentive` -> `PenaltyIncentiveManagement`
- `/staff-dashboard` -> `StaffDashboard`
- `*` -> `NotFound`

## Unused Pages

- `src/pages/Index.tsx` is not currently routed by `App.tsx`.
- No page was deleted. `Index.tsx` should be reviewed manually before archiving because it may be a framework scaffold or older landing page.

## Components And Hooks

Added official hooks/services:

- `src/hooks/useStaff.ts`
- `src/hooks/useShiftSchedules.ts`
- `src/hooks/useEmployeeTransactions.ts`
- `src/hooks/usePermissions.ts`
- `src/services/staffService.ts`
- `src/services/shiftScheduleService.ts`
- `src/services/employeeTransactionService.ts`
- `src/services/permissionService.ts`

Potential cleanup candidates:

- `src/lib/mock-data.ts` is still present and `Sidebar.tsx` still imports `MOCK_NOTIFICATIONS`. This should be replaced with `notifications` or the existing `notificationFeed` path before archiving.
- `src/lib/staffFallback.ts` still provides fallback staff choices for screens that need resilience when Supabase is empty. This is not a table conflict, but it should not be shown as real data in production workflows.

## Supabase Query Audit

Official staffing pages now use central sources:

- Team staff: `TABLES.staff`
- Team schedules: `TABLES.shiftSchedules`
- Team penalties/rewards: `TABLES.employeeTransactions`
- Staff creation: `staffService.createStaff`
- Staff updates: `staffService.updateStaff`
- Weekly schedule replacement: `shiftScheduleService.replaceStaffShiftSchedules`
- Permissions user overrides: `permissionService.upsertUserPermission`

Points and penalty/reward views now read the official transaction source:

- `Dashboard.tsx` reads `employee_transactions`
- `Team.tsx` reads `employee_transactions`
- `Points.tsx` reads `employee_transactions`
- `PenaltyIncentiveManagement.tsx` reads `employee_transactions`
- `StaffDetail.tsx` reads `employee_transactions`

Writes:

- Manual points/penalty/reward creation now writes into `employee_transactions` through `persistPointsTransaction`.
- Conversation reviews use `persistPointsTransaction`, so their reward/deduction impact is mirrored into `employee_transactions`.
- `point_records` and `points_transactions` are still written for compatibility with older modules and migrations, but they should be treated as legacy compatibility stores, not the source of truth for penalties/rewards.

## Suspected Old Or Duplicate Tables

Detected in migrations or schema files:

- `employees` appears in `supabase/staffing_and_evaluation_schema.sql`. The app runtime should use `staff` instead.
- `point_records` and `points_transactions` exist in multiple older migrations. They are now compatibility tables for point scoring/history, while penalty/reward truth should be `employee_transactions`.
- Potential historical penalty/reward tables mentioned in audit requirements should be checked live with `supabase_cleanup_audit.sql`: `employee_rewards`, `employee_penalties`, `penalties`, `rewards`, `staff_penalties`, `staff_rewards`.

No destructive SQL was added.

## Conflicting Data Sources Fixed

- Team cards and team detail modal both count penalties/rewards from `employee_transactions`.
- Points overview and penalty/incentive management now read from `employee_transactions`.
- Staff detail reward/deduction boxes now read from `employee_transactions`.
- Staff and schedule create/update now go through services using official table names.

## Remaining Follow-Up Cleanup

- Replace `MOCK_NOTIFICATIONS` in `Sidebar.tsx` with live notifications.
- Consider migrating historical `point_records` / `points_transactions` into `employee_transactions` if they contain older penalty/reward data that must appear in new views.
- Review `DoctorDashboard.tsx`, `StaffDashboard.tsx`, `Delivery.tsx`, and `shiftPerformance.ts` because they still read `point_records` for personal score history or performance calculations. This can remain temporarily if those screens are score-led rather than penalty/reward-led, but migration to `employee_transactions` should be planned.
- Archive `src/pages/Index.tsx` only after confirming it is not used by deployment scaffolding.

## Supabase Cleanup Plan

Created `supabase_cleanup_audit.sql`.

The script:

- Lists public tables.
- Lists columns.
- Shows estimated sizes and rows.
- Lists suspected legacy tables.
- Includes commented rename statements only.
- Includes commented migration patterns for old penalties/rewards into `employee_transactions`.

Do not run any rename/delete statements without a verified backup and explicit approval.

## Service Worker And Routing

- Updated `public/sw.js` cache version to force clients off old cached assets.
- Navigation fetch now uses `request.clone()` before caching.
- Added `CLEAR_CACHE` message support.
- Added `vercel.json` SPA rewrite to prevent direct-route 404s on Vercel.

## Error Handling

Added `src/lib/supabaseError.ts` with:

- `logSupabaseError`
- `friendlySupabaseError`

The shared Supabase hook now logs full Supabase error details: `message`, `details`, `hint`, and `code`.

## Validation

Build completed successfully:

- Command: `npm.cmd run build`
- Result: success

Warnings:

- Large bundle warning from Vite.
- Browserslist data is outdated.

## Important Migration Note

If live legacy tables contain data, migrate first, archive second, delete last. Recommended order:

1. Run `supabase_cleanup_audit.sql`.
2. Export/backup all suspected legacy tables.
3. Compare row counts against official tables.
4. Migrate old penalty/reward rows into `employee_transactions`.
5. Rename old tables to `archived_*`.
6. Deploy and observe logs.
7. Delete archived tables only after explicit approval.

## Employee Transactions Final Wiring

After the point migration, the React app no longer reads `point_records`, `points_log`, or `points_transactions` from `src`.

Current official source for penalties/rewards/deductions:

- `public.employee_transactions`
- Staff relation: `employee_transactions.staff_id = staff.id`
- Penalty type: `type = 'penalty'`
- Reward type: `type = 'reward'`
- Points: `points` when present, otherwise `abs(points_delta)`

Updated areas:

- Team cards count and sum penalties/rewards from `employee_transactions`.
- Team eye/details modal displays the same employee transaction rows from `employee_transactions`.
- Points and rewards page reads `employee_transactions`.
- Penalty/incentive management reads and updates `employee_transactions`.
- Staff detail reads `employee_transactions`.
- Doctor dashboard reads `employee_transactions`.
- Staff dashboard reads `employee_transactions`.
- Delivery dashboard reads `employee_transactions`.
- Conversation review repeat checks read `employee_transactions`.
- Shift performance repeat checks read `employee_transactions`.
- New point/penalty/reward writes go directly to `employee_transactions`.

Created safe cleanup script:

- `supabase_backup_moaz_before_delete.sql`
- Creates schema `backup_moaz`
- Copies `point_records`, `points_log`, and `points_transactions` if they exist
- Prints row counts
- Keeps actual `drop table` commands commented until manual approval

Local copies created:

- `backups/باك اب معاذ قبل المسح`
- `backups/التطبيق الجديد`

## Final Points And Incentive Stabilization

Cause of the returned old values:

- `src/pages/DoctorDashboard.tsx` had direct incentive math equivalent to 1500 EGP cap, 500 target points, and 3 EGP per point.
- `src/pages/Points.tsx` passed a hardcoded `5000` base salary into the old salary calculator.
- `src/lib/points.ts` previously owned scattered numeric incentive constants directly.
- `src/lib/staffFallback.ts` could merge fallback staff such as `fallback-delivery-ahmed-batal` into live staff dropdowns.

Fixes applied:

- Added `src/lib/incentiveConfig.ts` as the single documented fallback config for target points, point value, cap, deduction rate, and reward rate.
- Converted the old salary calculator UI into incentive calculation UI in `src/components/points/SalaryCalculator.tsx`.
- `/points` now shows `حساب الحوافز`, uses selected `staff.id`, shows reward/penalty details from `employee_transactions`, and exports a printable PDF.
- `/doctor-dashboard` now uses shared incentive helpers, not inline `1500`, `500`, or `points * 3` logic.
- `/staff/:id`, `/points`, `/team`, and `/doctor-dashboard` all calculate reward/penalty signs through the same `pointRecordDelta` logic.
- `point_records`, `points_log`, and `points_transactions` are not used in the live `src` app.
- Fallback staff records are no longer merged into UI choices. Missing staff now results in an empty/error state rather than fake data.

Expected Ahmed El-Batal result from `employee_transactions`:

- Penalties: `10 + 80 = 90`
- Rewards: `10`
- These numbers are calculated from `type = 'penalty'` and `type = 'reward'` for the same `staff_id`.

## Staff Creation Fix

Updated files:

- `src/services/staffService.ts`
- `src/services/shiftScheduleService.ts`
- `src/pages/Team.tsx`

Current behavior:

- Creates the employee in `public.staff`.
- Creates an account in `public.staff_accounts` after staff creation.
- Creates seven weekly records in `public.shift_schedules`.
- Sends `is_day_off`, `is_different`, and `has_custom_time` when supported, with safe missing-column retry.
- Logs full Supabase staff save errors through `console.error('Supabase save staff error:', ...)`.
- Password handling remains temporary and is marked with a TODO for server-side hashing or Supabase Auth.

## Weekly Schedule Fix

Updated `src/pages/Schedule.tsx`:

- A day is shown as leave only when `is_off === true` or `is_day_off === true`.
- Missing shift rows now display `غير محدد`.
- Null shift times without an explicit day-off flag are not treated as leave.
- Added a per-staff action to regenerate the weekly schedule from the employee base shift.

## Stagnant Medicine Customer Search

Updated `src/pages/StagnantMedicines.tsx`:

- Added searchable customer input before the dropdown.
- Search checks name, customer code, and phone.
- `*` is treated as a flexible wildcard by splitting the query into ordered segments.
- Dispense records now include `customer_id`, `customer_name`, `customer_code`, and `customer_phone`.
- Dispense is blocked if no customer is selected/entered.

## Staff Accounts And Permissions

Updated files:

- `src/pages/StaffAccounts.tsx`
- `src/pages/RolesPermissions.tsx`
- `src/hooks/usePermissions.ts`
- `src/lib/supabaseTables.ts`

Current behavior:

- `/staff-accounts` shows username, password visibility, status, last update, staff link, edit/reset, activate/disable, and grouped permission toggles.
- Permission groups are displayed as clear ON/OFF switches.
- Page permission definitions now use `permission_definitions` instead of `permissions`.
- `public.permissions` is no longer used as the page-permissions definition table in the changed code path.

## Mock And Fallback Cleanup

- Removed the live Sidebar dependency on `src/lib/mock-data.ts`.
- Moved `src/lib/mock-data.ts` to `src/archive/unused-data/mock-data.ts`.
- Simplified `src/lib/staffFallback.ts` so it only normalizes real staff rows and does not inject fallback staff.

## Remaining SQL / Migration Needs

- Run `supabase_cleanup_audit.sql` to list live tables, columns, estimated rows, and suspected duplicates.
- Run `supabase_backup_moaz_before_delete.sql` before any manual archive/drop step.
- If `permission_definitions`, `role_permissions`, or missing account columns are absent in Supabase, add them through a reviewed migration before enforcing advanced permission management fully.
- Do not delete `point_records` or `points_log` until the backup schema and row-count comparison are verified.

## Final Validation Update

Build completed successfully again:

- Command: `npm.cmd run build`
- Result: success

Warnings remain non-blocking:

- Large Vite chunk.
- Browserslist data is outdated.
