const fs = require('fs');
function edit(path, fn){ const s=fs.readFileSync(path,'utf8'); const out=fn(s); if(out===s) throw new Error('no change: '+path); fs.writeFileSync(path,out); }

edit('src/pages/DailyManagerChecklist.tsx', (s) => {
  s=s.replace("const ROLE_TO_EVALUATION_TYPE: Record<ManagerDailyRole, EvaluationType> = {\n  branch_manager: 'branch_manager',\n  branches_manager: 'branches_manager',\n  customer_service_manager: 'customer_service',\n};", "const ROLE_TO_EVALUATION_TYPE: Record<ManagerDailyRole, EvaluationType> = {\n  branch_manager: 'branch_manager',\n  branches_manager: 'branches_manager',\n  customer_service_manager: 'customer_service',\n};\n\nconst BRANCHES_MANAGER_BRANCHES = ['فرع شكري', 'فرع الشامي'] as const;");
  s=s.replace("  const [taskDate, setTaskDate] = useState(todayInput());\n  const [activeTab, setActiveTab] = useState<'tasks' | 'score'>('tasks');", "  const [taskDate, setTaskDate] = useState(todayInput());\n  const [activeTab, setActiveTab] = useState<'tasks' | 'score'>('tasks');\n  const [selectedBranch, setSelectedBranch] = useState<(typeof BRANCHES_MANAGER_BRANCHES)[number]>('فرع شكري');");
  s=s.replace("  const staffId = user?.staffId || user?.id || '';", "  const staffId = user?.staffId || user?.id || '';\n  const effectiveBranch = role === 'branches_manager' ? selectedBranch : (user?.branch || null);");
  s=s.replace("      .select('id, task_key, task_date, completed, note')", "      .select('id, task_key, task_date, completed, note, branch')");
  s=s.replace("type ChecklistRow = {\n  id?: string;\n  task_key: string;\n  task_date?: string;\n  completed: boolean;\n  note: string | null;\n};", "type ChecklistRow = {\n  id?: string;\n  task_key: string;\n  task_date?: string;\n  completed: boolean;\n  note: string | null;\n  branch?: string | null;\n};");
  s=s.replace("          const row = rawRow as ChecklistRow;\n          const cadence", "          const row = rawRow as ChecklistRow;\n          if (role === 'branches_manager' && row.branch !== selectedBranch) return;\n          const cadence");
  s=s.replace("  }, [staffId, taskDate, isEligible]);", "  }, [staffId, taskDate, isEligible, selectedBranch]);");
  s=s.replace(/branch: role === 'branches_manager' \? null : \(user\?\.branch \|\| null\),/g, "branch: effectiveBranch,");
  s=s.replace(/onConflict: 'staff_id,task_date,task_key'/g, "onConflict: 'staff_id,task_date,task_key,branch'");
  s=s.replace("          branch={role === 'branches_manager' ? null : (user?.branch || null)}", "          branch={effectiveBranch}");
  const marker = "      {isEligible && !isAssistant && (\n        <div className=\"flex gap-2 border-b border-white/10\">";
  const branchUi = "      {role === 'branches_manager' && (\n        <div className=\"grid gap-2 rounded-2xl border border-teal-400/20 bg-teal-500/5 p-3 sm:grid-cols-2\">\n          {BRANCHES_MANAGER_BRANCHES.map((branch) => (\n            <button key={branch} type=\"button\" onClick={() => setSelectedBranch(branch)} className={`rounded-xl border px-4 py-3 text-sm font-black transition ${selectedBranch === branch ? 'border-teal-400/50 bg-teal-500/15 text-teal-200' : 'border-white/10 bg-slate-950/30 text-slate-400 hover:text-white'}`}>\n              {branch} {selectedBranch === branch ? '— الفرع النشط' : ''}\n            </button>\n          ))}\n        </div>\n      )}\n\n" + marker;
  if(!s.includes(marker)) throw new Error('daily branch UI marker missing');
  s=s.replace(marker, branchUi);
  s=s.replace("          <div className=\"flex flex-wrap items-center gap-3\">", "          {role === 'branches_manager' && <div className=\"rounded-xl border border-white/10 bg-slate-900/40 px-3 py-2 text-sm font-black text-teal-200\">مهام {selectedBranch} — الإنجاز والتقييم لهذا الفرع فقط</div>}\n          <div className=\"flex flex-wrap items-center gap-3\">");
  return s;
});

edit('src/lib/evaluations/managerDailyTasks.ts', (s) => s
  .replace("label: 'الشكل العام والنظافة في الفرعين'", "label: 'الشكل العام والنظافة بالفرع'")
  .replace("label: 'أهم 20 عميل بكل فرع — الاستمرارية وجودة الخدمة'", "label: 'أهم 20 عميل بالفرع — الاستمرارية وجودة الخدمة'")
);

