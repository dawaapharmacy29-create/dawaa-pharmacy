import { describe, expect, it } from 'vitest';
import {
  isLeadershipEvaluationRole,
  leadershipEvidenceIsSufficient,
  leadershipEvidenceRequirement,
} from '@/lib/evaluations/monthlyLeadershipEvidence';

describe('monthly leadership evidence contract', () => {
  it('maps branch-manager sections to branch-level evidence instead of personal evidence', () => {
    const requirement = leadershipEvidenceRequirement('branch_manager', 'operations');
    expect(requirement?.scope).toBe('branch');
    expect(requirement?.requiredSignals).toContain('inventory_health');
    expect(requirement?.requiredSignals).toContain('invoice_quality');
  });

  it('uses customer-service team outcomes for the customer-service manager', () => {
    const requirement = leadershipEvidenceRequirement('customer_service_manager', 'followups_sla');
    expect(requirement?.scope).toBe('customer_service_team');
    expect(requirement?.requiredSignals).toEqual(expect.arrayContaining(['followup_volume', 'on_time_rate', 'overdue_followups']));
  });

  it('reports exactly which leadership signals are still missing', () => {
    const requirement = leadershipEvidenceRequirement('branch_manager', 'execution');
    expect(requirement).not.toBeNull();
    const result = leadershipEvidenceIsSufficient(requirement!, ['assigned_actions', 'closed_actions']);
    expect(result.sufficient).toBe(false);
    expect(result.missingSignals).toEqual(['overdue_actions']);
  });

  it('does not classify ordinary individual roles as leadership evaluation roles', () => {
    expect(isLeadershipEvaluationRole('doctor')).toBe(false);
    expect(isLeadershipEvaluationRole('delivery')).toBe(false);
    expect(isLeadershipEvaluationRole('branch_manager')).toBe(true);
  });
});
