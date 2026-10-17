# WhatsApp Master Brain — Batch 3

BRANCH: `fix/whatsapp-master-brain-kpi-truth-v3-20261017`

HEAD: the commit containing this report (resolve the branch ref; the commit cannot contain its own hash).

PARENT_BATCH2: `aabfd48fd3c97249898bc65a351f935ffda39412`

KPI_READER_MAP: [pre-change map](KPI_READER_MAP.md). Map completed before implementation. Doctor Eye/service, management, staff performance, opportunity center, analytics and doctor drilldown now use one batched adapter over existing persisted canonical readers. Four legacy report routes render retirement notices; ProductDemandLeakage delegates to the canonical opportunity center. Customer-service manual purchase amounts are explicitly labelled follow-up entries, not official WhatsApp revenue. Invoice productivity/reconciliation remains a distinct transaction metric.

PARALLEL_LEGACY_SALES_TRUTH_BEFORE: YES

PARALLEL_LEGACY_SALES_TRUTH_AFTER: NO — in the reviewed active official WhatsApp KPI paths. Historical helpers/data remain for compatibility; architecture tests prohibit official consumers from querying the retired views/RPCs.

DOCTOR_PERFORMANCE_SALE_SOURCE: `sales_intelligence_current_analyses` + canonical case envelope/current attribution, through existing `readCaseIntelligence` / `canonicalCaseTruth` and `canonicalKpiReadModel`.

DOCTOR_PERFORMANCE_REVENUE_SOURCE: canonical revenue flag and same-case persisted V22 proven invoice ledger. A proof analysis ID is audit provenance, not an added freshness condition. No new SQL view or writer.

LEGACY_INVOICE_MATCH_STATUS_USED_FOR_SALES: NO

CANONICAL_SALE_COUNT_RULE: persisted outcome `sale_proven` AND `isSaleCountable === true`. Invoice proof alone never promotes a sale.

CANONICAL_REVENUE_RULE: `isRevenueCountable === true`, using canonical same-case proven ledger value. Missing/hidden value remains null; known revenue is labelled separately. Revenue and sale flags remain independent. Missing outcomes remain unknown. A failed canonical read returns unavailable, never legacy fallback.

STAFF_ATTRIBUTION_RULE: one unambiguous persisted `confirmed_order` staff ID and canonical attribution official for staff evaluation. Invoice seller, reviewer, names and current employment status never establish credit. Multi-staff participants remain available. Follow-up responsibility requires persisted assignedStaffId; complaint/loss ownership without canonical evidence remains unavailable.

UNRESOLVED_ATTRIBUTION_FAILS_CLOSED: PASS

LEGACY_V4_DELAY_APOLOGY_FALSE_SALE: RETIRED. The path was V4 `chatSuggestedSold` / commercial-eligible fallback → journey `chat_sale_signal`, and a suggested conversion ratio. These no longer create sale signals or conversion. Historical invoice evidence is explicitly labelled as evidence. Canonical SI does not consume this heuristic.

POLITE_RESPONSE_FALSE_POSITIVE_TESTS: PASS — delay apology + تمام شكراً, وصل تمام, شكراً, تمام, ماشي, جزاك الله خير, resolved delivery complaint, late apology, consultation, unavailable product, refused alternative and promised follow-up. Positive canonical sale/proof and independent-flag cases are also tested.

LOST_OPPORTUNITY_TRUTH: PASS — only persisted canonical `lost` state. No invoice, silence, unresolved product and human review do not independently create a missed sale or staff penalty.

CONVERSION_NUMERATOR: eligible canonical countable conversation sales. Staff numerator additionally requires explicit confirmed-sale attribution. Non-commercial countable cases do not inflate eligible conversion.

CONVERSION_DENOMINATOR: existing canonicalConversionV1 eligible sales_opportunity/mixed cases with checkable customer identity. Unknown eligible outcomes remain pending. Staff eligible denominator is unavailable when eligible ownership is unresolved. Product final-basket acceptance is separately labelled as a stage ratio, not sale conversion. Legacy V4 suggestion ratio is unavailable, not a replacement definition.

## Deterministic comparison

| Metric | Legacy fixture predicates | Canonical persisted fixture |
|---|---:|---:|
| Sales | 3 | 2 |
| Revenue EGP | 300 | 200 |
| Conversion | 100% (3/3) | 66.67% (2/3) |
| Staff credited sales | 3 | 1 |
| Missed opportunities | 1 | 0 |

Legacy predicates count verified invoice matches, award source-staff credit, and infer loss from absent invoice. The fixture includes proof without a countable outcome, unresolved attribution and a human-review case. These differences are intentional; canonical values are not forced to reproduce legacy totals. Permissions tests hide ledger/attribution: canonical sale counts stay fixed while unavailable revenue or staff ownership remains unknown. This does not bypass row-level access or claim hidden rows are readable.

