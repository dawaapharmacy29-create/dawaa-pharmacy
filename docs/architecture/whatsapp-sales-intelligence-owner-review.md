# WhatsApp / Sales Intelligence — Owner Review (Deep Architecture Review v1)

Status: review contract. No runtime behaviour is changed by this document.
Scope freeze: legacy/historical rows are **history only**. No cleanup of old sources, actions, reviews,
imports or points is part of this programme. A historical conversation that matters is re-ingested
through the modern path instead of being repaired in place.

Governing rule (unchanged): **Conversation is evidence. Invoice is transaction truth.**
Only Canonical Sale Proof counts a sale. AI may grade support (`strongly_supported`, `weakly_supported`,
`unknown`, `contradicted`) but never produces `sale_proven` on its own.

## 1. Method

- Production reachability was computed from the real entry points only: `src/main.tsx` (lazy routes
  included), `server/sales-intelligence-refresh-source.ts` (Vercel API), every `scripts/*` file referenced
  by `.github/workflows` or `package.json`, and `supabase/functions/*/index.ts`.
- Table/RPC readers were inventoried from `src/` and `server/`.
- Live DB owners (V50–V53) were verified in STEP 3C.

## 2. The central finding — two brains

| | Brain A: Sales Intelligence pipeline | Brain B: Watcher page orchestration |
|---|---|---|
| Entry | `server/sales-intelligence-refresh-source.ts` → `canonicalRefreshService` → `batchPersistenceService` → `runSalesIntelligencePipeline` | `src/pages/WhatsAppSmartFolderWatcher.tsx` (2,951 lines, a UI page) |
| Nature | Pure engines, versioned, immutable analyses, canonical gate, Sale Proof via V22 reconcile | ~30 engine calls wired inside a React page: V4 unified, V6 operational, V7 product journey, V15 journey, V17 evidence ledger, V18 turns, V19 order lifecycle, V22 case graph, V26–V33 timing/focus/evaluation/grounded journey, Smart Review pipeline/decision/actions/draft, V34 invoice link |
| Owns | case segmentation (interaction), basket, confirmation, attribution, basket↔invoice match, integrity, Sale Proof state, canonical outcome | source creation (canonical segmentation), review drafts, operational actions, evidence facts, response turns, order lifecycle, customer story, lost reasons |

Brain A is the correct analytical owner. Brain B is ingestion plus many legacy analytical engines that
still write operational tables (`whatsapp_conversation_actions`, `whatsapp_evidence_facts_v17`,
`whatsapp_response_turns_v18`, order lifecycle, stories). The duplication below mostly comes from
Brain B re-deriving concepts Brain A already owns.

A second orchestrator, `whatsappAutoIngestPipeline.ts`, is reachable **only** from
`src/pages/WhatsAppFolderWatcher.tsx`, which has **no route**. Consequence: the automatic-review writer
(`persistAutomaticWhatsAppReview`) has no live caller today.

## 3. Concept → Authoritative Owner

