# Sales Intelligence — Persistence Design (Phase H)

DESIGN ONLY. No SQL migrations, no Supabase tables, no RPCs, no dashboards exist yet. This
document is the storage contract for implementing persistence in a later phase (H.1). The
TypeScript row shapes referenced throughout live in
`src/lib/salesIntelligence/persistence/types.ts` — also design-only (pure interfaces, no I/O).

The semantic engines (`src/lib/salesIntelligence/*Engine.ts`, `salesIntelligencePipeline.ts`) are
frozen as of Phase G.3 and are the source of truth this document stores. This document does not
change case segmentation, historical closure, protocol applicability/compliance, attribution
scoring, basket↔invoice matching, or the integrity exception taxonomy.

Every design decision below is checked against real Phase G.3 findings (90 conversations, 148
cases, 5 customers) — see §21.

## 1. Proposed tables

| Table | Row type | Purpose |
|---|---|---|
| `sales_intelligence_case_analyses` | `SalesIntelligenceCaseAnalysisRow` | One row per `(caseId, analysisVersion)` — the case-level pipeline result. |
| `sales_intelligence_case_baskets` | `SalesIntelligenceCaseBasketRow` | Immutable basket version history. **disabled_by_default** (§3, §19). |
| `sales_intelligence_case_basket_items` | `SalesIntelligenceCaseBasketItemRow` | Line items per basket version. **disabled_by_default**, same gate as baskets. |
| `sales_intelligence_attributions` | `SalesIntelligenceAttributionRow` | One row per `(caseId, analysisVersion)` — Phase D output, including first-class `competing_case_ids`. |
| `sales_intelligence_basket_invoice_matches` | `SalesIntelligenceBasketInvoiceMatchRow` | One row per `(caseId, analysisVersion)` — Phase E output. |
| `sales_integrity_exceptions` | `SalesIntegrityExceptionRow` | One row per canonical exception. **disabled_by_default** (§6, §19). |
| `sales_intelligence_policy_config` | `SalesIntelligencePolicyConfigRow` | Single canonical config row (policy effective date). |
| `sales_intelligence_review_events` | `SalesIntelligenceReviewEventRow` | Append-only human-review decision log, kept separate from engine output (§12). |

## 2. Primary/foreign keys

- `sales_intelligence_case_analyses.id` (uuid, surrogate PK). Natural key `(case_id, analysis_version)` — see §6 for why the PK is surrogate, not natural.
- `sales_intelligence_case_baskets.id` (uuid PK); FK `case_id -> sales_intelligence_case_analyses.case_id` (not the surrogate `id`, since a caseId outlives any one analysis version — baskets are versioned independently of case-analysis reprocessing).
- `sales_intelligence_case_basket_items.basket_row_id -> sales_intelligence_case_baskets.id`.
- `sales_intelligence_attributions.case_id -> ` (same case_id reference pattern as baskets).
- `sales_intelligence_basket_invoice_matches.case_id`, optional `basket_id -> sales_intelligence_case_baskets.basket_id` (the CaseBasket business id, not the row id — a match references a basket *version*, which may not be the currently-active row).
- `sales_integrity_exceptions.case_id`; optional `invoice_id` (no FK — `sales_invoices.id` is a free-text column in the live schema, not a uuid FK target, per the Phase D schema investigation).
- `sales_intelligence_review_events.subject_row_id` — polymorphic reference (no DB-level FK; `subject_kind` disambiguates which table it points into). Documented, not enforced, because the subject can be an attribution row, an exception row, or a case-analysis row.

## 3. Unique constraints

- `sales_intelligence_case_analyses`: unique `(case_id, analysis_version)`; partial unique `(case_id) WHERE is_current = true` — enforces at most one active analysis per case at the database level, not just in application code.
- `sales_intelligence_attributions`, `sales_intelligence_basket_invoice_matches`: same `(case_id, analysis_version)` uniqueness, mirroring the case-analysis row they were computed alongside.
- `sales_intelligence_case_baskets`: unique `(case_id, basket_id, basket_version)`.
- `sales_integrity_exceptions`: unique `(exception_id)` — `exception_id` is deterministically derived from `(case_id, type, stage, invoice_id, basket_version)` by the engine already (see `salesIntegrityEngine.ts`), so reprocessing the same unchanged case produces the same id and naturally upserts rather than duplicating.
- `sales_intelligence_policy_config`: single row, enforced by a fixed `id = 'default'` primary key (no separate uniqueness needed — see §7).

