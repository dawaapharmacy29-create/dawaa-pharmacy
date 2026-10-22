# WhatsApp Master Brain — Batch 2 continuation

BRANCH: `perf/whatsapp-master-brain-window-v2-continuation-20261017`
HEAD: the commit containing this report (see branch tip; no self-referential commit hash).
PARENT_BATCH1: `86356cf853c803e9dbf5bb43cfc4877d1e5a3ba5`
BASE_TREE: `606f9795289de9c1b09aa9324308247b02f2656a`
BATCH_2_STATUS: CLOSED

## Product path map

Before: `SalesIntelligenceQACaseDetail` → `fetchQaCaseDetail` → runtime-context/catalog load →
segmentation + Basket V2 + full pipeline → per-token/per-split products ilike queries → competing UI matcher.

After: page → `fetchQaCaseDetail` → selected current analysis → `readPersistedProductTruth` →
`evidence_snapshot.caseIntelligence.need.products` (identity, resolver-owned ids/codes/names,
confidence and evidence), or the same snapshot's `basket.activeItems` when need products are absent →
product display states. The case id must match both the analysis row and the supported view.
An unresolved need identity is never replaced by a competing basket identity.
`interaction.messageIds` supplies the exact case scope for recommendation evidence.

The existing writer is `persistence/mappers.ts:mapCaseAnalysisRowContent`; it already persists
`caseIntelligence` from `caseIntelligenceView.ts`. Quantities and quoted amounts now come directly
from the persisted active items; absent amounts stay absent. No reconstructed Basket V2 or invoice
quantity fills an unknown saved value. No new resolver, catalog cache or runtime fallback is needed.
Unsupported/missing snapshots display a warning and require an explicit canonical refresh.

`pharmacyProductResolverV2.ts:CROSS_SCRIPT_SEED` contains the Hyfresh aliases. The shared resolver
retains its existing weak cross-script confidence; no uniqueness-based promotion or code-28532
special case was added. Multiple valid presentations stay unresolved/ambiguous. Explicit pack,
strength, form and percentage contradictions also reject approved-alias candidates at the shared
resolver boundary. The generated refresh API bundle was regenerated from that canonical source.

## Behavior and safety

- Normal open displays persisted canonical analysis and never invokes the full pipeline or product resolver.
- Explicit reanalysis uses the existing authenticated canonical refresh transport, source gate and selected-case request gate.
- Secondary conversation-evaluation system evidence is fetched only after the user requests it;
  results are visible only for the requested case + analysis id, with stale completion cancellation.
- The invoice confirmation/source authorization paths and database permissions are unchanged.
- Invoice catalog reads remain two bounded exact-key enrichments for current-price facts; they never decide product identity.
- No cosmetics redesign, migrations, SQL, Production calls/writes, backfill, Batch 3 work or security changes.
- `vercel.json` explicitly disables automatic Git deployments for this continuation branch before publishing its commit.

## Deterministic synthetic performance

10,767 catalog rows, eight distinct product lines, one image reference, one competing attribution
claim. The selected id is derived by canonical segmentation so the old pipeline path actually runs.
Original main and Batch 1 source snapshots were restored by Git blob hashes, with the same synthetic
harness added; application source was unmodified. Counts are query-builder reads, not claims about
universal Production counts. ilike query counts count each product search once; the separate filter
count includes chained ilike predicates. Timings are single local samples, without database/network
latency, under Node 24.19.0, and are informational rather than performance SLAs.

| Metric | Main | Batch 1 | Batch 2 |
|---|---:|---:|---:|
| Total DB reads | 65 | 60 | 17 |
| Product DB reads | 41 | 41 | 2 |
| Fuzzy product queries | 28 | 28 | 0 |
| ilike predicates | 40 | 40 | 0 |
| Full pipeline runs on open | 1 | 1 | 0 |
| Shared product resolver calls | 20 | 20 | 0 |
| Product resolver time, ms | 171.63 | 194.05 | 0.00 |
| Total loader time, ms | 493.45 | 527.85 | 13.62 |

Raw measurements: [performance.json](performance.json).

## Verification on the final implementation

