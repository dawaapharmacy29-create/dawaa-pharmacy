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
if(fail.length){console.error(fail.join('\n'));process.exit(1);}console.log('manager evaluation finality architecture OK');
