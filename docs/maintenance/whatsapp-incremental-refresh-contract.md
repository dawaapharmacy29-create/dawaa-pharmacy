# Incremental invoice evidence refresh — implementation contract

Status: design gate, not enabled in production.

## Canonical ownership
Reuse runCanonicalSalesIntelligenceRefresh and existing canonical source gate. No second sale-proof writer. Import success and analysis refresh success are separate statuses. Never post points/payroll or override approved reviews from a refresh worker.

## Durable work
Use a transactional outbox with old and new invoice identity, event kind (header/item insert/update/delete), event generation and timestamps. Store only necessary identity and evidence-change metadata, never raw conversation text. Private service-only access, RLS, no anon/authenticated grants. Statement-level capture; unchanged commercial fields do not emit events. Item deletes retain old invoice identity. Invoice deletion retains old identity even after source invoice disappears.

The consumer resolves candidates using current direct invoice dependencies and old/new customer identity/time windows (24h before start to 168h after end). Include competing claims and same-source dependencies; do not publish a source in isolation if this would break exclusive invoice ownership. A source without an active analytical case requires explicit source-gate handling, not silent omission. Shared phone matches are candidate selection only, never identity proof.

## Concurrency and recovery
Deduplicate per source and generation; use atomic lease claim with bounded batch, expiry and retry. Acknowledge only the claimed generation after canonical publication and required followers succeed. Newer events arriving during processing must remain pending. Retry transient failure with backoff; show permanent failures for manager review. Never silently discard an event. Keep payload retention bounded after acknowledgement.

## Release gates
1. Verify actual invoice read-model fields and canonical identity normalization; test changed header, items, returns, deletions, repeated imports, same invoice number across dates/branches.
2. Test pagination and truncated evidence fail-closed, fake clients and generated API bundle consistency.
3. Test outbox RLS and role boundaries; transaction rollback, duplicate imports, old/new identities, concurrent lease, generation races, failures, retries.
4. Verify a current production backup and isolated staging environment. Run npm run verify and rebuild generated API via repository scripts.
5. Dry-run the 385 active analysis cases and compare proof/branch/customer/items/review changes; preserve human approval and history.
6. Deploy capture first, consumer disabled; measure import overhead and queue volume. Enable consumer only after release gates pass.
7. Monitor failure rate, age, retries, import latency, duplicate current analyses and proof revocations. Rollback disables capture and consumer without deleting pending work.

Existing maintenance changes are not yet tested or deployed. This contract is not an implemented queue.
