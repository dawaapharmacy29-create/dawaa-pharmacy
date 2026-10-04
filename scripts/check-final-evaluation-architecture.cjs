const fs=require('fs');
const failures=[];
const read=p=>fs.existsSync(p)?fs.readFileSync(p,'utf8'):(failures.push('missing '+p),'');
const evalPage=read('src/pages/StaffMonthlyEvaluationGeneral.tsx');
const decisionHeader=read('src/components/evaluations/EvaluationDecisionHeaderV1.tsx');
const workflow=read('src/components/evaluations/MonthlyEvaluationWorkflowV5.tsx');
const axisCard=read('src/components/evaluations/EvaluationAxisCardV1.tsx');
const finalReview=read('src/components/evaluations/FinalEvaluationReviewV1.tsx');
const employeeHeader=read('src/components/evaluations/EmployeeEvaluationHeaderV1.tsx');
const headerService=read('src/lib/evaluations/employeeEvaluationHeaderService.ts');
const performanceScope=read('src/lib/performance/performanceScope.ts');
const report=read('src/lib/reports/monthlyPerformance360Service.ts');
const financial=read('src/lib/payroll/employeeFinancialProjection.ts');
const composition=read('src/lib/payroll/payrollFinancialCompositionService.ts');
const requestEvidence=read('src/lib/tasks/customerRequestEvidenceAdapter.ts');
const taskAdapters=read('src/lib/tasks/taskEvidenceAdapters.ts');
const evidenceReader=read('src/lib/performance/performanceTaskEvidenceService.ts');
const required=[
 [evalPage,"get_staff_monthly_evaluation_v5",'final evaluation must use V5'],
 [evalPage,'final_approval_snapshot','published evaluation must use final snapshot'],
 [evalPage,'EvaluationDecisionHeaderV1','manager decision header must be wired'],
 [evalPage,'EvaluationAxisCardV1','final evaluation must use the unified evidence-first axis card'],
 [evalPage,'FinalEvaluationReviewV1','final approval must use one canonical review surface'],
 [evalPage,'EmployeeEvaluationHeaderV1','evaluation must expose employee cycle truth header'],
 [evalPage,'evaluationRequestRef','employee switching must reject stale evaluation loads'],
 [evalPage,'orderedFilteredStaff','evaluation roster must use deterministic branch/role grouping'],
 [evalPage,"role === 'inventory_assistant'",'warehouse staff must be separated from general assistants'],
 [evalPage,'blockers={approvalBlockers}','workflow must receive canonical approval blockers'],
 [decisionHeader,'أسباب منع الاعتماد','decision header must expose approval blockers'],
 [workflow,'المطلوب قبل الاعتماد','workflow must surface blockers'],
 [axisCard,'الدليل يبرر القرار ولا ينشئ درجة تلقائية','axis card must preserve evidence/decision boundary'],
 [axisCard,"evidenceUnavailable",'axis card must expose unavailable evidence state'],
 [axisCard,'الدرجة الضعيفة لا تُعتمد بدون سبب مكتوب','weak score must require explanation'],
 [axisCard,'evidenceBlocksDecision','incomplete evidence must block axis decision'],
 [finalReview,'كل شروط الاعتماد مكتملة','final review must expose readiness'],
 [finalReview,"incentiveSettled",'final review must distinguish settled from current incentive'],
 [employeeHeader,'مبيعات الدورة','employee header must expose cycle sales'],
 [employeeHeader,'ساعات العمل','employee header must expose worked hours'],
 [employeeHeader,'الإجازة الأسبوعية','employee header must expose weekly off days'],
 [employeeHeader,"s.roleGroup==='doctor'",'sales/conversation header must be role-aware'],
 [employeeHeader,'permissionMinutes','employee header must expose permission duration'],
 [headerService,'getStaffAttendanceDetail','header must use canonical attendance detail'],
 [headerService,'getAnnualLeaveBalanceV1','header must use canonical annual leave balance'],
 [headerService,'loadStaffPerformanceProfile','header sales must use canonical staff profile'],
 [headerService,"roleGroup==='doctor'",'sales truth must be scoped to pharmacist role'],
 [headerService,'overlapDays','leave requests must be clamped to evaluation cycle'],
 [performanceScope,"scope === 'assistants'",'assistants must have a canonical separate scope'],
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
