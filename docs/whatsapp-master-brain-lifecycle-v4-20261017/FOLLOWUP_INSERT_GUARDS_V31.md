# Follow-up insert guards — V31 precision check

Status: **CANDIDATE_VALIDATED_PRODUCTION_PARITY_BLOCKED**. No deployment, Production writes,
historical repair, or main merge. This extends V30's domain integration to the actual BEFORE
triggers on daily_followups; it does not change runtime code or introduce another writer.

## Why the extension matters

V30's initial captured-function/index fixture surfaced a unique constraint error for a complaint
when the same customer/branch already had an open general follow-up. That alone was insufficient
to claim the exact installed symptom: it did not include all current BEFORE triggers.

V31 captures and executes all six current BEFORE triggers and their two identity/phone helpers,
with 119 captured daily_followups columns. Existing fixture column types are checked against the
capture and converted locally when needed (`followup_date` was incorrectly typed date in the old
bootstrap; Production uses text). Production schema is not changed.

With the actual guard chain, the old type-specific writer's second insert becomes a **hidden,
archived duplicate linked by duplicate_of**, rather than surfacing the unique constraint error.
The diagnostic insert is executed and inspected in a synthetic transaction, then rolled back.
No synthetic duplicate survives that probe and no Production task is created.

## Candidate verification

The existing source-only Contract A migration is then applied inside the disposable database.
With the SAME captured BEFORE triggers enabled:

- the complaint links to the original open follow-up;
- its retry adds neither a new follow-up nor another request_linked event;
- a fresh customer receives one visible follow-up with the expected actor/customer/branch;
- invoice and product fingerprints remain unchanged.

The complete opt-in rehearsal passes **55 steps locally, 0 failed**. The domain runner already
refuses non-local connections and application DB environment variables. Captures contain only
code/metadata; session fixtures and all operational records are synthetic.

AFTER triggers for metrics, points, incentives and dual-record projections are not included in
this extension; no end-to-end incentive correctness or browser smoke is claimed. The installed
writer still differs from the reviewed source candidate. A green candidate rehearsal does not
clear the Production parity blocker or authorize database activation.

## Next release review

The V30 release prerequisites remain: review the existing Contract A writer release and V29
lifecycle candidate together, preserve existing rows/ACLs/indexes, and obtain explicit activation
approval before a branch Preview deployment. One current unmaterialized canonical proposal lacks
analysis provenance (read-only preflight); it needs an explicit refresh after activation, not an
automatic backfill. Re-read that count and catalog state immediately before any authorized release.

Nothing here re-runs closed Production phases, fixes historical groups 14/39, or removes existing
operational history. See the companion JSON for the candidate status and reproducible input hashes.