## 4. First-class indexed columns

Promoted out of JSONB onto real columns specifically because G.3's failure-taxonomy and
distribution reporting (items 4, 6, 8, 11, 14, 16) needs to `GROUP BY`/`WHERE` on these without a
JSONB scan:

`case_id`, `conversation_id`, `customer_id`, `branch_id`, `case_ended_at`, `case_type`,
`pipeline_status`, `historical_closure_level`, `commercial_confirmation_state`,
`protocol_applicability`, `protocol_policy_compliance`, `attribution_level`,
`integrity_evaluation_scope`, `needs_human_review`, `is_current`, `analyzed_at`,
`analysis_version`. On attributions: `selected_invoice_id`, `is_official_for_staff_evaluation`,
`ambiguity_status`. On exceptions: `type`, `severity`, `status`, `stage`.

## 5. JSONB fields

Reserved for genuinely nested, variable-shape evidence that a dashboard never filters on directly,
only displays for drill-down (§11 Auditability):

- `sales_intelligence_case_analyses.evidence_snapshot` — confidence structs, rule ids, evidence completeness.
- `sales_intelligence_attributions.primary_evidence`, `.contradictions`, `.rule_ids`.
- `sales_intelligence_basket_invoice_matches.differences`.
- `sales_integrity_exceptions.source_evidence`, `.rule_ids`.

