# Canonical follow-up proposal lifecycle — V29 source candidate

Status: source candidate; NOT installed in Production or Preview. No production writes,
backfill, automatic materialization, deployment, or main merge are part of this change.

## Reproduced problem

The follow-up projector only inserted absent stable identities. It returned immediately for an
empty opportunity set and skipped existing identities. Therefore a canonical obligation could
disappear while its unexecuted action remained ready, and customer/deadline corrections could
leave stale proposal fields. The materializer did not revalidate canonical follow-up provenance.

## Change and boundary

Sales Intelligence remains the semantic owner. The projector consumes its opportunities without
parsing conversation text. The refresh passes the exact successfully published case/analysis map,
including explicitly published empty source sets. Failed/incomplete publication is never emptiness.

One internal SECURITY INVOKER RPC reconciles proposals for one canonical source in a transaction.
Only service_role can execute it through the existing staff-authorized refresh server. There is
no browser grant, permission bypass, direct-write fallback, or direct daily_followups writer.
It locks source/case publication resources in publication order, verifies the complete current
published set and persisted opportunity set, and rejects obsolete refreshes or identity collisions.

- New opportunities produce ready proposals with automatic execution disabled.
- Customer, deadline and evidence corrections update the same unexecuted stable identity.
- No-longer-actionable obligations dismiss unassigned, unmaterialized canonical proposals only.
- Only a projector-owned withdrawal can reactivate; human dismissals remain dismissed.
- Assigned/in-progress/completed/cancelled workflow and materialized targets remain unchanged.
- Stored source branch wins; guessed branch changes are rejected.
- Identical retries do not update timestamps or inflate action counts.

The existing public materializer retains strict staff-session identity, action permission, source
access, request branch authorization and explicit customer-request approval. Before executing an
unmaterialized canonical follow-up it locks the source, checks current analysis provenance,
canonical opportunity/customer identity and source branch, and rejects stale proposals.
Previously materialized target lineage is preserved. Existing follow-up records are not cancelled
or reassigned automatically when new evidence arrives; staff review owns that decision.

## Verification scope

The committed tests execute the actual migration SQL with PGlite 0.5.8 (already a repository
dependency), synthetic records and controlled authorization stubs. They cover withdrawal,
correction, no-op retry, same-identity retry calls, stale publication, empty published set,
human dismissal, preserved workflow/targets, source customer correction, missing evidence,
pointer drift, noncanonical source, transport errors, transactional collision rollback, internal
RPC grants and retained materializer permission/approval checks.

PGlite serializes its connection: overlapping Promise calls and stale ordering are tested, but
this is not a two-session hosted PostgreSQL lock-contention test. Production RLS and operational
tables are not mutated or replaced by these fixtures. The core materializer is stubbed; these
tests do not claim an actual daily_followups creation or end-to-end browser approval.

## Release dependency / remaining work

`supabase/migrations/20261018061544_canonical_followup_projection_lifecycle.sql` was created using
Supabase CLI 2.121.0 and is committed as a candidate only. It MUST be reviewed and installed via
the authorized database release process before the corresponding runtime is deployed. A missing
RPC remains an explicit operational projection error; it never falls back to the legacy writer.
Do not deploy this branch runtime to the existing production-backed preview until that release
dependency has been resolved. Existing Preview remains on its prior verified runtime.

Before runtime activation: rehearse the migration against the full isolated schema and real
authorization functions, test publication/materialization with separate PostgreSQL sessions, and
review lock contention. Then run an explicitly authorized UI smoke. No historical repair is implied.
Customer-request and complaint lifecycle corrections remain separate scopes; their existing
projection tests are regression checks, not proof that every lifecycle scenario is closed.
