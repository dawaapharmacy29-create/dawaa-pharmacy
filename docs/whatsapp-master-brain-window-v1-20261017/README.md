# WhatsApp Master Brain — selected-conversation window, batch 1 (2026-10-17)

This is the first implementation batch from `WHATSAPP_MASTER_BRAIN_END_TO_END_REVIEW_20261017`. It is not a redesign.

**Scope**
- the selected-conversation window: correctness and stale async;
- canonical truth consumption;
- test coverage.

**Not touched in this batch**
- Production data or schema;
- migrations;
- Doctor Performance KPIs;
- payroll and financial rewards;
- the product-matcher performance;
- the security branch / PR #512.

## 1. Stale async overwrite: fixed

The detail route keeps one component mounted while the user moves between cases. Every async result now commits through `qa/selectedCaseRequestGate.ts`, and the page flows live in `qa/selectedCaseDetailFlow.ts`.

How the gate works:
- `select(caseId)` starts a new generation and aborts the previous case's requests (`AbortSignal`). The loader also checks the signal between its read stages.
- A result commits only while its generation is current and no newer request of the same case has already committed.
- The effect cleanup calls `release(caseId)` on case change and on unmount.
- There are no timers.

The confirm-invoice flow:
- The server write itself is never aborted.
- Only its UI effects are dropped once the user has moved on.

Regression tests are in `qa/__tests__/selectedCaseStaleAsync.test.ts`. They cover:
- A → slow confirm and reload of A → switch to B → A finishes → B stays rendered;
- A → B → C in four completion orders;
- a late error from a previous case;
- re-visiting A (first visit ignored);
- an older reload inside one case;
- unmount.

Mutation check: with the guard disabled, 6 of 7 tests fail.

## 2. Canonical sale truth: read, never re-derived

The window no longer runs the sales pipeline with invoice candidates or competing claims. It reads the persisted truth for THIS case through `qa/canonicalCaseTruth.ts`.

| Fact | Persisted source | Writer |
|---|---|---|
| Conversation outcome, `saleProofState`, `isSaleCountable`, `isRevenueCountable`, `isOrderConfirmed`, `needsHumanReview` | `sales_intelligence_case_analyses.evidence_snapshot.canonicalSalesOutcome` (current analysis) | server refresh pipeline |
| Invoice attribution | current `sales_intelligence_attributions` row of that analysis | server refresh pipeline |
| Countable sale ledger (invoice, revenue) | `whatsapp_customer_cases_v22.case_json.canonicalSaleProof` + `verified_*`, only when `canonicalSaleProof.salesCaseId` equals the case | `dawaa_reconcile_sales_intelligence_case_v22_v1` (single writer) |

Rules the reader enforces:
- Each fact is shown exactly as persisted. `saleProofState = proven` is never turned into a countable sale, a confirmed order or `sale_proven`.
- One V22 case can be shared by several SI cases. In Production, up to 7 active SI cases share one V22 case. A proof that belongs to another segment shows as `proof_belongs_to_other_case`.
- Missing truth stays missing:
  - `not_analyzed` / `outcome_not_persisted` (47 current analyses in Production carry no outcome);
  - `v22_not_linked`;
  - `v22_not_visible`.
- There is no fallback to a browser calculation.
- Viewer authorization only decides visibility. A row hidden by RLS becomes an explicit "not visible" state. It never changes outcome, proof state or attribution; a test covers this.

The window keeps one display-only conversation re-reading: basket item names, quantities and source messages, which the analysis row does not persist. It runs with **no invoice candidates**, so it cannot select an invoice or prove a sale.

## 3. One case = one window truth

`qa/__tests__/selectedCaseIsolation.test.ts` uses synthetic data and a filter-aware in-memory client. Its cases:
- case A: canonical sale;
- case B: same customer, `needs_review`, with proof `proven` but not countable, sharing A's V22 case;
- case C: no proof;
- case D: legacy analysis, no outcome.

For each case it asserts:
- customer;
- case id;
- source id;
- outcome, proof and countable flags;
- ledger;
- invoice and invoice lines;
- catalog products, which are limited to the case interval;
- staff truth;
- sibling cases.

It also checks:
- A → B → C → A through the real window flow;
- the same customer with separate cases (customer-wide invoice history never becomes case evidence);
- viewer visibility.

## 4. Direct test failures: classified and resolved

Before this batch, a direct Vitest run of `src/lib/salesIntelligence` + `src/lib/__tests__` on `fdb53454` showed 29 failed tests plus 1 suite load error, in 13 files. None of those files ran in CI.

