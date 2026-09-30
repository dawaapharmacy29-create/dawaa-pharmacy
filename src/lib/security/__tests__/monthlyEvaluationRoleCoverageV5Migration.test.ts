import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const path = 'supabase/migrations/20260930123000_monthly_evaluation_role_coverage_v5.sql';
const sql = () => readFileSync(path, 'utf8').toLowerCase();

describe('monthly evaluation V5 role coverage', () => {
  it('covers real operating role aliases', () => {
    const source = sql();
    for (const role of [
      'مساعد','shift supervisor morning','shift supervisor evening',
      'مسئولة شيفت صباحي','مسئول شيفت مسائي',
      'branch manager shamy','branch manager shokry',
      'خدمة العملاء','مندوب توصيل',
    ]) expect(source).toContain(role);
  });

  it('uses canonical role truth instead of fragile supported-role regexes', () => {
    const source = sql();
    expect(source).toContain("dawaa_monthly_evaluation_canonical_role_v5(coalesce(s.role,s.type,'')) <> 'other'");
    expect(source).toContain("dawaa_monthly_evaluation_canonical_role_v5(coalesce(v_target.role,v_target.type,'')) = 'other'");
  });

  it('uses the same branch-manager subject guard across list/save/read/audit/response paths', () => {
    const source = sql();
    expect((source.match(/dawaa_monthly_evaluation_branch_manager_subject_allowed_v5/g) || []).length).toBeGreaterThanOrEqual(7);
  });
});