edit('src/lib/evaluations/managerEvaluationService.ts', (s) => {
  s=s.replace("export async function fetchWeeklyChecklistCompletion(\n  staffId: string,\n  weekStart: string,\n  weekEnd: string\n): Promise<Record<string, number>> {", "export async function fetchWeeklyChecklistCompletion(\n  staffId: string,\n  weekStart: string,\n  weekEnd: string,\n  branch: string | null = null\n): Promise<Record<string, number>> {");
  const v3Marker = "  // v3 يحافظ على المفاتيح الحالية";
  if(!s.includes(v3Marker)) throw new Error('service v3 marker missing');
  s=s.replace(v3Marker, "  const { data: v4Data, error: v4Error } = await supabase.rpc(\n    'calculate_weekly_checklist_completion_v4',\n    { p_staff_id: staffId, p_week_start: weekStart, p_week_end: weekEnd, p_task_cadences: cadencePayload, p_branch: branch }\n  );\n  if (!v4Error) return (v4Data as Record<string, number>) || {};\n\n"+v3Marker);
  s=s.replace("{ onConflict: 'evaluation_type,subject_staff_id,week_start' }", "{ onConflict: 'evaluation_type,subject_staff_id,week_start,branch' }");
  const oldHist = /export async function fetchEvaluationHistory\(evaluationType: EvaluationType, subjectStaffId: string\) \{[\s\S]*?\n\}/;
  const newHist = `export async function fetchEvaluationHistory(evaluationType: EvaluationType, subjectStaffId: string, branch: string | null = null) {\n  let query = supabase\n    .from(TABLES.managerWeeklyEvaluations)\n    .select('*')\n    .eq('evaluation_type', evaluationType)\n    .eq('subject_staff_id', subjectStaffId);\n  if (branch) query = query.eq('branch', branch);\n  const { data, error } = await query.order('week_start', { ascending: false }).limit(12);\n  if (error) throw new Error(error.message);\n  return data || [];\n}`;
  if(!oldHist.test(s)) throw new Error('history function missing');
  s=s.replace(oldHist,newHist);
  return s;
});

edit('src/lib/evaluations/managerScoreBreakdown.ts', (s) => s.replace("fetchWeeklyChecklistCompletion(subjectStaffId, weekStart, weekEnd),", "fetchWeeklyChecklistCompletion(subjectStaffId, weekStart, weekEnd, branch),"));

edit('src/lib/evaluations/managerLiveIncentiveService.ts', (s) => s
  .replace("fetchWeeklyChecklistCompletion(subjectStaffId, weekStart, weekEnd).catch(() => ({})),", "fetchWeeklyChecklistCompletion(subjectStaffId, weekStart, weekEnd, branch).catch(() => ({})),")
  .replace("fetchEvaluationHistory(evaluationType, subjectStaffId).catch(() => []),", "fetchEvaluationHistory(evaluationType, subjectStaffId, branch).catch(() => []),")
);

edit('src/pages/WeeklyManagerEvaluation.tsx', (s) => {
  s=s.replace("  const [weekStart, setWeekStart] = useState(() => weekBoundsOf(new Date()).start);", "  const [weekStart, setWeekStart] = useState(() => weekBoundsOf(new Date()).start);\n  const [selectedBranch, setSelectedBranch] = useState<'فرع شكري' | 'فرع الشامي'>('فرع شكري');");
  s=s.replace("  const branchForMetrics = evaluationType === 'branches_manager' ? null : subject?.branch || null;", "  const branchForMetrics = evaluationType === 'branches_manager' ? selectedBranch : subject?.branch || null;");
  s=s.replace(/fetchEvaluationHistory\(evaluationType, subjectStaffId\)/g, "fetchEvaluationHistory(evaluationType, subjectStaffId, branchForMetrics)");
  s=s.replace("fetchWeeklyChecklistCompletion(subjectStaffId, weekStart, weekEnd),", "fetchWeeklyChecklistCompletion(subjectStaffId, weekStart, weekEnd, branchForMetrics),");
  const selectMarker = "        <input type=\"date\" className=\"input-dark\" value={weekStart}";
  if(!s.includes(selectMarker)) throw new Error('weekly selector marker missing');
  s=s.replace(selectMarker, "        {evaluationType === 'branches_manager' && (\n          <select className=\"input-dark\" value={selectedBranch} onChange={(e) => setSelectedBranch(e.target.value as 'فرع شكري' | 'فرع الشامي')}>\n            <option value=\"فرع شكري\">تقييم فرع شكري</option>\n            <option value=\"فرع الشامي\">تقييم فرع الشامي</option>\n          </select>\n        )}\n        "+selectMarker.trimStart());
  return s;
});

edit('src/lib/evaluations/managerMonthlyReportService.ts', (s) => {
  const marker="  const [evaluationResult, settlementResult, liveSnapshot, cycleMetrics] = await Promise.all([\n    supabase\n      .from('manager_weekly_evaluations')";
  if(!s.includes(marker)) throw new Error('monthly marker missing');
  const repl="  let evaluationQuery = supabase\n    .from('manager_weekly_evaluations')\n    .select('week_start,week_end,total_score,status,auto_metrics,branch')\n    .eq('evaluation_type', evaluationType)\n    .eq('subject_staff_id', subjectStaffId)\n    .eq('status', 'submitted')\n    .gte('week_end', oldestStart);\n  if (branch) evaluationQuery = evaluationQuery.eq('branch', branch);\n\n  const [evaluationResult, settlementResult, liveSnapshot, cycleMetrics] = await Promise.all([\n    evaluationQuery.order('week_end', { ascending: false }),";
  s=s.replace(/  const \[evaluationResult, settlementResult, liveSnapshot, cycleMetrics\] = await Promise\.all\(\[\n    supabase\n      \.from\('manager_weekly_evaluations'\)[\s\S]*?\.order\('week_end', \{ ascending: false \}\),/, repl);
  return s;
});
