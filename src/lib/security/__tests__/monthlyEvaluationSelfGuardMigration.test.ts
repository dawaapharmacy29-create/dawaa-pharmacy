import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath =
  'supabase/migrations/20260827054500_monthly_evaluation_actor_subject_guard.sql';

function sql() {
  return readFileSync(migrationPath, 'utf8').toLowerCase();
}

describe('monthly evaluation actor/subject boundary', () => {
  it('excludes the evaluator from the monthly evaluation subject list', () => {
    const source = sql();
    expect(source).toContain('v_actor.staff_id is null or s.id <> v_actor.staff_id');
  });

  it('rejects self evaluation again at the write boundary', () => {
    const source = sql();
    expect(source).toContain('v_staff_id = v_actor.staff_id');
    expect(source).toContain("raise exception 'لا يمكن للموظف تقييم نفسه شهريًا'");
  });

  it('keeps branch managers inside their own branch and away from manager/service subjects', () => {
    const source = sql();
    expect(source).toContain("coalesce(v_target.branch,'')<>v_actor.branch");
    expect(source).toContain("branch_manager|customer_service|خدمة العملاء");
  });

  it('removes PUBLIC execute and grants only the app roles used by the existing custom auth path', () => {
    const source = sql();
    expect(source).toContain(
      'revoke all on function public.save_staff_monthly_evaluation_safe(uuid,jsonb) from public'
    );
    expect(source).toContain(
      'grant execute on function public.save_staff_monthly_evaluation_safe(uuid,jsonb) to anon, authenticated, service_role'
    );
  });
});
