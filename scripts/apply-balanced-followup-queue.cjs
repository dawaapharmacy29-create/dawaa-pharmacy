const fs = require('node:fs');
const path = require('node:path');

const target = path.join(process.cwd(), 'src/components/customerService/CustomerFollowupCockpitPanel.tsx');
let source = fs.readFileSync(target, 'utf8');

const replacements = [
  [
    "const DAILY_QUEUE_LIMIT = 45;",
    "const PER_BRANCH_QUEUE_LIMIT = 25;\nconst TOTAL_DAILY_QUEUE_LIMIT = PER_BRANCH_QUEUE_LIMIT * 2;",
  ],
  [
    "const smartQueue = useMemo(() => queueCandidates.slice(0, DAILY_QUEUE_LIMIT), [queueCandidates]);",
    `const smartQueue = useMemo(() => {
    if (branch !== ALL_BRANCHES) {
      return queueCandidates.slice(0, PER_BRANCH_QUEUE_LIMIT);
    }

    const shamyQueue = queueCandidates
      .filter((row) => normalizeBranchName(row.branch || '').includes('الشامي'))
      .slice(0, PER_BRANCH_QUEUE_LIMIT);

    const shokryQueue = queueCandidates
      .filter((row) => normalizeBranchName(row.branch || '').includes('شكري'))
      .slice(0, PER_BRANCH_QUEUE_LIMIT);

    return [...shamyQueue, ...shokryQueue].sort((a, b) => smartScore(b) - smartScore(a));
  }, [branch, queueCandidates]);`,
  ],
  [
    "{smartQueue.length} / 45",
    "{smartQueue.length} / {branch === ALL_BRANCHES ? TOTAL_DAILY_QUEUE_LIMIT : PER_BRANCH_QUEUE_LIMIT}",
  ],
  [
    "const canExecute = currentProfile.role === 'executor';",
    "const canExecute = ['executor', 'reviewer', 'general_manager'].includes(currentProfile.role);",
  ],
  [
    "const contactedEvents = useMemo(() => events.filter((event) => EXECUTION_ACTIONS.has(event.action) && actorProfile(event.actor_name).role === 'executor'), [events]);",
    "const contactedEvents = useMemo(() => events.filter((event) => EXECUTION_ACTIONS.has(event.action)), [events]);",
  ],
  [
    "toast.error('التنفيذ متاح فقط لد/ ضحى لفرع الشامي ود/ دنيا لفرع شكري. حسابك للمراجعة والإشراف.');",
    "toast.error('حسابك لا يملك صلاحية تنفيذ المتابعات. التنفيذ متاح لد/ ضحى ود/ دنيا ود/ علا والمدير العام.');",
  ],
  [
    "حسابك للمراجعة أو الإدارة؛ أزرار التنفيذ موقوفة.",
    "حسابك للعرض فقط؛ أزرار التنفيذ موقوفة.",
  ],
];

for (const [before, after] of replacements) {
  if (source.includes(after)) continue;
  if (!source.includes(before)) {
    throw new Error(`Expected follow-up queue snippet was not found: ${before}`);
  }
  source = source.replace(before, after);
}

fs.writeFileSync(target, source, 'utf8');
console.log('Balanced queue and execution permissions applied: 25 customers per branch; execution enabled for ضحى، دنيا، علا، والمدير العام.');
