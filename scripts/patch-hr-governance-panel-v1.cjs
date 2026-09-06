const fs = require('fs');
const p = 'src/pages/HRComplianceCenter.tsx';
let s = fs.readFileSync(p, 'utf8');

if (!s.includes("import HRComplianceGovernancePanel from '@/components/hr/HRComplianceGovernancePanel';")) {
  const anchor = "import { cn } from '@/lib/utils';";
  if (!s.includes(anchor)) throw new Error('import anchor not found');
  s = s.replace(anchor, `${anchor}\nimport HRComplianceGovernancePanel from '@/components/hr/HRComplianceGovernancePanel';`);
}

if (!s.includes('<HRComplianceGovernancePanel')) {
  const anchor = `\n    </div>\n  );\n}\n\nfunction Metric`;
  if (!s.includes(anchor)) throw new Error('root closing anchor not found');
  const block = `\n\n      <HRComplianceGovernancePanel\n        startDate={startDate}\n        endDate={endDate}\n        dailyDate={dailyDate}\n        branch={effectiveBranch}\n        onChanged={load}\n      />${anchor}`;
  s = s.replace(anchor, block);
}

fs.writeFileSync(p, s);
console.log('patched HRComplianceCenter governance panel');
