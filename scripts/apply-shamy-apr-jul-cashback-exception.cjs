const fs = require('fs');
const path = require('path');

function patchFile(file, patches) {
  const full = path.join(process.cwd(), file);
  let text = fs.readFileSync(full, 'utf8');
  let changed = false;
  for (const [from, to] of patches) {
    if (text.includes(to)) continue;
    if (!text.includes(from)) {
      throw new Error(`[shamy-cashback] expected snippet not found in ${file}: ${from.slice(0, 90)}`);
    }
    text = text.replace(from, to);
    changed = true;
  }
  if (changed) fs.writeFileSync(full, text);
  console.log(`[shamy-cashback] ${changed ? 'patched' : 'already patched'} ${file}`);
}

patchFile('src/pages/CustomerCashback.tsx', [
  [
    "const ALL = '__all__';",
    "const ALL = '__all__';\nconst SHAMY_EXCEPTION_BRANCH = 'فرع الشامي';\nconst SHAMY_EXCEPTION_START = '2026-04-01';\nconst SHAMY_EXCEPTION_END = '2026-07-31';\n\nfunction currentBoundsForBranch(branchName: string, standard: { start: string; end: string }) {\n  if (\n    branchName === SHAMY_EXCEPTION_BRANCH &&\n    standard.start === '2026-05-01' &&\n    standard.end === SHAMY_EXCEPTION_END\n  ) {\n    return { start: SHAMY_EXCEPTION_START, end: SHAMY_EXCEPTION_END };\n  }\n  return standard;\n}"
  ],
  [
    ".gte('cycle_start', cycleStart)\n          .lte('cycle_end', cycleEnd)",
    ".eq('cycle_start', cycleStart)\n          .eq('cycle_end', cycleEnd)"
  ],
  [
    "const { data, error } = await supabase.rpc('calculate_customer_cashback_cycle_v6', {\n        p_cycle_start: cycleStart,\n        p_cycle_end: cycleEnd,\n      });",
    "if (branch === ALL) {\n        toast.error('اختار الفرع الأول قبل احتساب الكاش باك، عشان ما نعدّلش فرع تاني بالغلط.');\n        return;\n      }\n      const { data, error } = await supabase.rpc('calculate_customer_cashback_cycle_for_branch_v1', {\n        p_cycle_start: cycleStart,\n        p_cycle_end: cycleEnd,\n        p_branch: branch,\n      });"
  ],
  [
    "setCycleStart(current.start);\n            setCycleEnd(current.end);",
    "const bounds = currentBoundsForBranch(branch, current);\n            setCycleStart(bounds.start);\n            setCycleEnd(bounds.end);"
  ],
  [
    "<select className=\"dawaa-input\" value={branch} onChange={(e) => setBranch(e.target.value)}>",
    "<select className=\"dawaa-input\" value={branch} onChange={(e) => {\n          const nextBranch = e.target.value;\n          setBranch(nextBranch);\n          const wasShamyException = cycleStart === SHAMY_EXCEPTION_START && cycleEnd === SHAMY_EXCEPTION_END;\n          if (nextBranch === SHAMY_EXCEPTION_BRANCH && current.start === '2026-05-01' && current.end === SHAMY_EXCEPTION_END) {\n            setCycleStart(SHAMY_EXCEPTION_START);\n            setCycleEnd(SHAMY_EXCEPTION_END);\n          } else if (nextBranch !== SHAMY_EXCEPTION_BRANCH && wasShamyException) {\n            setCycleStart(current.start);\n            setCycleEnd(current.end);\n          }\n        }}>"
  ]
]);

patchFile('src/lib/customerEngagement.ts', [
  [
    "export async function runQuarterlyCashbackBatch(actorName?: string | null) {\n  const { data, error } = await supabase.rpc('run_quarterly_cashback_batch', {\n    p_period_start: null, p_period_end: null, p_reward_rate: 0.05, p_actor_name: actorName || 'يدوي من الصفحة',\n  });",
    "export async function runQuarterlyCashbackBatch(\n  actorName?: string | null,\n  branch?: string | null,\n  periodStart?: string | null,\n  periodEnd?: string | null\n) {\n  if (!branch || !periodStart || !periodEnd) throw new Error('لازم تحدد الفرع وفترة الدورة قبل الاحتساب.');\n  const { data, error } = await supabase.rpc('run_quarterly_cashback_batch_for_branch_v1', {\n    p_branch: branch, p_period_start: periodStart, p_period_end: periodEnd, p_reward_rate: 0.05, p_actor_name: actorName || 'يدوي من الصفحة',\n  });"
  ]
]);

patchFile('src/pages/CustomerPointsLedger.tsx', [
  [
    "const todayKey = () => new Date().toISOString().slice(0, 10);",
    "const todayKey = () => new Date().toISOString().slice(0, 10);\nconst SHAMY_EXCEPTION_BRANCH = 'فرع الشامي';\nconst SHAMY_EXCEPTION_START = '2026-04-01';\nconst SHAMY_EXCEPTION_END = '2026-07-31';"
  ],
  [
    "const visiblePendingCustomers = useMemo(\n    () => contactFilter === 'uncontacted' ? pendingCustomers.filter((c) => c.uncontacted_count > 0) : pendingCustomers,\n    [pendingCustomers, contactFilter]\n  );",
    "const visiblePendingCustomers = useMemo(\n    () => contactFilter === 'uncontacted' ? pendingCustomers.filter((c) => c.uncontacted_count > 0) : pendingCustomers,\n    [pendingCustomers, contactFilter]\n  );\n\n  const effectiveQuarterBounds = useMemo(() => {\n    if (\n      workBranch === SHAMY_EXCEPTION_BRANCH &&\n      quarterBounds?.period_start === '2026-05-01' &&\n      quarterBounds?.period_end === SHAMY_EXCEPTION_END\n    ) {\n      return { ...quarterBounds, period_start: SHAMY_EXCEPTION_START, period_end: SHAMY_EXCEPTION_END, quarter_label: 'استثناء الشامي: أبريل - يوليو 2026' };\n    }\n    return quarterBounds;\n  }, [quarterBounds, workBranch]);"
  ],
  [
    "const result = await runQuarterlyCashbackBatch(user?.name);",
    "if (!effectiveQuarterBounds) throw new Error('تعذر تحديد فترة الدورة الحالية.');\n      const result = await runQuarterlyCashbackBatch(\n        user?.name,\n        workBranch,\n        effectiveQuarterBounds.period_start,\n        effectiveQuarterBounds.period_end\n      );"
  ],
  [
    "{quarterBounds ? (",
    "{effectiveQuarterBounds ? ("
  ],
  [
    "آخر دورة محسوبة: {quarterBounds.quarter_label}",
    "آخر دورة محسوبة: {effectiveQuarterBounds.quarter_label}"
  ],
  [
    "({quarterBounds.period_start} — {quarterBounds.period_end})",
    "({effectiveQuarterBounds.period_start} — {effectiveQuarterBounds.period_end})"
  ]
]);