| Concept | Authoritative owner (keep) | Competing / duplicate paths | Decision |
|---|---|---|---|
| Source canonicality | DB `whatsapp_operational_canonical_sources_v1` (V51) | TS `evaluateCanonicalSourceGate` / `loadCanonicalAnalyticalSources` (mirror + parity CI); `sourceSnapshotLineage.ts` ("fuller snapshot wins", unreachable) | **Merge**: TS becomes an adapter over the V51 owner (reason codes to move into the owner). `sourceSnapshotLineage` → Delete-safely candidate |
| Import segmentation (export → sources) | `whatsappCanonicalSegmentation.ts` (V27 case contexts) | raw `splitWhatsAppSessions` callers | Keep |
| Interaction segmentation (source → commercial interactions) | V32 `buildConversationUnderstandingV32` interactions, consumed by SI `deriveSegmentedCases` | fixed 30-min gap + one regex topic marker; SI re-splits with a 120-min gap | Keep owner; **upgrade** to semantic segmentation (Phase 1) |
| Customer identity | `src/lib/customers/canonicalCustomerIdentityResolver.ts` | `whatsappCustomerResolverV4`, `whatsappCustomerContextResolver`, `whatsappFollowupIdentity`, filename hint (`whatsappExportCustomerHint`) | Keep owner; V4/context/followup resolvers → adapters; filename = hint only |
| Case identity | V22 case (`whatsapp_customer_cases_v22`) = customer-case grouping; SI case `conversationId:interaction:N[:session:M]` = commercial interaction | V15 journeys/sessions | Keep both layers (different concepts); V15 → Evidence-only |
| Commercial intent | V32 semantic signals (`whatsappSemanticSignalsV32`) + SI `conversationCaseEngine` | V6 operational intent, V22 direct product intent, `whatsappConversationJourneyClassifier`, Smart conversation intelligence | Keep SI; others → Evidence-only then Retire |
| Product extraction | SI `caseBasketEngine` + `pharmacyProductResolverV2` | V6 `enrichWhatsAppOperationalProductsV6`, V7 product journey, V22 direct intent, basketV2 reconstruction (shadow) | Keep SI; V6/V7 → Evidence-only |
| Basket | SI `caseBasketEngine` (+ `resolveActiveBasket`) | basketV2 (shadow/benchmark only) | Keep; merge basketV2 improvements into the owner, not beside it |
| Invoice candidate matching | SI `invoiceCandidateRetrieval` + `basketInvoiceMatchingEngine` + `saleAttributionEngine` | V4 `verifySessionAgainstInvoices`; source-level `matched_invoice_*` columns; V23 `productInvoiceVerification`; `whatsapp_sales_opportunities_v17.matched_invoice_*` | Keep SI; source-level matching → Evidence-only (V50 already made the legacy trigger evidence-only) |
| Sale Proof | `dawaa_reconcile_sales_intelligence_case_v22_v1` + `saleProofState` (canonical) | V34 manual link writes `invoice_match_status='verified'` on the **source** (one conversation = one invoice) | Keep; **Merge** manual confirmation into a case-level human-proof input |
| Lost opportunity | none canonical yet | `whatsappCaseLostReasonV23`, V6 actions, `whatsapp_lost_opportunities_v1`, `*_lost_reason_cycle_v24`, `*_leakage_v20/v22`, SI legacy `SalesOutcome.lossReason` (unused) | **New owner inside SI** (Phase 7); legacy views become readers of it |
| Recovery / follow-up / next action | none canonical yet | `whatsapp_conversation_actions` (22 readers), `whatsapp_recovery_work_queue_v2`, `whatsapp_rescue_queue_v24`, `whatsapp_auto_followup_requests`, `whatsapp_customer_service_action_center_v1`, `customerServiceSmartFollowup` (no importer) | **New owner inside SI** (Phase 8); `whatsapp_conversation_actions` stays the operational work store fed from it |
| Customer story | `whatsapp_customer_story_360_v1` (V51-gated) | `whatsapp_stories`, `whatsapp_customer_stories`, V15 journeys, V16 story builder | Keep 360 view; others → Evidence-only |
| Staff attribution | SI `saleAttributionEngine` → `sales_intelligence_current_attributions` → `sales_intelligence_invoice_staff_truth_v1` | V6 ownership, `whatsappSmartReviewOwnership`, V23 stage ownership | Keep SI; others → Evidence-only |
| Official review | DB `conversation_sales_reviews_official_v1` (V52) + V53 points gate | — | Keep |
| KPI | readers of the official owners (V52 dataSources constant) | `whatsapp_doctor_performance_v1`, `whatsapp_case_doctor_kpis_v23`, `*_funnel_v20`, `*_response_cycle_v18`, `whatsapp_recovery_staff_kpis_v1` | Keep official readers; KPI views must read SI/official owners (Phase 9) |

## 4. Patch / duplication inventory

Deletion requires all seven proofs: no frontend reader, no RPC consumer, no trigger dependency, no
CI/script dependency, no current production path, a canonical replacement, tests covering it. Anything
not fully proven stays.

### Delete-safely candidates (unreachable from every production entry point; proof 1/2/4/5 done, 3/6/7 pending per item)

| Path | Only importers |
|---|---|
| `src/pages/WhatsAppFolderWatcher.tsx` + `whatsappAutoIngestPipeline.ts` | unrouted page, tests |
| `src/pages/WhatsAppConversationAnalyzer.tsx` + `whatsappConversationIntelligence.ts` | unrouted page |
| `src/pages/WhatsAppReviewQueueV4.tsx` → `WhatsAppCycleEvidenceDashboardV17` → `doctorCommercialCycleRepositoryV1` → `staffCommercialAnalyticsV1` | unrouted page |
| `src/pages/WhatsAppCustomerHistory.tsx` | unrouted page |
| `whatsappPerformanceV4`, `whatsappTemplates`, `whatsappCustomerJourneyDecisionV8`, `legacyOpportunityAdapter`, `customerServiceSmartFollowup` | no importer / tests only |
| `whatsappReviewDecisionSupport`, `whatsappReviewFrameworkV3`, `whatsappAnalysisScope` | only old `scripts/patch-*.cjs` one-off patchers |
| `whatsappCriterionEvidenceV32` family (`…Understanding/ResponseSpeed/OrderConfirmationEvidenceV32`) | each other + tests |
| `sourceSnapshotLineage`, `saleProofStateContractBenchmark`, `staffRecommendationAnalyticsV1` | tests only |
| `scripts/patch-whatsapp-*.cjs` | not referenced by workflows/package.json |

