#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const MANIFEST = path.join(DIST, '.vite', 'manifest.json');

// 300 KiB gzip is intentionally strict enough that a hidden PDF/Excel dependency
// cannot disappear inside a shared chunk and still pass merely because its name changed.
const INITIAL_GZIP_LIMIT = 300 * 1024;
const ROUTE_GZIP_LIMIT = 100 * 1024;
const HEAVY_TOOL_RULES = [
  { name: 'excel', limit: 500 * 1024, prefixes: ['excel'] },
  { name: 'pdf', limit: 200 * 1024, prefixes: ['pdf', 'jspdf', 'html2canvas'] },
  { name: 'charts', limit: 150 * 1024, prefixes: ['charts'] },
];

if (!fs.existsSync(MANIFEST)) {
  throw new Error('Missing Vite manifest. Build must use build.manifest=true before performance budget checks.');
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const byFile = new Map();
for (const [key, entry] of Object.entries(manifest)) {
  if (entry && entry.file) byFile.set(entry.file, { key, ...entry });
}

function gzipBytes(file) {
  const absolute = path.join(DIST, file);
  if (!fs.existsSync(absolute)) return 0;
  return zlib.gzipSync(fs.readFileSync(absolute)).byteLength;
}

function findEntry() {
  const preferred = ['src/main.tsx', 'src/main.ts', 'index.html'];
  for (const key of preferred) {
    if (manifest[key]?.isEntry) return manifest[key];
  }
  return Object.values(manifest).find((entry) => entry?.isEntry);
}

function collectStaticGraph(entry, seen = new Set()) {
  if (!entry?.file || seen.has(entry.file)) return seen;
  seen.add(entry.file);
  for (const imported of entry.imports || []) {
    const child = manifest[imported] || byFile.get(imported);
    if (child) collectStaticGraph(child, seen);
  }
  return seen;
}

function matchesPrefix(file, prefixes) {
  const base = path.basename(file);
  return prefixes.some((prefix) => base.startsWith(`${prefix}-`) || base.startsWith(`${prefix}.`) || base.startsWith(`${prefix}_`));
}

const entry = findEntry();
if (!entry) throw new Error('Could not find Vite entry chunk in manifest.');

const initialFiles = collectStaticGraph(entry);
const initialGzip = [...initialFiles].reduce((sum, file) => sum + gzipBytes(file), 0);
const failures = [];

if (initialGzip > INITIAL_GZIP_LIMIT) {
  failures.push(`Initial JS graph is ${(initialGzip / 1024).toFixed(1)} KiB gzip; limit is ${(INITIAL_GZIP_LIMIT / 1024).toFixed(0)} KiB.`);
}

for (const rule of HEAVY_TOOL_RULES) {
  const leaked = [...initialFiles].filter((file) => matchesPrefix(file, rule.prefixes));
  if (leaked.length) failures.push(`${rule.name} leaked into the initial static graph: ${leaked.join(', ')}`);

  const matches = [...byFile.keys()].filter((file) => matchesPrefix(file, rule.prefixes));
  for (const file of matches) {
    const size = gzipBytes(file);
    if (size > rule.limit) {
      failures.push(`${file} is ${(size / 1024).toFixed(1)} KiB gzip; ${rule.name} budget is ${(rule.limit / 1024).toFixed(0)} KiB.`);
    }
  }
}

const sharedPrefixes = new Set([
  'react-core', 'router', 'supabase', 'query', 'charts', 'forms', 'date-fns', 'radix',
  'icons', 'motion', 'maps', 'excel', 'pdf', 'jspdf', 'html2canvas', 'qrcode', 'calendar',
  'upload', 'virtual-list', 'carousel', 'state', 'ui-feedback', 'vendor',
]);

for (const file of byFile.keys()) {
  if (!file.endsWith('.js')) continue;
  const base = path.basename(file);
  if ([...sharedPrefixes].some((prefix) => base.startsWith(`${prefix}-`) || base.startsWith(`${prefix}.`) || base.startsWith(`${prefix}_`))) continue;
  const size = gzipBytes(file);
  if (size > ROUTE_GZIP_LIMIT) failures.push(`${file} is ${(size / 1024).toFixed(1)} KiB gzip; route/module budget is ${(ROUTE_GZIP_LIMIT / 1024).toFixed(0)} KiB.`);
}

// Runtime scheduling guard: the Doctor Eye primary summary must win the first-load race.
// The comparative layer may read thousands of branch review rows, so it must start only after
// loadDoctorPerformanceIntelligence settles and must be retryable without reloading primary data.
const eyePath = path.join(ROOT, 'src/components/evaluations/DoctorPerformanceEye.tsx');
if (!fs.existsSync(eyePath)) {
  failures.push('Missing DoctorPerformanceEye runtime source.');
} else {
  const eyeSource = fs.readFileSync(eyePath, 'utf8');
  const loadStart = eyeSource.indexOf('async function load(force: boolean)');
  const showStart = eyeSource.indexOf('function show()', loadStart);
  const evidenceStart = eyeSource.indexOf('async function openEvidence', showStart);
  if (loadStart < 0 || showStart < 0 || evidenceStart < 0) {
    failures.push('DoctorPerformanceEye runtime functions could not be inspected.');
  } else {
    const loadBody = eyeSource.slice(loadStart, showStart);
    const primaryAwait = loadBody.indexOf('await loadDoctorPerformanceIntelligence');
    const decisionKick = loadBody.indexOf('void loadDecision(force, requestId)');
    if (primaryAwait < 0 || decisionKick < 0 || decisionKick < primaryAwait) {
      failures.push('Doctor Eye must settle the primary doctor intelligence before starting branch comparison.');
    }
    const showBody = eyeSource.slice(showStart, evidenceStart);
    if (!showBody.includes('if (!branch || decisionLoading || (decisionSources && !decisionFailed)) return;') || !showBody.includes('void loadDecision(Boolean(decisionSources), requestRef.current);')) {
      failures.push('Doctor Eye must retry the comparative layer without re-fetching an already healthy primary summary.');
    }
  }
}

console.log(`[perf-budget] initial static JS: ${(initialGzip / 1024).toFixed(1)} KiB gzip across ${initialFiles.size} chunks`);
console.log(`[perf-budget] initial files: ${[...initialFiles].join(', ')}`);

if (failures.length) {
  console.error('\nRuntime performance budget failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('[perf-budget] PASS: heavy tools remain lazy and bundle budgets are within limits.');
