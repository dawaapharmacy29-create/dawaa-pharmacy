# Dawaa Unified Core — architecture and migration contract

Status: **proposed, non-deployed**. Owner: Dawaa operations. This document extends
[EMPLOYEE_DOMAIN_ARCHITECTURE.md](EMPLOYEE_DOMAIN_ARCHITECTURE.md); it does not replace
existing payroll, WhatsApp, attendance, or financial approval controls.

## Purpose and non-negotiable invariants

The goal is to remove competing sources of truth and redundant identity decisions,
not to delete tables merely because they look similar.

1. **Person identity:** `staff.id` identifies a person inside Dawaa. Display names,
   source-system usernames, B-Connect seller labels, branch, and job title never do.
2. **No inference as settlement:** unverified identity cannot contribute to employee
   compensation, credited performance, or a finalized evaluation.
3. **Historical truth:** a departure does not invalidate historically approved
   transactions. Inactive people are valid owners of older records.
4. **Immutable evidence:** source records, approval audits, settled payroll and ledger
   transactions follow their existing append/cancel/reversal policy. An identity merge
   must never silently mutate or delete them.
5. **Fail closed:** ambiguous aliases, missing IDs, conflicting role or date evidence,
   and unavailable source data yield `unresolved`, not a convenient name match.
6. **One writer per domain:** browser components do not directly mutate canonical
   ledger, attendance decisions, identity merges or payroll settlement.
7. **Database and app parity:** schema functions, triggers, access policies and read
   projections are committed as reproducible migrations and verified against runtime.

## Canonical boundaries

| Domain | Authoritative entity | Outside inputs / compatible read models |
| --- | --- | --- |
| Employee identity | `staff.id` + verified account-to-staff link | `staff_accounts`, alias names, legacy text IDs |
| Sales identity | Original invoice + verified attribution decision | B-Connect seller name, `sales_invoices` imports |
| Attendance | Device event + dated schedule + approved decision | Historical free-form staff name |
| Conversations | Source conversation/case + approved staff attribution | Original sender label and filename |
| Evaluation | Approved evidence and versioned evaluation projection | Temporary estimates; partial evidence |
| Compensation | Approved settlements, immutable ledger and finalized snapshot | Live KPI previews and UI totals |

Do not create a new 'canonical' copy of the same source transaction. A projection
may cache results, but must identify its source IDs, version, freshness and
recalculation procedure.

## Identity resolution contract

An identity resolution returns a structured **decision**, not an arbitrary
string that can conceal uncertainty:

- `verified`: stable staff ID, supporting independent evidence, branch/date
  validity, provenance, and verification actor/source.
- `unresolved`: original name and evidence are retained; no credited employee.
- `conflict`: multiple candidates or inconsistent evidence; manual review required.
- `retired_link`: past identity mapping kept as history but unavailable to new
  transactions.

Order of evidence:
1. Previously verified immutable source-to-staff identity within valid time scope.
2. Verified linked application account to canonical staff ID.
3. Explicitly approved, active source alias whose scope is unambiguous.
4. Exact normalized name **only** to suggest candidates, never to settle payments.

A staff member can change branches or leave the company without changing ID.
The valid employee on the date of a sale/shift must be checked independently
of whether their account is active today. New live operations cannot attribute
to an archived duplicate account.

A source alias may be scoped by upstream system, branch, valid-from/to and
approved decision. Changes must be serialized and audited; replacing an alias
is atomic and cannot be implemented as 'deactivate old then attempt insert'.

## Table disposition process

Every affected table receives one decision supported by a dependency inventory:

- **canonical**: owns an independent business fact; retained.
- **event/audit**: preserves historical evidence, append only.
- **projection**: derived and reproducible; may be consolidated after parity checks.
- **compatibility**: old shape maintained only for identified readers; remove after
  reader migration and observation.
- **candidate for retirement**: zero verified consumers, authoritative replacement,
  rollback plan and approval. This category does not authorize deletion.

Inventory must cover foreign keys, triggers, SQL functions/views, cron, Edge
Functions, app reads/writes, exports, scheduled imports and external applications.
A table count or a similar column name alone is not retirement evidence.

