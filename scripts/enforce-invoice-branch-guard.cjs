const fs = require('node:fs');

const importerPath = 'src/lib/invoiceImporter.ts';
let source = fs.readFileSync(importerPath, 'utf8');

const oldBlock = `  const branchMismatchWarning = await detectBranchInvoiceNumberMismatch(rows, branch);\n  if (branchMismatchWarning) {\n    summary.errors.push({ row: 0, field: 'الفرع', message: branchMismatchWarning });\n  }`;

const newBlock = `  const branchMismatchWarning = await detectBranchInvoiceNumberMismatch(rows, branch);\n  if (branchMismatchWarning) {\n    summary.errors.push({ row: 0, field: 'الفرع', message: branchMismatchWarning });\n    summary.needsReviewRows = rows.length;\n    summary.rejectedRows = rows.length;\n    summary.rowsSaveNotAttemptedCount = rows.length;\n    summary.rowSaveTrace = [...traceMap.values()].map((trace) => ({\n      ...trace,\n      actualAction: 'blocked_wrong_branch',\n      skipReason: 'branch_invoice_sequence_mismatch',\n      finalStatus: 'blocked_wrong_branch',\n    }));\n    await persistInvoiceImportBatch(summary, 'blocked_wrong_branch', branchMismatchWarning);\n    return summary;\n  }`;

if (source.includes(newBlock)) {
  console.log('Invoice branch guard already enforced.');
  process.exit(0);
}

if (!source.includes(oldBlock)) {
  throw new Error('Could not find invoice branch mismatch warning block. Refusing to build without guard.');
}

source = source.replace(oldBlock, newBlock);
fs.writeFileSync(importerPath, source);
console.log('Invoice branch mismatch now blocks all writes before the first insert.');
