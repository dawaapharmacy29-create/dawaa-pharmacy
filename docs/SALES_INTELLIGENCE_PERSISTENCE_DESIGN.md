# Sales Intelligence — Persistence Design (Phase H, hardened in Phase H.0.1)

DESIGN ONLY. No SQL migrations, no Supabase tables, no RPCs, no dashboards exist yet. This
document is the storage contract for implementing persistence in a later phase (H.1). The
TypeScript row shapes referenced throughout live in
`src/lib/salesIntelligence/persistence/types.ts` — also design-only (pure interfaces, no I/O).

The semantic engines (`src/lib/salesIntelligence/*Engine.ts`, `salesIntelligencePipeline.ts`) are
frozen as of Phase G.3 and are the source of truth this document stores. This document does not
change case segmentation, historical closure, protocol applicability/compliance, attribution
scoring, basket↔invoice matching, or the integrity exception taxonomy.

**Phase H.0.1 note:** Phase H's first draft had a structural defect — it used `case_id` as a
general FK target inside `sales_intelligence_case_analyses`, a table where `case_id` is **not**
unique (multiple analysis-version rows legitimately share one `case_id`). A partial unique index
(`UNIQUE(case_id) WHERE is_current = true`) narrows uniqueness to the current row only; it does
not make `case_id` a valid FK target for a *historical* dependent row that must keep pointing at
the exact version it was computed from. This revision fixes that (see §2 for the root cause and
§3 for the corrected entity model) before any migration is written.

## 1. Proposed tables

| Table | Row type | Ownership | Purpose |
|---|---|---|---|
| `sales_intelligence_cases` | `SalesIntelligenceCaseRow` | Stable-case | One permanent row per globally unique commercial case. Never versioned, never carries engine output. |
| `sales_intelligence_case_analyses` | `SalesIntelligenceCaseAnalysisRow` | Analysis-version | One row per `(case_id, analysis_version)` — the full semantic pipeline result. |
| `sales_intelligence_case_baskets` | `SalesIntelligenceCaseBasketRow` | Analysis-version (generated) | Immutable basket version history, tied to one `analysis_id`. **disabled_by_default** (§10, §19). |
| `sales_intelligence_case_basket_items` | `SalesIntelligenceCaseBasketItemRow` | Analysis-version (generated) | Line items per basket row. Same gate as baskets. |
| `sales_intelligence_attributions` | `SalesIntelligenceAttributionRow` | Analysis-version (independently evaluable) | One row per `(analysis_id, evaluation_version)` — Phase D output, including first-class `competing_case_ids`. |
| `sales_intelligence_basket_invoice_matches` | `SalesIntelligenceBasketInvoiceMatchRow` | Analysis-version (independently evaluable) | One row per `(analysis_id, evaluation_version)` — Phase E output. |
| `sales_integrity_exceptions` | `SalesIntegrityExceptionRow` | Analysis-version (independently evaluable) | One row per canonical exception per evaluation. **disabled_by_default** (§11, §19). |
| `sales_intelligence_policy_config` | `SalesIntelligencePolicyConfigRow` | Stable-case-adjacent (singleton, cross-cutting) | Single canonical config row (policy effective date). |
| `sales_intelligence_review_events` | `SalesIntelligenceReviewEventRow` | Append-only, references analysis-version rows | Human-review decision log, pinned to the exact analysis reviewed (§12, §13). |

## 2. Root cause and resolution of the FK issue

**Root cause:** `sales_intelligence_case_analyses` is a *versioned* table by design — its whole
purpose is to preserve every historical analysis of a case, not just the latest. That means
`case_id` alone is duplicated across rows (one per `analysis_version`), so it cannot be a primary
key or a safe FK target: a dependent row (an attribution, a match, an exception) that stores only
`case_id` has no way to say *which* of that case's several analyses it was actually computed from.
The partial unique index on `case_id WHERE is_current = true` only guarantees uniqueness among
*current* rows — it says nothing about historical ones, and a dependent row belonging to a
*superseded* analysis would have no valid, enforceable FK to point at.

