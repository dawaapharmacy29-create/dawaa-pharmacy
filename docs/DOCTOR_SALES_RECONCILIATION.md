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

## Results for د/ أحمد حافظ (fixed definitions)

| Cycle | Total sales | Attendance-verified | Identity-only | Uncertain | Zero | Verified coverage |
|---|---|---|---|---|---|---|
| Aug (26 Jul–25 Aug) | 326,588 (942 inv.) | 715 / 272,166 | 207 / 51,191 | 11 / 3,231 | 9 | 83.3% |
| Sep (26 Aug–25 Sep) | 401,792 (908) | 833 / 379,635 | 59 / 21,875 | 2 / 282 | 14 | 94.5% |
| Oct (running, to 7 Oct) | 85,374 (336) | 240 / 57,495 | 92 / 27,879 | 0 | 4 | 67.3% |
