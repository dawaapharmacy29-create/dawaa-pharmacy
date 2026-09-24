// Sales Intelligence Phase H.1B — persistence version constants.
//
// Single place every writer/hasher reads its own version string from, so a future engine change
// bumps exactly one constant here rather than a magic string scattered across writer files. These
// are INDEPENDENT of any git SHA (design doc H.0.1 §8) — each one only changes when the engine it
// names actually changes in a way that should trigger the reprocessing scope
// REPROCESSING_MATRIX assigns it (see persistence/types.ts).
export const PIPELINE_VERSION = 'sales-intelligence-v1';

export const ENGINE_VERSIONS = {
  caseSegmentation: 'case-segmentation-v4-trusted-timeline',
  historicalClosure: 'historical-closure-v1',
  commercialConfirmation: 'commercial-confirmation-v1',
  protocolApplicability: 'protocol-applicability-v1',
  attribution: 'attribution-v3-official-corroboration',
  matching: 'matching-v1',
  policyEvaluation: 'policy-evaluation-v1',
} as const;

/**
 * Future-proofing placeholder for the branch/identity-mapping version folded into
 * semanticSourceHash (design doc H.0.2's own wording: "future-proofing only" — there is no real
 * branch/identity mapping versioning system yet, so this is a constant until one exists).
 */
export const BRANCH_IDENTITY_MAPPING_VERSION = 'branch-identity-mapping-v2';
