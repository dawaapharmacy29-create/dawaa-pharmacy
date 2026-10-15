import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

// Regression for the Production smoke finding: one failing weekly-evaluation read was retried
// against v5 -> v4 -> v3 -> v2 -> legacy generations (up to 5 × 15s statement timeouts).

const gateway = () =>
  fs.readFileSync(path.join(process.cwd(), 'src/lib/evaluations/evaluationMetricsGateway.ts'), 'utf8');

describe('weekly evaluation canonical RPC contract', () => {
  it('calls exactly one canonical generation per read', () => {
    const source = gateway();
    expect(source).toContain("'calculate_weekly_manager_metrics_v5'");
    expect(source).toContain("'calculate_weekly_checklist_completion_v4'");
    expect((source.match(/supabase\.rpc\(/g) || []).length).toBe(2);
  });

  it('never falls back to older generations', () => {
    const source = gateway();
    for (const legacy of [
      'calculate_weekly_manager_metrics_v4',
      'calculate_weekly_manager_metrics_v3',
      'calculate_weekly_manager_metrics_v2',
      "'calculate_weekly_manager_metrics'",
      'calculate_weekly_checklist_completion_v3',
      'calculate_weekly_checklist_completion_v2',
      "'calculate_weekly_checklist_completion'",
    ]) {
      expect(source.includes(legacy)).toBe(false);
    }
    expect(/fallback/i.test(source.replace(/never retried against older RPC generations/g, ''))).toBe(false);
  });
});
