// Keep the deployable attendance handler generated from the reviewed TypeScript transport.
const fs = require('node:fs');
const esbuild = require('esbuild');
const outfile = 'api/attendance-inline-command.js';
const check = process.argv.includes('--check');
const result = esbuild.buildSync({ entryPoints:['server/attendance-inline-command.ts'], outfile,
  bundle:true,platform:'node',format:'esm',target:['node22'],packages:'external',write:!check,
  banner:{js:'// GENERATED from server/attendance-inline-command.ts; run node scripts/build-attendance-inline-api.cjs'},
  logLevel:'silent' });
if(check && (!fs.existsSync(outfile) || fs.readFileSync(outfile,'utf8') !== result.outputFiles[0].text)) {
  throw new Error('Attendance API source drift: run node scripts/build-attendance-inline-api.cjs');
}
console.log('[attendance-api] PASS: canonical transport ' + (check ? 'verified' : 'generated'));
