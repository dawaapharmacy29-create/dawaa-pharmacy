# Runtime loading review — 2026-10-19

Base: 5252801d937ae9f177e3a9cb25863901d8674b9b.
Preview reviewed: f0c63bc33cc1b4b327382e67c6637f6febb717c7.

## Observed
Authenticated read-only review opened QA, invoice-backed case 74857, customer requests, and customer followup cockpit. Invoice 74857 remained sale-proven and countable at EGP 290. No refresh-source, generation, request creation, followup save, upload, deployment or merge was executed.
Requests and followups displayed initial zeros before their reads completed.

## Change
Availability boundaries hide metrics, empty results and operational row actions until their corresponding read succeeds. Failed reads remain unavailable, not zero. Request summary and list retain independent availability. Followup audit failure marks completed-today unavailable while preserving a successfully loaded queue. Followup overlapping loads use a sequence guard.

No query/schema/permission/materializer/canonical decision change.

## Validation and limits
Six render-level regression tests passed locally: pending zeros/empty state suppressed; actions withheld while loading/failed; children not mounted while unavailable; genuine zero rendered after success; actions restored after success. Both modified screens passed TSX parsing.
Repository full verification is delegated to the existing read-only branch CI; record its actual result separately.
The current deployed Preview does not include this source-only fix. No quantitative page latency or complete live materialization guarantee is claimed.
Existing historical missing identities/product codes and review queues were observed, not repaired. Controlled new-conversation business-write testing remains outstanding.