## Phased delivery and measurable gates

### Gate A — inventory and baseline (no writes)
- Pin repository HEAD, production schema and function fingerprints.
- Enumerate staff and alias identity duplicates, every FK, name-only attribution
  reader, unresolved invoice and review, and inactive-staff ledger references.
- Record source counts by cycle and branch; prove no double-counting.
- Classify every mismatch as correct historical, duplicate, ambiguous or broken.
- Stop when a source cannot be mapped without guessing.

### Gate B — new-write protection
- Shared resolution contract for invoice import, WhatsApp, attendance, service
  requests and manual staff selection.
- Reject ambiguous or inactive duplicate matches for new operations.
- Keep explicit manual review for ambiguity; never auto-credit on similarity.
- Tests for concurrent alias changes, multiple active name matches, retired ID,
  same name across branches, shift across midnight and unavailable DB.
- Block legacy direct writers progressively in CI.

### Gate C — historical reconciliation
- Generate per-row proposed `old -> canonical` mappings with reason, sources,
  date/branch scope, approval and impact preview.
- Apply only verified mappings in idempotent, guarded transactions.
- Compare counts and currency/points by source, cycle, employee and branch
  before and after; preserve historical actor and audit fields.
- Uncertain cases remain unresolved, and no payroll final is recalculated until
  inputs and approvals are complete.

### Gate D — projections and payroll
- Consolidate staff identity, sales truth, attendance decisions, conversation
  attribution and incentive settlement into versioned read boundaries.
- Perform shadow parity across current/previous pharmacy cycles for both
  branches and individual employees.
- Block release if credits move without source-backed approval, a final salary
  shifts unexpectedly, or rejected cases are counted.

### Gate E — compatibility retirement
- Require zero remaining readers/writers, migration parity, independent backup,
  rollback rehearsal, and explicit owner approval before retiring any table,
  RPC or alias.
- Do not remove immutable HR history, settled ledger rows or final payroll to
  make account deletion convenient; reconcile by approved administrative
  workflow that preserves legal/accounting evidence.

## Confirmed case: Islam Farouk vs Islam El-Sabaa (25 October 2026)

Production currently has two distinct active employees, a pharmacist **د اسلام فاروق**
and a courier **اسلام السبع**. Their legal/canonical staff IDs must never merge.

The active alias rows `د اسلام`, `د/ اسلام`, `دكتور اسلام` belong to
the pharmacist, while `اسلام` belongs to the courier; the legacy
`normalizeStaffName` folds **all four** into the same `اسلام` key. This is a
confirmed normalization collision, **not** evidence that either employee
record is a duplicate. Role alone does not authorize credit.

Until source-scoped, time-bounded and role-verified decisions are implemented,
an ambiguous alias key yields **unresolved**. Do not migrate the seller's
historic invoice IDs or clear the conflict by guessing. The client-side
preflight prevents avoidable new collisions but cannot serialize concurrent
writes. A future migration must enforce the invariant atomically on the server,
preserving audit/history and reporting existing incompatible active rows first.

## Immediate tracked risks

- Name-based and alias-based fallback paths in imported sales and review flows.
- Historical invoices with no canonical employee ID, including literal non-UUID
  source actor labels.
- Mixed text/UUID identities across tables and snapshots.
- Old accounts marked 'merged' that still own historical point movements.
- Existing protected HR-history and ledger semantics conflict with physical
  deletion of duplicated historical staff IDs.
- Concurrency and partial-failure protection for alias reassignment.

## Release rules

- Work on feature branches; no direct `main` changes or force pushes.
- No live database writes or deployment as a side effect of review.
- Unit tests, integration/reconciliation tests, production **read-only**
  verification and human review precede rollout.
- Production changes require a scoped, reviewed apply plan with guard queries,
  backups, transaction preconditions, postchecks and rollback strategy.
- Changes to canonical employee identity, historical money or deletion scopes
  receive separately enumerated approval. Never infer a blanket approval from a
  previously accepted UI or naming change.