No management-facing filter/aggregate may be built against these JSONB blobs directly — every
dimension a dashboard needs to group or filter by must first be promoted to a column (§4). This is
the explicit rule from instruction §2 ("Do NOT collapse major structs into one opaque JSON blob
only").

## 6. Idempotency strategy

Key: `(case_id, source_hash)` determines whether a re-run is a no-op or a new version.

- `source_hash` = a stable hash over: the raw WhatsApp export text for this conversation, the
  sorted list of invoice-candidate ids actually returned for this case, and the
  `protocol_policy_effective_at` value active at analysis time.
- On reprocessing: compute `source_hash` first. If it matches the current active row's hash, the
  run is a true no-op — **do not write a new row**, only bump `analyzed_at` on the existing one
  (or skip writing anything, per the batch job's own logging needs).
- If `source_hash` differs (raw text corrected, invoice data changed, engine version changed): a
  new row is inserted with `analysis_version = previous + 1`, `is_current = true`; the previous
  row gets `is_current = false`, `superseded_at = now()`, `superseded_by_analysis_version` set.
  **The old row is never deleted or mutated beyond those two fields** — it remains a permanent,
  queryable audit trail of what the engine believed at that point in time.
- The surrogate `id` (not `(case_id, analysis_version)`) is the PK specifically so that
  `sales_intelligence_attributions`/`sales_intelligence_basket_invoice_matches` can FK to a single
  stable analysis row rather than a composite key, keeping joins simple.

This satisfies every reprocessing scenario in instruction §9: same-conversation-unchanged (hash
matches, no-op), source-corrected (hash changes, new version), invoice-data-updated-later (hash
changes because candidate-id list changed, new version), engine-version-changed (hash changes
because `pipeline_version`/`engine_versions` are inputs to the hash too, forcing a new version even
if the raw text and candidates are byte-identical).

## 7. Source-hash / reprocessing strategy

See §6 for the hash definition. Reprocessing triggers (instruction §10), and what they touch:

| Trigger | New `analysis_version`? | Rewrites `protocol_policy_compliance`? |
|---|---|---|
| New invoices imported for a known customer | Yes (candidate-id list changed) | Only if applicability changes as a side effect — see below. |
| Customer identity merged | Yes (customer_id input changed) | No, unless applicability changes. |
| Branch mapping improves | Yes (branch_id input changed) | No. |
| Semantic engine version bump | Yes (engine_versions changed) | Possibly, if the new engine version changes the applicability outcome. |
| **Policy effective date changes** | **No new semantic analysis needed.** | **Yes, in place, via a targeted recompute — see below.** |
| Invoice item data finally becomes available | Yes for basket-invoice-match rows specifically (integrity_evaluation_scope can now become `header_and_items`) | No, unless it changes applicability. |

**Policy-date changes are the one deliberate exception to "always a new analysis_version".**
Instruction §10 requires separating immutable semantic evidence from derived policy-compliance
state. `historical_closure_level`, `commercial_confirmation_state`, and `protocol_applicability`
never depend on the policy config row — only `protocol_policy_compliance` does
(`deriveProtocolPolicyComplianceState`'s own 3-way `undefined`/`null`/date semantics, unchanged
since G.1). So when the policy config row changes, a lightweight batch job recomputes
**only** `protocol_policy_compliance` for every `is_current = true` case-analysis row whose
`protocol_applicability = 'applicable'`, using each row's own `case_ended_at` against the new
`protocol_policy_effective_at` — this is a pure function of two already-stored values, not a
re-run of the pipeline, and it updates that one column in place (the one deliberate exception to
"rows are never mutated after write", scoped to exactly this one derived field). This is what
instruction §10's "policy date changes should NOT require rewriting historical semantic facts"
means concretely.

## 8. Batch pipeline architecture

Per instruction §8, batched around **customer/conversation/time-window**, never per case:

```
1. Load a batch of conversations (bounded page from whatsapp_review_sources).
2. Resolve customer identity for each (existing customer-identity resolution, unchanged).
3. Group conversations by customer_id (fallback: normalized phone) into CaseBatchGroup
   (src/lib/salesIntelligence/persistence/types.ts) — one group per customer, spanning the
   union of that customer's conversation time windows in this batch.
4. For each group, fetch invoice candidates ONCE (buildInvoiceCandidateQuery + a single
   fetchInvoiceCandidates call spanning the group's whole window), never once per case.
   G.3 measured 148 candidate-retrieval calls for 148 cases under the current per-case pattern —
   this step is specifically what eliminates that N+1.
5. Run the pure salesIntelligencePipeline() for every case in the group, reusing the one
   pre-fetched candidate list (resolveInvoiceCandidates becomes a pure in-memory filter over the
   already-fetched rows, exactly like the G.3 shadow harness's own resolver).
6. Compute CompetingCaseResolution across the WHOLE BATCH (not just one group) — mirrors the
   G.3 two-pass shadow-validation pattern, but as a real batch step: collect every case's own
   pass-1 selectedInvoiceId, then re-derive attribution.competingCaseIds for every case against
   that full set.
7. Persist case-analysis, attribution (with competingCaseIds now resolved), and
   basket-invoice-match rows together, in one transaction per case, only after step 6 completes.
```

Step 7's ordering is the direct implementation of instruction §8's rule: **never persist pass-1
attribution before competing-case analysis is done** — competing_case_ids is written once,
correctly, at insert time, never patched in by a later pass.

## 9. Competing-case persistence model

`sales_intelligence_attributions.competing_case_ids: string[]` is written directly from step 6
above. G.3's two-pass validation found 92/148 cases (62%) participate in a competing-case pattern
once cross-case resolution runs — this is the **normal case**, not an edge case, given the sample
has only 5 distinct customers. The schema and batch design treat it as such: no lazy
recomputation, no "compute on read" fallback. An empty array is a real fact ("resolved against the
full batch, no competition found"), not "not yet computed" — readers must never distinguish those
two states by re-running the check themselves.

## 10. Basket-version persistence model

Fully designed (`SalesIntelligenceCaseBasketRow`/`SalesIntelligenceCaseBasketItemRow`), immutable
version history, `supersededByBasketId` set once and never cleared. **Deployment status:
`disabled_by_default`** — `basket_version_writes_enabled` feature flag off. G.3 observed 0 real
multi-version baskets across 148 cases (formal basket confirmation, the precondition for a
"modification after confirmation" to even be meaningful, essentially never occurs on real data —
see G.3 §8/§10). Writing this path before a real multi-version case is captured would mean
designing persistence semantics against zero real examples, which instruction §6 explicitly
forbids for the exception table and this document applies the same discipline to baskets.

## 11. Integrity-exception persistence model

Fully designed (`SalesIntegrityExceptionRow`), keyed by the engine's own deterministic
`exceptionId`. **Deployment status: `disabled_by_default`** — `integrity_exception_writes_enabled`
feature flag off. G.3 found 0 real exceptions across 148 cases, root-caused to
`headerEvidenceReady` requiring a real basket `announcedTotal` that real Dawaa conversations
essentially never state (G.3 §14/§15). The table and row shape are ready; turning the flag on is
safe the moment a real sample naturally produces a non-zero exception, without any schema change.

## 12. Policy configuration model

Single canonical row (`id = 'default'`) in `sales_intelligence_policy_config`, per instruction §7's
preference. `protocol_policy_effective_at: string | null` — `null` is a real, meaningful state
("opted in, no date configured yet"), never defaulted to a guessed date, matching
`deriveProtocolPolicyComplianceState`'s existing 3-way semantics exactly (undefined vs. null vs.
date, unchanged since G.1). Changing this row triggers the targeted recompute described in §7 —
it never causes historical `historical_closure_level`/`commercial_confirmation_state` facts to be
rewritten, only the derived `protocol_policy_compliance` column, and only for currently-active,
`applicable` rows.

## 13. Human-review model

`sales_intelligence_review_events` is an **append-only event log**, deliberately separate from
every engine-output table (instruction §12: "Do NOT mix automated engine output with human
decision history"). An engine row's `needs_human_review`/`human_review_reasons` are immutable
facts about what the pipeline found at analysis time; a reviewer's decision is a new event
referencing that row via `(subject_kind, subject_row_id)`, never a mutation of the engine row.
States: `open` → `reviewed` → `resolved` | `dismissed`, covering the four subject kinds in
instruction §12 (attribution ambiguity, identity conflict, integrity exception, semantic
ambiguity) plus `branch_conflict` and `case_segmentation_ambiguity`, matching the actual
`contradictions`/`humanReviewReasons` values the engines already emit.

## 14. RLS / access model

No migration yet — policies below are the design to implement in H.1, following this codebase's
existing role vocabulary (see `docs/EMPLOYEE_DOMAIN_ARCHITECTURE.md`).

| Role | `sales_intelligence_case_analyses` / attributions / matches | `sales_integrity_exceptions` | Raw evidence (`evidence_snapshot`, `source_evidence`, message-id arrays) | `review_events` |
|---|---|---|---|---|
| Doctor (staff) | Read own-involvement cases only (`staff_id` appears in `known_staff_ids`/attribution), review-surface fields only — no cross-branch visibility. | No access. | No access. | Read own-subject events only. |
| Branch manager | Read all cases for their own `branch_id`. | Read, own branch only. | No access (drill-down evidence stays admin/CS-manager tier per §16). | Read/write for their branch's subjects. |
| Branch managers / director (multi-branch) | Read across their assigned branches. | Read across assigned branches. | No access. | Read/write across assigned branches. |
| Customer service manager | Read all cases (cross-branch), for operational triage. | Read all. | Read (this role owns conversation-quality investigation). | Read/write all. |
| General manager | Read all, analytics-scope. | Read all, aggregate-scope. | No access (not this role's job; drill-down stays with CS manager/admin). | Read all. |
| Accounts / admin | Full read; write restricted to policy config and feature flags only — never to engine-output tables directly (those are only ever written by the batch pipeline service role). | Full read/write (lifecycle status only, never the engine-derived fields). | Full read. | Full read/write. |

Every engine-output table (`case_analyses`, `attributions`, `basket_invoice_matches`,
`case_baskets`, `sales_integrity_exceptions`) is **service-role-write-only** — no role above ever
gets direct INSERT/UPDATE on those tables; all writes go through the batch pipeline. Only
`policy_config` and `review_events` accept authenticated-user writes, and only from the roles
listed. This mirrors instruction §14's "no dashboard metric without drill-down to evidence" while
keeping raw evidence itself restricted per §16 below.

## 15. Feature flags

Defined in `src/lib/salesIntelligence/persistence/types.ts` as
`SalesIntelligenceFeatureFlags`/`DEFAULT_SALES_INTELLIGENCE_FEATURE_FLAGS`:

| Flag | Default | Rationale |
|---|---|---|
| `caseAnalysisPersistenceEnabled` | `false` | Off until a human reviews the H.1 implementation against a real dry-run — matches instruction §19's "enabled only after review". |
| `basketVersionWritesEnabled` | `false` | §10 — 0 real multi-version baskets observed. |
| `integrityExceptionWritesEnabled` | `false` | §11 — 0 real exceptions observed. |
| `policyComplianceDashboardEnabled` | `false` | G.3's enforced-mode simulation shows every currently-`applicable` case would read `non_compliant` the instant this is turned on — needs a rollout/communication plan first. |
| `staffEvaluationConsumptionEnabled` | `false` | §13 hard rule below — no KPI consumption until this is explicitly turned on by a human decision, never by default. |

## 16. Versioning model

`pipeline_version` (e.g. `'sales-intelligence-v1'`) is independent of any git SHA — a human-chosen
label bumped only when a semantic engine's rules actually change in a way that could alter past
conclusions. `engine_versions` (on every row, via `PersistenceVersionFields`) lets a reader
distinguish, per component, which logic version produced a given field — e.g. attribution scoring
could bump independently of historical-closure regex changes. Both are inputs to `source_hash`
(§6), so any version bump forces a new `analysis_version` on next reprocessing rather than silently
leaving stale rows looking current.

## 17. Retention / raw-text strategy

Per instruction §16: no duplication of raw WhatsApp text. Every row stores only:
`conversation_id` (FK reference into `whatsapp_review_sources`, which already owns the raw text)
and `source_message_ids: string[]` (pointers, not content) wherever evidence needs to cite a
specific message. The only place any message *content* is ever stored is
`sales_intelligence_case_analyses.evidence_snapshot`'s short evidence-description strings, which
already exist today in the engines' own `EvidenceRef.description` fields (max ~120 chars, not the
full message) — this document does not introduce any new raw-text duplication beyond what the
engines already produce as evidence descriptions, and access to that field is restricted per §14.

## 18. Required indexes

Beyond the constraint-backed indexes in §3:

- `sales_intelligence_case_analyses`: btree on `case_ended_at`, `customer_id`, `branch_id`,
  `attribution_level`, `protocol_policy_compliance`, `integrity_evaluation_scope`,
  `needs_human_review`, `analyzed_at`; partial index `WHERE is_current = true` (the hot path —
  almost every dashboard query filters to current rows first).
- `sales_intelligence_attributions`: btree on `selected_invoice_id` (needed for the
  competing-case-resolution batch step itself, §8/§9), GIN on `competing_case_ids` if array
  membership queries ("which cases compete with case X") become common.
- `sales_integrity_exceptions`: btree on `type`, `severity`, `status`, `invoice_id`.
- No JSONB-specific indexes initially (instruction §17: "Do not over-index JSONB") — add a
  targeted GIN index only if a specific evidence-drill-down query is measured to need one.

## 19. Migration order — DESIGN ONLY, not executed

1. `sales_intelligence_policy_config` (singleton, no dependents — everything else can reference a stable policy state from day one).
2. `sales_intelligence_case_analyses` (the anchor table every other table's `case_id` conceptually points at).
3. `sales_intelligence_attributions`.
4. `sales_intelligence_basket_invoice_matches`.
5. `sales_intelligence_case_baskets` + `sales_intelligence_case_basket_items` (created but left write-disabled per §10/§15).
6. `sales_integrity_exceptions` (created but left write-disabled per §11/§15).
7. `sales_intelligence_review_events` (depends conceptually on 2-6 existing, though no DB FK).

RLS policies (§14) land in the same migration as each table, never as a follow-up — no table is
ever created "open" even briefly.

## 20. Rollback strategy — DESIGN ONLY, not executed

- Every table is purely additive (no existing table is altered) — rollback is `DROP TABLE` in
  reverse of the order in §19, safe at any point before application code depends on the tables.
- Because writes are feature-flagged (§15) and case-analysis rows are never mutated in place
  (§6), a rollback after some data exists is still safe: disable
  `caseAnalysisPersistenceEnabled` first (stops new writes), confirm no reader depends on the
  tables, then drop. No data in these tables is ever the sole copy of anything — raw text stays
  in `whatsapp_review_sources` (§17), and every derived fact can be regenerated by re-running the
  pure pipeline against that source.
- The one non-trivial rollback case is the targeted `protocol_policy_compliance` recompute (§7):
  since it's a pure function of two stored values, "rollback" is just re-running it against the
  previous policy config row — no separate undo log needed.

## 21. Validation against G.3 findings

| G.3 finding | How this design handles it |
|---|---|
| 148 unique caseIds, 0 duplicates | `(case_id, analysis_version)` uniqueness + partial `is_current` uniqueness enforces this at the DB level going forward. |
| 92/148 competing-case pattern (two-pass) | §8 step 6 + §9 — computed once per batch, before persistence, as first-class `competing_case_ids`. |
| 0 real basket-version bumps | §10 — table fully designed, `basket_version_writes_enabled = false`. |
| 0 real integrity exceptions | §11 — table fully designed, `integrity_exception_writes_enabled = false`. |
| 0 formal protocol completions (organic closure dominates) | §1/§4 — `historical_closure_level` and `commercial_confirmation_state` are separate first-class columns, never merged into one `closure_status` (instruction §14's explicit rule). |
| 12 applicable organic-closure cases | Enforced-mode simulation showed all 12 would read `non_compliant` — `policy_compliance_dashboard_enabled = false` until a rollout plan exists (§15). |
| `sales_invoice_items_v21 = 0` | `item_evidence_ready`/`integrity_evaluation_scope` are the structural gates on `sales_intelligence_basket_invoice_matches`; no reader may assume item-level fields are populated without checking `item_evidence_ready` first (§5 rule, mirrored from the engine's own `IntegrityEvaluationScope` contract). |
| N+1 candidate-retrieval risk (148 calls for 148 cases) | §8's batch architecture fetches once per customer/time-window group, not once per case — this is the primary reason the batch design exists. |

## 22. Is Phase H.1 implementation safe? Exact proposed scope.

**Yes, safe to begin**, scoped narrowly:

**In scope for H.1:**
- SQL migrations for `sales_intelligence_policy_config` and `sales_intelligence_case_analyses`
  only (migration steps 1-2 in §19), with RLS from the first migration.
- The batch pipeline service (§8, steps 1-7) implementing case-analysis + attribution persistence
  together (adds `sales_intelligence_attributions` and `sales_intelligence_basket_invoice_matches`,
  migration steps 3-4), since attribution's `competing_case_ids` cannot be validated
  independently of the batch step that produces it.
- `caseAnalysisPersistenceEnabled` feature flag wired end-to-end but **left `false`** until a
  human reviews a dry-run against a real batch and compares its output to the G.3 shadow-harness
  numbers for the same 90 conversations.

**Explicitly out of scope for H.1** (deferred until each table's own precondition is met):
- `sales_intelligence_case_baskets`/`_case_basket_items` writes (§10 — wait for a real
  multi-version case).
- `sales_integrity_exceptions` writes (§11 — wait for a real non-zero exception).
- Any dashboard or staff-facing UI (§15 — `policy_compliance_dashboard_enabled` and
  `staff_evaluation_consumption_enabled` stay `false`).
- The targeted policy-recompute job (§7) — build it, but do not schedule/trigger it until a real
  policy date is actually being considered operationally.

**Phase H complete. Stopping here per instructions — no migrations, no Supabase tables, no RPCs, no dashboards were created.**
