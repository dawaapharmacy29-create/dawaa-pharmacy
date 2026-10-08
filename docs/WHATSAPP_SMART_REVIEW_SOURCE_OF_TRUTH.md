# WhatsApp Smart Review / Sales Intelligence — Source of Truth Map

Status: canonical contract (2026-10-07). Read this before changing any WhatsApp review or
Sales Intelligence engine.

## 1. Pipeline (one orchestrator for every ingestion path)

```
WhatsApp export file
  -> parse (whatsappConversationParser)
  -> canonical segmentation (whatsappCanonicalSegmentation.segmentWhatsAppExportCanonical)
  -> Canonical Customer Identity (customers/canonicalCustomerIdentityResolver)
  -> Durable Source per case unit (whatsapp_review_sources, deduplicated by source_hash)
  -> Customer Case V22                         [critical]
  -> ONE canonical Sales Intelligence refresh  [critical]  (/api/sales-intelligence-refresh-source)
  -> Review draft (Reviews ?mode=new&fromSmart=1)
  -> Human approval (the only point where points / penalties can apply)
```

Orchestrator: `src/lib/whatsappWatcherCaseGraphSync.ts`
(`runCanonicalWhatsAppFilePipeline`, `deriveWhatsAppFileProcessingState`). Used by both the
Smart Folder (`WhatsAppSmartFolderWatcher.tsx`) and automatic ingest (`whatsappAutoIngestPipeline.ts`).

Side projections — never block V22 or Sales Intelligence; failures are visible warnings:

| Projection | Where | Failure behaviour |
| --- | --- | --- |
| Journey V15 | `whatsappCustomerJourneyPersistenceV15.ts` | warning; V22 still written |
| Story V16 rows/events | `whatsappCustomerStoryV16.ts` | warning; V22 still written |
| Story V16 aggregates (SECURITY DEFINER RPC) | server only: `salesIntelligence/refresh/storyProjectionRefresh.ts` | reported as `sideProjections.story`; canonical status unchanged |
| Evidence V17 links, response timing V18, invoice-verification attach | client | warning |

Rules:

* Sales Intelligence never runs before V22 (the Canonical Source Gate requires V22 ownership).
  Journey and V22 persistence never trigger a refresh themselves.
* Exactly one refresh request per file run, for the sources owned by saved V22 cases.
* A file is recorded as processed only when `parsed`, `source_saved`, `identity_resolved`,
  `case_graph_saved` and `sales_intelligence_refreshed` are all done. Otherwise it stays retryable.
* `dawaa_refresh_whatsapp_customer_story_v16` is never granted to `anon`; the browser never calls it.

### 1b. Semantic ownership inside Sales Intelligence (acyclic)

```
V32 semantic facts (whatsappSemanticSignalsV32)
  - classifyStaffCommitmentsV32: ONE staff-commitment grammar -> availability check_pending + follow-up promises
  -> Customer Need (availability per product, linked only when unambiguous) / Basket
  -> Unavailable Demand (check_pending | unavailable)
  -> Commercial Confirmation -> Sales Outcome -> Journey State -> Lost Opportunity (commercial verdict)
  -> Follow-up Opportunities (obligations; stock_check_pending preferred over a generic promise)
  -> Operational Disposition (caseOperationalDispositionEngine): what the case waits on NOW
  -> CaseIntelligenceView (read projection; never re-derives)
  -> persisted analysis -> V22 semantic projection (v22SemanticProjection, follower)
```

* V22 before SI = case envelope (grouping / ownership / Canonical Source Gate). Its regex
  semantics are preliminary and are never extended to fix SI cases.
* After persistence, `v22SemanticProjection` projects order_intent / commercial_opportunity /
  case_type (only `order` when canonical) / case_state / proposed_outcome / outcome_confidence /
  next_action / summary / needs_human_review with provenance in
  `case_json.canonicalSemanticProjection` (analysis ids, pipeline version, reason codes, evidence,
  confidence, preliminary values). It never writes confirmed_*/reviewed_*/verified_*/
  canonicalSaleProof; a proven sale keeps proposed_outcome; a human-confirmed outcome outranks it.
* Multi SI cases -> one V22: one -> direct; agreeing -> aggregate; conflicting open states ->
  `open` + `needs_human_review` + `v22_projection.mixed_operational_states`; any active case without a
  disposition (older analysis) -> skipped, never guessed.
* The envelope sync preserves server-owned case_json keys and, once projected, refreshes only the
  preliminary snapshot; analysis inputs read envelope values (`v22EnvelopeValue`) so SI never consumes
  its own projection (no feedback loop). Reanalysis converges to the same final state.
* Product loss != operational demand: `lostOpportunity.productLosses` is produced only from a
  canonical UNAVAILABLE fact (recoverable / lost / replaced_by_alternative). A `check_pending`
  demand stays in Unavailable Demand + Follow-up + Operational Disposition and is never a loss.
