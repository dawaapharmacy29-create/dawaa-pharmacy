'use strict';

// Generates api/sales-intelligence-refresh-source.js from the single canonical implementation
// (server/sales-intelligence-refresh-source.ts + src/lib/salesIntelligence/refresh/*).
// `--check` rebuilds in memory and fails when the committed transport drifted (hand edits).

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const outfile = 'api/sales-intelligence-refresh-source.js';
const check = process.argv.includes('--check');

const result = esbuild.buildSync({
  entryPoints: ['server/sales-intelligence-refresh-source.ts'],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: ['node22'],
  sourcemap: false,
  minify: false,
  packages: 'external',
  banner: {
    js:
      '// GENERATED FILE — do not edit. Source: server/sales-intelligence-refresh-source.ts\n' +
      '// Regenerate with: node scripts/build-sales-intelligence-refresh-api.cjs',
  },
  define: {
    'import.meta.env.VITE_SUPABASE_URL': 'process.env.VITE_SUPABASE_URL',
    'import.meta.env.VITE_SUPABASE_ANON_KEY': 'process.env.VITE_SUPABASE_ANON_KEY',
    'import.meta.env.DEV': 'false',
    'import.meta.env.PROD': 'true',
    'import.meta.env.MODE': '"server"',
  },
  write: !check,
  logLevel: check ? 'silent' : 'info',
});

if (check) {
  const generated = Buffer.from(result.outputFiles[0].contents).toString('utf8');
  const committed = fs.existsSync(outfile) ? fs.readFileSync(path.resolve(outfile), 'utf8') : '';
  if (generated !== committed) {
    const os = require('os');
    const cp = require('child_process');
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-parity-'));
    const oldFile = path.join(temp, 'old.js');
    const expectedFile = path.join(temp, 'expected.js');
    fs.writeFileSync(oldFile, committed);
    fs.writeFileSync(expectedFile, generated);
    try { cp.execFileSync('diff', ['-u', oldFile, expectedFile], { encoding: 'utf8', maxBuffer: 1024 * 1024 }); }
    catch (error) { console.error('EXPECTED_GENERATED_DIFF_START\n' + String(error.stdout || '').slice(0, 13000) + '\nEXPECTED_GENERATED_DIFF_END'); }
    finally { fs.rmSync(temp, { recursive: true, force: true }); }
    console.error(`[refresh-api] ${outfile} is not the generated output of the canonical server implementation.`);
    console.error('[refresh-api] Run: node scripts/build-sales-intelligence-refresh-api.cjs and commit the result.');
    process.exit(1);
  }
  console.log(`[refresh-api] PASS: ${outfile} matches the canonical server build.`);
}
