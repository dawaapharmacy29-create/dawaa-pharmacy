# Writer boundary continuation

Status: **BLOCKED for application implementation**. This pass extends static caller resolution and live dynamic-SQL inspection. It does not activate a new writer, apply a migration, or claim deployed-client coverage.

## Static source resolution

The 116 nonliteral database candidates were traced using the repository TypeScript program, symbol resolution, imported aliases, literal types, and direct static callers. Results are recorded in `nonliteral-caller-resolution.json`.

* 58 targets resolve directly from literal types.
* 96 resolve through literal types or the inspected static callers combined.
* 20 still need manual/runtime evidence; four are intentionally dynamic persisted offline operations.
* Three candidates are storage calls, outside relational operational writer scope.

Counts describe call sites, not semantic engines. Static resolution is a conservative aid: callbacks, external producers, object properties, and persisted browser state cannot be certified by this pass. The `classification` in this supplementary file classifies the inspected path; it is not proof that an unresolved adapter is read-only in all callers.

Important resolved targets:

| Adapter | Resolved targets | Effect on operational audit |
|---|---|---|
| `supabaseInsert` / `supabaseUpdate` / `supabaseDelete` | evaluation rules / tasks | No audited-table target in the found callers |
| Reviews `insertSafe` | conversation reviews, nonexistent `followups`, service-manager reviews | Existing review paths confirmed; no extra semantic engine |
| Reviews `updateSafe` | conversation reviews | Existing writer boundary confirmed |
| Invoice importer generic helpers | sales invoices | Retain canonical sale-import authority |
| Personal dashboard dynamic RPC | three `get_cs_dashboard_*` commands | Inspect server body; getter names alone do not prove no mutation |
| CRM constants | `crm_requests`, `crm_timeline` | Distinct from procurement `customer_requests` |
| Manager correction constant | canonical version-correction RPC | Already added to the 62-site inventory; live absence remains recorded |

## Persisted offline replay boundary

`src/lib/offlineQueue.ts.runItem` contains four runtime target paths: RPC, update, upsert, and insert. They execute names loaded from the existing `dawaa_offline_queue_v1` browser storage. `src/main.tsx` initializes automatic replay; replay also runs when connectivity returns. No current non-test source call to `addOfflineQueueItem` was found. That negative result does **not** prove existing browsers have empty storage.

The original literal-target inventory omitted these four conditional writer paths. They are now included as PROJECT ONLY execution adapters, increasing the app inventory to **66** sites. They do not own customer need or follow-up semantics. Their actual stored targets and Production invocation counts are unknown; no browser storage or customer data was opened to infer them.

Cutover must reject or safely redirect unsupported legacy replay on the server. A stale browser must not recreate an unsupported proposal through direct table writes or an old RPC. A rejected replay stays visible/retryable with its original payload and lineage. Do not flush browser queues or silently treat a blocked write as successful.

This browser queue is not a server-owned quality outbox: it depends on the browser and its storage, has no canonical current-review/version check, and has no automatic semantic dedupe. Its existence satisfies the search requirement for retry infrastructure but does not prove suitability for the review-quality contract. Reuse the canonical action queue for that contract only after its constraints and authorization are proved.

## Live dynamic SQL catalog pass

Read-only public-schema inspection returned 910 PL/pgSQL functions, 362 SQL functions, and 31 C functions; no public procedures were returned in that grouped snapshot. Searching all public PL/pgSQL function definitions for `EXECUTE` returned 18 candidates. One (`hr_canonical_architecture_health_v1`) matches a privilege string rather than a dynamic execution statement. The remaining 17 bodies contain dynamic execution statements.

Definitions were inspected as data, never executed. The supplementary inventory `dynamic-sql-catalog.json` records signatures, live hashes, operations, classifications, and limits. This closes the earlier *saved-closure-only* search limitation for public PL/pgSQL EXECUTE candidates at this snapshot. It does not prove absence of dynamic behavior in C extensions, external services, later schema changes, or generated/deployed bundles.

