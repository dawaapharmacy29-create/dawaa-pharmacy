# WhatsApp Smart Review / Sales Intelligence — Source of Truth Map

Status: canonical contract (2026-10-07). Read this before changing any WhatsApp review or
Sales Intelligence engine.

## 0. Foundational rule: every detail needs its own case-scoped evidence

**القاعدة الأساسية:** كل تفصيلة تُحسم من دليلها الخاص، وعلى مستوى الحالة التي تخصها. ملف التصدير الكامل هو سياق يحتوي على حالات؛ ليس حالة واحدة، ولا يجيز نقل موظف أو فرع أو فاتورة من حالة إلى أخرى. عند ضعف الدليل أو تعارضه، تُعرض المعلومة «مرشحة» أو «غير محسومة» مع سبب ذلك بدل ملء الفراغ بالتخمين.

* **Segment first, then resolve.** Build explicit, non-overlapping message sets for each conversation/case. Keep messages that are genuinely continuous in one case; separate customer-service outreach, a later pharmacy consultation/order, and a nursing/service request when their intent and timeline show distinct interactions. A shared customer may connect cases as a journey, but journey membership never merges case facts or owners.
* **Customer identity:** Resolve against the canonical customer master using the approved unique identity rules (for example, a unique customer code). Report separately (a) identity resolved for analysis and (b) a durable `customer_id` actually linked to the source/case. A code on an invoice or chat is evidence to evaluate, not proof that a master row or a database link exists. Never invent an ID.
* **Employee and department:** Use the official staff directory and only approved, unambiguous aliases. Scope an introduction such as «مع حضرتك د شبل» to the messages/case it introduces; do not assign every speaker or case in the uploaded file to that employee. A seller on a candidate invoice may support the order case, but must not overwrite a case-local introduction or assign unrelated customer-service work. Team classification (such as customer service) is distinct from the employee's home branch.
* **Branch:** Preserve separate fields for the source/folder branch, the case's operational branch, and any candidate branch. Derive an operational branch only from evidence attached to that case and appropriate to the field. A doctor's home branch is supporting context, not an automatic transaction branch. An invoice's branch can support the case only after the invoice-to-case relationship is established; do not use the same seller/doctor signal twice as if it were independent proof. If the source says «المخزن» while the case and invoice suggest «فرع شكري», keep that conflict visible until the approved correction path resolves it.
* **Invoice and products — strongest transactional evidence:** Keep three verdicts separate: (1) the invoice and its recorded lines exist, (2) each line's match to this case's requests, and (3) whether the invoice belongs to this case. A valid invoice created during the case or within the existing narrow post-case window is the strongest transaction signal **when combined** with a unique canonical customer identity (or exact unique customer code plus consistent name), at least one distinctive case-local product match with quantity agreement, a unique eligible invoice candidate, and no contradictory identity, time, status, or competing-case evidence. The system must evaluate that combination as a first-class deterministic attribution path; it must not require every invoice line to have been spoken in the chat or every basket item to be fully resolved before recognizing the invoice-to-case relationship. The matched lines alone are corroborated by the conversation; unmatched lines remain «بالفاتورة فقط», never become customer requests. A merely nearby timestamp, a code/name alone, seller alone, branch alone, or one ambiguous item is not sufficient. Do not count correlated signals twice (for example, the same seller identity used both as staff match and as the reason for choosing that invoice's branch). If identity is duplicated/conflicting, the invoice is cancelled/returned/draft, another invoice or concurrent case is equally plausible, or the timestamp is not precise enough, preserve a strong candidate and route the case to review. A source-level branch conflict unrelated to this case must not veto case-scoped invoice evidence; preserve it as a separate source fact, and derive the order's transaction branch only from a safely linked invoice or other case-local evidence. If image/audio evidence is unavailable, mark it unavailable rather than assuming its contents are known or absent.
* **Evidence and contradictions:** Every material displayed conclusion must retain traceable provenance (case ID and message IDs; staff/master record; invoice ID and line/product IDs), a state/confidence, and any counter-evidence or unresolved ambiguity. Keep confirmed facts distinct from candidates, suggestions, and human decisions.
* **Aggregation:** V22, journey, story, customer, and file-level summaries may aggregate child cases, but must preserve each case's IDs, owners, branch evidence, product evidence, and confidence. Aggregation must never promote a child candidate to confirmed truth or spread one case's employee/branch/invoice across sibling cases.
* **Acceptance tests:** Regressions must cover multiple cases in one export, customer-service and pharmacy staff in one file, ambiguous/duplicate staff aliases, source/folder versus invoice branch conflicts, a master customer that exists while the source link is empty, a unique invoice created during/just after the correct case with exact customer identity and a distinctive quantity-matched product despite partial basket coverage (attribute only when candidate/competition/status guards pass), timestamp-only and code-only false positives, two competing invoices/cases, cancelled/returned invoices, ambiguous pack sizes, invoice-only lines, unavailable media, and aggregation of conflicting child cases. Assert both the conclusion and its evidence trail; assert that unresolved facts stay unresolved.

This rule is an analysis and data-integrity contract. It does not itself authorize reanalysis, customer/source correction, invoice linking, branch correction, action changes, migration, deployment, or any write to Production.


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
| Story V16 rows/events | `whatsappCustomerStoryV16.ts` (upsert on `story_id,event_key`; reanalysis needs `whatsapp_customer_story_events_update_v16`, migration `20261008073930`) | warning (`story_events_update_not_permitted` on RLS denial); V22 still written |
| Story V16 aggregates (SECURITY DEFINER RPC) | server only: `salesIntelligence/refresh/storyProjectionRefresh.ts` | reported as `sideProjections.story`; canonical status unchanged |
| Evidence V17 links, response timing V18, invoice-verification attach | client | warning |

Rules:

* Sales Intelligence never runs before V22 (the Canonical Source Gate requires V22 ownership).
  Journey and V22 persistence never trigger a refresh themselves.
* Exactly one refresh request per file run, for the sources owned by saved V22 cases.
* A file is recorded as processed only when `parsed`, `source_saved`, `identity_resolved`,
  `case_graph_saved` and `sales_intelligence_refreshed` are all done. Otherwise it stays retryable.
* If local folder read permission expires, ingestion reports the permission failure and disconnects
  the folder; it must never present the denied read as an empty inbox.
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
* Envelope write strategy (`planV22EnvelopeWrite` / `writeV22Envelope`): a NEW envelope is an
  INSERT of the complete preliminary payload; an EXISTING envelope is a guarded UPDATE of
  envelope-owned columns only (never an UPSERT — Postgres checks NOT NULL case_type/case_state on the
  INSERT tuple before ON CONFLICT). The UPDATE is conditional on the updated_at just read; on a lost
  race it re-reads, re-merges and retries at most 3 times. case_key/created_by are never rewritten.
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
