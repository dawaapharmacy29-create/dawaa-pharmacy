const fs = require('node:fs');
const path = require('node:path');

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const activeScripts = ['dev', 'prebuild', 'build', 'test', 'verify'];
const failures = [];

function commands(script) {
  return String(script || '')
    .split(/&&|;/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function unsafeCommand(command, context) {
  if (/\b(?:patch-[^\s]+|run-customer-monthly-tabs(?:\.cjs|\.sh)?)\b/.test(command)) {
    failures.push(`${context} runs a source patcher: ${command}`);
  }
  if (/audit-fix-semantic-lint\.cjs\b/.test(command) && !/--check\b/.test(command)) {
    failures.push(`${context} runs semantic source repair in write mode: ${command}`);
  }
  if (
    /build-sales-intelligence-refresh-api\.cjs\b/.test(command) &&
    !/--check\b/.test(command)
  ) {
    failures.push(`${context} generates committed server output during execution: ${command}`);
  }
}

for (const name of activeScripts) {
  const script = String(pkg.scripts?.[name] || '');
  for (const command of commands(script)) unsafeCommand(command, `package.json#${name}`);
}

const workflowsDir = path.join('.github', 'workflows');
if (fs.existsSync(workflowsDir)) {
  for (const filename of fs.readdirSync(workflowsDir).filter((name) => /\.ya?ml$/i.test(name))) {
    const workflowPath = path.join(workflowsDir, filename);
    const source = fs.readFileSync(workflowPath, 'utf8');
    const context = `.github/workflows/${filename}`;

    // CI in this repository is verification-only. Giving a workflow repository-write
    // permission or allowing it to commit/push recreates the exact patch-at-build class
    // of failures this guard exists to prevent. A future source-writing bot must be an
    // explicit architecture decision, not an accidental regression.
    if (!/^permissions:\s*$/m.test(source) || !/^\s{2}contents:\s*read\s*$/m.test(source)) {
      failures.push(`${context} must declare top-level permissions with contents: read.`);
    }
    if (/^\s*contents:\s*write\s*$/m.test(source)) {
      failures.push(`${context} requests contents: write; verification workflows must be read-only.`);
    }
    if (/\bgit\s+(?:commit|push)\b/.test(source)) {
      failures.push(`${context} contains git commit/push; CI must never rewrite repository source.`);
    }

    source.split(/\r?\n/).forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      // Only inspect executable-looking workflow lines. This avoids treating comments or
      // human-readable step names as commands while still catching inline and block run bodies.
      if (!/^(?:run:\s*)?[^#]*(?:node|bash|sh|npm|npx|\.\/)/.test(trimmed)) return;
      unsafeCommand(trimmed, `${context}:${index + 1}`);
    });
  }
}

const retiredPatchMutators = fs
  .readdirSync('scripts')
  .filter((name) => /^patch-.*\.(?:cjs|mjs|js|sh)$/.test(name));
if (retiredPatchMutators.length) {
  failures.push(
    `retired source patchers must stay out of the live repository; found: ${retiredPatchMutators.join(', ')}`
  );
}

if (failures.length) {
  console.error('[build-source-purity] FAIL: active app or CI paths may mutate committed source/generated output.');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('[build-source-purity] PASS: active dev/build/test and workflow paths are check-only, read-only, and source-pure.');
