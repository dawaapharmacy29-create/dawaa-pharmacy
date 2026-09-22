# Sales Intelligence — Persistence Design (Phase H, hardened in H.0.1 and H.0.2)

DESIGN ONLY. No SQL migrations, no Supabase tables, no RPCs, no dashboards exist yet. This
document is the storage contract for implementing persistence in H.1A/H.1B. The TypeScript row
shapes referenced throughout live in `src/lib/salesIntelligence/persistence/types.ts` — also
design-only (pure interfaces, no I/O).

The semantic engines (`src/lib/salesIntelligence/*Engine.ts`, `salesIntelligencePipeline.ts`) are
frozen as of Phase G.3 and are the source of truth this document stores. This document does not
change case segmentation, historical closure, protocol applicability/compliance, attribution
scoring, basket↔invoice matching, or the integrity exception taxonomy.

**H.0.1** fixed a structural FK defect (`case_id` used as a general FK target in a table where it
was not unique) by introducing a stable `sales_intelligence_cases` entity and making `analysis_id`
the real provenance FK everywhere. **H.0.2** (this revision) fixes a defect H.0.1 itself still had:
mutating `protocol_policy_compliance` in place on the otherwise-immutable `case_analyses` row when
policy config changed. See §7-§14 below for the fix: a new `sales_intelligence_policy_evaluations`
table, and a versioned (never-mutated) `sales_intelligence_policy_config`.

## 1. Proposed tables

| Table | Row type | Ownership | Purpose |
|---|---|---|---|
| `sales_intelligence_cases` | `SalesIntelligenceCaseRow` | Stable-case | One permanent row per globally unique commercial case. Current/correctable identity pointer only (§9). |
| `sales_intelligence_policy_config` | `SalesIntelligencePolicyConfigRow` | Stable, append-only/versioned (H.0.2) | Every policy change is a NEW row; never overwritten. |
| `sales_intelligence_case_analyses` | `SalesIntelligenceCaseAnalysisRow` | Analysis-version | One row per `(case_id, analysis_version)` — fully immutable once written (H.0.2). No longer carries policy compliance. |
| `sales_intelligence_policy_evaluations` | `SalesIntelligencePolicyEvaluationRow` | Analysis-version, independently evaluable (H.0.2 NEW) | Derived compliance evaluation of one immutable `analysis_id` under one immutable `policy_config_id`. |
| `sales_intelligence_case_baskets` | `SalesIntelligenceCaseBasketRow` | Analysis-version (generated) | Immutable basket version history, tied to one `analysis_id`. **disabled_by_default**. |
| `sales_intelligence_case_basket_items` | `SalesIntelligenceCaseBasketItemRow` | Analysis-version (generated) | Line items per basket row. Same gate as baskets. |
| `sales_intelligence_attributions` | `SalesIntelligenceAttributionRow` | Analysis-version, independently evaluable | One row per `(analysis_id, evaluation_version)` — Phase D output, including first-class `competing_case_ids`. |
| `sales_intelligence_basket_invoice_matches` | `SalesIntelligenceBasketInvoiceMatchRow` | Analysis-version, independently evaluable | One row per `(analysis_id, evaluation_version)` — Phase E output. |
| `sales_integrity_exceptions` | `SalesIntegrityExceptionRow` | Analysis-version, independently evaluable | One row per canonical exception per evaluation. **disabled_by_default**. |
| `sales_intelligence_review_events` | `SalesIntelligenceReviewEventRow` | Append-only, references analysis-version rows | Human-review decision log, pinned to the exact analysis AND policy evaluation reviewed (§7). |

## 2. Root cause and resolution of the H.0.1 FK issue (unchanged, restated)

`sales_intelligence_case_analyses` is versioned by design, so `case_id` alone cannot be a safe FK
target for historical dependent rows. Resolution: a stable `sales_intelligence_cases` table where
`case_id` is genuinely, permanently unique, plus a surrogate `analysis_id` on `case_analyses` that
is the real FK target for every dependent table. See the Phase H.0.1 commit for the full original
rationale — unchanged and still correct.

## 3-6. Stable-case entity, ownership matrix, FK graph, basket-version model (unchanged from H.0.1)

