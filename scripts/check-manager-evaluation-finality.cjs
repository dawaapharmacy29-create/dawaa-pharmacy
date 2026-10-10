const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const failures = [];
const read = (file) => {
  const fullPath = path.join(root, file);
  if (!fs.existsSync(fullPath)) {
    failures.push(`missing ${file}`);
    return '';
  }
  return fs.readFileSync(fullPath, 'utf8');
};
const must = (file, tokens) => {
  const source = read(file);
  for (const token of tokens) {
    if (!source.includes(token)) failures.push(`${file} missing ${token}`);
  }
};

const canonicalSave = read('supabase/migrations/20261005152000_manager_evaluation_canonical_save_v5.sql');
const managerEvaluationService = read('src/lib/evaluations/managerEvaluationService.ts');
for (const token of [
  'create or replace function public.save_manager_weekly_evaluation_v5(p_payload jsonb)',
  "v_status text:=coalesce(nullif(trim(p_payload->>'status'),''),'draft')",
  'public.dawaa_manager_evaluation_objective_v5',
  "if v_status not in ('draft','submitted')",
  'insert into public.manager_weekly_evaluations(',
  'week_start,week_end,auto_metrics,manual_scores,manual_note,total_score,status,submitted_at,updated_at',
  "'submitted'",
  'revoke insert,update,delete on public.manager_weekly_evaluations from anon,authenticated',
]) {
  if (!canonicalSave.includes(token)) failures.push(`canonical manager save migration missing ${token}`);
}
if (!/grant execute on function public\.save_manager_weekly_evaluation_v5\(jsonb\) to authenticated,service_role/i.test(canonicalSave)) {
  failures.push('canonical manager save RPC must be executable only by authorized application roles');
}
if (!/\.rpc\(\s*['"]save_manager_weekly_evaluation_v5['"]/.test(managerEvaluationService)) {
  failures.push('managerEvaluationService must call the canonical save_manager_weekly_evaluation_v5 RPC');
}
if (/\.from\(TABLES\.managerWeeklyEvaluations\)\s*\.upsert\(/.test(managerEvaluationService)) {
  failures.push('managerEvaluationService must not upsert manager_weekly_evaluations directly after the canonical-save migration revokes browser writes');
}

const finalImmutability = read('supabase/migrations/20261005154000_manager_evaluation_final_immutability_v5.sql');
for (const token of [
  'create or replace function public.trg_manager_evaluation_final_immutable_v5()',
  "old.status='submitted'",
  'manager_evaluation_final_decision_immutable',
  'before update or delete on public.manager_weekly_evaluations',
  'execute function public.trg_manager_evaluation_final_immutable_v5()',
]) {
  if (!finalImmutability.includes(token)) failures.push(`manager finality migration missing ${token}`);
}

const payrollSettlement = read('supabase/migrations/20260830200000_payroll_incentive_truth_v2_and_manager_cycle_fix.sql');
for (const token of [
  'create or replace function public.settle_manager_evaluation_incentive()',
  "where e.status='submitted'",
  'from public.manager_weekly_evaluations e',
  'insert into public.employee_transactions(',
  "'manager_evaluation_settlement'",
]) {
  if (!payrollSettlement.includes(token)) failures.push(`manager payroll settlement source missing ${token}`);
}

must('supabase/migrations/20261005156000_doctor_cs_evaluation_final_immutability_v5.sql',[
  'doctor_cs_evaluation_final_decision_immutable','before update or delete',"old.status in ('sent','approved')"
]);
must('supabase/migrations/20261005158000_monthly_evaluation_snapshot_contract_v5.sql',[
  "'server_evidence'", "'server_evidence_snapshot'", "'final_approval_hash_algorithm','sha256'",
  'monthly_evaluation_server_evidence_unavailable'
]);
must('supabase/migrations/20261005159000_monthly_evaluation_final_decision_immutability_v5.sql',[
  'monthly_evaluation_final_decision_immutable',"old.status in ('sent','approved')",'before update or delete'
]);
must('supabase/migrations/20261005161000_payroll_points_evaluation_multiplier_truth_v5.sql',[
  'v_points_after_evaluation',
  "greatest(0,coalesce(t.final_incentive_egp,0)-coalesce(t.competition_bonus_egp,0))",
  'v_points_after_evaluation + v_competition_bonus'
]);
must('supabase/migrations/20261005160000_monthly_evaluation_snapshot_verification_v5.sql',[
  'dawaa_verify_monthly_evaluation_snapshot_v5','legacy_unverified','extensions.digest'
]);
if (failures.length) {
  console.error('Manager evaluation finality architecture check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Manager evaluation finality architecture check passed.');
