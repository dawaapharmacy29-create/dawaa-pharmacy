const fs = require('node:fs');
const path = require('node:path');

const analyticsPath = path.join(process.cwd(), 'src/pages/Analytics.tsx');
const servicePath = path.join(process.cwd(), 'src/lib/salesAnalyticsSummaryService.ts');
let analytics = fs.readFileSync(analyticsPath, 'utf8');
let service = fs.readFileSync(servicePath, 'utf8');

// Prefer the existing summary tables for the main page. Loading thousands of raw invoices
// together with the V13 views was exhausting the statement timeout.
service = service.replace(
  '    fetchLiveInvoiceRows(filters),',
  "    Promise.resolve({ rows: [] as Row[], error: null }),"
);

if (!analytics.includes("const TARGET_BRANCHES = ['فرع الشامي', 'فرع شكري'];")) {
  analytics = analytics.replace(
    "const ALL_FILTER = 'الكل';",
    "const ALL_FILTER = 'الكل';\nconst TARGET_BRANCHES = ['فرع الشامي', 'فرع شكري'];"
  );
}

if (!analytics.includes('const [targetDrafts, setTargetDrafts]')) {
  analytics = analytics.replace(
    "  const [error, setError] = useState<string | null>(null);",
    "  const [error, setError] = useState<string | null>(null);\n  const [targetDrafts, setTargetDrafts] = useState<Record<string, string>>({});\n  const [savingTarget, setSavingTarget] = useState<string | null>(null);"
  );
}

const targetRowsPattern = /  const targetRows = useMemo\(\(\) => \{[\s\S]*?\n  \}, \[branchTargets, data\?\.branchRows\]\);/;
const targetRowsReplacement = `  const targetRows = useMemo(() => {
    const byBranch = new Map(
      (branchTargets || []).map((target) => [normalizeBranchName(target.branch_name), target])
    );
    const salesByBranch = new Map(
      (Array.isArray(data?.branchRows) ? data.branchRows : []).map((row) => [normalizeBranchName(row.branch), row])
    );
    const branchNames = [...new Set([
      ...TARGET_BRANCHES,
      ...byBranch.keys(),
      ...salesByBranch.keys(),
    ].filter(Boolean))];
    return branchNames.map((branch) => {
      const target = byBranch.get(branch);
      const salesRow = salesByBranch.get(branch);
      const targetAmount = Number(target?.target_amount || 0);
      const netSales = Number(salesRow?.netSales || 0);
      return {
        branch,
        targetId: target?.id,
        targetAmount,
        netSales,
        percent: targetAmount ? Math.round((netSales / targetAmount) * 1000) / 10 : null,
        remaining: Math.max(0, targetAmount - netSales),
      };
    });
  }, [branchTargets, data?.branchRows]);`;
if (targetRowsPattern.test(analytics)) analytics = analytics.replace(targetRowsPattern, targetRowsReplacement);

if (!analytics.includes('setTargetDrafts((current) =>')) {
  analytics = analytics.replace(
    "  const [R, setR] = useState<any>(null);",
    `  useEffect(() => {
    setTargetDrafts((current) => {
      const next = { ...current };
      for (const row of targetRows) {
        if (!(row.branch in next) || next[row.branch] === '') next[row.branch] = row.targetAmount ? String(row.targetAmount) : '';
      }
      return next;
    });
  }, [targetRows]);

  const [R, setR] = useState<any>(null);`
  );
}

analytics = analytics.replace(
  "  const saveBranchTarget = async (row: {\n    branch: string;\n    targetId?: string;\n    targetAmount: number;\n  }) => {",
  "  const saveBranchTarget = async (row: {\n    branch: string;\n    targetId?: string;\n    targetAmount: number;\n  }) => {\n    if (!Number.isFinite(row.targetAmount) || row.targetAmount <= 0) {\n      toast.error('اكتب تارجت صحيح أكبر من صفر');\n      return;\n    }\n    setSavingTarget(row.branch);"
);
analytics = analytics.replace(
  "    if (error) {\n      toast.error('تعذر حفظ تارجت الفرع');\n      return;\n    }",
  "    if (error) {\n      setSavingTarget(null);\n      toast.error(`تعذر حفظ تارجت الفرع: ${error.message}`);\n      return;\n    }"
);
analytics = analytics.replace(
  "    toast.success('تم حفظ التارجت');\n  };",
  "    setSavingTarget(null);\n    clearExecutiveDashboardCache();\n    toast.success(`تم حفظ تارجت ${row.branch}`);\n  };"
);

const targetPanelPattern = /            <Panel title="تارجت الفروع">[\s\S]*?            <\/Panel>/;
const targetPanelReplacement = `            <Panel title="تحديد تارجت الفروع يدويًا">
              <div className="space-y-3">
                {targetRows.map((row) => (
                  <div key={row.branch} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="font-black text-slate-900">{row.branch}</span>
                      <span className="text-xs font-bold text-teal-700">
                        {row.percent === null ? 'لم يتم تحديد هدف' : `إنجاز ${row.percent}%`}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min="1"
                        step="1000"
                        value={targetDrafts[row.branch] ?? ''}
                        onChange={(event) => setTargetDrafts((current) => ({ ...current, [row.branch]: event.target.value }))}
                        placeholder="اكتب التارجت بالجنيه"
                        className="dawaa-input min-w-0 flex-1"
                      />
                      <button
                        type="button"
                        disabled={savingTarget === row.branch}
                        onClick={() => void saveBranchTarget({
                          branch: row.branch,
                          targetId: row.targetId,
                          targetAmount: Number(targetDrafts[row.branch] || 0),
                        })}
                        className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-black text-white hover:bg-teal-700 disabled:opacity-50"
                      >
                        <Save size={16} /> {savingTarget === row.branch ? 'حفظ...' : 'حفظ'}
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs font-bold text-slate-600">
                      <span>المبيعات: {formatMoney(row.netSales)}</span>
                      <span>المتبقي: {formatMoney(row.remaining)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>`;
if (targetPanelPattern.test(analytics)) analytics = analytics.replace(targetPanelPattern, targetPanelReplacement);

// Do not execute the three expensive V13 views automatically. The main analytics page must stay usable.
analytics = analytics.replace(
  "  useEffect(() => {\n    void loadV13();\n  }, [loadV13]);",
  "  useEffect(() => {\n    // مؤشرات V13 اختيارية لأنها ثقيلة على قاعدة البيانات؛ يتم تحميلها فقط عند الضغط على الزر.\n  }, []);"
);
analytics = analytics.replace(
  '            الداشبورد، العملاء المهمين، متوسط الفرع اليومي، والتارجت من الـ Views الجديدة.',
  '            مؤشرات إضافية اختيارية. الصفحة الأساسية تعمل من الملخصات السريعة حتى لو كانت Views الثقيلة غير متاحة.'
);
analytics = analytics.replace(' /> تحديث V13', ' /> تحميل مؤشرات V13');

fs.writeFileSync(analyticsPath, analytics, 'utf8');
fs.writeFileSync(servicePath, service, 'utf8');

analytics = fs.readFileSync(analyticsPath, 'utf8');
service = fs.readFileSync(servicePath, 'utf8');
if (!analytics.includes('تحديد تارجت الفروع يدويًا')) throw new Error('[analytics-fix] manual target panel missing');
if (!analytics.includes('setTargetDrafts')) throw new Error('[analytics-fix] target drafts missing');
if (!service.includes('Promise.resolve({ rows: [] as Row[], error: null })')) throw new Error('[analytics-fix] summary-first source missing');
console.log('Analytics timeout protection and manual branch targets applied.');