**Resolution (two changes, both required together):**
1. Split the stable case identity out into its own table, `sales_intelligence_cases`, where
   `case_id` genuinely is unique for the table's entire lifetime (§3). This table, not
   `case_analyses`, is the safe FK target for anything that only needs to say "this case exists."
2. Give `sales_intelligence_case_analyses` its own surrogate `analysis_id` (uuid) as its real
   primary key, and make `analysis_id` — never `case_id` — the provenance FK every dependent table
   (attributions, matches, exceptions, baskets) actually points at (§4, §5). `case_id` is still
   kept on those dependent rows, but only as a redundant, indexed column for debugging/filtering
   convenience — it carries no referential-integrity meaning there.

## 3. Final stable-case entity design

```
sales_intelligence_cases
  case_id                text PRIMARY KEY   -- conversationId:interactionId[:session:N], unchanged from the engines' own scheme
  conversation_id         text NOT NULL
  source_case_id_v22      text NULL
  customer_id             uuid NULL
  customer_phone          text NULL
  branch_id               uuid NULL
  branch_name_raw         text NULL
  case_started_at         timestamptz NOT NULL
  case_ended_at           timestamptz NULL
  first_seen_at           timestamptz NOT NULL
  last_seen_at            timestamptz NOT NULL
  created_at              timestamptz NOT NULL DEFAULT now()
```

This table represents **existence**, not analysis. It is written once (on first pipeline run that
derives this `case_id`) and updated only for `last_seen_at` (bumped on every subsequent run,
successful or a no-op) and, rarely, for `customer_id`/`branch_id`/`case_ended_at` when an upstream
identity/timestamp correction is confirmed independently of a full re-analysis. It never stores
`pipeline_version`, `analysis_version`, or any engine-derived field — those all live on
`sales_intelligence_case_analyses` and its dependents.

## 4. Stable-case vs analysis-version table ownership matrix

| Table | Owner | Why |
|---|---|---|
| `sales_intelligence_cases` | **Stable-case** | Identity facts only; never re-derived per engine run, never versioned. |
| `sales_intelligence_policy_config` | **Stable-case-adjacent** (singleton) | Not per-case at all — one config row read by every analysis, cross-cutting. |
| `sales_intelligence_case_analyses` | **Analysis-version** | The full semantic pipeline result; a new row every time segmentation/closure/confirmation/applicability could have changed. |
| `sales_intelligence_case_baskets` / `_case_basket_items` | **Analysis-version (generated)** | Basket reconstruction is itself part of the semantic pipeline — a different `analysis_id` can legitimately reconstruct a different basket history for the same case (§5). |
| `sales_intelligence_attributions` | **Analysis-version, independently evaluable** | Tied to one `analysis_id`, but gets its OWN `evaluation_version` axis so customer-identity/branch/invoice-candidate changes can re-evaluate it without forcing a full semantic re-analysis (§9, §10). |
| `sales_intelligence_basket_invoice_matches` | **Analysis-version, independently evaluable** | Same pattern as attributions — re-evaluable when invoice item data appears, without touching case segmentation/closure. |
| `sales_integrity_exceptions` | **Analysis-version, independently evaluable** | Same pattern; one row per canonical exception per evaluation (§14). |
| `sales_intelligence_review_events` | **References analysis-version rows, itself append-only** | Pinned to the exact `analysis_id` a human reviewed — never re-owned by a later analysis (§12). |

## 5. Final FK for every table

