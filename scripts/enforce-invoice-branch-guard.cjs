const fs = require('node:fs');

function ensurePattern(path, predicate, message) {
  const source = fs.readFileSync(path, 'utf8');
  if (!predicate(source)) {
    throw new Error(`${message} (${path})`);
  }
}

const importerPath = 'src/lib/invoiceImporter.ts';
ensurePattern(
  importerPath,
  (source) => source.includes('const branchMismatchWarning = await detectBranchInvoiceNumberMismatch(rows, branch);')
    && (source.includes('blocked_wrong_branch') || source.includes('summary.needsReviewRows = rows.length;')),
  'Invoice branch protection is missing or not in the valid source form.'
);

console.log('[build-validation] Invoice branch guard validated in source. No source files were modified.');
