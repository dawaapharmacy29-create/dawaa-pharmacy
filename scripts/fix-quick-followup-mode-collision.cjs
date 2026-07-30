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
  .replace(/\bmode === 'request'/g, "actionMode === 'request'");

if (!source.includes("const [actionMode, setActionMode] = useState<FollowupMode>('execute');")) {
  throw new Error('[quick-followup-mode-fix] actionMode state was not found after patch');
}
if (/const \[mode, setMode\] = useState<FollowupMode>/.test(source)) {
  throw new Error('[quick-followup-mode-fix] duplicate FollowupMode state still exists');
}

if (source !== before) {
  fs.writeFileSync(file, source);
  console.log('[quick-followup-mode-fix] renamed FollowupMode state to actionMode');
} else {
  console.log('[quick-followup-mode-fix] already applied');
}
