# Runtime performance gates

This document defines the pre-merge runtime contract for the Dawaa management app.
It complements the architecture/data-access checks: clean code is not sufficient if the
page still makes slow, duplicated, or inconsistent runtime reads.

## 1. Front-end startup budget

The production build is measured from the Vite manifest after gzip compression.

- Initial static JavaScript graph: **<= 300 KiB gzip**.
- Normal route/module chunk: **<= 100 KiB gzip** unless explicitly classified as a heavy tool.
- Excel, PDF and chart engines must never be part of the initial static graph.
- Heavy export/report libraries are allowed only in route/action-lazy graphs.
- A new feature may not increase the startup graph just because it shares a generic `vendor` chunk.

`npm run perf:budget` is enforced by the Quality Gate.

## 2. Data-path budget

Representative database execution should target:

- simple indexed identity/detail read: **< 100 ms** DB execution;
- operational queue/list read: **< 250 ms** DB execution;
- core dashboard/analytics projection: **< 500 ms** DB execution;
- exceptional heavy report: **< 1,000 ms** DB execution, and it must not block the operational shell.

These are DB-execution targets, not browser wall-clock guarantees. Network, authentication and
render time are measured separately on the preview deployment.

## 3. Correctness before speed

No performance rewrite may change business results silently.

Before replacing a canonical data path:

1. compare record counts;
2. compare aggregate values (sales, points, incentives, etc.);
3. compare stable row/entity IDs where applicable;
4. compare complete JSON/RPC payloads for operational dashboards when practical;
5. only then accept the faster implementation.

Examples established during the August 2026 architecture pass:

- canonical sales analytics view rewrite: identical invoice IDs/count/net sales before accepting the faster plan;
- customer-service operations RPC rewrite: exact JSON payload equality before accepting the faster query.

## 4. Runtime data architecture

Pages consume domain/read-model boundaries rather than choosing tables or fallbacks themselves.

- invoice analytics -> canonical sales analytics truth;
- customer invoice history -> customer invoice read model;
- staff identity -> staff directory read model;
- employee points/events -> employee transaction read model / settled payroll projection;
- attendance -> attendance read model;
- evaluations -> evaluation metrics gateway;
- customer-service operational metrics -> bounded operational projections/RPCs.

A page must not add a second source merely to recover from a slow first source. Fix the source or
isolate a temporary compatibility fallback behind one observable boundary with a removal condition.

## 5. No false zero / false empty state

Timeout, permission error, schema error, network failure, or partial-load failure must not be
presented as a legitimate zero value or empty queue.

Every operational projection should distinguish at minimum:

- `ready`;
- `empty` (successful query with zero records);
- `unavailable/error`.

This rule is particularly important for attendance, incentives, customer followups, dashboard KPIs,
and staff performance.

## 6. Request duplication

Complex pages often compose several domains. Shared canonical directories/read models should dedupe
concurrent identical reads. Do not use long client caches to hide duplicated architecture when fresh
RLS/session semantics matter.

Known examples:

- staff directory uses in-flight request deduplication;
- invoice reads use the shared freshness-aware invoice cache;
- customer detail uses exact indexed identity strategies before expensive wildcard compatibility matching.

## 7. Preview verification before main

Before the PR is eligible to leave Draft status:

1. Build passes.
2. Quality Gate passes, including runtime bundle budget.
3. Database parity checks for new migrations are recorded.
4. Preview deployment is exercised for the critical routes when deployment protection permits it.
5. Browser console/network errors are reviewed.
6. Critical route data is compared across the canonical sources/projections.
7. The PR remains unmerged until these checks are complete.

Critical routes include at minimum:

- executive dashboard;
- customer service / followup queue;
- customer 360/profile;
- invoices/import;
- analytics;
- staff detail/performance;
- points/incentives/payroll;
- tasks/evaluations;
- attendance/schedule;
- reports center.