| Table | Primary key | Real provenance FK(s) | Redundant/indexed-only columns |
|---|---|---|---|
| `sales_intelligence_cases` | `case_id` (text) | — (root of the graph) | — |
| `sales_intelligence_case_analyses` | `analysis_id` (uuid) | `case_id -> sales_intelligence_cases.case_id` | — |
| `sales_intelligence_case_baskets` | `id` (uuid) | `analysis_id -> sales_intelligence_case_analyses.analysis_id` | `case_id` (redundant, indexed) |
| `sales_intelligence_case_basket_items` | `id` (uuid) | `basket_row_id -> sales_intelligence_case_baskets.id` | — |
| `sales_intelligence_attributions` | `id` (uuid) | `analysis_id -> sales_intelligence_case_analyses.analysis_id` | `case_id` (redundant, indexed) |
| `sales_intelligence_basket_invoice_matches` | `id` (uuid) | `analysis_id -> sales_intelligence_case_analyses.analysis_id`, `attribution_row_id -> sales_intelligence_attributions.id` | `case_id` (redundant, indexed) |
| `sales_integrity_exceptions` | `exception_id` (deterministic, see §14) | `analysis_id -> sales_intelligence_case_analyses.analysis_id` | `case_id` (redundant, indexed) |
| `sales_intelligence_policy_config` | `id` (fixed `'default'`) | — | — |
| `sales_intelligence_review_events` | `event_id` (uuid) | `case_id -> sales_intelligence_cases.case_id`, `analysis_id -> sales_intelligence_case_analyses.analysis_id` | `subject_kind` + `subject_row_id` (documented, not FK-enforced — §13) |

Unique constraints, restated with the corrected model: `sales_intelligence_case_analyses` —
`UNIQUE(case_id, analysis_version)` + partial `UNIQUE(case_id) WHERE is_current = true`.
`sales_intelligence_attributions`/`_basket_invoice_matches`/`_case_baskets` — analogous
`UNIQUE(analysis_id, evaluation_version)` (or `UNIQUE(analysis_id, basket_id, basket_version)` for
baskets specifically) + partial `UNIQUE(analysis_id) WHERE is_current_evaluation = true` (or the
basket-specific active-version equivalent already covered by `superseded_by_basket_id`).

## 6. Current-result convenience views — design only

```
sales_intelligence_current_case_analyses  -- VIEW: SELECT * FROM sales_intelligence_case_analyses WHERE is_current = true
sales_intelligence_current_attributions   -- VIEW: SELECT a.* FROM sales_intelligence_attributions a
                                           --       JOIN sales_intelligence_current_case_analyses ca ON ca.analysis_id = a.analysis_id
                                           --       WHERE a.is_current_evaluation = true
```

Not created in H.0.1 — listed here so H.1's migration order (§16) can include them alongside their
base tables. Historical storage stays fully versioned underneath; these views exist purely so a
dashboard query never has to know about `analysis_version`/`evaluation_version` bookkeeping.

## 7. Basket-version vs analysis-version model

Two genuinely different axes, never conflated (per the explicit instruction to fix this):

- **`analysis_id`** (and its `analysis_version` counter) — bumped when the semantic pipeline
  re-runs from raw conversation text and could produce a *different case segmentation or basket
  reconstruction entirely*. Example from the instructions: analysis A1 reconstructs baskets v1 and
  v2 for a case; a later semantic-engine upgrade (A2) re-parses the same raw text and may
  reconstruct a *different* basket history altogether for the same `case_id`.
- **`basket_version`** — the `CaseBasket`'s own version axis, bumped when the *engine, within one
  analysis*, detects the customer editing an already-built basket (add/remove/change quantity
  after an earlier state). This can only ever produce more than one row *within* one `analysis_id`.

Every `sales_intelligence_case_baskets` row therefore carries both `analysis_id` (which semantic
run produced this basket reconstruction) and its own `basket_id`/`basket_version` (which edit,
within that run). A basket row belonging to analysis A1 is never treated as "the same basket
lineage" as a same-`basket_id`-string row under A2 — `analysis_id` is the real partition; a shared
`basket_id` string across two different `analysis_id`s is coincidental, not linked.

## 8. Corrected idempotency model

Two independent identity dimensions, never hidden inside one combined hash (per the explicit
instruction to separate "source changed" from "algorithm changed"):

