const fs = require('node:fs');

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const activeScripts = ['dev', 'prebuild', 'build', 'test', 'verify'];
const failures = [];

function commands(script) {
  return String(script || '')
    .split(/&&|;/)
    .map((part) => part.trim())
    .filter(Boolean);
}

for (const name of activeScripts) {
  const script = String(pkg.scripts?.[name] || '');
  for (const command of commands(script)) {
    if (/\b(?:patch-[^\s]+|run-customer-monthly-tabs\.cjs)\b/.test(command)) {
      failures.push(`${name} runs a source patcher: ${command}`);
    }
    if (
      /build-sales-intelligence-refresh-api\.cjs\b/.test(command) &&
      !/--check\b/.test(command)
    ) {
      failures.push(`${name} generates committed server output during execution: ${command}`);
    }
  }
}

if (failures.length) {
  console.error('[build-source-purity] FAIL: active dev/build/test paths may mutate committed source or generated output.');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('[build-source-purity] PASS: active dev/build/test paths are check-only and source-pure.');