Retained exactly as designed in H.0.1: `sales_intelligence_cases` is the stable identity root;
`analysis_id` is the provenance FK for every dependent table; `basket_version` and `analysis_version`
are distinct axes. See §9 below for the one clarification H.0.2 adds to the stable-case entity
(mutable current identity vs. immutable per-analysis identity snapshot).

---

## Phase H.0.2 — Policy Evaluation Immutability

### 7. Resolution of the remaining historical-reproducibility issue

**The defect:** H.0.1 kept `protocol_policy_compliance` as a field on `case_analyses` and said a
policy-date change "recomputes this struct, in place, on the CURRENT row." That is a mutation —
and it breaks reproducibility exactly as described: if analysis A1 read `not_enforced` under
policy P1, and P2 later makes the same facts read `non_compliant`, overwriting A1's own row means
"what was visible under P1" becomes permanently unanswerable. This also technically contradicted
H.0.1's own stated rule elsewhere in the same document ("rows are never mutated after write") by
carving out exactly one exception — an exception this revision removes entirely.

**The fix:** `case_analyses` is now immutable, full stop, no exceptions (§8 below). Policy
compliance moves to its own new, versioned, append-only table.

### 8. Final policy-evaluation table design

```
sales_intelligence_policy_evaluations
  policy_evaluation_id         uuid PRIMARY KEY
  analysis_id                  uuid NOT NULL REFERENCES sales_intelligence_case_analyses(analysis_id)
  case_id                      text NOT NULL              -- redundant, indexed, for debugging only
  policy_config_id             uuid NOT NULL REFERENCES sales_intelligence_policy_config(policy_config_id)
  policy_config_version        integer NOT NULL           -- denormalized copy, avoids a join for display
  protocol_policy_effective_at timestamptz NULL           -- snapshot from the config at evaluation time
  protocol_applicability       text NOT NULL              -- copied from the analysis, NEVER authoritative
  protocol_policy_compliance   text NOT NULL              -- THE derived evaluation this table exists for
  evaluation_version           integer NOT NULL           -- monotonic within analysis_id
  policy_input_hash            text NOT NULL              -- hash(analysis.protocolApplicability + caseEndedAt + policyConfigId)
  is_current                   boolean NOT NULL
  evaluated_at                 timestamptz NOT NULL
  superseded_at                timestamptz NULL
  superseded_by_policy_evaluation_id uuid NULL

  UNIQUE (analysis_id, evaluation_version)
  UNIQUE (analysis_id) WHERE is_current = true   -- partial, same pattern as case_analyses/is_current
```

This is explicitly **not** another semantic analysis — it never touches `semantic_source_hash`,
never bumps `analysis_version`, and never re-runs any of the B-C engines. It is a narrow, pure
function of two already-immutable things (`analysis.protocolApplicability` /
`analysis.caseEndedAt`, and one specific `policy_config` row) — see the type's own doc comment in
`persistence/types.ts` for the exact field list.

### 9. Semantic-fact vs. policy-evaluation field split

| Field | Lives on | Classification |
|---|---|---|
| `caseType`, `caseStatus`, `caseStartedAt`, `caseEndedAt` | `case_analyses` | Semantic fact — derived from the conversation itself. |
| `historicalClosureLevel` | `case_analyses` | Semantic fact — organic closure language, independent of any policy. |
| `commercialConfirmationState` | `case_analyses` | Semantic fact — Phase C's own formal state machine, independent of policy. |
| `protocolApplicability` | `case_analyses` | Semantic fact — whether the conversation reached an order-closing stage, derived from `historicalClosure`+`commercialConfirmation`+`caseType`, never from a policy config or date. |
| `protocolPolicyCompliance` | **`policy_evaluations`** (moved, H.0.2) | Policy-derived evaluation — the SAME `protocolApplicability` fact read against a specific, versioned policy config; changes when the config changes, without the conversation changing. |
| `attributionLevel`, `selectedInvoiceId`, etc. | `attributions` | Evidence-derived fact, independent of policy (kept separate for its own, different reason — re-evaluability without a full semantic re-run, per H.0.1 §9-§11). |
| `integrityEvaluationScope`, exceptions | `basket_invoice_matches` / `sales_integrity_exceptions` | Evidence-derived facts, independent of policy. |

Rule applied consistently: **a field is a semantic fact if re-running the conversation through the
SAME policy config would never change it; it is a policy-derived evaluation if the exact same
conversation, unchanged, could read differently under a different policy config.**
`protocolPolicyCompliance` is the only field in the whole schema that fails the first test, which
is exactly why it — and only it — gets its own table.