- **`semantic_source_hash`** — what changed about the *input*. Narrowed in H.0.1 to cover only
  what case segmentation / historical closure / commercial confirmation / protocol applicability
  actually read: the raw conversation source text, plus branch/identity-mapping version only where
  it is semantically material to segmentation itself (rare — most identity resolution does not
  affect segmentation). Excludes: policy date, resolved customer identity for attribution purposes,
  invoice candidate/item data.
- **`pipeline_version` / `engine_versions`** — what changed about the *algorithm*. Independent
  fields, never folded into the hash, so a reader can always tell "same input, different logic"
  apart from "different input, same logic" (§9 of the instructions: "do not call an engine upgrade
  a source-data change").

Idempotency key for a full semantic analysis: **`case_id + semantic_source_hash + pipeline_version`**
(conceptually — `pipeline_version` here stands in for the full `engine_versions` struct on
`case_analyses`, since a bump to `caseSegmentation`/`historicalClosure`/`commercialConfirmation`/
`protocolApplicability` is what actually invalidates a case-analysis row). For the independently-
evaluable dependent tables, the analogous key is **`analysis_id + <table's own input hash> +
<table's own engine version>`** — e.g. `analysis_id + attribution_input_hash +
attribution_engine_version` for attributions.

Behavior:
- Same case + same `semantic_source_hash` + same `pipeline_version`/`engine_versions` → **no-op**
  (no new row; only `sales_intelligence_cases.last_seen_at` is bumped).
- Same case + source changed (hash differs) → **new `analysis_version`** (new `analysis_id`, old
  marked `is_current = false`).
- Same source + new pipeline semantic version → **new `analysis_version`** (this is the "algorithm
  changed" branch — never treated as a no-op even though the raw text is byte-identical).
- Policy date only changed → **no new analysis version anywhere.** Only
  `case_analyses.policy_compliance` is recomputed in place (§12) — the one deliberate exception to
  "rows are never mutated after write."
- Invoice item data newly becomes available → see §9/§10 for the explicit decision.

## 9. `semantic_source_hash` definition

Inputs, precisely:
1. A hash of the raw WhatsApp export text for the conversation this case belongs to.
2. The branch/identity-mapping table *version* active at analysis time — included only because a
   branch-name-to-`branch_id` remapping could, in principle, change which raw messages V32 treats
   as belonging to the same interaction if branch context ever feeds segmentation (it does not
   today, but the hash input is kept future-proof and cheap to include; it is a version counter,
   not the resolved value itself, so it changes rarely).

Explicitly **excluded**: `protocol_policy_effective_at` (policy changes must only trigger the §12
compliance-only recompute, never a full re-analysis — this was Phase H's original contradiction,
now resolved by removing it from the hash entirely), resolved `customer_id`/`customer_phone` (these
feed attribution and candidate retrieval, not case segmentation — see
`AnalysisDependentProvenanceFields.attributionInputHash` in `persistence/types.ts` for where they
now live), and invoice candidate/item data (feeds attribution/matching/integrity only).

## 10. Pipeline/engine version model

`pipeline_version` (e.g. `'sales-intelligence-v1'`) stays a single human-chosen label for the
whole `case_analyses` row, bumped only when a component within its scope
(`caseSegmentation`/`historicalClosure`/`commercialConfirmation`/`protocolApplicability`) actually
changes rules. Separately, `sales_intelligence_attributions`, `_basket_invoice_matches`, and
`sales_integrity_exceptions` each carry their **own** single engine-version field
(`attributionEngineVersion`, `matchingEngineVersion`, `integrityEngineVersion`) — because these
three can legitimately be re-evaluated on a schedule/trigger independent of the case-analysis
engines (customer-identity merges, invoice imports, item data appearing), and folding their
version into the case-analysis-level `engineVersions` struct would force an unnecessary full
re-analysis every time only one of *them* changed. This is the direct implementation of instruction
§8's "do not hide both inside one hash" applied consistently across every table, not just the top
one.

## 11. Reprocessing matrix

| Trigger | Full semantic re-analysis? | Attribution-only? | Matching/integrity-only? | Compliance-only? | New `analysis_version`? | Old result superseded? |
|---|---|---|---|---|---|---|
| Raw conversation changes | **Yes** | — | — | — | Yes | Yes |
| Case segmentation logic changes | **Special — see below** | — | — | — | Usually yes, but may also add/retire `sales_intelligence_cases` rows | Yes |
| Customer identity merge | No | **Yes** | (cascades if selected invoice changes) | — | No | No (case_analyses); attribution evaluation superseded, yes |
| Branch mapping changes | No | **Yes** | (cascades if selected invoice changes) | — | No | Attribution evaluation superseded, yes |
| Invoice candidates imported/updated | No | **Yes** | (cascades if selected invoice changes) | — | No | Attribution evaluation superseded, yes |
| Invoice item data appears | No | No | **Yes** | — | No | Matching/integrity evaluation superseded, yes |
| Semantic pipeline version changes (segmentation/closure/confirmation/applicability engines) | **Yes** | — | — | — | Yes | Yes |
| Policy effective date changes | No | No | No | **Yes** | No | No — in-place field update only (§12) |
| Protocol policy *version* changes (the protocol's own required-steps logic, not just the date) | **Yes** — treated as a `protocolApplicability`/`engineVersions` bump, since it can change what counts as `applicable` | — | — | — | Yes | Yes |

**Case-segmentation-logic-changes special case:** a segmentation rule change can alter not just
*how* a case is analyzed but *which cases exist at all* for a conversation (interaction boundaries
shifting means `caseId`s can appear, disappear, or merge). This is never fully automatic: the
reprocessing job flags affected conversations for a `stable_case_identity_review_required` batch
step (see `ReprocessingScope` in `persistence/types.ts`) rather than silently creating/retiring
`sales_intelligence_cases` rows. Every other trigger only ever operates within an already-fixed
`case_id`.

**Invoice-item-data-appears — explicit decision:** this creates a **downstream evaluation version**
(a new row in `sales_intelligence_basket_invoice_matches`/`sales_integrity_exceptions`, same
`analysis_id`, incremented `evaluation_version`), **not** a new complete `analysis_version`. Chosen
over the "simpler" always-full-reanalysis alternative because: (a) item data cannot retroactively
change case segmentation, historical closure, commercial confirmation, or even attribution's own
invoice selection (Phase D never depends on item-level evidence, by design since Phase E.1); (b)
historical reproducibility remains exact either way — the old evaluation row is preserved,
untouched, exactly as before; (c) forcing a full semantic re-analysis for a change that literally
cannot affect the semantic layer would make `analysis_version` numbers noisy and would falsely
suggest the conversation's own meaning was re-interpreted when it was not. The "simpler model" was
only preferred *because* it does not cost any reproducibility — per instruction §9's own stated
preference rule.

## 12. Historical reproducibility model

Every derived row carries the fields instruction §11 requires, restated per table:

- `sales_intelligence_case_analyses`: `case_id`, `analysis_id` (its own PK), `pipeline_version`,
  `engine_versions`, `semantic_source_hash`, `analyzed_at`.
- `sales_intelligence_attributions` / `_basket_invoice_matches` / `sales_integrity_exceptions`:
  `case_id` (redundant), `analysis_id` (provenance FK), `evaluation_version`, their own
  engine-version field, their own input hash, `evaluated_at`.
- `sales_intelligence_review_events`: `case_id`, `analysis_id` (§13).

"What did A1 conclude?" → query `case_analyses WHERE analysis_id = A1` (never deleted, never
mutated except its one `policy_compliance` field, and that mutation is itself versioned via
`policy_config_version` so even *that* is answerable: "what did A1 conclude under policy config
v3"). "Which attribution belonged to A1?" → `attributions WHERE analysis_id = A1 AND
evaluation_version = <the one active at the time in question>`. "Why did A2 differ?" → diff
`semantic_source_hash`/`engine_versions` between A1 and A2; if identical, the difference is a bug
(should never happen under the idempotency model in §8) — if different, that difference is the
answer, directly inspectable without guessing.

## 13. Review-event provenance model

`sales_intelligence_review_events` stores **both** `case_id` and `analysis_id` (not `case_id`
alone, and not a bare polymorphic pointer alone) — per the explicit instruction to preserve
traceability even though full per-subject-kind FK normalization is impractical. `analysis_id`
pins the review to the exact result a human looked at; it is **never** updated when a newer
analysis becomes current, so a review of A1 stays a review of A1 forever, even after A2 supersedes
it.

`reviewed_analysis_superseded` is **derived at read time**, not stored: `event.analysis_id !=
case's current analysis_id` (via `sales_intelligence_current_case_analyses`, §6). Storing it as a
column would mean writing to every open review event every time a new analysis landed for that
case — a write-amplification pattern this design avoids everywhere else (see the whole "rows are
immutable, mutate nothing but the one documented exception" discipline running through §8/§12) and
that offers no benefit a cheap join-time comparison doesn't already give for free. UI semantics for
surfacing this flag are deferred to a later phase, per instruction §12's "no UI implementation
now."

`subject_kind` + `subject_row_id` remains a documented convention rather than a native per-kind FK
set: the alternative (six nullable FK columns, `attribution_row_id`, `match_row_id`,
`exception_id`, etc., all-but-one always null) buys marginal integrity checking at the cost of a
schema that grows a new nullable column every time a new reviewable subject kind is added. Given
`subject_kind` is a small, closed enum (`ReviewSubjectKind` in `persistence/types.ts`) and every
value maps to exactly one known table, the convention is judged sufficient; this tradeoff is
revisited if a future phase needs cross-table joins directly through this pointer rather than a
one-step lookup keyed by `(subject_kind, subject_row_id)`.

## 14. Exception-ID model

**Decision, per the explicit instruction:** the same logical exception recurring in two different
analyses (or two different evaluations of the same analysis) gets **two distinct persisted rows**
— an exception row is never reused/updated across analyses or evaluations.

`exception_id = hash(analysis_id + evaluation_version + exception_type + canonical_subject)`,
where `canonical_subject` is the same discriminator the engine already uses internally (invoice id
+ basket version + product key, as applicable per exception type — unchanged from
`salesIntegrityEngine.ts`'s own existing logic, just now folded into a hash that also carries
`analysis_id`/`evaluation_version`). This means: reprocessing the *exact same* analysis+evaluation
naturally upserts (same hash → same row, satisfying the idempotency model in §8), while a genuine
new analysis or a new matching/integrity evaluation always produces fresh, independently-queryable
rows — so "was this flagged before, under the old analysis, too?" is a real, answerable question
rather than an overwritten fact.

## 15. Competing-case versioning

`competing_case_ids` stays on `sales_intelligence_attributions`, **not** on the stable
`sales_intelligence_cases` entity — confirmed correct in H.0.1 and left unchanged structurally,
now made explicit: it is scoped to `(analysis_id, evaluation_version)`, computed once per batch
(design §8/§9, unchanged) and written only at that evaluation's insert time. If a later
`analysis_id` changes segmentation or attribution for a case, its competing set is recomputed fresh
for the *new* evaluation and tied to it; the old evaluation's `competing_case_ids` remains exactly
as it was, satisfying §12's reproducibility requirement ("which attribution belonged to A1" must
include "who did A1 think it was competing with").

## 16. Revised RLS implications

`sales_intelligence_cases` is added to the access model at the same tier as
`sales_intelligence_case_analyses` (a doctor/branch-manager/etc. who can read a case's current
analysis can read its stable identity row — they are read together in practice via the current-
analyses view, §6). No existing control from the Phase H draft is weakened; restated with the
corrected table set:

| Role | `cases` + `case_analyses` / attributions / matches (current-view scoped) | `sales_integrity_exceptions` | Raw evidence | `review_events` |
|---|---|---|---|---|
| Doctor (staff) | Read own-involvement cases only, review-surface fields only. | No access. | No access. | Read own-subject events only. |
| Branch manager | Read all cases for their own `branch_id`. | Read, own branch only. | No access. | Read/write for their branch's subjects. |
| Multi-branch director | Read across assigned branches. | Read across assigned branches. | No access. | Read/write across assigned branches. |
| Customer service manager | Read all cases (cross-branch). | Read all. | Read. | Read/write all. |
| General manager | Read all, analytics-scope. | Read all, aggregate-scope. | No access. | Read all. |
| Accounts / admin | Full read; write restricted to `policy_config` and feature flags only. | Full read/write (lifecycle status only). | Full read. | Full read/write. |

Every engine-output table (`cases`, `case_analyses`, `attributions`, `basket_invoice_matches`,
`case_baskets`, `sales_integrity_exceptions`) remains **service-role-write-only**. Only
`policy_config` and `review_events` accept authenticated-user writes, unchanged from the Phase H
draft.

## 17. Revised migration order — DESIGN ONLY, not executed

1. `sales_intelligence_policy_config` (singleton, no dependents).
2. `sales_intelligence_cases` (the stable identity root every other table ultimately traces back
   to — must exist before anything that references `case_id`).
3. `sales_intelligence_case_analyses` (references `sales_intelligence_cases.case_id`; introduces
   `analysis_id` as the PK every table below actually points at).
4. `sales_intelligence_attributions` (references `case_analyses.analysis_id`).
5. `sales_intelligence_basket_invoice_matches` (references `case_analyses.analysis_id` and
   `attributions.id`).
6. `sales_intelligence_case_baskets` + `sales_intelligence_case_basket_items` (references
   `case_analyses.analysis_id`) — created but **write-disabled** (§19 in the Phase H section below).
7. `sales_integrity_exceptions` (references `case_analyses.analysis_id`) — created but
   **write-disabled**.
8. `sales_intelligence_review_events` (references `sales_intelligence_cases.case_id` and
   `case_analyses.analysis_id`).
9. Convenience views (`sales_intelligence_current_case_analyses`,
   `sales_intelligence_current_attributions`, §6) — added once steps 2-5 exist, in the same
   migration as step 5 if practical, since they have no independent existence.

RLS policies land in the same migration as each table, never as a follow-up.

---

## Phase H — original sections retained (still valid, cross-referenced above where corrected)

### 18. Deployment gates (basket versions / integrity exceptions)

- `sales_intelligence_case_baskets`/`_case_basket_items`: fully designed (§7), `disabled_by_default`
  — G.3 observed 0 real multi-version baskets.
- `sales_integrity_exceptions`: fully designed (§14), `disabled_by_default` — G.3 observed 0 real
  exceptions, root-caused to `headerEvidenceReady` almost never being true on real data.

### 19. Feature flags

| Flag | Default | Rationale |
|---|---|---|
| `caseAnalysisPersistenceEnabled` | `false` | Off until a human reviews the H.1 implementation against a real dry-run. |
| `basketVersionWritesEnabled` | `false` | §18 — 0 real multi-version baskets observed. |
| `integrityExceptionWritesEnabled` | `false` | §18 — 0 real exceptions observed. |
| `policyComplianceDashboardEnabled` | `false` | G.3's enforced-mode simulation shows every currently-`applicable` case would read `non_compliant` the instant this is turned on. |
| `staffEvaluationConsumptionEnabled` | `false` | No KPI consumption until explicitly turned on by a human decision. |

### 20. Retention / raw-text strategy

No raw WhatsApp text duplicated anywhere — every row references `conversation_id` +
`source_message_ids` (pointers) into the existing `whatsapp_review_sources` owner. Only short
(~120-char) evidence-description strings the engines already produce are stored, access-restricted
per §16.

### 21. Required indexes

Beyond the constraint-backed indexes in §5: btree on `case_ended_at`, `customer_id`, `branch_id`,
`attribution_level`, `protocol_policy_compliance`/`policy_compliance.state`,
`integrity_evaluation_scope`, `needs_human_review`, `analyzed_at`, `is_current` (partial) on
`case_analyses`; btree on `selected_invoice_id` on `attributions` (needed for the competing-case
batch step itself), GIN on `competing_case_ids` if array-membership queries become common; btree on
`type`, `severity`, `status`, `invoice_id` on `sales_integrity_exceptions`. No JSONB-specific
indexes initially.

### 22. Validation against G.3 findings

| G.3 finding | How this design handles it |
|---|---|
| 148 unique caseIds, 0 duplicates | `sales_intelligence_cases.case_id` PK + `case_analyses (case_id, analysis_version)` uniqueness enforces this at the DB level going forward, now on a structurally sound FK model (§2-§5). |
| 92/148 competing-case pattern (two-pass) | §8 batch step + §15 — computed once per batch, before persistence, scoped to `(analysis_id, evaluation_version)`. |
| 0 real basket-version bumps | §7/§18 — table fully designed, write-gated off. |
| 0 real integrity exceptions | §14/§18 — table fully designed, write-gated off. |
| 0 formal protocol completions | `historical_closure_level` and `commercial_confirmation_state` are separate first-class columns on `case_analyses`, never merged into one `closure_status`. |
| 12 applicable organic-closure cases | Enforced-mode simulation showed all 12 would read `non_compliant` — dashboard flag stays off (§19). |
| `sales_invoice_items_v21 = 0` | `item_evidence_ready`/`integrity_evaluation_scope` are the structural gates on `basket_invoice_matches`; no reader may assume item-level fields are populated without checking `item_evidence_ready` first. |
| N+1 candidate-retrieval risk | Batch architecture (§8 of the original design, unchanged) fetches once per customer/time-window group, not once per case. |

## 23. Tests / typecheck / build

`npm run typecheck` and `npx vite build --configLoader runner` both re-run after this revision.
Baseline: 37 pre-existing typecheck errors, 0 new. No runtime tests apply — this phase changes only
pure `.ts` interface declarations and this markdown document; no engine, pipeline, or test file was
touched.

## 24. Is Phase H.1 now structurally safe? Exact scope.

**Yes.** The FK model is now sound end-to-end: every dependent table's provenance FK
(`analysis_id`, and `attribution_row_id` for matches) points at a table where that key is
genuinely, permanently unique, never merely unique "among current rows." `case_id` is never used
as a historical FK target anywhere in the corrected design.

**In scope for H.1** (unchanged in spirit from the Phase H report, restated against the corrected
table list): SQL migrations for `sales_intelligence_policy_config`, `sales_intelligence_cases`, and
`sales_intelligence_case_analyses` (migration steps 1-3, §17), with RLS from the first migration;
the batch pipeline service implementing case-analysis + attribution + basket-invoice-match
persistence together (adds steps 4-5), since attribution's `competing_case_ids` cannot be
validated independently of the batch step that produces it; the two convenience views (§6);
`caseAnalysisPersistenceEnabled` wired end-to-end but left `false` until a human reviews a dry-run
against the G.3 shadow-harness numbers for the same 90 conversations.

**Explicitly out of scope for H.1:** `sales_intelligence_case_baskets`/`_case_basket_items` writes
(§18 — wait for a real multi-version case); `sales_integrity_exceptions` writes (§18 — wait for a
real non-zero exception); any dashboard or staff-facing UI; the targeted policy-recompute job (§12
of the design doc / §7 above) — build it, but do not schedule/trigger it until a real policy date
is actually being considered operationally; the `stable_case_identity_review_required` batch-review
tooling for segmentation-logic changes (§11) — not needed until a segmentation-engine version bump
actually happens.

**Phase H.0.1 complete. Stopping here — no migrations, no Supabase tables, no RPCs, no dashboards were created.**
