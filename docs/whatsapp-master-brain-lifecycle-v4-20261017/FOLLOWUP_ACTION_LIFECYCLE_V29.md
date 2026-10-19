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

The browser cannot forge canonical analysis/lifecycle provenance in an existing action payload.
Recorded contact attempts/recovery evidence also prevent automatic proposal rewriting, even when
an older workflow marker still says unassigned.

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

PGlite serializes its connection: overlapping Promise calls and stale ordering are tested there.
The separate `followup-concurrency` CI job uses a disposable PostgreSQL 17 service without
published ports. Its script only accepts that Docker container ID, never a database URL. Five
multi-session scenarios verify actual lock waiting for retries, stale refresh, stale execution,
execution before publication, and an overlapping case-analysis writer.
Production RLS and operational
tables are not mutated or replaced by these fixtures. The core materializer is stubbed; these
tests do not claim an actual daily_followups creation or end-to-end browser approval.

## Release dependency / remaining work

`supabase/migrations/20261018061544_canonical_followup_projection_lifecycle.sql` was created using
Supabase CLI 2.121.0 and is committed as a candidate only. It MUST be reviewed and installed via
the authorized database release process before the corresponding runtime is deployed. A missing
RPC remains an explicit operational projection error; it never falls back to the legacy writer.
Do not deploy this branch runtime to the existing production-backed preview until that release
dependency has been resolved. Existing Preview remains on its prior verified runtime.
Older unmaterialized canonical proposals without current analysis provenance will require an
explicit refresh before execution; they are not silently trusted or mass-refreshed by this change.

The multi-session job passed on f81e2089. The full domain/authentication rehearsal subsequently
passed 53 local steps; see FOLLOWUP_AUTHORIZATION_REHEARSAL_V30.md. V31 extends this to 55 steps
with the actual BEFORE insert guards (FOLLOWUP_INSERT_GUARDS_V31.md). The rehearsal reproduced an installed
writer mismatch resolved by the existing source-only Contract A migration. Production parity is
therefore still blocked. Review that prerequisite and operational lock contention before an
authorized release and UI smoke. No historical repair is implied.
Customer-request and complaint lifecycle corrections remain separate scopes; their existing
projection tests are regression checks, not proof that every lifecycle scenario is closed.