## Production read-only comparison and diagnosis

Observed 2026-10-17: legacy doctor-cycle verified matches still yield 14 sales / 6101.50 EGP. Current canonical analyses contain 136 cases, 135 outcomes, 10 countable sale outcomes and 10 revenue-countable flags; accessible same-case proven ledger amounts sum to 2305 EGP. This known amount is not a claim that every flagged case has a readable amount. Invoice-only historical counts and current canonical counts have different coverage and business predicates; they are not equivalent cohort estimates. No deployed reader changed during this investigation.

MISSING_CURRENT_ANALYSIS_COUNT: 53 (189 active-flag cases minus 136 visible current analyses).

| Group | Count / branch | Evidence | Classification |
|---|---|---|---|
| Active case metadata, archived source | 39: Shokry 37, Shamy 2 | Sources archived, no V22 link, historical current flags/published pointers; current view intentionally excludes them | HISTORICAL_PIPELINE_GAP; ARCHITECTURAL_CONTRACT_VIOLATION in lifecycle metadata |
| Non-archived, no published/current analysis | 14: Shokry | Canonical source owner and V22 dependencies exist; historical analyses superseded; published pointer absent and no current flags | DATA_GAP; HISTORICAL_PIPELINE_GAP; OPERATIONAL_ISSUE in publication/persistence |

Archived source dates: Shokry 2025-12-22–2026-09-15; Shamy 2026-09-15. Non-archived dates: 2026-01-05–2026-09-15. Historical pipeline is sales-intelligence-v1. Source versions are V4, with two V5 in the 14-case group. Those 14 each have 1–5 historical analyses, last analyzed September 22/28, superseded September 27–October 3; review states are 12 needs_context, one ready_detailed, one ready_quick. All 53 are absent from current-analysis-driven UI. The 39 archived sources are intentional exclusions, not 39 fresh analysis requests.

No missing dependency or never-analyzed explanation was found for the 14. Durable refresh failure logs were not established, so failed refresh is not asserted. There is no evidence to assert CONFIG_GAP, TEST_GAP, or source contamination as the production root cause. Exact grouped dates, source versions and 14-case identifiers/timestamps are in [read-only evidence](production-readonly-diagnosis.json).

Remediation plan only: first review the 39 lifecycle inconsistencies for archival alignment, separately from the 14 publication gaps. For the 14, inspect supersession/publish history, validate source coverage and resegmentation with a dry run, then propose explicit republish/reanalysis or retirement actions. Never restore superseded truth blindly. Production mutations require separate authorization in Batch 4. No historical repair was executed.

PRODUCTION_REANALYSIS_PERFORMED: NO

## Verification

SELECTED_WINDOW_PIPELINE_RUNS: 0

SELECTED_WINDOW_FUZZY_PRODUCT_QUERIES: 0

Existing window regression fixture: 17 total reads, 2 product reads, no fuzzy/ilike/resolution calls; observed 16.35 ms Cairo / 13.68 ms UTC, illustrative local timings, not production latency. Shared KPI loader fixture: 100 cases in 4 batched reads, not N+1 per staff. Pagination/caps fail explicitly; no silent truncation.

GOLDEN_CASE: PASS

SOURCE_GATE: PASS

INTEGRITY_ENGINE: PASS

SI_REGRESSION_GATE: PASS — Cairo and UTC, each 113 test files passed / one skipped, 1174 tests passed / one skipped. Includes Batch 1/2 window/product truth, A/B/C and same-customer isolation, QA, lost/conversion and new KPI/V4 tests.

NPM_TEST: PASS — custom suite 1047 passed, zero failed, followed by both SI timezones above.

TYPESCRIPT: PASS — tsc noEmit.

BUILD: PASS — production build. Existing chunk-size advisory remains. Performance budget PASS, initial static JS 202.2 KiB gzip, six chunks.

QUALITY_GATES: PASS — all 29 workflow script checks; semantic ESLint zero errors. Relevant evaluation architecture gate now requires canonical impact reads while preserving transaction productivity. Source-gate test follows the retired wrapper into the canonical center; no unrelated gates disabled.

Local Node 24.19.0; hosted Node 22 CI and live browser/deployed flows were not executed. Production readiness is not inferred from local tests. Automatic Vercel deployment is disabled for this branch in vercel.json.

PRODUCTION_WRITES: 0

PRODUCTION_DATA_CHANGES: 0

MAIN_CHANGES: 0

SECURITY_BRANCH_CHANGES: 0

PRODUCTION_DEPLOY: 0

No SQL migration, backfill, payroll/incentive change, merge, deployment command or Production writer was introduced/executed. Main, Batch 2 and security branch refs are checked after publishing.

BATCH_3_STATUS: CLOSED

Recommend Batch 4 only: missing-current-analysis operational remediation plan; after that, final integrated readiness review. Batch 4 has not started.
