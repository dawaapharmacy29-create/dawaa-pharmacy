const fs = require('fs');
const path = require('path');

function patchFile(relative, transform) {
  const file = path.join(process.cwd(), relative);
  if (!fs.existsSync(file)) throw new Error(`[monthly-eval-fix] missing ${relative}`);
  const before = fs.readFileSync(file, 'utf8');
  const after = transform(before);
  if (after !== before) fs.writeFileSync(file, after);
  console.log(`[monthly-eval-fix] ${relative}: ${after === before ? 'already applied' : 'updated'}`);
}

patchFile('src/components/dashboard/BranchTargetEditor.tsx', (input) => {
  let source = input;
  source = source.replace(
    /function canManage\(role: unknown\) \{[\s\S]*?\n\}/,
    `function canManage(role: unknown) {\n  const value = String(role || '').trim().toLowerCase();\n  return value === 'general_manager' || value === 'branches_manager';\n}`
  );

  source = source.replace(
    /  const save = async \(branch: string, (?:_?matchingRows): TargetRow\[\]\) => \{[\s\S]*?\n  \};\n\n  if \(!allowed\) return null;/,
    `  const save = async (branch: string, _matchingRows: TargetRow[]) => {\n    const targetAmount = amount(drafts[branch]);\n    if (targetAmount <= 0) {\n      toast.error('اكتب تارجت صحيح أكبر من صفر');\n      return;\n    }\n    if (!user?.id || !allowed) {\n      toast.error('تعديل التارجت متاح فقط لمدير الفروع والمدير العام');\n      return;\n    }\n\n    setSaving(branch);\n    try {\n      const { data, error } = await supabase.rpc('save_branch_sales_target_v2', {\n        p_actor_id: user.id,\n        p_branch: branch,\n        p_target: targetAmount,\n      });\n      if (error) throw error;\n      const saved = Array.isArray(data) ? data[0] : data;\n      if (!saved || rowAmount(saved as TargetRow) !== targetAmount) {\n        throw new Error('تعذر التحقق من القيمة المحفوظة');\n      }\n      const verification = await supabase.from('branch_sales_targets').select('*').limit(200);\n      if (verification.error) throw verification.error;\n      const verifiedRows = ((verification.data || []) as TargetRow[]).filter((item) => rowBranch(item) === branch);\n      clearDashboardCache();\n      localStorage.setItem('dawaa_branch_target_refresh', String(Date.now()));\n      window.dispatchEvent(new CustomEvent('dawaa:branch-target-updated', { detail: { branch, targetAmount } }));\n      setRows((current) => [...current.filter((item) => rowBranch(item) !== branch), ...verifiedRows]);\n      setDrafts((current) => ({ ...current, [branch]: String(targetAmount) }));\n      toast.success(\`تم حفظ تارجت \${branch}: \${targetAmount.toLocaleString('ar-EG')} جنيه\`);\n    } catch (error) {\n      toast.error(\`تعذر حفظ التارجت: \${error instanceof Error ? error.message : 'خطأ غير معروف'}\`);\n    } finally {\n      setSaving(null);\n    }\n  };\n\n  if (!allowed) return null;`
  );
  if (!source.includes("save_branch_sales_target_v2")) throw new Error('[monthly-eval-fix] branch target v2 patch failed');
  return source;
});

