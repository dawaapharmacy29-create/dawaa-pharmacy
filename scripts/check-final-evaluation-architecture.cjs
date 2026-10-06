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
const salesBundleCache=read('src/lib/evaluations/performanceSalesBundleCache.ts');
const performanceScope=read('src/lib/performance/performanceScope.ts');
const report=read('src/lib/reports/monthlyPerformance360Service.ts');
const financial=read('src/lib/payroll/employeeFinancialProjection.ts');
const composition=read('src/lib/payroll/payrollFinancialCompositionService.ts');
const requestEvidence=read('src/lib/tasks/customerRequestEvidenceAdapter.ts');
const taskAdapters=read('src/lib/tasks/taskEvidenceAdapters.ts');
const evidenceReader=read('src/lib/performance/performanceTaskEvidenceService.ts');
const monthlyEvidence=read('src/lib/staff/employeeMonthlyEvidenceService.ts');
const required=[
 [evalPage,"get_staff_monthly_evaluation_v5",'final evaluation must use V5'],
 [evalPage,'final_approval_snapshot','published evaluation must use final snapshot'],
 [evalPage,'EvaluationDecisionHeaderV1','manager decision header must be wired'],
 [evalPage,'EvaluationAxisCardV1','final evaluation must use the unified evidence-first axis card'],
 [evalPage,'FinalEvaluationReviewV1','final approval must use one canonical review surface'],
 [evalPage,'EmployeeEvaluationHeaderV1','evaluation must expose employee cycle truth header'],
 [evalPage,'evaluationRequestRef','employee switching must reject stale evaluation loads'],
 [evalPage,'staffRequestRef','staff roster loads must reject stale responses'],
 [evalPage,'evaluationLoading','evaluation details must load independently from roster'],
 [evalPage,'const pointsPromise = getStaffPointsDashboardV3','points must not block core evaluation rendering'],
 [evalPage,"const savedResult = await supabase.rpc('get_staff_monthly_evaluation_v5'",'persisted evaluation must load independently from live evidence'],
 [evalPage,"if (!['sent', 'approved'].includes(savedForEvidenceStatus)) throw evidenceCause",'draft approval remains fail-closed when live evidence is unavailable'],
 [evalPage,'setEvidenceLoadedAt(evidenceEnvelope.loadedAt)','evidence freshness must preserve the original load timestamp across cache hits'],
 [evalPage,'setSections(evaluationProfileForRole(selected.job_title || selected.role).sections);','employee switching must clear previous employee decision state immediately'],
 [evalPage,'evaluationLoadError','evaluation load failure must render an explicit state'],
 [evalPage,'!evaluationLoading && !evaluationLoadError','evaluation writes must stay disabled until current employee details are ready'],
 [evalPage,"if (evaluationLoading || evaluationLoadError)",'save and approval must reject loading or failed employee detail state'],
 [evalPage,'roleEvidenceReady','top-level readiness must include role-specific axis evidence'],
 [evalPage,'blockedAxisEvidence','blocked axes must prevent final approval'],
 [evalPage,'orderedFilteredStaff','evaluation roster must use deterministic branch/role grouping'],
 [evalPage,"['دكاترة', 'مساعدون', 'الدليفري', 'المخزن', 'خدمة العملاء', 'النظافة', 'المشتريات', 'الإدارة', 'وظائف أخرى']",'evaluation roster role order must stay explicit'],
 [evalPage,"}, [branch, cycleLabel, globalScope, managerMode, user?.id, user?.name, user?.staffId]);",'employee selection must not refetch the full roster'],
 [evalPage,"role === 'inventory_assistant'",'warehouse staff must be separated from general assistants'],
 [evalPage,"status: 'insufficient' as const",'unmapped evaluation evidence must fail closed'],
 [evalPage,'لا تُستخدم محادثات المدير الشخصية أو أرقام حضوره كبديل عن نتيجة الفريق أو الفرع.','leadership axes must not reuse personal employee evidence'],
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
 [headerService,'get_staff_evaluation_sales_summary_v3','header sales must use focused indexed evaluation summary'],
 [salesBundleCache,'get_staff_performance_sales_bundle_v1','shared performance sales reader must use canonical lightweight performance invoice truth'],
 [performanceService,'loadPerformanceSalesBundle','performance eye must use shared canonical performance sales bundle'],
 [headerService,"sourceTableUsed!=='none'",'unavailable sales source must never render as zero'],
 [headerService,"roleGroup==='doctor'",'sales truth must be scoped to pharmacist role'],
 [headerService,'overlapDays','leave requests must be clamped to evaluation cycle'],
 [performanceScope,"scope === 'assistants'",'assistants must have a canonical separate scope'],
 [performanceScope,"if (scope === 'assistants') return role === 'assistant';",'warehouse must not leak into assistant scope'],
 [report,"get_staff_monthly_evaluation_v5",'360 must not read legacy evaluation API'],
 [report,'availableWeight === 100','360 partial data must fail closed'],
 [financial,"duplicate component",'financial duplicate guard missing'],
 [composition,"finalized_snapshot_v2",'payable projection must recognize finalized snapshot'],
 [composition,"get_payroll_incentive_truth_v2",'financial projection must use canonical incentive truth'],
 [requestEvidence,"row.primary_responsible_id,row.source_assigned_staff_id",'request responsibility must require explicit owner'],
 [taskAdapters,"cairoDateBoundaryIso",'task evidence must use Cairo boundary'],
 [evidenceReader,"followup_date",'followup evidence must include date-only records'],
 [monthlyEvidence,'taskEvidencePromise','task evidence must load in parallel with monthly evidence'],
 [evalPage,'role: selected.job_title || selected.role','monthly evidence must receive canonical employee role scope'],
];
for(const [body,token,msg] of required)if(!body.includes(token))failures.push(msg);
if(headerService.includes('getStaffCycleSales'))failures.push('evaluation header must not fall back to legacy heavy staff cycle sales truth');
if(headerService.includes('loadPerformanceSalesBundle')||headerService.includes('get_staff_performance_sales_bundle_v1'))failures.push('evaluation header must stay on focused summary and not load the detailed performance bundle');
for(const forbidden of ["get_staff_monthly_evaluation_safe","save_staff_monthly_evaluation_v3"]){if(report.includes(forbidden))failures.push('360 legacy API: '+forbidden)}
if(failures.length){console.error('Final evaluation architecture gate failed:');failures.forEach(x=>console.error('- '+x));process.exit(1)}
console.log('Final evaluation architecture gate passed.');
