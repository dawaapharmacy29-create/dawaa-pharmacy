#!/usr/bin/env node
'use strict';
// Build-time database isolation gate (runs in prebuild, so every Vercel build runs it).
// Preview / development builds FAIL unless every Supabase URL and key belongs to the declared
// staging project (DAWAA_STAGING_SUPABASE_REF) and none belongs to Production.
// Production builds and unflagged local builds only report. Prints project refs, never keys.
// The rule itself lives in src/lib/deployEnvironmentGuard.ts (also used by the server at runtime).
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

const file = path.join(__dirname, '..', 'src', 'lib', 'deployEnvironmentGuard.ts');
const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const mod = new Module(file);
mod._compile(outputText, file);
const report = mod.exports.evaluateDeployEnvironment(process.env);

const refs = Object.entries(report.projectRefs).map(([name, ref]) => `${name}=${ref || 'unrecognized'}`).join(' ');
console.log(`[deploy-env] environment=${report.environment} enforced=${report.enforced} ${refs || 'no Supabase variables set'}`);
for (const warning of report.warnings) console.warn(`[deploy-env] WARN: ${warning}`);
if (!report.ok) {
  for (const error of report.errors) console.error(`[deploy-env] FAIL: ${error}`);
  console.error('[deploy-env] Refusing to build: this environment must not reach the production database.');
  process.exit(1);
}
console.log('[deploy-env] PASS');