- `npm test`: PASS; custom runner 1047 passed / 0 failed, SI regression gate 1112 passed / 1 intentionally skipped in each of Africa/Cairo and UTC.
- Golden Case 1, Source Gate, Integrity Engine, Basket V2, QA, product resolution, A/B/C stale async and same-customer multi-case suites: PASS.
- New deterministic product-truth suite: 36 tests; resolver → canonical pipeline → persistence mapper → loader → display-state label; exact code, English, Arabic/cross-script, packs, strengths, forms, concentration, ambiguous ties, unknown/image/voice evidence and foreign snapshots.
- Performance guard: no product fuzzy queries, no resolver runs and no pipeline executions on normal open; invoice-product enrichments bounded to two reads.
- TypeScript: PASS. Production build (local only): PASS. Performance budget: PASS (202.1 KiB gzip initial JS).
- Quality Gate workflow's 29 architecture/fix-check scripts: PASS. Full semantic ESLint: zero errors; latest page/reader checked again. `git diff --check`: PASS.
- Both named environment gates pass on the current tree AND the hash-verified clean main source: `check-whatsapp-evidence-link-session`, `check-dashboard-primitives-architecture`. No pre-existing environment failure was reproduced; no unrelated architecture was changed.
- Available runtime is Node 24.19.0; repository CI targets Node 22.x. No Node 22 or hosted-CI result is claimed. The existing live integration benchmark is skipped; no live browser/Production reanalysis was executed.

Machine-readable gate results: [verification.json](verification.json).

## Required closure fields

```text
PERSISTED_CANONICAL_PRODUCT_READER: PASS
SECONDARY_FUZZY_MATCHER: REMOVED
CANONICAL_PRODUCT_TRUTH: ONE
FUZZY_ILIKE_CALLS_BEFORE: 28 queries (40 predicates)
FUZZY_ILIKE_CALLS_AFTER: 0
TOTAL_DB_CALLS_BEFORE: 60
TOTAL_DB_CALLS_AFTER: 17
PRODUCT_DB_CALLS_BEFORE: 41
PRODUCT_DB_CALLS_AFTER: 2
FULL_PIPELINE_RUNS_BEFORE: 1
FULL_PIPELINE_RUNS_AFTER: 0
NORMAL_CASE_OPEN_REANALYZES_PIPELINE: NO
PACK_SIZE_SAFETY: PASS
STRENGTH_SAFETY: PASS
DOSAGE_FORM_SAFETY: PASS
AMBIGUOUS_TIE: FAIL_CLOSED
UNKNOWN_PRODUCT: HUMAN_REVIEW
HYFRESH: CANONICAL_ALIAS_RESOLVED (original weak confidence retained; uncertain displays require review)
A_B_C_ISOLATION: PASS
SAME_CUSTOMER_MULTI_CASE: PASS
GOLDEN_CASE: PASS
SOURCE_GATE: PASS
INTEGRITY_ENGINE: PASS
SI_REGRESSION_GATE: PASS
NPM_TEST: PASS (1047 runner; 1112 SI per timezone, 1 intentionally skipped)
TYPESCRIPT: PASS
BUILD: PASS (local production build only)
PRODUCTION_WRITES: 0
PRODUCTION_DATA_CHANGES: 0
MAIN_CHANGES: 0
SECURITY_BRANCH_CHANGES: 0
PRODUCTION_DEPLOY: 0
BATCH_2_STATUS: CLOSED
```

## Review and reversal

Architect/planner: canonical persistence already owns product and basket truth; remove the second
reader rather than replace it with another matcher. Reviewer: saved nulls, case ids and quantities
remain explicit; no fuzzy recovery or customer-wide evidence substitutes. Security review: no new
SQL/auth/RLS paths; explicit refresh uses the existing verified-session server authorization.
Performance review: the entire runtime catalog/pipeline path is removed from normal open; only
existing bounded invoice enrichments remain. Verifier: targeted and full gates above.

Rollback: revert this one continuation commit. No database rollback is needed. Retain the branch's
auto-deployment prohibition if preparing a rollback for review.

Batch 3 recommendation only (NOT STARTED):
1. Eliminate legacy Doctor Performance sales/revenue parallel truth.
2. Fix or retire legacy V4 delayed-order sale heuristic.
3. Separately diagnose the 53 cases without current analysis.
