// Sales Intelligence Phase H.1B — policy-evaluation (sales_intelligence_policy_evaluations) writer.
//
// H.1B instruction #9's decision (documented here, the single place this policy is implemented):
// "no current policy_config row => no policy_evaluation row is persisted at all" — NEVER a
// `not_enforced` evaluation invented against a made-up config. This is forced by the schema itself
// (policy_config_id is NOT NULL with a real FK — there is no config row to reference) and matches
// H.1B's "never create invisible policy semantics" rule: skipping the row is visible (the caller
// gets an explicit `skipped: true` result to report/warn on), whereas fabricating a disabled config
// id would not be. A dry-run plan surfaces this as a warning (see batchPersistenceService.ts), never
// a silent no-op.
import { computePolicyInputHash } from './hashing';
import { mapPolicyEvaluationRowContent } from './mappers';
import type { SalesIntelligenceCaseAnalysis } from '../types';

export interface CurrentPolicyConfig {
  policyConfigId: string;
  policyConfigVersion: number;
  protocolPolicyEffectiveAt: string | null;
}

/** Reads the single current (is_current=true) policy_config row, or null when none exists yet. */
export async function fetchCurrentPolicyConfig(supabaseClient: any): Promise<CurrentPolicyConfig | null> {
  const { data, error } = await supabaseClient
    .from('sales_intelligence_policy_config')
    .select('policy_config_id, policy_config_version, protocol_policy_effective_at')
    .eq('is_current', true)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    policyConfigId: data.policy_config_id,
    policyConfigVersion: data.policy_config_version,
    protocolPolicyEffectiveAt: data.protocol_policy_effective_at,
  };
}

export type PersistPolicyEvaluationResult =
  | { skipped: true; reason: 'no_current_policy_config' }
  | {
      skipped: false;
      policyEvaluationId: string;
      evaluationVersion: number;
      isCurrent: boolean;
      isNew: boolean;
      policyInputHash: string;
    };

export async function persistPolicyEvaluation(
  supabaseClient: any,
  analysisId: string,
  caseId: string,
  analysis: SalesIntelligenceCaseAnalysis,
  currentPolicyConfig: CurrentPolicyConfig | null
): Promise<PersistPolicyEvaluationResult> {
  if (!currentPolicyConfig) return { skipped: true, reason: 'no_current_policy_config' };

  const content = mapPolicyEvaluationRowContent(analysis, currentPolicyConfig.protocolPolicyEffectiveAt);
  const policyInputHash = await computePolicyInputHash({
    protocolApplicability: content.protocolApplicability,
    caseEndedAt: analysis.conversationCase.endedAt,
    policyConfigId: currentPolicyConfig.policyConfigId,
  });

  const { data, error } = await supabaseClient.rpc('sales_intelligence_write_policy_evaluation', {
    p_analysis_id: analysisId,
    p_row: {
      case_id: caseId,
      policy_config_id: currentPolicyConfig.policyConfigId,
      policy_config_version: currentPolicyConfig.policyConfigVersion,
      protocol_policy_effective_at: content.protocolPolicyEffectiveAt,
      protocol_applicability: content.protocolApplicability,
      protocol_policy_compliance: content.protocolPolicyCompliance,
      policy_input_hash: policyInputHash,
    },
  });
  if (error) throw error;

  return {
    skipped: false,
    policyEvaluationId: data.policy_evaluation_id,
    evaluationVersion: data.evaluation_version,
    isCurrent: data.is_current,
    isNew: data.is_new,
    policyInputHash,
  };
}
