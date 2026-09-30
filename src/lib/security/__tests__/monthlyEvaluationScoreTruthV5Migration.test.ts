import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath =
  'supabase/migrations/20260930113000_monthly_evaluation_score_truth_v5.sql';

function sql() {
  return readFileSync(migrationPath, 'utf8').toLowerCase();
}

describe('monthly evaluation V5 score/incentive truth migration', () => {
  it('locks section keys and weights to the canonical role profile', () => {
    const source = sql();
    expect(source).toContain('monthly_evaluation_profile_section_set_mismatch');
    expect(source).toContain('monthly_evaluation_canonical_weight_mismatch');
    expect(source).toContain('"discipline":15,"conversations":20,"dispensing":20');
    expect(source).toContain('"daily_stars":35,"checklist":25');
  });

  it('recomputes score and grade on the server and zeros legacy monetary fields', () => {
    const source = sql();
    expect(source).toContain('new.overall_score := v_overall');
    expect(source).toContain('new.grade := v_grade');
    expect(source).toContain('new.suggested_incentive := 0');
    expect(source).toContain('new.approved_incentive := 0');
    expect(source).toContain('new.points_delta := 0');
    expect(source).toContain('monthly_evaluation_section_score_must_be_integer_star');
  });

  it('accepts only the five documented critical gates and rejects duplicates', () => {
    const source = sql();
    for (const gate of [
      'unexplained_cash_shortage',
      'data_manipulation',
      'ignored_serious_complaint',
      'unescalated_critical_issue',
      'repeated_negligence',
    ]) {
      expect(source).toContain(gate);
    }
    expect(source).toContain('invalid_monthly_evaluation_critical_gate');
    expect(source).toContain('duplicate_monthly_evaluation_critical_gate');
  });

  it('retires legacy fixed-point critical-gate penalties without rewriting finalized payroll', () => {
    const source = sql();
    expect(source).toContain("t.source='monthly_evaluation_critical_gate'");
    expect(source).toContain("status='cancelled'");
    expect(source).toContain('replaced_by_monthly_evaluation_multiplier_v5');
    expect(source).toContain('payroll_finalized_snapshots_v2');
    expect(source).toContain('legacy_monthly_evaluation_critical_gate_points_retired');
  });
});
