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
const groundTruth = process.argv.includes('--ground-truth');

const GROUND_TRUTH_SOURCE_IDS = [
  '9a59338b-f1ca-4b68-bd3b-c081fee914a8', // محمد الكموني — ISIS
  '2524fc3e-1b2d-421b-91cb-50a39403540b', // اليماني — Flexilax
  '66fe13b7-7ebc-48a9-8180-033bfb34cd4b', // اليماني — GAST-REG unavailable
  'e9e231ad-48b4-427c-9b5a-be6d2c09b566', // مونزا — Solofresh
];

const GROUND_TRUTH_EXPECTATIONS = [
  { sourceId: GROUND_TRUTH_SOURCE_IDS[0], productCode: '70271', stage: 'verified_sale', invoiceNumber: '73006', leakageCode: null },
  { sourceId: GROUND_TRUTH_SOURCE_IDS[1], productCode: '68114', stage: 'verified_sale', invoiceNumber: '70655', leakageCode: null },
  { sourceId: GROUND_TRUTH_SOURCE_IDS[2], productCode: '40049', stage: 'unavailable', invoiceNumber: null, leakageCode: 'stock_unavailable' },
  { sourceId: GROUND_TRUTH_SOURCE_IDS[3], productCode: '66682', stage: 'verified_sale', invoiceNumber: '72743', leakageCode: null },
];
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
if (groundTruth && apply) {
  console.error('--ground-truth is a read-only regression gate and cannot be combined with --apply.');
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

  let lastLogged = 0;
  const result = await runProductDemandBackfillV22({
    limit: 500,
    dryRun: !apply,
    sourceIds: groundTruth ? GROUND_TRUTH_SOURCE_IDS : undefined,
    dryRunConcurrency: apply ? 1 : 4,
    onProgress(processed, total) {
      if (processed === total || processed - lastLogged >= 5) {
        lastLogged = processed;
        console.log(`Progress: ${processed}/${total}`);
      }
    },
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
    truthChanges: result.rows.flatMap((row) =>
      (row.productTruthChanges || []).map((change) => ({ sourceId: row.sourceId, ...change }))
    ),
    failures: result.rows
      .filter((row) => row.status === 'failed')
      .map((row) => ({
        sourceId: row.sourceId,
        reason: row.reason,
        droppedPriorCanonicalCodes: row.droppedPriorCanonicalCodes,
      })),
  };

  if (groundTruth) {
    const changes = summary.truthChanges;
    const failures = [];
    for (const expected of GROUND_TRUTH_EXPECTATIONS) {
      const actual = changes.find((row) =>
        row.sourceId === expected.sourceId &&
        String(row.productCode || '') === expected.productCode
      );
      if (!actual) {
        failures.push(`Missing product truth result for ${expected.sourceId} / ${expected.productCode}`);
        continue;
      }
      if (actual.afterStage !== expected.stage) {
        failures.push(`${expected.productCode}: stage ${actual.afterStage} != ${expected.stage}`);
      }
      if ((actual.afterInvoiceNumber || null) !== expected.invoiceNumber) {
        failures.push(`${expected.productCode}: invoice ${actual.afterInvoiceNumber || 'null'} != ${expected.invoiceNumber || 'null'}`);
      }
      if ((actual.afterLeakageCode || null) !== expected.leakageCode) {
        failures.push(`${expected.productCode}: leakage ${actual.afterLeakageCode || 'null'} != ${expected.leakageCode || 'null'}`);
      }
    }
    if (failures.length) {
      console.error('GROUND TRUTH REGRESSION FAILED');
      for (const failure of failures) console.error(' - ' + failure);
      process.exitCode = 1;
    } else {
      console.log('GROUND TRUTH REGRESSION PASSED: ISIS, Flexilax, GAST-REG, Solofresh.');
    }
  }

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
