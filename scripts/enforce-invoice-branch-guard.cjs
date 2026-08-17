require('./apply-shamy-apr-jul-cashback-exception.cjs');
require('./apply-doctor-cycle-review-truth.cjs');
require('./apply-executive-target-fallback-truth.cjs');
require('./apply-customer-invoice-metrics-rpc.cjs');

const fs = require('node:fs');

const importerPath = 'src/lib/invoiceImporter.ts';
let source = fs.readFileSync(importerPath, 'utf8');

const oldBlock = `  const branchMismatchWarning = await detectBranchInvoiceNumberMismatch(rows, branch);\n  if (branchMismatchWarning) {\n    summary.errors.push({ row: 0, field: 'الفرع', message: branchMismatchWarning });\n  }`;

const newBlock = `  const branchMismatchWarning = await detectBranchInvoiceNumberMismatch(rows, branch);\n  if (branchMismatchWarning) {\n    summary.errors.push({ row: 0, field: 'الفرع', message: branchMismatchWarning });\n    summary.needsReviewRows = rows.length;\n    summary.rejectedRows = rows.length;\n    summary.rowsSaveNotAttemptedCount = rows.length;\n    summary.rowSaveTrace = [...traceMap.values()].map((trace) => ({\n      ...trace,\n      actualAction: 'blocked_wrong_branch',\n      skipReason: 'branch_invoice_sequence_mismatch',\n      finalStatus: 'blocked_wrong_branch',\n    }));\n    await persistInvoiceImportBatch(summary, 'blocked_wrong_branch', branchMismatchWarning);\n    return summary;\n  }`;

if (source.includes(newBlock)) {
  console.log('Invoice branch guard already enforced.');
} else {
  if (!source.includes(oldBlock)) {
    throw new Error('Could not find invoice branch mismatch warning block. Refusing to build without guard.');
  }

  source = source.replace(oldBlock, newBlock);
  fs.writeFileSync(importerPath, source);
  console.log('Invoice branch mismatch now blocks all writes before the first insert.');
}

// Keep the cashback status dropdown and the quick-summary cards from applying
// contradictory filters at the same time. Previously, choosing "تم تبليغ العميل"
// while the default quick filter was still "لم يتم التعامل" produced an empty list
// even though notified customers existed in the database.
const cashbackPath = 'src/pages/CustomerCashback.tsx';
let cashbackSource = fs.readFileSync(cashbackPath, 'utf8');

const oldStatusSelect = `<select className="dawaa-input" value={status} onChange={(e) => setStatus(e.target.value)}>`;
const newStatusSelect = `<select\n          className="dawaa-input"\n          value={status}\n          onChange={(e) => {\n            const nextStatus = e.target.value;\n            setStatus(nextStatus);\n            setQuickFilter(\n              nextStatus === ALL\n                ? 'all'\n                : nextStatus === 'calculated'\n                  ? 'pending'\n                  : nextStatus === 'notified'\n                    ? 'notified'\n                    : nextStatus === 'bconnect_updated'\n                      ? 'bconnect'\n                      : nextStatus === 'partially_redeemed'\n                        ? 'partial'\n                        : nextStatus === 'settled'\n                          ? 'settled'\n                          : 'all'\n            );\n          }}\n        >`;

if (cashbackSource.includes(oldStatusSelect)) {
  cashbackSource = cashbackSource.replace(oldStatusSelect, newStatusSelect);
  console.log('Cashback status dropdown now synchronizes the quick filter.');
} else if (!cashbackSource.includes(newStatusSelect)) {
  throw new Error('Could not find cashback status dropdown. Refusing to apply an unsafe filter patch.');
}

const oldQuickFilterClick = `onClick={() => setQuickFilter(item.key)}`;
const newQuickFilterClick = `onClick={() => {\n              setQuickFilter(item.key);\n              setStatus(ALL);\n            }}`;

if (cashbackSource.includes(oldQuickFilterClick)) {
  cashbackSource = cashbackSource.replace(oldQuickFilterClick, newQuickFilterClick);
  console.log('Cashback quick cards now clear the conflicting status dropdown filter.');
} else if (!cashbackSource.includes(newQuickFilterClick)) {
  throw new Error('Could not find cashback quick-filter click handler. Refusing to apply an unsafe filter patch.');
}

fs.writeFileSync(cashbackPath, cashbackSource);
console.log('Customer cashback filter synchronization verified.');
