const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/components/common/QuickFollowupModal.tsx');
if (!fs.existsSync(file)) {
  console.log('[quick-followup-mode-fix] file not found; skipped');
  process.exit(0);
}

let source = fs.readFileSync(file, 'utf8');
const before = source;

source = source
  .replace(
    "const [mode, setMode] = useState<FollowupMode>('execute');",
    "const [actionMode, setActionMode] = useState<FollowupMode>('execute');"
  )
  .replace(/\bsetMode\(/g, 'setActionMode(')
  .replace(/\bmode === 'execute'/g, "actionMode === 'execute'")
  .replace(/\bmode === 'request'/g, "actionMode === 'request'")
  .replace(
    /const exceptionalMode = followupKind === ['\"]exceptional['\"];?/g,
    'const exceptionalMode = true;'
  );

if (!source.includes("const [actionMode, setActionMode] = useState<FollowupMode>('execute');")) {
  throw new Error('[quick-followup-mode-fix] actionMode state was not found after patch');
}
if (/const \[mode, setMode\] = useState<FollowupMode>/.test(source)) {
  throw new Error('[quick-followup-mode-fix] duplicate FollowupMode state still exists');
}
if (/\bfollowupKind\b/.test(source)) {
  throw new Error('[quick-followup-mode-fix] undefined followupKind reference still exists');
}

if (source !== before) {
  fs.writeFileSync(file, source);
  console.log('[quick-followup-mode-fix] normalized actionMode and removed undefined followupKind');
} else {
  console.log('[quick-followup-mode-fix] already applied');
}

require('./apply-followup-continuation-action.cjs');
require('./fix-branch-target-save-rpc.cjs');
require('./apply-monthly-evaluation-and-target-access.cjs');
require('./apply-monthly-evaluation-doctor-nav.cjs');
require('./dedupe-monthly-evaluation-helpers.cjs');
require('./apply-monthly-evaluation-development-model.cjs');
require('./polish-monthly-evaluation-pdf.cjs');
require('./apply-schedule-roster-source.cjs');
require('./apply-followup-results-excel-import.cjs');
require('./place-followup-results-import-top-action.cjs');
require('./mount-followup-results-import-visible-action.cjs');
require('./apply-doctor-average-items-card.cjs');

// DoctorCompetition already contains the newer branch-aware identity merge in source.
// Do not run the legacy build-time patch: on the newer mergeRows signature it could
// inject duplicateIdentity references without declaring the variable, crashing the page.
console.log('[doctor-competition-duplicate-identity] skipped during prebuild; source implementation is authoritative');

require('./apply-doctor-competition-sales-authority-fix.cjs');
require('./apply-cross-branch-evaluation-and-inspection-history-fix.cjs');
require('./apply-customer-service-all-doctors-evaluation.cjs');

// The doctor smart-merge patch has already been applied to source files.
// Do not execute it during every Vercel build: the legacy generator contains
// nested template literals that Node parses before it can run and was blocking
// production deployment with "SyntaxError: Unexpected identifier '$'".
console.log('[doctor-smart-merge] skipped during prebuild; source changes are already committed');

require('./apply-permission-routing-fixes.cjs');
