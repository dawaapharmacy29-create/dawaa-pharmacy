# Complaint cutover and need evidence — V34 source fix

The authorized single-source V33 Preview trial preserved invoice-backed sale truth, review flags,
missing-media count, three case identities and current/published pointers. It exposed a pre-existing
ready legacy complaint proposal alongside the newly published canonical complaint proposal. No
proposal was materialized. The source-specific legacy record is not a newly created legacy writer.

V34 changes the canonical complaint projector to withdraw only an untouched, unmaterialized legacy
`complaint-followup` proposal whose complaint evidence overlaps exactly one canonical replacement
in the same source. It preserves the old identity/payload as audit history, marks it dismissed and
disables automatic eligibility before exposing the canonical replacement. A failed read, ambiguous
evidence, assignment, contact attempt, materialization or concurrent row change blocks replacement.
The conditional update checks the original timestamp and all workflow/target fields; concurrent
identical withdrawals are accepted only with the matching replacement identity. Insert failure
leaves the old proposal disabled and reports an error; retry can finish the canonical proposal.
This is intentionally fail-closed, not a cross-row atomic publication claim. No task or customer
request is materialized, no historical scan runs, and no schema/RPC/permission change is included.
Reads are bounded to admitted source IDs, exact action key/type and active proposal statuses.

The pipeline now calculates complaint assessment once before the need model. A complaint without
a real product lifecycle uses the canonical complaint evidence as its primary service need rather
than the first introductory courier-call narrative. Mixed product/complaint cases retain their
commercial need. This does not invent product demand or clear source/media review requirements.

Verification: 16 new synthetic tests cover withdrawal order, existing canonical/legacy coexistence,
retry, insertion/read failure, evidence mismatch, human workflow and compare-and-set races; pipeline
tests check primary evidence, callback timing and absence of fabricated product requests/sales.
Existing follow-up/request/complaint and semantic regressions also run. Full CI results are reported
separately against the exact committed SHA. No private customer transcripts are included.

Release status: source candidate only until the exact V34 Preview and its authorized runtime
post-check are verified. V33 live database rows are not modified by these local tests. No main merge,
Production deployment, SQL release, historical cleanup or bulk reanalysis is authorized here.
