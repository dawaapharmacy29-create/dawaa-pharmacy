# Doctor Performance Eye — release readiness (2026-10-09)

Nothing below has been applied to production. Every verdict is backed by a command or a query that can be re-run.

## Verdicts

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | Cross-branch read in `get_staff_performance_sales_bundle_v1` and `get_staff_evaluation_sales_summary_v3` | **Confirmed vulnerability; fix ready, rehearsed, not applied** | See "1. Cross-branch read" below |
| 2 | One conversion time rule | **Decided by evidence, rehearsed** (credit split unchanged, pending approval) | See "2. Conversion time rule" below |
| 3 | Dependency on `20261008090000` | **Removed** | See "3. Old peer-comparison migration" below |
| 4 | Identity hardening + Base44 ordering, impersonation and cross-branch | **Pre-checks passed; production behaviour not tested** | See "4. Identity hardening and Base44" below |
| 5 | Isolated rehearsal (roles, failure, rollback, no data loss) | **Passed locally** for 20261009090000 + 20261009120000; **not tested** on a full production copy | See "5. Isolated rehearsal" below |
| 6 | Eye vs peer comparison; provisional values in the chart | **Explained and fixed** | See "6. Eye vs peer comparison" below |

### 1. Cross-branch read

**Measured exposure (190 days):** 5 الشامي employees have 1,709 invoices worth 568,541 EGP at شكري. Their totals, counts and customers were readable by الشامي-scoped accounts.

**Read-only test with temporary copies, Ahmed:**
- **GM:** 2,186 / 813,753 before and after.
- **الشامي manager:** 2,186 / 813,753 including **288 شكري invoices** → after the fix **1,898 / 719,285**, with `scopeBranch`.
- **شكري manager and assistant:** refused before and after.

**Fix:** `20261009120000`.
- It refuses to run if either function has changed (md5).
- Its rollback restores both definitions byte for byte. The gate recomputes the md5 on every run.

### 2. Conversion time rule

Across 401 claimed conversions system-wide (120 days), invoice time relative to the customer's first message:
- 78% within 0–2 h after; median +10 min.
- All 8 invoices in the hour before sit 15–54 min before and before any staff reply. That's an earlier purchase, not clock drift.

**Rule:** the customer's first message → +48 h.
- No change to Ahmed's September: all 12 cases with a matched invoice fall 2–223 min after.
- Credit split (`served_other_seller`) unchanged, pending approval.

### 3. Old peer-comparison migration

- `20261009090000` defines the peer comparison completely, with its grants.
- `20261008090000` was never applied (production has no such function). It moved to `supabase/sql/SUPERSEDED_…` and the gate fails if it returns to `migrations/`.
- Rollback drops everything `20261009090000` created.

### 4. Identity hardening and Base44

**Passed pre-checks:**
- All 52 bind targets of `20261008120000` still exist.
- 18 newer client-reachable `p_actor_id` functions were audited:
  - 15 resolve the actor through `monthly_eval_actor()`, which ignores the argument and reads the verified session.
  - `dawaa_can_read_conversation_review_row_v2` is an RLS predicate that returns only a boolean (low risk; execute must stay for RLS).
- Base44 import md5 = `db806d85…` (runbook step 0); 95 runs in 24 h, 0 failures.

**Live evidence of today's risk:** a call carrying only `x-dawaa-user-id` of the general manager succeeded with no session. That is what `20261008120000` closes.

**Not tested:** the hardened identity itself, because it needs the full identity schema (sessions, auth) on an isolated copy.

### 5. Isolated rehearsal

Run `bash scripts/run-isolated-db-rehearsal.sh`. It uses a throwaway local PostgreSQL 16 cluster: production functions verbatim, synthetic fixtures, identity stubbed via `test.actor`.

**Results: 26 assertions, all passed:**
- 2 failure injections leave nothing behind.
- Applying writes no existing data (checksums).
- Re-applying is idempotent.
- Rollbacks restore byte-identical definitions, remove every new object and keep all data; they are safe twice.
- Forward re-apply after rollback works.

**Mutation check:** removing the branch filter makes the rehearsal fail.

### 6. Eye vs peer comparison

September, Ahmed:
- **Eye:** 296,413 ÷ 171.36 h = **1,730/h**, all branches, approved proven days.
- **Peer comparison:** 288,837 ÷ 163.51 h = **1,766/h**, الشامي only, device-proven days with known hours.

The 2% gap is fully explained:
- The peer figure excludes شكري (4,274).
- It excludes 3 mixed days (44,601).
- It includes 5 pending days.

Changes:
- The shift and peer tabs now show «مؤقت: يشمل N يوم بانتظار المراجعة» and state their branch scope.
- Productivity denominators exclude unproven days.

## Defects found by this review (all fixed in the unapplied files)

- Per-hour and per-day denominators counted days whose branch is unproven: their hours diluted the rate while their sales could never count.
- `otherBranchDays` counted unproven days.
- For a branch-scoped caller, "invoice missing" checked every branch, which revealed whether an invoice number exists elsewhere.
- Shift and peer tabs did not mark provisional values.
- Shift and peer tabs did not state their branch scope.

## Full-copy rehearsal (needs approval; covers what the local rehearsal cannot)

**Environment:** an isolated Postgres built from a production schema dump, not from repository migrations. Production has 38 migrations since 2026-10-08 that are not in `main` or this branch.

**Data, masked copy:**
- Staff, accounts, aliases, attendance, biometric logs and reviews for الشامي/شكري, 26 Jul – 8 Oct.
- Invoices with `customer_phone`, `customer_name` and `customer_code` replaced by a salted hash.
- `staff_login_sessions` truncated and re-seeded with test sessions only.

**Order:**
1. Schema snapshot.
2. Apply `20261008115000`, then `20261008120000` (run its `TEST_…` file).
3. Apply `20261009090000` and `20261009120000`.

**Roles:**
- General manager (`ALL`).
- الشامي branch manager.
- شكري branch manager.
- An assistant.
- A pharmacist.
- A request with a forged `x-dawaa-user-id` and no session token (must be refused after step 2).

**Failure:**
- Kill a migration mid-transaction.
- Drift one guarded function.
- Expire a session during a request.

**Rollback, in reverse order, with these checks:**
- md5 restores.
- Row checksums of `sales_invoices`, `biometric_attendance_logs`, `attendance_daily_summary`, conversation reviews and staff tables unchanged.
- The Eye and the Base44 sync still work.

## Safe execution order (each step needs separate approval)

1. Confirm the device registry (101, 102, GED…315, GED…324); 105 and device-less events stay unproven.
2. Approve the business choices: the strict branch scope for branch managers in the evaluation header, and the credit split proposal.
3. Full-copy rehearsal above.
4. Identity runbook (`docs/IDENTITY_HARDENING_ROLLOUT.md`): step 0 md5 check → Preview → `20261008115000` → Base44 Edge Function → client → wait 30 min → `20261008120000`.
5. `20261009120000` (sales branch scope). Its md5 guard aborts if the functions drifted.
6. `20261009090000` (reconciliation + peer comparison). `20261008090000` is not applied.
7. Preview this branch; compare the Eye for د/ أحمد حافظ with the documented figures.
8. Later and separately: the BConnect `staff_id` source fix, and the repair of 258 wrong stored attendance branches.
