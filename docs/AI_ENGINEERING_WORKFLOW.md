# Dawaa AI Engineering Workflow

This workflow adapts the useful ideas from multi-agent coding repositories to Dawaa without importing a large generic agent framework or adding runtime dependencies.

## Goal

Make every meaningful change follow a repeatable chain:

`Architecture -> Plan -> Implementation -> Review -> Security -> Performance -> Verification -> Merge`

The goal is not to maximize the number of agents. The goal is to force independent reasoning passes around the failure modes that matter most in this application.

## 1. Architect pass

Output before implementation:

- user-visible problem;
- root cause or strongest current hypothesis;
- affected domain(s);
- canonical source(s) of truth;
- permission/RLS surfaces;
- high-volume/read-path implications;
- existing compatibility/fallback paths;
- smallest architectural seam where the fix belongs.

Reject a plan that introduces another direct table reader, another identity matcher, another incentive calculation, or another page-specific permission rule when a canonical boundary already exists.

## 2. Planner pass

Define:

- exact files expected to change;
- exact files explicitly out of scope;
- migration need or no-migration rationale;
- targeted tests;
- architecture gates;
- rollback or revert strategy for high-risk changes.

Keep one PR focused on one architectural concern whenever practical.

## 3. Implementer pass

Implementation rules:

- preserve canonical domain boundaries;
- prefer deletion/consolidation over adding another compatibility branch;
- do not silently convert failures to zero/empty data;
- do not use broad `select('*')` on high-volume paths without a measured reason;
- preserve request-generation/race guards on live operational screens;
- keep staff identity, account identity, branch identity, and invoice identity separate;
- keep performance incentive and target incentive separate.

## 4. Reviewer pass

Review the diff as if the implementation author were wrong.

Check specifically for:

- stale-high totals after downward corrections;
- stale cache or old request overwriting newer results;
- duplicate business calculations;
- direct shared-table UI reads;
- new fallback chains;
- permission drift between route/UI/service/database;
- branch reassignment bugs;
- name-only staff matching;
- hidden mutation during build/prebuild;
- missing regression tests.

## 5. Security pass

For every sensitive read or mutation, verify four layers:

1. page/route visibility;
2. action permission in the application;
3. service/RPC authorization;
4. database grants/RLS/policies.

A UI-hidden button is not security. An RPC with `SECURITY DEFINER` is not automatically safe. A permissive RLS policy is not acceptable just because the page is protected.

## 6. Performance pass

Classify each changed read as `live`, `standard`, or `historical`.

Check:

- row bounds and pagination;
- date/branch/staff/status predicates;
- selected columns;
- N+1 calls;
- duplicate concurrent requests;
- cache key scope;
- invalidation after writes;
- fallback freshness and observability;
- expected behavior after 6–12 months of data growth.

Pages known to be operationally sensitive should favor bounded read models/RPCs over repeated client-side scans.

## 7. Verifier pass

During development, run targeted checks for the changed domain. Before merge, run:

```bash
npm run verify
```

The repository Quality Gate is the authoritative broad verification layer. A Vercel deployment quota/rate-limit failure must be reported as an external deployment blocker, not as a source-code test failure.

## Domain playbooks

### Invoice import/corrections

Verify all of:

- existing invoice identity is updated rather than duplicated;
- downward corrections decrease downstream customer metrics;
- branch is part of the transaction truth;
- importer remains idempotent;
- no dashboard/customer service reintroduces direct transactional scans for analytics.

### Customer metrics/follow-up

Verify all of:

- customer identity resolution is centralized;
- failed reads are distinguishable from genuine zero activity;
- historical/live cache policy is correct;
- follow-up queries are bounded and branch-scoped;
- no stale snapshot silently replaces authoritative live values without visible degradation state.

### Staff/permissions

Verify all of:

- canonical `staff_id` is used for employee-domain records;
- account/user id is not substituted for staff id;
- permission keys come from the central permission system;
- route access and action access agree;
- RLS/database authorization matches the same scope.

### Points/incentives/payroll

Verify all of:

- evidence/event -> projection -> evaluation -> settlement -> payroll direction is preserved;
- pending values are not paid as settled values;
- performance incentive and target achievement remain separate;
- corrections are auditable reversals/cancellations when required;
- UI does not reconstruct final payroll directly from raw ledger rows.

### Attendance/tasks/evaluations

Verify all of:

- canonical staff identity;
- unavailable data is not interpreted as absence or zero performance;
- task completion evidence is separate from task definition/cadence;
- evaluation metrics consume canonical projections rather than rebuilding every domain query in the page.

## Merge-ready definition

A change is merge-ready only when:

- the architectural boundary is clear;
- the diff is smaller or simpler than the path it replaces, or a regression guard justifies the added code;
- targeted verification passes;
- broad gates pass or any external blocker is explicitly identified;
- the PR description records remaining risk;
- no known parallel source of truth was introduced.