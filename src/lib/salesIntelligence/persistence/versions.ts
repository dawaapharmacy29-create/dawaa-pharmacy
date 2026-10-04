// Sales Intelligence Phase H.1B — persistence version constants.
//
// Single place every writer/hasher reads its own version string from, so a future engine change
// bumps exactly one constant here rather than a magic string scattered across writer files. These
// are INDEPENDENT of any git SHA (design doc H.0.1 §8) — each one only changes when the engine it
// names actually changes in a way that should trigger the reprocessing scope
// REPROCESSING_MATRIX assigns it (see persistence/types.ts).
// IMPORTANT: after changing semantic versions here, regenerate the committed serverless transport
// with scripts/build-sales-intelligence-refresh-api.cjs so Preview/Production runs the same versions.
// v19 (2026-10-04): a complete confirmed order with clean official invoice attribution and an exact
// announced-total match projects as invoiced_unproven/closed_order_unproven. Media-only product
// identity remains an evidence limitation and never reopens an otherwise closed invoiced order.
// Final V19 user-trigger marker: focused Mohamed regression, mismatch fail-closed test, full suite,
// TypeScript, generated API verification, and production build passed before this comment-only trigger.
// V19 preview retry marker: this comment-only commit was made after the Vercel Hobby build-rate window elapsed.
// v18 (2026-10-04): unresolved media/deictic product identity is unavailable evidence, never a
// manufactured item contradiction; canonical review-source staff_id now reaches SI knownStaffIds.
// Final V18 user-trigger marker: focused regression, full suite, TypeScript, generated API verification,
// and production build passed on the semantic head before this comment-only CI/deploy trigger.
// v17 (2026-10-04): compact announced totals may bridge only short acknowledgement messages
// after the customer's explicit total question; any new customer commercial content fails closed.
// v16 (2026-10-04): settled-order truth alignment. Exact invoice-backed payment settlement now
// projects consistently as case=invoiced, journey=financially_settled, lostOpportunity=closed_order_unproven,
// pipeline=analyzed, while Sale/Revenue remain uncounted until canonical Sale Proof is proven.
// Final V16 preview trigger: source tests, full suite, TypeScript, generated API verification, and production build passed.
// v15 (2026-10-04): invoice-backed financial settlement closes transfer-paid orders without
// fabricating formal protocol compliance or Sale Proof; payment-continuation request ambiguity is
// suppressed only under explicit transfer context. Final gate marker: generated API verified.
// Preview trigger note: this comment-only marker exists to ensure Vercel builds the verified V15 head.
// v14 (2026-10-04): canonical refresh reassembles only explicit payment-settlement followup fine
// sources into their single same-journey order anchor for analysis, while preserving source/V22
// ownership and retiring the follower's stale SI case-set through normal reconciliation.
// v13 (2026-10-04): quality hardening validated on real WhatsApp cases. The semantic pipeline
// changed materially: V32 now keeps payment settlement inside the original order interaction,
// and commercial confirmation/basket parsing recognizes natural Egyptian recap/compact totals
// without manufacturing product identity from unresolved media deictics.
export const PIPELINE_VERSION = 'sales-intelligence-v19';

export const ENGINE_VERSIONS = {
  caseSegmentation: 'case-segmentation-v10-payment-continuation-ambiguity-safe',
  historicalClosure: 'historical-closure-v1',
  commercialConfirmation: 'commercial-confirmation-v6-compact-total-interstitial-ack-safe',
  protocolApplicability: 'protocol-applicability-v1',
  attribution: 'attribution-v8-unresolved-product-evidence-safe',
  matching: 'matching-v3-unresolved-product-evidence-safe',
  policyEvaluation: 'policy-evaluation-v1',
} as const;

/**
 * Future-proofing placeholder for the branch/identity-mapping version folded into
 * semanticSourceHash (design doc H.0.2's own wording: "future-proofing only" — there is no real
 * branch/identity mapping versioning system yet, so this is a constant until one exists).
 */
export const BRANCH_IDENTITY_MAPPING_VERSION = 'branch-identity-mapping-v2';
