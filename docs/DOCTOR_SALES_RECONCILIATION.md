# Doctor sales ⇄ attendance reconciliation

Status: designed and tested read-only against production data inside rolled-back transactions.
Migration `20261009090000_doctor_sales_reconciliation_v1.sql` is **not applied** and needs separate approval.

## Problem

The Doctor Performance Eye divided all of a doctor's cycle sales by attendance days. Some invoices fall on
times with no punched shift, so their value was spread over other days and productivity was inflated.
Conversion trusted the review's "converted" flag and invoice number. Invoice numbers repeat across branches,
and some invoices were rung up by another doctor or for another customer.

## One source, two consumers

```
sales_invoices ─┐                      ┌─ get_doctor_sales_reconciliation_v1 ── Doctor Performance Eye
staff + aliases ├─ dawaa_doctor_sales_ ┤
attendance  ────┤  reconciliation_v1   └─ get_branch_doctor_performance_window_v1 ── peer / shift comparison
biometric logs ─┘  (+ dawaa_doctor_attendance_days_v1)
```

Identity, the attendance branch and shift placement exist only in the two `dawaa_doctor_*` functions.
The Eye and the peer comparison only aggregate them.

## Categories (every invoice in exactly one; none deleted)

| Category | Rule | Counts in |
|---|---|---|
| `attendance_verified` | Reliable identity, and the invoice falls inside a punched shift at the same branch (±60 min). A night shift owns its tail after midnight. A date-only import belongs to a punched shift on that date. | Total sales and comparable productivity |
| `identity_only` | Reliable identity (staff_id, or a seller name owned by exactly one active employee), but no punched shift covers it | Total sales only |
| `uncertain` | Seller name shared by several employees, duplicated (branch, invoice number), or the covering shift was punched at another branch | Shown separately, never credited |
| `zero_value` | Non-positive amount | Shown, never counted |

Comparable productivity:
- Per attendance day: verified sales ÷ punched days.
- Per hour: verified sales of approved days with known hours ÷ those hours, with at least 5 such days.
- Running-cycle and pending-day values are provisional.

Conversion is verified ÷ (verified + recorded no-sale). A sale is verified when:
- the invoice is found by **branch + number**, it is unique and not reused by another review;
- it has a positive value and falls within 48 hours of the conversation;
- it belongs to the **same customer**;
- it was **sold by the doctor**.

Every other "converted" claim is reported as unverified and stays out of both sides of the ratio.

## Root causes found

1. **Branch of attendance.**
   - The legacy biometric ingest stored the employee's home branch instead of the device's branch: device 101 «شكرى القواتلى» was stored as فرع الشامي.
   - 219 punches between 2026-07-26 and 2026-09-03 are affected.
   - The new `GED…` devices are consistent.
   - Fix: `biometric_device_branches`. Its seed values come from the vendor `device_location` and must be confirmed.
2. **Missing `staff_id` after 2026-08-26.**
   - Every BConnect import (`bconnect_xlsx`, `bconnect_xlsx_reconciliation`, `26-29(1).xlsx`) arrives without `staff_id`: about 95% of all invoices since that date.
   - The import runs outside this repository. The app importer (`src/lib/invoiceImporter.ts`) resolves `staff_id` at insert; the BConnect pipeline does not.
   - No database trigger resolves it either.
   - The seller field is the POS login name («المستخدم» / `seller_name`).