### 10. Final policy-config versioning model

```
sales_intelligence_policy_config
  policy_config_id             uuid PRIMARY KEY
  policy_config_version         integer NOT NULL           -- monotonic global counter
  protocol_policy_effective_at  timestamptz NULL            -- null = opted in, no date configured yet
  enabled                       boolean NOT NULL
  effective_from                timestamptz NOT NULL        -- when THIS config version itself became active
  superseded_at                 timestamptz NULL
  is_current                    boolean NOT NULL
  created_at                    timestamptz NOT NULL
  created_by                    text NOT NULL               -- staff/user id, never a raw name

  UNIQUE (policy_config_id) WHERE is_current = true  -- partial, at most one current config
```

Every change (effective date, enabled flag, or the underlying protocol-step requirements) inserts
a new row; the previous row is marked `is_current = false` / `superseded_at` and kept forever —
identical discipline to `case_analyses`. This directly answers "what policy configuration/version
was used to compute a given `protocol_policy_compliance`" for any evaluation, at any point in the
past, without guessing.

### 11. Policy-change lifecycle (final desired behavior)

| Change | Effect |
|---|---|
| Raw conversation changed | New `case_analyses` row (new `analysis_id`, new `analysis_version`). |
| Semantic engine changed | New `case_analyses` row. |
| Policy configuration changed | **No** new `case_analyses` row. A new `sales_intelligence_policy_config` row is inserted (old one superseded); a new `sales_intelligence_policy_evaluations` row is created for the CURRENT analysis of every case whose `protocolApplicability = 'applicable'` (mirrors the targeted-recompute batch job from the H design, now writing a new row instead of mutating one). Old policy evaluations remain queryable exactly as they were. |
| New semantic analysis created | Evaluated against whichever `policy_config` row is CURRENT at that moment, producing that analysis's own initial `policy_evaluations` row (`evaluation_version = 1`). |

This cleanly separates the two timelines end to end: the semantic-analysis timeline
(`case_analyses.analysis_version`) and the policy-evaluation timeline
(`policy_evaluations.evaluation_version`, scoped within one `analysis_id`) never interfere.

### 12. Interaction with analysis versioning

`policy_evaluations.analysis_id` FKs to an immutable `case_analyses` row exactly like
`attributions`/`basket_invoice_matches`/`sales_integrity_exceptions` already do (H.0.1's
`AnalysisDependentProvenanceFields` pattern) — `policy_evaluations` now formally joins that same
family, with its own `evaluation_version` counter scoped within `analysis_id`, independent of
attribution's or matching's own evaluation-version counters (a policy-only change bumps only
`policy_evaluations`, never touching attribution/matching rows, and vice versa).

### 13. Review-event provenance changes

`sales_intelligence_review_events` gains `policyEvaluationId: string | null`, set only when
`subjectKind = 'policy_compliance_finding'`. A manager who reviews a violation surfaced from
`Analysis A1 + PolicyEvaluation E1` has that review permanently pinned to `E1` — when policy
changes and `E2` becomes current for the same `A1`, the review row is **never** touched or
reassigned. `reviewed_analysis_superseded`-style derived flags (for both the analysis axis and,
now, the policy-evaluation axis) stay computed at read time by comparing the review's stored ids
against the current-view tables (§6 in the H.0.1 section) — never stored, per the same
write-amplification-avoidance rule already applied to the analysis axis in H.0.1.

### 14. Staff-evaluation safety rule

Made structurally queryable via `StaffEvaluationSafetyRequirement` and
`isActionableForStaffProtocolKpi()` in `persistence/types.ts` — a pure function, not a UI
convention. **Both** gates are required, always:

1. `attributions.isOfficialForStaffEvaluation === true` (unchanged gate from Phase D).
2. The case's **current** `policy_evaluations.protocolPolicyCompliance` is exactly `'compliant'`
   or `'non_compliant'` — `'not_enforced'`, `'not_applicable'`, `'not_reached'`, and `'unknown'`
   must never be read as, or silently coerced into, a violation.

