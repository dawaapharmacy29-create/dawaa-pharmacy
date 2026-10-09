# Dynamic caller follow-up

This pass supplements the original 61 literal-target call sites. It does not claim exhaustive runtime coverage.

An AST candidate scan over non-test `src`/`api` sources found 116 nonliteral `from`/`rpc` targets whose receiver text resembles a database client. Generated `sales-intelligence-refresh-source.js` was excluded because it mirrors the source bundle. These are **candidates**, not 116 writers: they include constant targets, read helpers, storage calls, and unrelated domains. A broader initial method-name scan also matched `Array.from`; those false positives were discarded before counting the 116 candidates.

## Newly classified writer

| Field | Finding |
|---|---|
| File / function | `src/lib/reviews/conversationReviewCorrection.ts` / `correctConversationReviewVersion` |
| Call | `client.rpc(CONVERSATION_REVIEW_CORRECTION_COMMAND, ...)` |
| Resolved constant | `dawaa_correct_conversation_review_session_v1` |
| Trigger | Explicit manager correction of a current review/version |
| Intended destinations | `conversation_sales_reviews` and point/version lineage through the server command |
| Stable identity | Caller idempotency key; review-version lineage |
| Classification | RETAIN authorized correction/versioning; no complaint existence or guessed staff authority |
| Live availability | Exact public-schema catalog lookup returned zero matching functions on 2026-10-09 |
| Compatibility | Definition belongs to protected `20261008160000`; leave it unchanged and unapplied |

The function name in the source is `correctConversationReviewVersion`; this pass does not imply that its intended server behavior has been activated in Production. An unavailable command is an observable compatibility gap, not permission to fall back to overwriting an automatic review.

## Reviewed generic adapters

* `Reviews.tsx` parameterized `insertSafe`/`updateSafe` calls are already represented through their literal-target callers in the original inventory. Count adapters and call sites separately; do not invent additional engines.
* `useSupabaseQuery.ts` exports generic `supabaseInsert`, `supabaseUpdate`, and `supabaseDelete`. The source search found callers for evaluation rules and tasks, not literal callers targeting the audited tables. This is lexical caller evidence, not a proof against aliases/reexports.
* `safeSupabase.ts.safeRows` and pagination helpers are read paths in their inspected bodies.
* `OperationalModule.tsx` generic writes resolve through module configurations for shelf tasks, inventory sessions, shortages, offers, training, and staff. They are not direct audited-table writes. Its separately declared customer-request lifecycle RPC remains in the original inventory.
* `whatsappOperationalSourceOwner.ts` consumes a constant read-model name; it is not an automatic proposal creator.

The saved 218-function live closure contains no matches for the inspected PL/pgSQL `EXECUTE <variable>` / `EXECUTE format(...)` pattern. This negative result applies only to that saved closure and pattern. It does not prove that functions excluded by the original literal-name closure, dynamic relation aliases, or external service writers are absent.

## Remaining coverage limits

Resolve all remaining nonliteral candidates and imported aliases, compare generated API/runtime artifacts, and enumerate external/deployed caller surfaces before declaring every writer covered. The protected correction command's absence also needs an explicit compatibility decision before a review-quality command depends on corrected versions. No live repair or migration was performed in this pass.
