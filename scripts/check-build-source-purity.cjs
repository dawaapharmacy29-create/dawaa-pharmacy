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
    const source = fs.readFileSync(path.join(workflowsDir, filename), 'utf8');
    source.split(/\r?\n/).forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      // Only inspect executable-looking workflow lines. This avoids treating comments or
      // human-readable step names as commands while still catching inline and block run bodies.
      if (!/^(?:run:\s*)?[^#]*(?:node|bash|sh|npm|npx|\.\/)/.test(trimmed)) return;
      unsafeCommand(trimmed, `.github/workflows/${filename}:${index + 1}`);
    });
  }
}

if (failures.length) {
  console.error('[build-source-purity] FAIL: active app or CI paths may mutate committed source/generated output.');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('[build-source-purity] PASS: active dev/build/test and workflow paths are check-only and source-pure.');
