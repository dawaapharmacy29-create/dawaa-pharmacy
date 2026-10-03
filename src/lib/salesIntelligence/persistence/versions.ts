// Sales Intelligence Phase H.1B — persistence version constants.
//
// Single place every writer/hasher reads its own version string from, so a future engine change
// bumps exactly one constant here rather than a magic string scattered across writer files. These
// are INDEPENDENT of any git SHA (design doc H.0.1 §8) — each one only changes when the engine it
// names actually changes in a way that should trigger the reprocessing scope
// REPROCESSING_MATRIX assigns it (see persistence/types.ts).
// v8 (STEP 7A): production runtime context — canonical staffIdBySender feeds attribution and V32
// staff senders; the pre-pass and the run share one base input.
export const PIPELINE_VERSION = 'sales-intelligence-v12';

export const ENGINE_VERSIONS = {
  caseSegmentation: 'case-segmentation-v8-semantic-continuation-courtesy-safe',
  historicalClosure: 'historical-closure-v1',
  commercialConfirmation: 'commercial-confirmation-v4-natural-arabic-basket-quantities',
  protocolApplicability: 'protocol-applicability-v1',
  attribution: 'attribution-v7-auto-code-name-time-items',
  matching: 'matching-v2-line-item-evidence',
  policyEvaluation: 'policy-evaluation-v1',
} as const;

/**
 * Future-proofing placeholder for the branch/identity-mapping version folded into
 * semanticSourceHash (design doc H.0.2's own wording: "future-proofing only" — there is no real
 * branch/identity mapping versioning system yet, so this is a constant until one exists).
 */
export const BRANCH_IDENTITY_MAPPING_VERSION = 'branch-identity-mapping-v2';