3. **Invoice numbers are per branch.** The same number exists in both branches (12 of the 17 numbers cited in Ahmed's September reviews), so number-only matching is unsafe.

## Proposed source fix for staff_id (separate approval)

- Add a `staff_pos_accounts` registry: `branch`, `pos_user_name` (normalized), `staff_id`, `valid_from`, `valid_to`.
- **At import:** resolve `staff_id` from (branch, POS user) only when exactly one active mapping exists. Store the link source (`pos_account`) and leave the invoice unlinked (and flagged) otherwise. Apply this both in the BConnect pipeline and in a `BEFORE INSERT` trigger as a safety net.
- **Backfill:** an idempotent, audited update of invoices since 2026-08-26 with blank `staff_id`, using the same rule. Write each change to an audit table so it can be rolled back.
- Name matching stays as a read-time fallback only, flagged as `unique_name`. It never overrides a resolved `staff_id`.

## Device → branch proof (independent review, 2026-10-09)

| Device | Channel | Evidence | Same-shift sales by the punching staff | Registry |
|---|---|---|---|---|
| GED7242701324 | `zk_shami_direct_bridge` only (`allowed_branches` = الشامي) | payload `branch` = فرع الشامي | 79/79 الشامي | الشامي |
| GED7242701315 | `zk_shokry_direct_bridge` only (`allowed_branches` = شكري) | payload `branch` = فرع شكري | 44/45 شكري | شكري |
| 102 | vendor | `device_location` «الشامى» | 62/62 الشامي | الشامي |
| 101 | vendor | `device_location` «شكرى القواتلى» | 46/52 شكري | شكري |
| 105 | vendor | «بسيسه»: not a branch in the system, 3 punches | none | **absent (unproven)** |
| no device id | vendor | 121 punches, 2 staff | 8/8 شكري (not proof) | **absent (unproven)** |

Shifts are rated per punch:
- 1,986 punched days (26 Jul – 8 Oct): 1,811 proven at one branch, **143 move between branches inside one shift**, and 32 have no proven device.
- **258 days** carry a stored branch that the device contradicts.
- A timed invoice takes the branch of the doctor's latest proven punch before it.
- A shift with no proven punch proves nothing.

## Date-only imports

An invoice stored at 00:00 UTC has no time of day. It never gets a shift class. It is attendance-verified only when
**every** punched shift touching that calendar day is proven at the invoice branch (`evidence = day`).
Otherwise it is `identity_only` (no shift that day) or `uncertain` (another or unproven branch).

## Conversion classes and the credit policy (proposal, not applied)

A cited invoice must:
- carry the cited number;
- belong to the **same customer**;
- fall from **1 h before to 48 h after** the conversation;
- have a positive value.

Customer + time disambiguate numbers that repeat across branches. The review's branch label is not trusted: case
a2fed23a was labelled الشامي, but the sale was at شكري.

| Class | Meaning | Current policy |
|---|---|---|
| `verified` | Exactly one such invoice, not claimed by another review of the same customer, rung up by the doctor | Counts as a sale |
| `served_other_seller` | The customer bought as cited, but a colleague rang up the invoice | Excluded from both sides |
| `invoice_not_matching_customer_or_time` | The number exists but for another customer or outside the window | Excluded |
| `invoice_missing` / `invoice_ambiguous` / `invoice_reused` / `claimed_without_invoice` | Unverifiable | Excluded |
| `no_sale` | Reviewer recorded no sale | Counts as a loss |
| `unknown` | No outcome recorded | Excluded |

Proposed fair split (needs approval). It separates **service proof** (the doctor held the reviewed conversation and
the customer bought) from **issuance proof** (who rang up the invoice):
1. Sales value and productivity always belong to the invoice seller. Never double-count revenue.
2. The conversation owner gets a separate **service conversion** for `served_other_seller` cases. It is shown next to the strict rate, never merged into it.
3. Any shared incentive credit (for example 50/50) is a business decision for incentives, not part of this read model.

September for د/ أحمد: strict 7 ÷ (7 + 7) = **50%** (coverage 58%, provisional). Service conversion under the proposal: 12 ÷ 19 = **63.2%**.

## Security model

- The internal functions (`dawaa_doctor_*`) are `SECURITY DEFINER`, pin `search_path`, and are revoked from `public`, `anon` and `authenticated`.
- The registry table has RLS enabled with no policy and is revoked from the API roles.
- `get_doctor_sales_reconciliation_v1` asserts the caller's sales scope.
  - A branch-scoped caller reads **only its branch** (invoices, attendance days, reviews), even for a doctor who also worked elsewhere.
  - Conversion requires `view_reviews`.
- The functions read identity through the canonical chain (`dawaa_current_staff_account_id_strict`). They inherit the verified session identity once `20261008120000` is applied, which must happen first.

## Safe execution order (each step needs approval)

1. Confirm the device registry (4 devices) and that 105 / no-device events stay unproven.
2. Apply identity hardening `20261008115000` + `20261008120000` (+ the Base44 Edge Function).
3. On an isolated database branch, run the permission and rollback tests:
   - anon denied on the internal functions and the registry;
   - a الشامي manager scoped to الشامي, and an assistant denied;
   - table checksums unchanged;
   - the rollback restores the previous peer comparison.
4. Apply `20261008090000` then `20261009090000` on production (the latter supersedes the peer-comparison body).
5. Publish a Preview of this branch and compare the Eye for د/ أحمد with the figures below.
6. Separately: the BConnect `staff_id` source fix and the repair of the 258 wrong stored attendance branches (data changes).

## Results for د/ أحمد حافظ (proven devices, per-punch branch, strict date-only rule)

| Cycle | Total | Attendance-verified | Identity-only | Uncertain | Zero | Verified share |
|---|---|---|---|---|---|---|
| Aug (26 Jul–25 Aug) | 942 / 326,588 | 582 / 222,261 | 207 / 51,191 | 144 / 53,136 | 9 | 68.1% |
| Sep (26 Aug–25 Sep) | 908 / 401,792 | 832 / 379,570 | 59 / 21,875 | 3 / 347 | 14 | 94.5% |
| Oct (running) | 336 / 85,374 | 224 / 54,762 | 92 / 27,879 | 16 / 2,733 | 4 | 64.1% |

August date-only imports (418):
- 237 day-verified;
- 34 with no shift that day;
- 66 at another proven branch;
- 78 on days touching an unproven or mixed shift;
- 3 zero-value.
