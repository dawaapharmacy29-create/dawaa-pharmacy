#!/usr/bin/env node
'use strict';

/**
 * Product Demand V22.1 maintenance runner.
 *
 * SAFETY
 * - DRY RUN by default.
 * - --apply is required for writes.
 * - Uses the canonical-source-aware runProductDemandBackfillV22 implementation.
 * - Uses the backend Supabase secret only inside this maintenance process.
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const apply = process.argv.includes('--apply');
const jsonOutput = process.argv.includes('--json');
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  console.error('Missing SUPABASE_URL (or VITE_SUPABASE_URL).');
  process.exit(2);
}
if (!serviceRoleKey) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(2);
}

globalThis.__VITE_IMPORT_META_ENV__ = {
  DEV: false,
  PROD: true,
  MODE: 'maintenance',
  VITE_SUPABASE_URL: supabaseUrl,
  // The imported app client is reused by the V22 backfill module. In this isolated
  // maintenance process the backend secret intentionally occupies the client-key slot.
  VITE_SUPABASE_ANON_KEY: serviceRoleKey,
};

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function patchedResolve(request, parent, isMain, options) {
  if (request.startsWith('@/')) {
    const target = path.join(root, 'src', request.slice(2));
    for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
      const candidate = target + ext;
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    if (fs.existsSync(target) && fs.statSync(target).isFile()) return target;
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = function compileTypeScript(module, filename) {
    const source = fs
      .readFileSync(filename, 'utf8')
      .replaceAll('import.meta.env', 'globalThis.__VITE_IMPORT_META_ENV__');
    const output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
      },
      fileName: filename,
    }).outputText;
    module._compile(output, filename);
  };
}

const { runProductDemandBackfillV22 } = require(
  path.join(root, 'src/lib/whatsappProductDemandBackfillV22.ts')
);

(async () => {
  console.log(`Product Demand V22.1 backfill: ${apply ? 'APPLY' : 'DRY RUN'}`);

  const result = await runProductDemandBackfillV22({
    limit: 500,
    dryRun: !apply,
  });

  const summary = {
    mode: result.dryRun ? 'dry-run' : 'apply',
    version: result.version,
    eligibleSources: result.eligibleSources,
    truncated: result.truncated,
    scanned: result.scanned,
    ready: result.ready,
    written: result.written,
    skipped: result.skipped,
    failed: result.failed,
    canonicalProducts: result.canonicalProducts,
    unresolvedProducts: result.unresolvedProducts,
    failures: result.rows
      .filter((row) => row.status === 'failed')
      .map((row) => ({
        sourceId: row.sourceId,
        reason: row.reason,
        droppedPriorCanonicalCodes: row.droppedPriorCanonicalCodes,
      })),
  };

  if (jsonOutput) console.log(JSON.stringify(summary, null, 2));
  else console.log(summary);

  if (result.truncated) {
    console.error('Backfill scope exceeded the maintenance runner limit; refusing to treat this run as complete.');
    process.exitCode = 1;
  }
  if (result.failed > 0) process.exitCode = 1;
})().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
