# Follow-up authorization and runtime parity — V30

Status: **CANDIDATE_VALIDATED_PRODUCTION_PARITY_BLOCKED**.
The source candidate passed isolated integration; the installed runtime is not proven ready for
cross-type follow-up/complaint testing. No Production mutation, deployment or main merge occurred.

## Scope and evidence

Extended the existing fresh-staging runner with opt-in `--canonical-followup`; its default behavior
is unchanged. It refuses remote hosts and application database environment variables. No Supabase
project is created. All writes are synthetic in a disposable local PGlite database.

The original 42-step schema/dependency rehearsal passes. The extension installs V29 twice without
backfill, then executes the actual operational materializer and customer-follow-up writer rather
than an `isolated-target` stub. Total: **53 steps passed, 0 failed** locally.

Read-only catalog captures supply the current staff-session/permission functions, source/action/
follow-up RLS policies, canonical V22 ownership/archival view, relevant column types/defaults and
open-case indexes. Captures contain definitions only, no business records or session credentials.
Synthetic local tokens are generated in memory and never logged or copied from Production.

Verified:

- hashed session verification; inactive, revoked, expired and unknown sessions rejected;
- actual role permissions and account overrides; wrong branch/unauthorized/internal calls denied;
- source and action RLS; customer-request management and explicit approval gates retained;
- real canonical action -> authorized materializer -> existing daily_followups link and audit;
- repeated materialization preserves target and creates no duplicate audit/event;
- a fresh customer follow-up is created by the real authorized writer;
- canonical provenance cannot be forged through browser updates;
- invoice and product fingerprints remain unchanged.

This is a domain integration rehearsal, not a byte-for-byte clone of every Production constraint,
Supabase Auth implementation or trigger outside the reviewed domain. Supabase platform functions
are shimmed; custom staff-session resolution and permission bodies are actual captured code.
Customer-request creation/incentives and full complaint lifecycle are not claimed verified.

## Proven runtime gap

V31 refines the exact installed symptom using all current BEFORE triggers. Read
FOLLOWUP_INSERT_GUARDS_V31.md before interpreting the lower-level reproduction below.

The installed `find_or_create_open_customer_followup` still includes request type in its open-case
lookup/lock. Current unique indexes permit one visible open case per customer and branch. With a
general follow-up already open, a complaint for the same customer/branch attempts another insert
and, in V30's fixture without the complete BEFORE trigger chain, fails with a unique constraint
error. V31 shows that the actual BEFORE guard chain instead produces a hidden archived duplicate.
Both were reproduced only in the isolated database; no Production complaint/task was created.

The existing source-only migration
`20261009180000_customer_followup_one_open_case_contract_a_v1.sql` already resolves this mismatch.
Its header explicitly states NOT APPLIED. Applying it ONLY inside the disposable rehearsal makes
the complaint link to the existing case; a retry adds neither a follow-up nor another event.
No legacy writer was restored and no new semantic owner was introduced.

The CI rehearsal intentionally characterizes the installed mismatch and then verifies the existing
candidate repair. A green rehearsal is **not** proof that Production was repaired. Its JSON report
retains `CANDIDATE_VALIDATED_PRODUCTION_PARITY_BLOCKED` and the missing prerequisite explicitly.

## Concrete release prerequisites — no execution authorization implied

1. Review the existing Contract A function changes against a fresh read-only catalog snapshot,
   preserving owners, ACLs, open-case indexes, branch provenance and all historical rows.
2. Plan that writer prerequisite and V29 lifecycle migration as one authorized database release.
   The isolated test does not authorize re-running closed Production phases or historical DML.
3. After database parity is resolved and verified, approve the exact branch runtime for one Preview
   deployment. The current Production-backed Preview must not receive V29 before its RPC exists.
4. Perform explicit staff-session browser tests for sale/invoice/product, customer request,
   follow-up and complaint flows. Record before/after identities, retry behavior and timings.

Main, Vercel, Production rows, historical groups 14/39 and historical repair remain untouched.
The companion JSON records the tested baseline, status, counts and reviewed fixture/migration hashes.
