# Production database drift — attendance readers (2026-10-15)

Read-only comparison made while preparing
`supabase/migrations/20261015150100_attendance_read_scope_initplan_callers_v1.sql` (M6).
No Production object was changed; no historical migration is replayed.

## Method

- **Production hash**: `md5` of the function body (`pg_proc.prosrc`) with all whitespace runs collapsed to one
  space and trimmed, read from Production (`jkjqeqkshllustwlzzbf`) on 2026-10-15.
- **Repo hash**: the same normalization applied to the body of the latest committed migration that defines the
  function.
- **M6 source**: each M6 function is `pg_get_functiondef` of the Production function with exactly one call
  `public.dawaa_can_read_staff_attendance_log(<staff>,<branch>)` replaced by the scope predicate used by the
  `staff_attendance_logs` policy in `20261015140000_rls_actor_scope_initplan_v1`. Verified both ways:
  the substituted text matches a Production-computed hash, and reversing the substitution reproduces the
  current Production definition hash exactly (full-definition hashes below).

## Drifted functions

| Function | Production body hash | Latest repo migration | Repo body hash | Drift | M6 source | Semantic change other than the scope fix |
|---|---|---|---|---|---|---|
| `attendance_daily_command_v1(date,text)` | `b1e3d719d275782de4cf22f6a61094c8` | `20260921043019_attendance_versioned_schedule_readers_v4.sql` | `cdef13cab6ee4ec0a08f8b70d2311e8a` | YES | Production text | NO |
| `attendance_review_triage_v1(date,date,text)` | `69d9b7f06589ee9b25695f1770954bd5` | `20260921053633_attendance_cross_branch_triage_and_mapping_v1.sql` | `4b99680e8bdf0176c01da6ee2d0259a3` | YES | Production text | NO |
| `attendance_truth_cycle_v2(date,date,text)` | `4299df6637cf7af85879be060ecd295e` | `20260924030000_attendance_truth_v2_hardening.sql` | `9ed02837ee6325e73f0cf712e7d95bf9` | YES | Production text | NO |
| `overtime_truth_status_v2(date,date,text)` | `98a8bae606b80b3108b9e56d50e8d67b` | `20260924034000_overtime_truth_v2_and_payroll_guard.sql` | `7eed2bc75f778ca48f53745cb2ac350c` | YES | Production text | NO |

Not drifted (Production body hash equals the latest repo body hash): `attendance_policy_shadow_audit_v1`
(`b0ed755f9f195a2c1461345bf0c52435`) and `list_pending_overtime_v1` (`8d1db2e5b6e00cabcaf9d6311e80e80c`).

## Full-definition hashes (`pg_get_functiondef`, whitespace-normalized)

| Function | Current Production | After M6 (expected) |
|---|---|---|
| `attendance_daily_command_v1` | `2fbe48471eb3752991f8badb6d1e8e0b` | `8df5669ee125fa9142b05a832352ff6c` |
| `attendance_policy_shadow_audit_v1` | `a9a4e24a454753ee7f17f376275bc451` | `3f728eb665fcc4c3d67f1667f6cec275` |
| `attendance_review_triage_v1` | `470b6477da200df50a562e46e0f1c926` | `503608986cf4c35270fd1619f02dcd0e` |
| `attendance_truth_cycle_v2` | `7e635926e5ff8ba51aa685193400d32c` | `ded1b69d60c745654ae9d8381478bdb4` |
| `overtime_truth_status_v2` | `31866706246ca134ee21077c9e007675` | `0cd0ce668f3f3e4aee55bf6b265c8fb3` |

## Consequence

Applying M6 makes the repository reproduce Production's current behavior for these four functions (plus the
scope fix). Before applying, the database owner should confirm the Production hashes above are unchanged; a
different current hash means Production moved again and M6 must be regenerated from the new text.