### Newly discovered indirect branch writer

`approve_customer_branch_repair_v14(text,text)` dynamically updates `customers.branch` (with a fallback to customer analysis) and records a repair log. It does not contain the audited table names, so the old literal-table closure missed its effect:

`approve_customer_branch_repair_v14` -> `customers.branch` update -> enabled `trg_sync_customer_branch_to_followups` -> `sync_customer_branch_to_open_followups_and_daily_queue` -> open `daily_followups.branch` and daily queue branch updates.

The trigger is enabled (`O`) and fires AFTER UPDATE OF branch. Its current body has no conversation-source exclusion. This indirect path is added to the database writer inventory, increasing the count to **98**. RETAIN the customer repair use case subject to authorization/compatibility review; prevent it from changing immutable conversation provenance through the source-aware downstream trigger exclusion.

Verified ACL: the repair function is SECURITY DEFINER and executable by anon, authenticated, and service_role. Its inspected wrapper body has no explicit session/permission check, and `p_reviewed_by` is caller supplied. This is a specific authorization-review finding. No call was attempted and no customer branch was changed; ACL exposure alone is not a claim that an end-to-end anonymous mutation was tested successfully. Before retaining this boundary in the future design, prove its authorized caller/session contract and dependent guards in an isolated harness.

### Dynamic RLS administration

`dawaa_apply_basic_rls_policy_v2(text,boolean,boolean,boolean,boolean)` can modify policies on a runtime-selected public table. It is not a data-row writer or a chat semantic owner. Its live ACL is limited to postgres/service_role; anon/authenticated cannot execute it. Retain it as a privileged schema-administration surface only, not a browser fallback.

Activation/verification must compare final effective policies and ensure a later administrative call cannot restore a retired legacy write policy unnoticed. This does not authorize invoking or changing the function during this task.

### Other catalog candidates

The inspected customer-service/dashboard/analytics bodies dynamically select data; the sales-summary rebuild writes its own analytics summary. They are not additional chat semantic owners. No new direct dynamic DML target among the four operational tables was found in the inspected 17 EXECUTE bodies; the indirect customer branch path above is the material new finding.

## Updated readiness conditions

### Local identity counterexample

The actual `buildFollowupIdentity` helper was loaded through a local TypeScript transpilation, with synthetic data and no database access. Identical retry, a source UUID change outside the helper's inputs, and raw-message reordering preserve the tested key. Changing the episode-start input by one minute changes the key for the same customer/reason/product scope.

SI passes `conversationCase.startedAt` as that episode-start input (`followUpOpportunityEngine.ts:289`). Therefore, if resegmentation changes case start while retaining the same obligation, blindly reusing this key cannot satisfy the supplied resegmentation invariant. `followup-identity-counterexample.json` records the two actual keys. This is a helper-level counterexample tied to the inspected engine argument, not a claim that a complete import-to-materialization flow was tested.

The parser's message ID also includes an array index (`whatsappConversationParser.ts` function `messageId`). Do not replace the case-start key with the raw parser ID and claim durable identity. The eventual SI identity contract needs a proved canonical obligation anchor, collision handling, and existing-key lineage reuse. Preserve A1/A2/A3 commercial behavior while correcting the proved identity boundary.

The one future semantic owner for each locked concept is unchanged. Readiness still requires:

1. Manual resolution of remaining adapters and trusted deployed caller surfaces.
2. Durable identity proof across source reimport/resegmentation.
3. An isolated DB proof that stale direct writes, offline replay, old RPCs, trigger paths, and service-role legacy paths cannot compete with the SI projector.
4. Source-aware request/follow-up materialization and downstream branch exclusion, preserving authorized manual workflows.
5. Authorization compatibility for the indirect branch repair boundary and final effective policies.

Application code remains unchanged. No local or live migration was applied; the protected migration and `vercel.json` remain untouched. No Vercel operation was performed.