Any future staff-KPI consumer (a view, an RPC, a dashboard query) MUST join through both gates
before a case can contribute to a protocol-compliance metric. The concrete failure mode this
prevents: "historical closure strongly_inferred" + "policy evaluation not_enforced" (G.3's actual
observed state for all 12 currently-applicable cases) must never become a protocol penalty — gate
2 alone already blocks it, but a consumer that only checked gate 1 (or worse, read
`historicalClosureLevel` directly without going through either gate) would miss this.

### 15. Stable-case identity correction semantics

`sales_intelligence_cases.customer_id` / `.branch_id` are the **current, correctable canonical
references** — a later customer-identity merge or branch-mapping fix updates them in place (this
table is explicitly the one place in the whole schema where in-place mutation of these two fields
is intended and safe, because the table represents "what do we currently believe," not "what did
we conclude at analysis time"). This is *not* a full identity-history system (deliberately not
built — the instruction explicitly warned against over-building this) — instead:

- `sales_intelligence_case_analyses.identityAtAnalysis` (new in H.0.2) is an **immutable snapshot**
  of exactly which `customerId`/`customerPhone`/`branchId`/`branchNameRaw` were in effect when
  THAT analysis ran, recorded once and never touched again — even if the stable case's own
  pointer is corrected afterward.
- `sales_intelligence_attributions.identityAtEvaluation` similarly snapshots the identity used for
  that specific attribution evaluation (which can be re-run on a corrected identity independently
  of the semantic analysis, per the `attribution_only` reprocessing scope — H.0.1 §9-§11).

