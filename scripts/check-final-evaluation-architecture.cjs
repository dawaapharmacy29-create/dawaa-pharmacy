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
const headerSalesV3Migration=read('supabase/migrations/20261006033000_staff_evaluation_sales_summary_v3.sql');
const performanceService=read('src/lib/evaluations/doctorPerformanceIntelligenceService.ts');
const performanceEye=read('src/components/evaluations/DoctorPerformanceEye.tsx');
const performanceVerdict=read('src/lib/evaluations/doctorPerformanceVerdict.ts');
const decisionEngine=read('src/lib/evaluations/doctorDecisionIntelligence.ts');
const decisionData=read('src/lib/evaluations/doctorDecisionDataService.ts');
const decisionChart=read('src/components/evaluations/DoctorPerformanceChart.tsx');
const eyeChartModel=read('src/lib/evaluations/doctorEyeChartModel.ts');
const reconciliationMigration=read('supabase/migrations/20261009090000_doctor_sales_reconciliation_v1.sql');
const branchWindowMigration=read('supabase/migrations/20261009090000_doctor_sales_reconciliation_v1.sql');
const performanceBundleFreshnessMigration=read('supabase/migrations/20261007090000_performance_sales_bundle_v1_freshness_index.sql');
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
 [headerSalesV3Migration,'get_staff_evaluation_sales_summary_v3','focused evaluation sales summary v3 must have a canonical replayable migration'],
 [headerSalesV3Migration,'security invoker','focused evaluation sales summary v3 must remain invoker-safe'],
 [salesBundleCache,'get_staff_performance_sales_bundle_v1','shared performance sales reader must use canonical lightweight performance invoice truth'],
 [performanceService,'loadPerformanceSalesBundle','performance eye must use shared canonical performance sales bundle'],
 [evalPage,'endExclusive: endDateExclusive','header sales must include the full last cycle day through an exclusive bound'],
 [headerService,'getEvaluationHeaderSales(args.staffId,args.start,args.endExclusive)','header sales RPC must receive the exclusive cycle end, not the inclusive last day'],
 [performanceService,'describeSourceProblem','performance eye must state the specific failure kind (timeout, permission, network, not enabled) instead of a vague unavailable state'],
 [performanceService,'loadDoctorPerformanceEvidence','performance eye drill-down must read through the service boundary'],
 [performanceEye,'buildDoctorPerformanceVerdict','performance eye must open on the decision summary, not the full report'],
 [performanceEye,'hidden={!detailsOpen}','performance eye details must stay collapsed until requested'],
 [evalPage,'conversation={coaching?.conversation ?? null}','performance eye must reuse the page conversation evidence instead of a parallel reader'],
 [performanceVerdict,"header?.attendance.state === 'available'",'performance eye discipline must come from the canonical evaluation header attendance'],
 [performanceEye,'loadDoctorDecisionSources','performance eye must load branch decision evidence through the decision data boundary'],
 [decisionData,"get_branch_doctor_performance_window_v1",'branch comparisons must use the branch-scoped aggregate RPC, not invoice rows'],
 [decisionData,'buildConversationCoaching','peer conversation quality must use the canonical evaluation rubric'],
 [decisionEngine,'leave-one-out','fair productivity must use leave-one-out branch shift rates'],
 [decisionEngine,"present: null",'missing evidence must stay unknown, never become "no problem"'],
 [branchWindowMigration,'dawaa_current_sales_invoice_scope_v1','branch window must keep actor sales scope authorization'],
 [branchWindowMigration,'get_staff_attendance_detail_v2','branch window attendance counts must come from the canonical attendance projection'],
 [branchWindowMigration,"o.owners = 1 then 'unique_name' else 'ambiguous_name'",'branch window must refuse ambiguous name attribution'],
 [performanceEye,'hasSourceFailure','performance eye must retry a result with failed sources instead of pinning it'],
 [performanceEye,'invalidatePerformanceSalesBundleCache','performance eye reload must bypass the shared sales bundle cache'],
 [decisionData,'sourceProblem','decision sources must classify failures through the source-state contract (not_enabled / failed + logged diagnostic)'],
 [decisionEngine,"availability: 'ready'",'decision engine must mark when a comparison is actually ready'],
 [decisionEngine,'unavailableDecision','a missing or insufficient branch source must produce a neutral result with no decision'],
 [performanceEye,"availability === 'ready'",'performance eye must render verdicts and decisions only from a ready comparison'],
 [performanceBundleFreshnessMigration,"(select max(si.invoice_date) from public.sales_invoices si",'performance sales bundle freshness must stay an index-friendly scalar max'],
 [performanceBundleFreshnessMigration,'dawaa_assert_staff_sales_scope_v1','performance sales bundle must keep actor scope authorization'],
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
if(/ممتاز|يحتاج تدخل|\bscore\s*:/.test(performanceVerdict.replace(/\/\*[\s\S]*?\*\//g,'')))failures.push('performance eye verdict must stay an evidence reading, never a parallel evaluation grade');
for(const [label,body] of [['decision engine',decisionEngine],['decision chart',decisionChart],['performance eye',performanceEye]]){
 if(/(^|[\s'"`(])(خصم|الخصم|عقوبة|العقوبة|عقوبات|جزاء|الجزاء|جزاءات)(?=[\s'"`.,،)]|$)|penalt/i.test(body.replace(/\/\*[\s\S]*?\*\//g,'')))failures.push(label+' must never recommend deductions or penalties');
 if(body.includes('supabase.from(')||body.includes('supabase.rpc('))failures.push(label+' must not query Supabase directly');
}
if(/(^|[^_\w])score\s*:(?!\s*number)/.test(decisionEngine.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'').replace(/_score/g,'')))failures.push('decision engine must not emit a score that competes with the monthly evaluation');
if(performanceEye.includes("supabase.from("))failures.push('performance eye UI must not query tables directly; use the performance service boundary');
if(decisionData.includes('describeSourceError'))failures.push('decision sources must not surface raw PostgREST error text; use the source-state contract');
if(!performanceEye.includes('{x.reason}'))failures.push('decision source status must show the plain-language reason');
// Every Eye error path shows plain language; technical detail goes to the diagnostic log only.
{
 // The doctor's own chart tabs must never disappear with the branch comparison (the Preview bug: chart gated on `ready`).
 const chartLine=performanceEye.split('\n').find(l=>l.includes('<DoctorPerformanceChart'))||'';
 if(!chartLine)failures.push('performance eye must render the four-tab performance chart');
 if(/\bready\b|availability/.test(chartLine))failures.push('performance eye chart must not be gated on the branch comparison being ready');
 if(!performanceEye.includes('buildEyeChartModel('))failures.push('performance eye chart must be built by the pure chart model');
 for(const key of ["'trend'","'shifts'","'peers'","'sources'"])if(!eyeChartModel.includes(key))failures.push('performance eye chart must keep the '+key+' tab');
 if(!/defaultMetric = metrics\.find\(m => m\.available && !m\.context\)/.test(eyeChartModel)||!/key: 'salesPerCalendarDay'[^\n]*context: true/.test(eyeChartModel))failures.push('doctor productivity must be per attendance day; the calendar-day average is context only and never the default');
 if(!performanceService.includes('verifiedConversion(')||!performanceService.includes('comparableProductivity('))failures.push('doctor conversion and per-hour productivity must come from the shared sales reconciliation');
 if(/salesPresentDays|m\.sales \/ (?!m\.salesDays)/.test(eyeChartModel))failures.push('doctor productivity must never divide total sales (including days without a punch) by attendance days');
 if(!/get_branch_doctor_performance_window_v1[\s\S]*dawaa_doctor_sales_reconciliation_v1/.test(reconciliationMigration))failures.push('peer comparison must be built on the same sales reconciliation as the doctor eye');
 if(/\?\?\s*0\b|\|\|\s*0\)\s*\/|value:\s*0\b/.test(eyeChartModel))failures.push('performance eye chart model must keep unknown values null, never zero');
}
{
 // Reconciliation migration safety: read-only over existing data, proven devices only, no stored-branch fallback,
 // conversion strictly after the conversation, branch-scoped callers, internal functions not exposed.
 const m=reconciliationMigration.replace(/--.*$/gm,'');
 const writes=[...m.matchAll(/\b(insert\s+into|update|delete\s+from|truncate|alter\s+table|drop\s+\w+)\s+(public\.)?(\w+)/gi)].map(x=>x[3].toLowerCase()).filter(t=>t!=='biometric_device_branches'&&t!=='if');
 if(writes.length)failures.push('reconciliation migration must not write to existing tables: '+[...new Set(writes)].join(', '));
 const seeded=[...m.matchAll(/\('([^']+)',\s*'فرع/g)].map(x=>x[1]).sort().join(',');
 if(seeded!=='101,102,GED7242701315,GED7242701324')failures.push('device registry must hold only devices with proven branches (got '+seeded+')');
 if(/coalesce\(\(\s*select db\.branch[\s\S]{0,400}?\),\s*a\.branch\)/.test(m)||!m.includes("'unproven'"))failures.push('attendance branch must come from the punching device, never from the stored home branch');
 if(/abs\(extract\(epoch from \(si\.invoice_date/.test(m)||!m.includes("si.invoice_date >= rv.at_ts and si.invoice_date <= rv.at_ts + interval '48 hours'")||!m.includes('coalesce(r.first_customer_message_at, r.conversation_date, r.created_at) at_ts'))failures.push('a converted review must match an invoice from the customer\'s first message to 48h after it');
 if(!/v_branch := case when v_scope = 'ALL' then null else v_scope end/.test(m))failures.push('branch-scoped callers must only read their own branch in the reconciliation');
 for(const fn of ['dawaa_doctor_attendance_days_v1','dawaa_doctor_sales_reconciliation_v1']){
  if(!new RegExp('revoke all on function public\\.'+fn+'\\([^)]*\\) from public, anon, authenticated').test(m)||new RegExp('grant execute on function public\\.'+fn).test(m))failures.push(fn+' must not be callable by API roles');
 }
 const definers=(m.match(/security definer/gi)||[]).length,paths=(m.match(/set search_path to 'public', 'pg_catalog'/g)||[]).length;
 if(definers!==paths)failures.push('every SECURITY DEFINER function in the reconciliation migration must pin search_path');
 const rb=read('supabase/sql/ROLLBACK_20261009_doctor_sales_reconciliation_v1.sql');
 if(require('fs').existsSync(require('path').join(__dirname,'..','supabase/migrations/20261008090000_branch_doctor_performance_window_v1.sql')))failures.push('the superseded peer-comparison migration 20261008090000 must not be applied');
 const rbDrops=[...rb.matchAll(/drop\s+(function|table)\s+if exists\s+public\.(\w+)/gi)].map(x=>x[2]).sort().join(',');
 if(rbDrops!=='biometric_device_branches,dawaa_doctor_attendance_days_v1,dawaa_doctor_sales_reconciliation_v1,get_branch_doctor_performance_window_v1,get_doctor_sales_reconciliation_v1')failures.push('reconciliation rollback must drop only the objects the migration created');
}
{
 // Staff sales branch-scope fix: both sales readers filter by the caller's readable branch, the helper is internal,
 // the migration refuses to run over drifted definitions, and the rollback restores them byte for byte.
 const sm=read('supabase/migrations/20261009190000_staff_sales_branch_scope_v1.sql');
 const srb=read('supabase/sql/ROLLBACK_20261009_staff_sales_branch_scope_v1.sql');
 const expectedRestores={
  get_staff_performance_sales_bundle_v1:['e2a969672242f7d2686c15c315a1b6be','91118e3b896c11f94e5e87b12a7e2f8e'],
  get_staff_evaluation_sales_summary_v3:['4cfce7577cb7ef6062a4aad1b91a2179'],
  get_staff_invoice_truth_read_v1:['257ffb1c5253fe2536d76c612ad0a1f7'],
 };
 const restoreNames=new Set([...srb.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g)].map(x=>x[1]));
 if(Object.entries(expectedRestores).some(([name,hashes])=>!restoreNames.has(name)||hashes.some(hash=>!sm.includes(hash))||!srb.includes(name)))failures.push('staff sales scope migration and rollback must cover all reviewed function baselines');
 if((sm.match(/sc\.branch is null or public\.dawaa_customer_request_branch_key\(coalesce\(nullif\(btrim\(si\.branch_name\)/g)||[]).length<2||(sm.match(/v_scope is null or public\.dawaa_customer_request_branch_key\(coalesce\(nullif\(btrim\(si\.branch_name\)/g)||[]).length<4)failures.push('every sales read in the bundle and evaluation summary must be limited to the caller\'s readable branch');
 if(!/revoke all on function public\.dawaa_staff_sales_read_branch_v1\(uuid\) from public, anon, authenticated/.test(sm))failures.push('the sales read-branch helper must not be callable by API roles');
 if(!performanceService.includes('salesScopeBranch')||!performanceEye.includes('data?.salesScopeBranch'))failures.push('the doctor eye must say when sales are limited to the viewer\'s branch');
}
if(/describeSourceError/.test(performanceService+performanceEye+decisionData))failures.push('doctor eye must not format raw PostgREST/SQL errors for the screen; use the source-state contract');
if(/\be\.message\b|\.error\s*\|\||\.error\}|sources\.\w+\.error/.test(performanceEye))failures.push('doctor eye must not render raw error messages; use source reasons or userFacingMessage');
if(!performanceEye.includes('userFacingMessage('))failures.push('doctor eye catch blocks must go through userFacingMessage (logs the original, shows plain text)');
if(!performanceService.includes('sourceStateOf('))failures.push('doctor eye sources must expose state + plain reason + diagnostic');
if(/إعادة تحميل مصدر المبيعات/.test(performanceVerdict))failures.push('verdict must not recommend actions derived from a missing source');
if(!performanceVerdict.includes('evidenceComplete'))failures.push('verdict must say whether its evidence is complete before a routine recommendation is shown');
if(/range\.(start|endExclusive)\.toISOString\(\)/.test(performanceEye+performanceService))failures.push('cycle date keys must come from evaluationCycleDateKeys, not Date#toISOString (Cairo day shift)');
if(headerService.includes('getStaffCycleSales'))failures.push('evaluation header must not fall back to legacy heavy staff cycle sales truth');
if(headerService.includes('loadPerformanceSalesBundle')||headerService.includes('get_staff_performance_sales_bundle_v1'))failures.push('evaluation header must stay on focused summary and not load the detailed performance bundle');
for(const forbidden of ["get_staff_monthly_evaluation_safe","save_staff_monthly_evaluation_v3"]){if(report.includes(forbidden))failures.push('360 legacy API: '+forbidden)}
if(failures.length){console.error('Final evaluation architecture gate failed:');failures.forEach(x=>console.error('- '+x));process.exit(1)}
console.log('Final evaluation architecture gate passed.');
