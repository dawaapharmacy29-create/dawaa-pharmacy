const fs=require('fs');const path=require('path');const root=path.resolve(__dirname,'..');const fail=[];
function must(file,tokens){const p=path.join(root,file);if(!fs.existsSync(p)){fail.push('missing '+file);return;}const s=fs.readFileSync(p,'utf8');for(const t of tokens)if(!s.includes(t))fail.push(file+' missing '+t);}
must('supabase/migrations/20261005154000_manager_evaluation_final_immutability_v5.sql',[
  'manager_evaluation_final_decision_immutable','before update or delete',"old.status='submitted'"
]);
must('supabase/migrations/20261005155000_manager_incentive_canonical_provenance_v5.sql',[
  'dawaa_manager_evaluation_is_canonical_v5',"'__server_validated_at'",
  'revoke all on function public.settle_manager_evaluation_incentive() from public,anon,authenticated'
]);
must('supabase/migrations/20261005152000_manager_evaluation_canonical_save_v5.sql',[
  'manager_evaluation_final_decision_immutable',"'data_coverage'",'dawaa_manager_evaluation_objective_v5'
]);
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
if(fail.length){console.error(fail.join('\n'));process.exit(1);}console.log('manager evaluation finality architecture OK');
