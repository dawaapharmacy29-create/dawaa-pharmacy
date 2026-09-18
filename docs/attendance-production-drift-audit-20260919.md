# Attendance production drift audit — 2026-09-19

## Scope
This audit documents the attendance/biometric/overtime runtime contract currently present in Supabase Production and the reconciliation work captured on `attendance-page-rebuild`.

No merge to `main` is authorized by this document. No historical attendance data is rewritten by the reconciliation migrations.

## Core runtime path
1. Raw terminal event lands in `biometric_attendance_logs`.
2. `trg_promote_biometric_attendance_v1` invokes `dawaa_promote_biometric_attendance_v1()`.
3. Semantic classification is stored in `biometric_semantic_decisions`.
4. Accepted semantic events are promoted to `staff_attendance_logs`.
5. `dawaa_build_attendance_day_resolution_v2` builds canonical day evidence.
6. `attendance_daily_summary` stores approved/pending daily resolution.
7. Daily Closure is a read-only operational projection over command + semantic intelligence + canonical resolution.
8. Overtime detection must read approved V2 daily summaries only.
9. Payroll/points impacts remain downstream of approved canonical resolution.

## Production-only contract recovered into Git
The reconciliation migration restores the current contract for:
- overtime approval queue
- two-stage time-off requests
- manual attendance action audit
- schedule mismatch dismissal state
- employee attendance profile
- attendance deduction review tools
- manual punch insertion/reinterpretation
- branch/GM time-off queues and decisions
- branch role attendance rates
- pending overtime detection/list/decision RPCs
- unified approval read model

Migration:
`supabase/migrations/20260919031500_attendance_production_contract_reconciliation_v1.sql`

## Hardening layered after reconciliation
- Duplicate confirmation window: 180 seconds.
- No matching schedule: review, never automatic accepted attendance.
- Ambiguous middle-of-shift event: review.
- Overnight schedule matching considers previous/current/next schedule day.
- Per-branch sync health is based on branch watermark + actual branch activity.
- Overtime approval requires an approved canonical daily resolution and a written decision reason.
- Bulk approval is blocked for overtime and attendance deductions.
- Daily Closure exposes blockers before financial effects.
- Schedule mismatch detector recognizes both legacy and hardened no-schedule reason codes.
- Overtime detector is sourced from approved V2 daily summaries only.

## Read-only production measurements at audit time
### Accepted biometric events without a matching schedule, last 14 days
- فرع الشامي: 150
- فرع شكري: 105
- كل الفروع: 8
- المخزن: 5
- Total: 268

These must not be bulk-reclassified without preview/review.

### Pending overtime integrity
- Pending total: 33
- Pending without daily summary: 0
- Pending on unapproved summary: 0
- Pending on approved day that still requires review: 0
- Pending on clean approved day: 33

Current pending overtime therefore does not show the specific canonical-resolution integrity failure that the new guard prevents.

## Required pre-merge gates
- Attendance hardening CI green.
- Production/Git contract reconciliation present.
- No direct historical biometric mutation.
- Semantic impact preview reviewed before any backfill.
- Branch sync health checked independently for Shamy and Shokry.
- Daily Closure validated against real overnight shifts.
- Overtime approval tested with approved and non-approved daily resolutions.
- Manual punch/reinterpretation audited end-to-end.
- Branch remains isolated from `main` until explicit approval.
