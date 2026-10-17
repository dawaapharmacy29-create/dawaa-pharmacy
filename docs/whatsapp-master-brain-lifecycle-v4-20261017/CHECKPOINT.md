# Batch 4 runtime checkpoint — not a deployment

Parent: d87f153928b97a9576336efc054f0440f3e8c4ff.

The direct batch stale-case lifecycle UPDATE is removed. Canonical refresh stages analyses through a dedicated service-only RPC; an incomplete source never changes current/publication and remains pending retry. Complete sources reconcile independently with explicit analysis IDs, and only successfully reconciled sources feed proof/evaluation followers. New staged cases start inactive.

This runtime requires the Batch 4 SQL candidates. There is intentionally no fallback to the older auto-current writer or v1 reconciliation: missing candidate RPCs fail closed. Branch automatic deployment is disabled. Do not activate this runtime before separate approval and installation/verification of its SQL dependencies.

Checkpoint verification: npm test PASS (1047 custom tests; 1189 SI tests in each Cairo/UTC, one existing skip); generated parity PASS; TypeScript PASS; production build PASS; 29 quality scripts PASS; semantic ESLint zero errors. Local Node 24.19.0; Node 22 not available locally. SQL design/rehearsal and operational classification are continued in the next checkpoint. No Production writes, data changes, main/security changes, merge or deploy.
