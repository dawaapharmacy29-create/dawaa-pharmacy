# Real-chat semantic corrections — source-only draft batch 1

Base: 8728c6c3356c1b7f31007e25c93812ac7f8b8008. Runtime baseline: a99a7ccd8bd6c35b17783919e3fb6f5266ef66db.

Fix the canonical parser introduction patterns for service-team introductions, slash titles and full doctor titles. Require explicit suitability objections rather than treating a bare alternative-product description as rejection. Reject quantity-only and colour-only phrases as product identities; do not guess their missing referents.

Validation: 17 focused local assertions passed against functions extracted from the three edited TypeScript sources, with TypeScript syntax stripping successful. Replayed all four privately supplied exports offline against the baseline bundled pipeline with only these three source regions replaced. Case counts stayed 3/3/99/3. No customer exports, directory snapshots, identifiers or medical conversations are included in this commit. Added synthetic Vitest regression tests; the repository Vitest suite and full verify gates have NOT run.

This is a source-only checkpoint, not deployment-ready. The generated API bundle has NOT been regenerated. Regenerate with the repository build script and run its parity checks, targeted Vitest suite, typecheck and required gates before any deployment. Repository checkout via git was unavailable in this runtime; connector access was used to retrieve exact source files.

Still open: quantity-reference binding; delivery follow-up/fulfillment semantics; ambiguous multi-person You attribution; narrow-title aliases. Batch 1 removes a false customer objection but does not claim delivery completion or accurate final disposition. No new queries or persistence paths are added. Staff identity resolution remains owned by the existing canonical directory.

Security review: no auth, permissions, RLS, SQL or financial-ledger changes. Performance review: bounded regex guards only, no network calls added; no Production latency claim. Branch auto-deploy is disabled in existing vercel.json. No main merge, deployment, Production reanalysis or historical repair is authorized by this checkpoint.