| Suite | # | Class | Root cause | Resolution |
|---|---|---|---|---|
| `basketV2/benchmark.ib3` (missedReview = 1, case R16) | 1 | REAL_REGRESSION | "و + pack noun" order-list lines ("وقطرة هاى فريش", "وعلبة سويتال", "وشريط كيوتابكس") produced no action, so their unresolved products silently vanished instead of surfacing for review. Failing since the benchmark landed (1d68d33e). | Fixed at the source: `actionIntentClassifierV2` classifies such a line as `add` when a basket exists. Unresolved products now raise review signals, and none is guessed. Covered by `listContinuationReview.test.ts`. |
| `basketV2/ib4EvaluationV2` (readyForNextStage) | 1 | REAL_REGRESSION | Same as R16 (blocker `missed_human_reviews:1`). | Same fix. |
| `qa/customerDisplayIdentity` (phone suffix) | 1 | REAL_REGRESSION | The bounded digit run let the lazy name swallow a phone's leading digits: "محمد 01012345678" became the name "محمد 01" and the code "012345678". | Fixed at the source: capture the whole trailing digit run before judging it. |
| `whatsappConversationJourneyClassifier` (apology → `chat_sale_signal`) | 1 | REAL_REGRESSION (legacy) | The legacy V4 `commercialEligible`/`chatSuggestedSold` heuristic marks a delayed-order apology as a chat sale signal. Failing since the test was written (da2f5057). Not canonical sale truth. | **Not fixed. Deferred** to the legacy Doctor-Performance truth removal batch, because changing it shifts legacy KPI inputs. The test stays visible and red in a direct run; it is not in the gate. |
| `persistence/refreshSourceCanonicalGate` | 13 | STALE_TEST_FIXTURE | The fixture predates the verified-session authorization: no `VITE_SUPABASE_ANON_KEY` (503 `missing_supabase_anon_key`) and no answers for the identity/permission RPCs. | Fixture sets the anon key and gives the session-token client its own permission-RPC mock. The deploy guard is untouched. |
| `persistence/refreshSourceCanonicalGate` (sold closure) | 1 | STALE_EXPECTATION | feca2250 moved the invoice link into `payload.canonical_sale` and stopped writing `target_*`. | Assertion updated to the current contract. |
| `whatsappAutomaticReviewPersistence` | 3 | STALE_TEST_FIXTURE | The canonical ownership gate (`loadOperationalSourceIds`) was not mocked, so the cases never reached the path they test. | The fixture admits the source. |
| `salesIntegrityEngine` golden 38/40 | 2 | STALE_TEST_FIXTURE | Invoice times were written as Cairo wall-clock but labelled `Z` (3 h after the chat), so attribution was correctly weak. | Fixture invoice times shifted −3 h, keeping the intended "minutes after the chat". |
| `queries.io` | 1 | STALE_TEST_FIXTURE | The fixed-payload mock returned an object where rows are read. | Uses the filter-aware test kit. |
| `conversationEvaluationSystemEvidence` | 1 | STALE_TEST_FIXTURE | The mock lacked `.eq` and assumed one invoice read; the loader now reads once per identity column and de-duplicates. | Mock and expectation updated; semantics asserted. |
| `caseBasketEngine` C1/C4 | 2 | STALE_EXPECTATION | Expected `09:02Z` for "9:02 AM", but WhatsApp time is Africa/Cairo (`06:02Z`). | Expectation corrected. Passes in Cairo, UTC, Tokyo and New York. |
| `basketInvoiceMatchingEngine` #11 | 1 | STALE_EXPECTATION | 18c3f451 made an unresolved identity unavailable evidence plus human review, never a negative "missing item". | Assertion updated to the fail-closed contract. |
| `canonicalAnalyticalSourceResolver` | 1 | STALE_EXPECTATION | Expected the off-main backfill script as an allowed caller. Secondary environment assumption: POSIX path separators. | Expected list matches main; separators normalized. |
| `refresh/canonicalBackfill` (suite load error) | 1 | TEST_RUNNER_GAP | Reads `scripts/run-sales-intelligence-backfill.cjs`, which exists only on unmerged branches. | The guard now applies to every SI backfill script that exists under `scripts/`. |

Totals: REAL_REGRESSION 4 (3 fixed, 1 deferred), STALE_TEST_FIXTURE 20, STALE_EXPECTATION 5, ENVIRONMENT_ASSUMPTION 0 (1 secondary, fixed), TEST_RUNNER_GAP 1.

The systemic runner gap is that none of the 13 files ran in CI. It is closed by `scripts/run-si-regression-gate.cjs`, now part of `npm test`, which runs the whole `src/lib/salesIntelligence` tree plus the review-persistence suite under `TZ=Africa/Cairo` and `TZ=UTC`.

One new failure appeared and was fixed inside this batch: `runtimeReadContracts` pinned the old `let cancelled` shape of the detail page. It now pins the gate wiring; the behaviour itself is covered by the stale-async tests.

## 5. Golden Case 1 is now a repeatable gate

`goldenCase1.realRegression.test.ts` is a deterministic isolated replay with synthetic ids. It runs in the SI regression gate in two time zones. It protects:
- no cross-segment product leakage (Segment 4's PEDICORT is absent from Segment 5);
- requested/final quantity stays `null` and is never inferred from the invoice;
- the image reference "ودا" stays unresolved, with `needsHumanReview`;
- invoice proof `proven` stays separate from the outcome (`needs_review`, not countable, order not confirmed);
- staff attribution is evidence-based (sender identity and invoice staff match);
- exclusive invoice ownership.

Historical Production contamination is not forced to match the archive.

## 6. Source Gate

The Source Gate is not reopened. No updated-export synthetic test reproduces current ingestion contamination. Historical contaminated sources remain HISTORICAL_DATA_CONTAMINATION.

The Source Gate transport suite (409 refusals, auth paths, the single proof writer, sold closure) is green again and gated.
