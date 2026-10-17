# Performance closure — verified

STARTING HEAD: `50786734f51854665c714fca2c40bae41da0ab09`.
TESTED HEAD: `1373abd88629f8bd0cdbefe2cfa940b6cb1c0ca0`.
FINAL HEAD: documentation-only descendant containing this report; exact published SHA in the final response.
BRANCH: `fix/whatsapp-master-brain-lifecycle-v4-continuation-20261017`.

This report supersedes the earlier browser-tooling BLOCKED outcome in ../FINAL_GATE.md. Phase A, Phase B, SQL/PG17 lifecycle verification and the 14/39 classifications remain closed and unchanged.

## Lint failure and minimal fixes

Exact reproduced semantic error on starting HEAD: **scripts/performance/browser-closure/main.tsx:41:9 — no-empty — Empty block statement.** The optional PerformanceObserver catch was empty. A comment now explains why unavailable long-task observation is non-fatal; behavior is unchanged.

The closure workflow called `npm run lint -- --quiet`, which also enabled Prettier. Exact command reproduction found **30,157 prettier/prettier errors and 1 no-empty error**. The semantic step now uses the existing Quality Gate policy `--rule 'prettier/prettier: off'`; no semantic rule is disabled and no application file was reformatted. [Diagnosis](lint-diagnosis.json). Initial decoded-job-log retrieval failed twice with Transport closed, so the exact checked-out command was reproduced before edits; later shorter CI logs were retrieved normally.

Verification tooling corrections found while completing the same gate:

- Quote the colon-bearing ESLint argument in a YAML run block (the first lint-fix push had a YAML error, corrected immediately).
- Use pipefail and retain stderr for tee measurement commands. The original browser artifact was empty: its successful shell step did not prove that browser measurement had succeeded.
- Run 39046167315 exposed a Playwright strict-mode ambiguity: the name المحادثة also matched تحليل المحادثة. Match tab names exactly.
- Run 39046338281 exposed missing production Profiler callbacks. Use React's opt-in production profiling entry **only in the harness config**. Measure each input's feedback to two animation frames in-browser, keeping three-command controller wall time separate.
- Green run 39046566836 exposed dependency contamination: installing the temporary controller in the project changed 144 installed packages and produced a 206.4 KiB initial bundle although package-lock stayed unchanged. The same pinned playwright-core@1.55.0 now installs only under RUNNER_TEMP and is imported by absolute path; the final exact-lockfile run returns to 202.1 KiB.

All changes after starting HEAD are confined to harness, browser test tooling/workflow and evidence. **Application src, SQL, package.json and package-lock.json are byte-for-byte unchanged.** No runtime behavior, authorization, identity, invoice/product/proof/follow-up logic or lifecycle change.

## Final CI evidence

