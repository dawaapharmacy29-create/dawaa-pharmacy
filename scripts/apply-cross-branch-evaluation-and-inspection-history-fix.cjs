const fs = require('node:fs');
const path = require('node:path');

function patchMonthlyEvaluation() {
  const filePath = path.join(process.cwd(), 'src/pages/StaffMonthlyEvaluation.tsx');
  if (!fs.existsSync(filePath)) return;
  let source = fs.readFileSync(filePath, 'utf8');
  const before = source;

  source = source.replace(
    "  const managerMode = isManager(role);\n  const selfMode = isDoctorRole(user) && !managerMode;",
    "  const managerMode = isManager(role);\n  const canSelectAnyBranch = ['general_manager', 'branches_manager', 'customer_service_manager'].includes(role);\n  const selfMode = isDoctorRole(user) && !managerMode;"
  );

  source = source.replace(
    "  const [branch, setBranch] = useState(role === 'general_manager' || role === 'branches_manager' ? 'فرع الشامي' : ownBranch);",
    "  const [branch, setBranch] = useState(canSelectAnyBranch ? (ownBranch || 'فرع الشامي') : ownBranch);"
  );

  source = source.replace(
    "          p_branch: role === 'general_manager' || role === 'branches_manager' ? branch : null,",
    "          p_branch: canSelectAnyBranch ? branch : null,"
  );

  // كل مواضع إظهار اختيار الفرع في الصفحة تشمل خدمة العملاء أيضًا.
  source = source.replace(/role === 'general_manager' \|\| role === 'branches_manager'/g, 'canSelectAnyBranch');

  if (source !== before) {
    fs.writeFileSync(filePath, source);
    console.log('[cross-branch-evaluation] applied');
  } else {
    console.log('[cross-branch-evaluation] already applied or anchors not found');
  }
}

function patchInspectionHistory() {
  const filePath = path.join(process.cwd(), 'src/pages/BranchInspection.tsx');
  if (!fs.existsSync(filePath)) return;
  let source = fs.readFileSync(filePath, 'utf8');
  const before = source;

  source = source.replace(
    "  const [loadingHistory, setLoadingHistory] = useState(false);",
    "  const [loadingHistory, setLoadingHistory] = useState(false);\n  const [historyError, setHistoryError] = useState('');"
  );

  const oldEffect = `  // Load past inspections
  useEffect(() => {
    if (!isSupabaseConfigured || !showHistory) return;
    setLoadingHistory(true);
    supabase
      .from('branch_inspections')
      .select('id, branch, date, inspector_name, overall_score, overall_notes, created_at')
      .eq('branch', form.branch)
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data }) => {
        setPastInspections((data || []) as PastInspection[]);
        setLoadingHistory(false);
      });
  }, [showHistory, form.branch]);`;

  const newEffect = `  // Load past inspections. Use select('*') because older rows may use
  // inspection_date/visit_date instead of date, and never swallow query errors.
  useEffect(() => {
    if (!isSupabaseConfigured || !showHistory) return;
    let cancelled = false;
    const loadHistory = async () => {
      setLoadingHistory(true);
      setHistoryError('');
      try {
        const { data, error } = await supabase
          .from('branch_inspections')
          .select('*')
          .eq('branch', form.branch)
          .order('created_at', { ascending: false })
          .limit(50);
        if (error) throw error;
        if (cancelled) return;
        const normalized = ((data || []) as Array<Record<string, any>>).map((row) => ({
          id: String(row.id),
          branch: String(row.branch || form.branch || ''),
          date: String(row.date || row.inspection_date || row.visit_date || row.created_at || '').slice(0, 10),
          inspector_name: String(row.inspector_name || row.created_by_name || row.manager_name || 'غير محدد'),
          overall_score: Number(row.overall_score || row.score || 0),
          overall_notes: String(row.overall_notes || row.notes || ''),
          created_at: String(row.created_at || row.date || row.inspection_date || ''),
        })) as PastInspection[];
        setPastInspections(normalized);
      } catch (error) {
        if (!cancelled) {
          setPastInspections([]);
          setHistoryError(error instanceof Error ? error.message : 'تعذر تحميل سجل المرورات السابقة');
        }
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    };
    void loadHistory();
    return () => { cancelled = true; };
  }, [showHistory, form.branch]);`;

  if (source.includes(oldEffect)) source = source.replace(oldEffect, newEffect);

  // Show a visible error instead of an apparently empty history panel.
  if (!source.includes("historyError &&")) {
    source = source.replace(
      "{loadingHistory ? (",
      "{historyError && (\n              <div className=\"mb-3 rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm font-bold text-red-200\">\n                تعذر تحميل السجل: {historyError}\n              </div>\n            )}\n            {loadingHistory ? ("
    );
  }

  if (source !== before) {
    fs.writeFileSync(filePath, source);
    console.log('[branch-inspection-history] applied');
  } else {
    console.log('[branch-inspection-history] already applied or anchors not found');
  }
}

patchMonthlyEvaluation();
patchInspectionHistory();
