const fs=require('fs');
const failures=[];
const read=p=>fs.existsSync(p)?fs.readFileSync(p,'utf8'):(failures.push('missing '+p),'');
const evalPage=read('src/pages/StaffMonthlyEvaluationGeneral.tsx');
const report=read('src/lib/reports/monthlyPerformance360Service.ts');
const financial=read('src/lib/payroll/employeeFinancialProjection.ts');
const composition=read('src/lib/payroll/payrollFinancialCompositionService.ts');
const requestEvidence=read('src/lib/tasks/customerRequestEvidenceAdapter.ts');
const taskAdapters=read('src/lib/tasks/taskEvidenceAdapters.ts');
const evidenceReader=read('src/lib/performance/performanceTaskEvidenceService.ts');
const required=[
 [evalPage,"get_staff_monthly_evaluation_v5",'final evaluation must use V5'],
 [evalPage,'final_approval_snapshot','published evaluation must use final snapshot'],
 [report,"get_staff_monthly_evaluation_v5",'360 must not read legacy evaluation API'],
 [report,'availableWeight === 100','360 partial data must fail closed'],
 [financial,"duplicate component",'financial duplicate guard missing'],
 [composition,"finalized_snapshot_v2",'payable projection must recognize finalized snapshot'],
 [composition,"get_payroll_incentive_truth_v2",'financial projection must use canonical incentive truth'],
 [requestEvidence,"row.primary_responsible_id,row.source_assigned_staff_id",'request responsibility must require explicit owner'],
 [taskAdapters,"cairoDateBoundaryIso",'task evidence must use Cairo boundary'],
 [evidenceReader,"followup_date",'followup evidence must include date-only records'],
];
for(const [body,token,msg] of required)if(!body.includes(token))failures.push(msg);
for(const forbidden of ["get_staff_monthly_evaluation_safe","save_staff_monthly_evaluation_v3"]){if(report.includes(forbidden))failures.push('360 legacy API: '+forbidden)}
if(failures.length){console.error('Final evaluation architecture gate failed:');failures.forEach(x=>console.error('- '+x));process.exit(1)}
console.log('Final evaluation architecture gate passed.');