Rule of thumb, stated once and applied consistently: **`sales_intelligence_cases` = current
canonical reference + a pointer back to source evidence (`conversation_id`, unchanged from
H.0.1's raw-text retention strategy); an analysis/evaluation row = the identity facts/version
actually used at that row's own moment in time.** Correcting the stable case's pointer never
destroys or retroactively rewrites what an old, superseded analysis or evaluation recorded.

---

## Retained from H.0.1 (updated only where the table/FK set changed)

### 16. Current convenience views — design only

```
sales_intelligence_current_case_analyses     -- VIEW: WHERE is_current = true
sales_intelligence_current_attributions      -- VIEW: JOIN current case_analyses, WHERE is_current_evaluation = true
sales_intelligence_current_policy_evaluations -- VIEW (H.0.2 NEW): WHERE is_current = true, joined against current case_analyses via analysis_id
```

Not created until H.1A. Historical storage stays fully versioned underneath all three.

### 17. Revised RLS implications

`sales_intelligence_policy_evaluations` joins the access model at the same tier as
`sales_integrity_exceptions` (compliance-sensitive, restricted broader than plain case analyses):
doctors get no direct access to raw compliance evaluations (only their own review-surface
summaries, unchanged); branch managers read their own branch's evaluations; CS manager/GM/admin
read broadly per the existing table in the H.0.1 section. `sales_intelligence_policy_config`
remains accounts/admin-write-only, now explicitly insert-only (never update, since it is versioned
— an "edit" is always a new row). No control from H.0.1 is weakened.

### 18. Revised table list and FK graph (see §1 above)

`sales_intelligence_cases` → `sales_intelligence_case_analyses` (`case_id`) →
{`sales_intelligence_attributions`, `sales_intelligence_policy_evaluations`} (`analysis_id`) →
`sales_intelligence_basket_invoice_matches` (`analysis_id` + `attribution_row_id`) →
`sales_integrity_exceptions` (`analysis_id`). `sales_intelligence_policy_config` feeds
`policy_evaluations` (`policy_config_id`) as a separate, parallel input — not part of the
case-lineage chain. `sales_intelligence_review_events` references `case_id` + `analysis_id` +
(optionally) `policy_evaluation_id`.

### 19. Revised migration order — DESIGN ONLY, not executed

1. `sales_intelligence_policy_config` (singleton-history, no dependents).
2. `sales_intelligence_cases` (stable identity root).
3. `sales_intelligence_case_analyses` (references `cases.case_id`).
4. `sales_intelligence_policy_evaluations` (references `case_analyses.analysis_id` and
   `policy_config.policy_config_id`) — **new in H.0.2, promoted into H.1A's schema step** since it
   completes the immutability model H.1A's constraints depend on.
5. `sales_intelligence_attributions` (references `case_analyses.analysis_id`).
6. `sales_intelligence_basket_invoice_matches` (references `case_analyses.analysis_id` and
   `attributions.id`).
7. `sales_intelligence_case_baskets` + `_case_basket_items` — created but **write-disabled**.
8. `sales_integrity_exceptions` — created but **write-disabled**.
9. `sales_intelligence_review_events`.
10. Convenience views (§16).

### 20. Deployment gates, feature flags, retention, indexes, G.3 validation

Unchanged from H.0.1 — see that section of this document's history (all four still apply exactly
as designed: basket-version and integrity-exception writes stay gated off pending real examples;
raw text is never duplicated, only referenced; JSONB stays un-indexed until a specific query needs
it; every G.3 finding still maps to a specific design decision, now additionally including "policy
evaluations must be historically reproducible," which §7-§14 above directly satisfies).

## 21. Tests / typecheck / build

`npm run typecheck` (via `npx tsc --noEmit -p tsconfig.json`) and
`npx vite build --configLoader runner` both re-run after this revision. Baseline: 37 pre-existing
typecheck errors, 0 new. No runtime tests apply — this phase changes only pure `.ts` interface
declarations and this markdown document; no engine, pipeline, or test file was touched.

## 22. Is Phase H.1A now safe to start?

**Yes.** The immutability model is now sound end-to-end: `case_analyses` is never mutated after
write, full stop; the one field that legitimately changes over time (policy compliance) lives in
its own versioned table with its own immutable FK to both the analysis and the policy config that
produced it. Every historical question this document promises to answer (§12 of the H.0.1 section,
extended by §14 above for policy) is answerable by direct lookup, never by guessing what an
already-overwritten value used to be.

## 23. Exact H.1A scope — Schema Foundation only

Create (as SQL migrations, in the order in §19):
- `sales_intelligence_policy_config`
- `sales_intelligence_cases`
- `sales_intelligence_case_analyses`
- `sales_intelligence_policy_evaluations`
- `sales_intelligence_attributions`
- `sales_intelligence_basket_invoice_matches`
- RLS policies for every table above, in the same migration as each table.
- Indexes per §20 (retained from H.0.1).
- The three convenience views (§16), if approved at H.1A review time.

**No automatic pipeline writes. No batch persistence execution.** Every feature flag stays
`false`. H.1A's own exit criterion is validating database constraints and RLS in isolation — e.g.
manually inserting a handful of representative rows (mirroring a few real G.3 cases) to confirm
the unique constraints, FK integrity, and RLS policies behave as designed — then **STOP** for a
human review before any writer code is built.

**H.1A must still exclude:** `sales_intelligence_case_baskets`/`_case_basket_items` table
creation stays paired with H.1A only as *schema* (write-disabled, per the existing gate) — no
basket-version writer code; `sales_integrity_exceptions` table creation is schema-only, same gate;
no dashboards; no staff KPIs; no policy-compliance UI; no cron/background processing; no automated
production ingestion of any kind.

## 24. Exact H.1B scope — Persistence Writer + Batch Service

Only after H.1A's own verification is signed off, separately:
- Idempotent writer functions implementing the two-tier versioning model (§8/§9 of the H.0.1
  section, extended by the policy-evaluation lifecycle in §11 above).
- Grouped invoice-candidate prefetch (one fetch per customer/time-window group, never per case —
  the direct fix for G.3's measured N+1).
- Full batch analysis run: load → resolve customers → group → prefetch → run pure pipeline per
  case → resolve competing-case relationships across the whole batch → persist.
- Competing-case resolution written as first-class `competing_case_ids` at insert time, never
  recomputed lazily.
- A persistence **dry-run mode** (computes and logs what would be written, writes nothing) as the
  first thing exercised against real data before any flag flips.
- Only after the dry-run is reviewed: flip `caseAnalysisPersistenceEnabled` to `true` in a
  controlled environment, still with `basketVersionWritesEnabled`,
  `integrityExceptionWritesEnabled`, `policyComplianceDashboardEnabled`, and
  `staffEvaluationConsumptionEnabled` all left `false`.

H.1A and H.1B are never combined into one pass — H.1A gives a clean, independently-verifiable
rollback boundary (drop the still-empty, still-unwritten-to schema) before any writer code exists
to reason about.

**Phase H.0.2 complete. Stopping here — no SQL migrations, no Supabase tables, no RPCs, no dashboards were created.**
