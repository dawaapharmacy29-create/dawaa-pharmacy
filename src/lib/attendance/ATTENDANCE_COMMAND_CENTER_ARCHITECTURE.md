# Attendance Command Center — Canonical Read Path

This file records the merge-readiness invariants for the attendance review command center.

## Canonical path

`attendance_daily_summary` → `dawaa_build_attendance_day_resolution_current_v1` → `dawaa_attendance_review_triage_v1` → `dawaa_attendance_manager_review_priority_v1` → `get_attendance_command_center_bundle_v1` → `attendanceResolutionService.ts` → `AttendanceResolutionCenter.tsx`

## Invariants

- The UI never reclassifies manager/system triage from attendance statuses or preview flags.
- The UI never derives former-staff status from a separate staff-directory query. It consumes `staff_active` / `priority_code` from the command-center bundle.
- Priority is produced by the database contract. The client may sort/display the returned `sort_rank`, `age_days`, and `priority_code`, but must not reconstruct priority from `resolution_status`.
- Active manager-review cases are shown before former-staff historical cases; system-repair/waiting lanes remain separate.
- Within the same manager-review priority, older unresolved cases appear first.
- Former staff are hidden by default in the daily working view and remain available through the explicit historical toggle.
- Attendance truth remains separate from general payroll deductions. No UI priority change may create a financial deduction.

## Release gate

Before integration with another feature branch or `main`, both workflows must pass on the same HEAD:

1. `Attendance Command Center Contract Wiring`
2. `Attendance Canonical Architecture`

The contract workflow also runs the attendance priority regression tests, TypeScript, and the Vite production bundle.

No production database migration or Vercel deployment is implied by this document or by these branch checks.