[Run 39046903455](https://github.com/dawaapharmacy29-create/dawaa-pharmacy/actions/runs/39046903455), job **117437325204**, tested HEAD `1373abd88629f8bd0cdbefe2cfa940b6cb1c0ca0`: **all steps SUCCESS**.

System Chrome **155.0.8059.39**, `/usr/bin/google-chrome`; Node **22.23.3**. No browser download. Controller remains outside application dependencies and does not mutate the committed lockfile.

| Gate | Result |
|---|---|
| Browser UX / rendering / retained memory | PASS |
| Analysis stage timing | PASS |
| Custom regression | 1047 PASS / 0 FAIL |
| Cairo SI | 1201 PASS, 1 skipped; 117 passing files |
| UTC SI | 1201 PASS, 1 skipped; 117 passing files |
| TypeScript | PASS |
| Semantic ESLint | PASS |
| Production build | PASS |
| Performance budget | PASS |
| Source purity | PASS |
| Lockfile purity | PASS |

## Actual browser metrics

These are **CI synthetic fixture measurements**, not Production latency. The production-built harness renders real SalesIntelligenceQA, CaseIntelligenceWorkspace and WhatsAppConversationPanel with precomputed canonical fixture data. It does not measure login, live Production network/database latency, server publication writes, or a Production deployment. Locator-ready/controller times below are not separately instrumented first-paint/FCP claims.

| Metric | Final observed value |
|---|---|
| Startup to loaded fixture QA content (including network-idle wait) | 737.613 ms |
| Warm navigation | 41.287 ms |
| Master Brain persisted summary/window ready | 85.522 ms |
| First evaluation tab | 46.831 ms |
| Return to preloaded/cached evaluation tab | 51.102 ms |
| Per-input feedback to two frames | 23.7 / 18.5 / 21.4 ms |
| Rapid three-input controller wall time | 110.4 ms |
| Tab switches | 31.106–46.996 ms |
| Browser requests | 3 |
| External Supabase network requests | 0 |
| Search extra fixture reads / RPCs | 0 / 0 |
| Detail/window full pipeline runs | 0; fixture preparation pipeline runs 1 before interaction |
| QA subtree Profiler commits / actual render duration sum | 6 / 43.9 ms |
| Brain subtree Profiler commits / actual render duration sum | 31 / 63.8 ms |
| Brain mounts across initial open + 20 close/open cycles | 21 |
| Recorded long tasks | 1, duration 166 ms; no storm |
| JS heap before / after forced GC and repeated cycles | 5,616,708 / 5,771,684 bytes |
| Retained heap delta | +154,976 bytes (2.76%); no material retained growth in this fixture |
| Initial production app JS / chunks | **202.1 KiB gzip / 6**, same as accepted baseline |

Overall fixture RPC totals and all-request duplicate URLs are not separately emitted by this existing probe; do not substitute zeros for unreported metrics. The observed zero search read/RPC delta, zero external Supabase requests, zero detail pipeline invocations and bounded commits show no duplicate heavy work/request explosion in the measured interactions. Evaluation data in this harness is preloaded; cached-tab timings are component interaction timings rather than live fetch-cache correctness claims.

The prior unprofiled attempt emitted QA/brain commits 0 and aborted at ambiguous selectors, so it is not a valid BEFORE rendering baseline. No application speedup is claimed from changing instrumentation. The accepted product optimization and its 17 reads/2 exact product reads/1 transport round/0 pipeline/fuzzy baseline are unchanged.

## Analysis CPU stage timing

Existing real engine path, unchanged canonical synthetic input, **5 warmups + 40 measured runs**; synchronous CPU timings only, not Production source loading, RPC/persistence or database latency. Stage durations can be nested, so they must not be summed as disjoint wall time.

| Stage | Median ms | p95 ms | Max ms |
|---|---:|---:|---:|
| source_parse | 0.186 | 0.314 | 0.3499 |
| session_split | 0.0244 | 0.0576 | 2.5633 |
| conversation_understanding | 0.1032 | 0.1542 | 2.0703 |
| case_segmentation | 0.0331 | 0.0797 | 0.1259 |
| basket_derivation | 0.0967 | 0.216 | 0.3117 |
| product_resolution | 0.0996 | 0.1601 | 0.182 |
| active_basket | 0.0016 | 0.0054 | 0.0082 |
| commercial_confirmation | 0.0099 | 0.0255 | 0.1111 |
| customer_need | 0.0998 | 0.176 | 0.6045 |
| unavailable_demand | 0.0035 | 0.0075 | 0.0125 |
| historical_closure | 0.0219 | 0.0417 | 0.0757 |
| invoice_attribution | 0.011 | 0.0159 | 0.0186 |
| invoice_match | 0.002 | 0.0103 | 0.0279 |
| financial_settlement | 0.0071 | 0.0193 | 0.113 |
| sales_integrity | 0.0114 | 0.0508 | 0.1656 |
| sale_proof | 0.0026 | 0.0151 | 0.0173 |
| canonical_outcome | 0.0012 | 0.0156 | 0.0566 |
| journey | 0.0145 | 0.048 | 0.1286 |
| lost_opportunity | 0.0118 | 0.0537 | 0.154 |
| followup_projection | 0.0309 | 0.0633 | 0.2519 |
| operational_disposition | 0.0057 | 0.0233 | 0.0851 |
| case_view | 0.0342 | 0.0747 | 0.2497 |
| evaluation_projection | 0.5687 | 0.928 | 9.4628 |
| full_pipeline_total | 0.9466 | 2.4582 | 4.2342 |

The legacy output field firstColdMs=2.4582 is the first **measured run after warmups**, not a genuinely cold process timing.

Top three measured internal engine medians (excluding separately reported evaluation and total):
1. source_parse: 0.186 ms.
2. conversation_understanding: 0.1032 ms.
3. customer_need: 0.0998 ms.

These rankings do not prove a material CPU bottleneck. No extra optimization is justified.

**NO_ADDITIONAL_MATERIAL_BOTTLENECK_PROVEN**

## Production and stop

Production writes = **0**; Production data changes = **0**; reanalysis = **0**; repair/historical repair = **0**; runtime activation = **0**; deploy = **0**; merge = **0**; main changes = **0**. No Production query or mutation was needed. Archived39 and the14 cases remain untouched.

Machine-readable exact metrics, successful CI steps and artifact digest: [verified-results.json](verified-results.json). Approved workflow artifact: batch4-performance-browser-closure, ID 12106042235, sha256:2d4baf2ba1db3286456552cc1d514d3ae171d3d905a4344b3766df1bb1232b8d.

Stop here. No Production activation, merge or deploy follows from this verification.

**PERFORMANCE_CLOSURE_PASS_READY_FOR_RUNTIME_ACTIVATION**
