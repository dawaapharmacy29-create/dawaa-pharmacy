const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const importerPath = 'src/lib/invoiceImporter.ts';
const source = fs.readFileSync(importerPath, 'utf8');

const verificationReady =
  source.includes('verificationComplete?: boolean;') &&
  source.includes('const verificationPageSize = 500;') &&
  source.includes('verification_incomplete_due_to_query_error');

if (!verificationReady) {
  execFileSync(process.execPath, ['scripts/apply-invoice-verification-pagination-fix.cjs'], {
    stdio: 'inherit',
  });
} else {
  console.log('Invoice verification pagination already applied.');
}

execFileSync(process.execPath, ['scripts/apply-invoice-import-hardening.cjs'], {
  stdio: 'inherit',
});