patchFile('src/pages/StaffMonthlyEvaluation.tsx', (input) => {
  let source = input;

  if (!source.includes('function nextMonthStart(value: string)')) {
    source = source.replace(
      "function monthStart(value: string) { return `${value}-01`; }",
      "function monthStart(value: string) { return `${value}-01`; }\nfunction nextMonthStart(value: string) { const [year, month] = value.split('-').map(Number); return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10); }"
    );
  }

  source = source.replace(
    "const managerMode = isManager(role) || canViewAllBranches(user);",
    "const managerMode = isManager(role);"
  );
  source = source.replace(
    "const [branch, setBranch] = useState(canViewAllBranches(user) ? 'فرع الشامي' : ownBranch);",
    "const [branch, setBranch] = useState(role === 'general_manager' || role === 'branches_manager' ? 'فرع الشامي' : ownBranch);"
  );

  source = source.replace(
    /        let query = supabase\.from\('staff'\)[\s\S]*?        if \(selfMode\) \{[\s\S]*?        \} else if \(!selectedId && doctors\[0\]\) setSelectedId\(doctors\[0\]\.id\);/,
    `        if (!user?.id) throw new Error('الحساب الحالي غير مرتبط بمعرف دخول');\n        const { data, error } = await supabase.rpc('list_staff_for_monthly_evaluation_safe', {\n          p_actor_id: user.id,\n          p_branch: role === 'general_manager' || role === 'branches_manager' ? branch : null,\n        });\n        if (error) throw error;\n        const doctors = ((data || []) as StaffRow[]);\n        setStaff(doctors);\n        if (selfMode) {\n          const own = doctors.find((row) => row.id === user?.staffId || row.name === user?.name);\n          setSelectedId(own?.id || '');\n        } else if (!selectedId && doctors[0]) setSelectedId(doctors[0].id);`
  );

  source = source.replace(
    /        const \[\{ data: saved \}, pointResult, reviewResult, followupResult, attendanceResult\] = await Promise\.all\(\[[\s\S]*?        \]\);/,
    `        if (!user?.id) throw new Error('الحساب الحالي غير مرتبط بمعرف دخول');\n        const endDate = nextMonthStart(month);\n        const [{ data: saved }, reviewResult, followupResult, attendanceResult] = await Promise.all([\n          supabase.rpc('get_staff_monthly_evaluation_safe', { p_actor_id: user.id, p_staff_id: selectedId, p_month: monthStart(month) }),\n          supabase.from('conversation_sales_reviews').select('total_score,final_score,doctor_points_impact,point_impact,created_at').eq('staff_id', selectedId).gte('created_at', monthStart(month)).lt('created_at', endDate).limit(500),\n          supabase.from('daily_followups').select('status,followup_status,completed_at,created_at,assigned_staff_id,requested_by_staff_id').or(\`assigned_staff_id.eq.\${selectedId},requested_by_staff_id.eq.\${selectedId}\`).gte('created_at', monthStart(month)).lt('created_at', endDate).limit(1000),\n          supabase.from('attendance').select('status,check_in,check_out,date,staff_id').eq('staff_id', selectedId).gte('date', monthStart(month)).lt('date', endDate).limit(100),\n        ]);`
  );

  source = source.replace("        const pointRows = pointResult.data || [];\n", '');
  source = source.replace(
    "const reviewAverage = reviewRows.length ? reviewRows.reduce((s: number, r: any) => s + safeNumber(r.score || r.total_score), 0) / reviewRows.length : 0;",
    "const reviewAverage = reviewRows.length ? reviewRows.reduce((s: number, r: any) => s + safeNumber(r.final_score || r.total_score), 0) / reviewRows.length : 0;"
  );
  source = source.replace(
    /        const positivePoints = pointRows[\s\S]*?        const negativePoints = pointRows[\s\S]*?;\n/,
    `        const reviewImpacts = reviewRows.map((r: any) => safeNumber(r.doctor_points_impact ?? r.point_impact));\n        const positivePoints = reviewImpacts.filter((value: number) => value > 0).reduce((sum: number, value: number) => sum + value, 0);\n        const negativePoints = reviewImpacts.filter((value: number) => value < 0).reduce((sum: number, value: number) => sum + Math.abs(value), 0);\n`
  );

  source = source.replace(
    "const { data, error } = await supabase.from('staff_monthly_manager_evaluations').upsert(payload, { onConflict: 'staff_id,evaluation_month' }).select('id').single();\n      if (error) throw error;\n      setEvaluationId(data.id);",
    "const { data, error } = await supabase.rpc('save_staff_monthly_evaluation_safe', { p_actor_id: user?.id, p_payload: payload });\n      if (error) throw error;\n      setEvaluationId(String(data));"
  );

  source = source.replace(
    "const suggestedIncentive = Math.round((overallScore / 100) * 1500);",
    "const suggestedIncentive = overallScore < 60 ? 0 : Math.round((overallScore / 100) * 1500);"
  );

  if (!source.includes("list_staff_for_monthly_evaluation_safe")) throw new Error('[monthly-eval-fix] staff RPC patch failed');
  if (!source.includes("save_staff_monthly_evaluation_safe")) throw new Error('[monthly-eval-fix] save RPC patch failed');
  if (source.includes("points_transactions")) throw new Error('[monthly-eval-fix] missing points table reference remains');
  if (source.includes("`${month}-32`")) throw new Error('[monthly-eval-fix] invalid month end remains');
  return source;
});
