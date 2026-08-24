# Customer Requests Feature

This directory is the canonical home for Customer Requests domain and, progressively, its data/workspace UI.

New Customer Requests code should be added here rather than growing `src/pages/CustomerRequests.tsx` or `src/lib/api/customerRequestsCommandCenter.ts` further.

Migration order:

1. Domain rules and identity normalization.
2. Repository/query layer.
3. Workspace state + URL filters.
4. Table/drawer/create workflow UI.
5. Legacy helper deletion after callers migrate.
