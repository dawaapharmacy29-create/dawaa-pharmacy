#!/usr/bin/env node
// Prevents the exact pattern this was written to stop: dashboard pages each
// growing their own local copy of the same visual primitive instead of
// sharing src/components/dashboard/DashboardPrimitives.tsx. See
// docs/ARCHITECTURE_TARGET.md section 14.
//
// Same shape as check-theme-architecture.cjs: a fixed baseline of known
// pre-existing local definitions that must shrink as pages migrate, never
// grow, and zero tolerance for any new file introducing one of these names.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const CANONICAL_FILE = path.normalize('src/components/dashboard/DashboardPrimitives.tsx');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);

// Primitive name -> baseline set of files still allowed to define it locally.
// This list must only shrink (as a page migrates to the canonical import) —
// never grow. Adding a new entry here to make a violation pass is exactly
// the "ترقيعة" (patch) this gate exists to block.
const LEGACY_BASELINE = {
  Panel: new Set([
    'src/pages/Analytics.tsx',
    'src/pages/AttendanceReport.tsx',
    'src/components/customerService/UnifiedCustomerServiceWorkspace.tsx',
    'src/components/customer-requests/CustomerRequestInsightsPanel.tsx',
  ]),
  SectionTitle: new Set([]),
  KpiCard: new Set(['src/pages/Customer360.tsx']),
  MiniBox: new Set([]),
  EmptyState: new Set(['src/pages/CRMPage.tsx']),
};

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

function repoPath(file) {
  return path.normalize(path.relative(ROOT, file));
}

const violations = [];
const primitiveNames = Object.keys(LEGACY_BASELINE);

for (const file of walk(SRC)) {
  const rel = repoPath(file);
  if (rel === CANONICAL_FILE) continue;
  const text = fs.readFileSync(file, 'utf8');

  for (const name of primitiveNames) {
    const pattern = new RegExp(`^(?:export )?function ${name}\\(`, 'm');
    if (!pattern.test(text)) continue;

    const allowed = LEGACY_BASELINE[name];
    if (allowed.has(rel)) continue; // tracked pre-existing debt, not yet migrated

    violations.push(
      `${rel}: defines a local "${name}" instead of importing it from ${CANONICAL_FILE}. ` +
        `If this page is intentionally migrating away from the shared primitive, that is backwards — ` +
        `import from DashboardPrimitives.tsx instead of adding another local copy.`
    );
  }
}

// Baseline files that no longer define the primitive have migrated — good,
// but flag it so the baseline list itself gets trimmed in the same PR
// instead of quietly going stale.
for (const name of primitiveNames) {
  for (const rel of LEGACY_BASELINE[name]) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) {
      violations.push(`${rel}: listed in the ${name} legacy baseline but the file no longer exists — remove it from scripts/check-dashboard-primitives-architecture.cjs.`);
      continue;
    }
    const text = fs.readFileSync(abs, 'utf8');
    const pattern = new RegExp(`^(?:export )?function ${name}\\(`, 'm');
    if (!pattern.test(text)) {
      violations.push(`${rel}: no longer defines a local "${name}" — remove it from the legacy baseline in scripts/check-dashboard-primitives-architecture.cjs so this gate keeps shrinking.`);
    }
  }
}

if (violations.length) {
  console.error('[dashboard-primitives-architecture] FAIL');
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

const baselineCount = primitiveNames.reduce((sum, name) => sum + LEGACY_BASELINE[name].size, 0);
console.log(
  `[dashboard-primitives-architecture] PASS: canonical primitives owned by ${CANONICAL_FILE}, ${baselineCount} tracked legacy local definition(s) across ${primitiveNames.length} primitive names.`
);