* Operational obligation != scoring maturity: an unresolved stock check is actionable now while
  its follow-up scoring lifecycle stays `pending` with zero penalty until violated.

## 2. Reanalysis contract

`persistAnalyzedWhatsAppSession(..., { mode: 'reanalyze' })`:

* same durable source (no duplicate), derived columns only (`REANALYSIS_DERIVED_COLUMNS`);
* identity/staff columns are only filled when empty (never overwrite a correction);
* never touches `review_status`, `official_review_id`, `reviewer_*`, `invoice_link_confirmed*`;
* idempotent (no write, no audit when nothing changed); audited as `analysis_reanalyzed`
  with `from_version` / `to_version`;
* never applies points. The canonical refresh then re-derives SI via semantic hashes.

## 3. Engine classification

| Engine | Classification | Owns |
| --- | --- | --- |
| Sales Intelligence V20 (`src/lib/salesIntelligence/**`, server refresh) | **Canonical truth** | Case, Product/Need, Basket, historical closure, invoice proof, basket↔invoice matching, attribution, sale outcome, evidence, confidence/coverage, human-review reasons |
| Customer Case V22 (`whatsappCustomerCasePersistenceV22.ts`) | **Canonical truth** (case graph / ownership) | case identity, source ownership, stage ownership V23 |
| Canonical Customer Identity (`customers/canonicalCustomerIdentityResolver.ts`) | **Canonical truth** | customer identity for every WhatsApp path (display names are informational only) |
| Follow-up Promise Lifecycle (`followUpPromiseLifecycle.ts`) | **Canonical rule** | pending / overdue / violated / completed; only `violated` may propose "never" |
| Staff commitment grammar (`classifyStaffCommitmentsV32`) | **Canonical semantic fact** | stock-check / reply-back commitments; feeds availability, follow-up and scoring |
| Operational Disposition (`caseOperationalDispositionEngine.ts`) | **Canonical truth** | state / waitingOn / action owner / next best action / staff / product |
| V22 semantic projection (`refresh/v22SemanticProjection.ts`) | **Projection** (compatibility) | materializes canonical meaning on V22 columns |
| V22 regex semantics (`whatsappCustomerCaseEngineV22.ts`) | **Preliminary envelope** | grouping/ownership only; kept as `preliminary` |
| Evaluation V2 `FOLLOWUP_PROMISE_RX` | **Derived diagnostic (legacy)** | stock-out follow-up hint in the diagnostic panel only |
| SI conversation evaluation (`salesIntelligence/conversationEvaluation*.ts`) | **Derived diagnostic** (proposal) | automatic review proposal; zero points impact |
| Timing V28 / Delay attribution V29 | **Derived diagnostic** | response timing evidence |
| Evaluation V2 (`whatsappConversationEvaluationV2.ts`) | **Derived diagnostic** | quality score, evidence coverage, analysis confidence shown as diagnostics |
| Sales Journey Review V2 (`salesJourneyReviewV2.ts`) | **Derived diagnostic** → feeds the reviewer's proposed official score | sales-journey axes |
| Smart Official Review Draft (`whatsappSmartOfficialReviewDraft.ts`, `whatsappReviewScoring.ts`) | **UI helper** (pre-fill) | criterion suggestions; human approves |
| Smart Review Result / Pipeline / Decision (`whatsappSmartReview*.ts`) | **UI helper** | per-staff scope, quick decision, review reasons in the Smart Folder |
| Operational Intelligence V6/V7, Unified Intelligence V4 | **Derived diagnostic** (operational) | operational actions, preliminary sales opportunities ("قراءة أولية") |
| Customer resolver V4 (`whatsappCustomerResolverV4.ts`, name search) | **Legacy comparison** | not used for identity in WhatsApp ingestion anymore |
| Legacy review score (`legacyScore` in Sales Journey V2) | **Legacy comparison** | shown muted as "مقارنة فنية" only |
| Journey V15 early SI refresh, V22 nested SI refresh | **Removed duplicates** | replaced by the single orchestrator refresh |

Product / Need / Basket / Sale Proof / Invoice Matching have exactly one owner: Sales Intelligence.
The Smart Folder shows its own opportunities only as a labelled preliminary reading and links to
`/sales-intelligence/qa` for the canonical result.

## 4. Review page contract

* One headline number: **الدرجة الرسمية المقترحة**. Quality score, evidence coverage, analysis
  confidence, journey axes and sale outcome are diagnostics. Legacy score is a muted comparison.
* Points impact is a proposal and is applied only by the reviewer's explicit save.
* Dirty state is baseline-based (`src/lib/reviews/reviewDraftLifecycle.ts`); autosave only after a
  meaningful change; "الانتقال بدون حفظ" clears the draft and the pending Smart transfer, resets the
  page and then navigates (`NavigationGuardContext` `onDiscard`).