Keep (shadow benchmarks, deliberately test-only): `basketV2/benchmark*`, `closure*`, `ib4EvaluationV2`,
`semanticReadinessV2`, `historicalClosureShadowV2`. They are the regression ground truth for the brain.

### Merge

- Source canonicality TS resolver → adapter over V51 (remove the second rule implementation).
- Interaction segmentation: SI re-splits by 120 min after V27 already segmented; one semantic owner.
- Invoice matching: V4 `verifySessionAgainstInvoices` / source `matched_invoice_*` → SI candidates.
- V34 manual invoice link → case-level human-proof input to the V22 reconcile writer.
- Product extraction: V6/V7/V22-intent → SI basket.

### Evidence-only (keep for history, never decide truth)

V6 operational intelligence, V7 product journey, V15 journeys, V16/`whatsapp_stories`,
V17 evidence facts, V18 turns, V19 order lifecycle, V23 lost reason/stage ownership, V26 deep
intelligence, V33 grounded journey, `whatsapp_sales_opportunities_v17`.

### Keep (core)

V32 understanding + semantic signals, SI pipeline and engines, canonical segmentation, V22 case
engine/persistence, V50–V53 owners, `canonicalCustomerIdentityResolver`, `pharmacyProductResolverV2`,
refresh service/API, persistence writers.

## 5. Intelligence gaps (target phases)

| Phase | Exists today | Gap |
|---|---|---|
| 1 Conversation understanding | V32 interactions: 30-min gap, fulfilment continuation, one topic-shift regex | semantic boundaries (intent change, product continuity, old-vs-new order, invoice timing) |
| 2 Customer need model | request/price/quantity/rejection signals | structured need: primary need, requested/offered/alternative/rejected products, objection + category |
| 3 Basket intelligence | `caseBasketEngine` items + basket history | per-product lifecycle requested → offered → alternative → accepted/rejected → final → invoice item |
| 4 Journey state machine | `CaseStatus`, `CaseStage`, `CanonicalSalesOutcome` (three vocabularies) | one small state machine derived from evidence |
| 5 Invoice intelligence | candidates, attribution, basket↔invoice diff | explicit score, supporting evidence, contradictions, selection reason, per candidate |
| 6 Sale Proof | canonical | keep; expose support grade from Phase 5 |
| 7 Lost opportunity | scattered legacy | one engine: reason, evidence message ids, confidence, responsible stage, recoverability |
| 8 Next best action | scattered legacy queues | one engine: action, due_after, owner, goal, product/alternative, or explicit `no_action` + reason |
| 9 Staff intelligence | review scoring (V2/V31), official reviews | journey-grounded strengths/gaps per interaction |

## 6. Execution order (small steps, each: HEAD check → change → verify → commit → stop)

1. **Owner registry guard** — a test that pins the owner table above (new engines must live under
   `src/lib/salesIntelligence/`; no new `whatsapp*V<n>.ts` analytical module; no new reader of the
   evidence-only tables for truth).
2. **Semantic interaction segmentation** in the V32 owner (Phase 1), benchmarked against basketV2
   ground truth, bump `ENGINE_VERSIONS.caseSegmentation`.
3. **Need model + basket lifecycle** (Phases 2–3) as pure SI engines consumed by the pipeline.
4. **Journey state machine** (Phase 4) collapsing the three vocabularies into one derived state; Sale
   Proof remains the only route to `sale_proven`.
5. **Invoice candidate explanation** (Phase 5) inside `saleAttributionEngine` output.
6. **Lost opportunity + next best action** (Phases 7–8) as SI engines; legacy lost/recovery views
   re-pointed to read them.
7. **Staff journey evaluation** (Phase 9).
8. **Retirement passes** for the Delete-safely list, one path per step, each with the seven proofs.

## 7. Brain owner map (after BRAIN STEP 5A)

Every truth has exactly one owner inside Sales Intelligence; the Case Intelligence view only
composes them (`caseIntelligenceView.ts`, persisted as `evidenceSnapshot.caseIntelligence` from
`sales-intelligence-v5`).

