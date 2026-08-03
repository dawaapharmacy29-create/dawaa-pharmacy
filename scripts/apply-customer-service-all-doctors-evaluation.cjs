const fs = require('node:fs');
const path = require('node:path');

const filePath = path.join(process.cwd(), 'src/pages/StaffMonthlyEvaluation.tsx');
if (!fs.existsSync(filePath)) {
  console.log('[customer-service-all-doctors] StaffMonthlyEvaluation.tsx not found; skipped');
  process.exit(0);
}

let source = fs.readFileSync(filePath, 'utf8');
const before = source;

source = source.replace(
  "  const ownBranch = normalizeBranchName(user?.branch || '');\n  const [branch, setBranch] = useState(role === 'general_manager' || role === 'branches_manager' ? 'فرع الشامي' : ownBranch);",
  "  const ownBranch = normalizeBranchName(user?.branch || '');\n  const canEvaluateAcrossBranches = ['general_manager', 'branches_manager', 'customer_service_manager'].includes(role);\n  const [branch, setBranch] = useState(canEvaluateAcrossBranches ? 'كل الفروع' : ownBranch);"
);

source = source.replace(
  "          p_branch: role === 'general_manager' || role === 'branches_manager' ? branch : null,",
  "          p_branch: canEvaluateAcrossBranches && branch !== 'كل الفروع' ? branch : null,"
);

source = source.replace(
  "        const doctors = ((data || []) as StaffRow[]);\n        setStaff(doctors);",
  "        const doctors = ((data || []) as StaffRow[])\n          .filter((row) => isDoctorRole({ role: row.role || row.job_title } as any))\n          .sort((a, b) => {\n            const branchCompare = String(a.branch || '').localeCompare(String(b.branch || ''), 'ar');\n            return branchCompare || String(a.name || '').localeCompare(String(b.name || ''), 'ar');\n          });\n        setStaff(doctors);"
);

source = source.replace(
  "  const filteredStaff = staff.filter((item) => item.name.includes(search));",
  "  const filteredStaff = staff.filter((item) => {\n    const matchesSearch = item.name.includes(search);\n    const matchesBranch = branch === 'كل الفروع' || normalizeBranchName(item.branch || '') === normalizeBranchName(branch);\n    return matchesSearch && matchesBranch;\n  });"
);

source = source.replace(
  "{managerMode && canViewAllBranches(user) ? <select value={branch} onChange={(e)=>setBranch(e.target.value)} className=\"input-dark\"><option>فرع الشامي</option><option>فرع شكري</option></select> : null}",
  "{managerMode && (canViewAllBranches(user) || role === 'customer_service_manager') ? <select value={branch} onChange={(e)=>setBranch(e.target.value)} className=\"input-dark\"><option>كل الفروع</option><option>فرع الشامي</option><option>فرع شكري</option></select> : null}"
);

source = source.replace(
  "        <div className=\"relative\"><Search className=\"absolute right-3 top-1/2 -translate-y-1/2 text-slate-500\" size={17}/><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder=\"بحث باسم الدكتور\" className=\"input-dark w-full pr-10\"/></div>",
  "        <div className=\"mb-3 flex items-center justify-between text-xs font-bold text-slate-400\"><span>الدكاترة المتاحون للتقييم</span><span>{filteredStaff.length} دكتور · {branch}</span></div>\n        <div className=\"relative\"><Search className=\"absolute right-3 top-1/2 -translate-y-1/2 text-slate-500\" size={17}/><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder=\"بحث باسم الدكتور أو الفرع\" className=\"input-dark w-full pr-10\"/></div>"
);

// وسّع البحث ليشمل اسم الفرع أيضًا.
source = source.replace(
  "    const matchesSearch = item.name.includes(search);",
  "    const matchesSearch = item.name.includes(search) || String(item.branch || '').includes(search);"
);

if (source === before) {
  console.log('[customer-service-all-doctors] already applied or compatible anchors not found');
  process.exit(0);
}

fs.writeFileSync(filePath, source);
console.log('[customer-service-all-doctors] applied');
