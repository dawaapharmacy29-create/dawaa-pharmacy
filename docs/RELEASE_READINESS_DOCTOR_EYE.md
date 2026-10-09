# Doctor Performance Eye — release readiness (2026-10-09)

Nothing below has been applied to production. Every verdict is backed by a command or a query that can be re-run.

## Verdicts

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | Cross-branch read in `get_staff_performance_sales_bundle_v1` and `get_staff_evaluation_sales_summary_v3` | **Confirmed vulnerability; fix ready, rehearsed, not applied** | See "1. Cross-branch read" below |
| 2 | One conversion time rule | **Decided by evidence, rehearsed** (credit split unchanged, pending approval) | See "2. Conversion time rule" below |
| 3 | Dependency on `20261008090000` | **Removed** | See "3. Old peer-comparison migration" below |
| 4 | Identity hardening + Base44 ordering, impersonation and cross-branch | **Passed in the combined isolated rehearsal** (real production identity chain); not tested on a production copy | See "Combined isolated rehearsal" below |
| 5 | Isolated rehearsal (roles, failure, rollback, no data loss) | **Passed locally** for all 6 unapplied migrations together; **not tested** on a full production copy | See "Combined isolated rehearsal" below |
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
- All 52 bind targets of `20261009081000` still exist.
- 18 newer client-reachable `p_actor_id` functions were audited:
  - 15 resolve the actor through `monthly_eval_actor()`, which ignores the argument and reads the verified session.
  - `dawaa_can_read_conversation_review_row_v2` is an RLS predicate that returns only a boolean (low risk; execute must stay for RLS).
- Base44 import md5 = `db806d85…` (runbook step 0); 95 runs in 24 h, 0 failures.

**Live evidence of today's risk:** a call carrying only `x-dawaa-user-id` of the general manager succeeded with no session. That is what `20261009081000` closes.

**Tested since:** the hardened identity runs in the combined isolated rehearsal through the verbatim production chain (sessions, expiry, revocation, disabled accounts, forged headers, actor binding, notifications, review points, Base44).

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

**Environment:** an isolated Postgres built from a production schema dump, not from repository migrations. The repository now carries the exact production migrations up to `20261009065014` (md5-locked).

**Data, masked copy:**
- Staff, accounts, aliases, attendance, biometric logs and reviews for الشامي/شكري, 26 Jul – 8 Oct.
- Invoices with `customer_phone`, `customer_name` and `customer_code` replaced by a salted hash.
- `staff_login_sessions` truncated and re-seeded with test sessions only.

**Order:**
1. Schema snapshot.
2. Apply `20261009080000`, then `20261009081000` (run its `TEST_…` file).
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

## Integration review of `integration/performance-attendance-20261009` (merged here)

Findings verified against production (read-only) and fixed in unapplied migrations, each rehearsed:

| # | Finding | Status |
|---|---|---|
| 1 | `materialize_attendance_range_v2` lost its authorization check in production migration `20261009053258` and is executable by `anon`: anyone with the public key could re-materialize all attendance for 46 days | **Live in production.** Fixed by `20261009070000` (verified top-management actor; the cron path calls the internal function and is unaffected) |
| 2 | Standard (non-delivery) payroll can never be finalized: staging fingerprints `preview_v2` (has `preview_route`), finalization compares with `preview_v1` | No snapshot affected yet (0 standard staged). Fixed by `20261009070500` (compare with the preview that staged the snapshot) |
| 3 | Repository migrations did not match production: different versions, 3 non-standard names sharing version `20261008`, 17 production migrations missing, consolidated files; `db push` and fresh rebuilds would fail | **Fixed.** The 58 applied migrations are now the exact production text (md5 = `statements[1]`), locked in `supabase/applied-migrations.lock.json` and guarded by `scripts/check-applied-migrations-immutable.cjs` (quality gate) |
| 4 | `check-attendance-resolution-v2-architecture` required queue v3, which the canonical gate bans | Fixed (requires v4) |
| 5 | Identity rollback dropped `dawaa_request_context_is_client_v1`, which the Base44 import calls | Fixed (kept while referenced); identity migration is now idempotent |
| 6 | Identity migrations sorted before already-applied versions | Renumbered to `20261009080000` / `20261009081000` |

Known, not changed in this round: the dirty-queue log trigger re-queues on any update (queue healthy: 59 rows, none overdue);
the backlog sweep can stall on former-staff rows; the hidden delivery→standard fallback when delivery classification fails;
three payroll scope rules; `PayrollManagementV2` is not routed; heavy health/bundle reads. Migrations before 2026-10-08 still
contain historical non-standard names and duplicate versions.

## Combined isolated rehearsal

`bash scripts/run-isolated-db-rehearsal.sh` applies all unapplied migrations in version order on a throwaway PostgreSQL 16
with the production identity chain and 6 production functions verbatim (md5-checked). It reproduces the production defects first
(forged header acts as GM, Base44 needs the forged header, anon materializes attendance, standard payroll cannot finalize),
then proves: 30 identity/session/notification/actor-binding/review-points/Base44 assertions, 12 materialize/payroll assertions,
27 reconciliation/scope/peer assertions, 4 failure injections, idempotent re-apply, reverse rollbacks restoring all 6 definitions
byte for byte with Base44 working between steps, no data change, and forward re-apply.

Peer comparison numerator/denominator: a date-only sale joins its shift when exactly one shift touches that day; otherwise that
day's hours and sales leave the per-shift ratio together. Pending days stay in peer shifts and are flagged provisional; the Eye's
per-hour rate uses approved days only.

## Safe execution order (each step needs separate approval)

0. **Urgent, independent:** `20261009070000` (close the live materialize hole).
1. `20261009070500` (standard payroll finalization) before the 2026-10-25 cycle close.
2. Confirm the device registry (101, 102, GED…315, GED…324); 105 and device-less events stay unproven.
3. Approve the business choices: strict branch scope for branch managers, and the credit split proposal.
4. Identity runbook (`docs/IDENTITY_HARDENING_ROLLOUT.md`): step 0 md5 check → Preview → `20261009080000` → Base44 Edge Function → client → wait 30 min → `20261009081000`.
5. `20261009090000` (reconciliation + peer comparison), then `20261009120000` (sales branch scope; its md5 guard aborts on drift).
6. `20261009114500` (attendance command-center contract wiring, from the integration branch; not yet in production).
7. Preview this branch; compare the Eye for د/ أحمد حافظ with the documented figures.
8. Later and separately: the BConnect `staff_id` source fix, and the repair of 258 wrong stored attendance branches.