| Truth | Canonical owner |
|---|---|
| Interaction boundary | V32 `buildConversationUnderstandingV32` interactions (carried into SI as `SegmentedCase.interaction`) |
| Message semantics (request, acceptance/commitment, availability, alternative, intent, timing, promise) | `whatsappSemanticSignalsV32.ts` |
| Customer identity | `canonicalCustomerIdentityResolver` upstream; SI consumes `customerIdentityStatus` |
| Staff identity | staff identity owner upstream; SI consumes `staffIdBySender`, never "first staff wins" |
| Customer need, product lifecycle, availability, alternatives, need decline | `customerNeedModel.ts` |
| Basket | `caseBasketEngine.ts` |
| Commercial confirmation | `commercialConfirmationEngine.ts` |
| Journey state | `commercialJourneyStateMachine.ts` |
| Invoice attribution / Sale Proof / outcome | `saleAttributionEngine.ts`, `saleProofState.ts`, `canonicalSalesOutcomeEngine.ts` |
| Unavailable demand | `unavailableDemandEngine.ts` |
| Lost opportunity | `lostOpportunityEngine.ts` |
| Follow-up opportunity / next best action | `followUpOpportunityEngine.ts` |
| Unified read model | `caseIntelligenceView.ts` (projection only) |
| Production runtime context (staff map, customer identity + status, catalog, shared base input) | `runtimeContext.ts` (STEP 7A) |

### 7.1 Production wiring (STEP 7A, `sales-intelligence-v8`)

Real call chain: Smart Watcher (`requestCanonicalSalesIntelligenceRefresh`) → `api/sales-intelligence-refresh-source`
(generated from `server/sales-intelligence-refresh-source.ts`) → `runCanonicalSalesIntelligenceRefresh` /
`runCanonicalSalesIntelligenceBackfill` → `reviewSourceRowToBatchConversation` → `runBatchPersistence` →
`loadSalesIntelligenceRuntimeContext` + `prepareSalesIntelligenceConversations` → `pipelineBaseInputFor` →
`deriveCasesOnly(segmentationInputFromPipelineInput(base))` (pre-pass) and `runSalesIntelligencePipeline({...base})`
(pass 1 + claim-resolution reruns). The read-only QA live re-derivation (`qa/queries.ts`) uses the same three calls.

- Staff: canonical staff directory (`loadStaffDirectoryFrom(client)`) → `buildStaffIdentityMap` → `resolveStaffIdBySender`
  (unique active names only; never the customer; never when no non-staff-looking inbound sender remains; "You" stays raw).
- Customer: `resolveCanonicalCustomerIdentities`; only `resolved` feeds `customerIdHint`; the status always travels.
- Catalog: `fetchPharmacyProductIndex` once per batch.
- Case ids: one base input feeds both the pre-pass and the run, so staff senders / hints can never diverge.
- Planning no-op mirrors the write RPC: `pipeline_version` is compared.
- Known limits: a staff-directory change alone does not re-analyse an unchanged source (the semantic hash covers the raw
  text); per-message introduced staff names in single-number exports stay unresolved.

## 8. Legacy path -> canonical replacement

| Legacy path | Canonical replacement | Future role |
|---|---|---|
| V6 operational intelligence (intent, products, `followupPlan`) | Customer Need + Follow-up engine | evidence-only now; operational adapter later |
| V6 `syncWhatsAppOperationalActionsV6` -> `whatsapp_conversation_actions` | Follow-up engine output | adapter (action writer fed by SI) later |
| V7 product journey (stages, leakage, `nextAction`) | Product lifecycle + Lost + Follow-up | evidence-only; retire later |
| V22 case `proposed_outcome` / `nextAction` | Journey + Lost + Follow-up | keep V22 case grouping; outcome fields evidence-only |
| V22 `proposed_lost_reason` + V23 lost reason | Lost Opportunity engine | retire later |
| V24 lost/rescue views, V20/V22 leakage views | Lost Opportunity + Unavailable Demand | adapter (re-point to SI) later |
| `whatsapp_lost_opportunities_v1` RPC | Lost Opportunity engine | retire later |
| `whatsappFollowupSignalDetector` / `whatsapp_auto_followup_requests` | Follow-up engine | retire later (no live writer) |
| V15 journeys, V16/V36 stories | Case Intelligence (Customer Story input) | evidence-only |
| Frontend status labels (e.g. V22 case labels) | Case Intelligence fields | display only |
