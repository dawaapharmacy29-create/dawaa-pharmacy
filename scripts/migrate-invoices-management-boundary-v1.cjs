#!/usr/bin/env node
const fs = require('node:fs');

const pagePath = 'src/pages/Invoices.tsx';
const gatePath = 'scripts/check-data-access-boundaries.cjs';
let src = fs.readFileSync(pagePath, 'utf8');
let gate = fs.readFileSync(gatePath, 'utf8');

function replaceOnce(from, to, label) {
  if (!src.includes(from)) throw new Error(`anchor not found: ${label}`);
  src = src.replace(from, to);
}

function replaceRegex(regex, to, label) {
  if (!regex.test(src)) throw new Error(`pattern not found: ${label}`);
  src = src.replace(regex, to);
}

const importAnchor = "import { createNotification } from '@/lib/notificationService';";
if (!src.includes("@/lib/invoices/invoiceManagementService")) {
  replaceOnce(importAnchor, `${importAnchor}\nimport {\n  cleanupCustomerAnalysisByIdentifiers,\n  deleteAllInvoiceManagementData,\n  deleteInvoiceBatchRows,\n  getInvoiceDuplicateAudit,\n  getInvoiceManagementSummary,\n  getOtherBranchInvoiceNumberRanges,\n  listManagedInvoices,\n  updateManagedInvoice,\n} from '@/lib/invoices/invoiceManagementService';`, 'management service import');
}

replaceRegex(
  /  const loadManagedInvoices = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[canManageBatches, sellerNameFilter, fromDateFilter, toDateFilter\]\);/,
`  const loadManagedInvoices = useCallback(async () => {
    if (!canManageBatches) return;
    setManagedLoading(true);
    try {
      const rows = await listManagedInvoices({
        sellerName: sellerNameFilter,
        fromDate: fromDateFilter,
        toDate: toDateFilter,
        limit: INVOICE_PAGE_SIZE,
      });
      setManagedInvoices(rows as ManagedInvoiceRow[]);
    } catch (error) {
      toast.error(\`تعذر تحميل أحدث الفواتير: \${(error as Error).message}\`);
      setManagedInvoices([]);
    } finally {
      setManagedLoading(false);
    }
  }, [canManageBatches, sellerNameFilter, fromDateFilter, toDateFilter]);`,
  'loadManagedInvoices'
);

replaceRegex(
  /  const loadInvoiceSummarySnapshot = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[\]\);/,
`  const loadInvoiceSummarySnapshot = useCallback(async () => {
    setSummarySnapshotBusy(true);
    setSummarySnapshotMessage(null);
    try {
      const snapshot = await getInvoiceManagementSummary(5000);
      setSummarySnapshot(snapshot);
      setSummarySnapshotMessage('ملخص سريع محسوب مباشرة داخل قاعدة البيانات.');
    } catch (error) {
      setSummarySnapshotMessage(\`تعذر تحميل ملخصات الفواتير: \${(error as Error).message}\`);
      setSummarySnapshot(null);
    } finally {
      setSummarySnapshotBusy(false);
    }
  }, []);`,
  'loadInvoiceSummarySnapshot'
);

replaceRegex(
  /  const loadDuplicateAudit = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[canManageBatches\]\);/,
`  const loadDuplicateAudit = useCallback(async () => {
    if (!canManageBatches) return;
    setDuplicateAuditLoading(true);
    try {
      setDuplicateAudit(await getInvoiceDuplicateAudit(3000));
    } catch (error) {
      toast.error(\`تعذر فحص التكرارات: \${(error as Error).message}\`);
      setDuplicateAudit([]);
    } finally {
      setDuplicateAuditLoading(false);
    }
  }, [canManageBatches]);`,
  'loadDuplicateAudit'
);

replaceRegex(
  /      const \{ data, error \} = await supabase\.rpc\('get_other_branch_invoice_number_ranges_v1', \{\n        p_selected_branch: selectedBranch,\n      \}\);\n      if \(error \|\| !data\) return;/,
`      let data;
      try {
        data = await getOtherBranchInvoiceNumberRanges(selectedBranch);
      } catch {
        return;
      }
      if (!data) return;`,
  'branch range rpc'
);

replaceRegex(
  /    \/\/ مسح على دفعات صغيرة[\s\S]*?\n    const error = lastError;/,
`    let deletedCount = 0;
    let totalToDelete = 0;
    let deleteError: Error | null = null;
    try {
      const result = await deleteInvoiceBatchRows(batch, {
        chunkSize: 150,
        onProgress: (deleted, total) => {
          deletedCount = deleted;
          totalToDelete = total;
          toast.info(\`جاري المسح… \${deleted} من \${total}\`, { id: 'batch-delete-progress' });
        },
      });
      deletedCount = result.deletedCount;
      totalToDelete = result.total;
    } catch (error) {
      deleteError = error as Error;
      deletedCount = Number((error as Error & { deletedCount?: number }).deletedCount || deletedCount);
      totalToDelete = Number((error as Error & { total?: number }).total || totalToDelete);
    }

    const error = deleteError;`,
  'delete batch direct access'
);

src = src.replace(/\$\{ids\.length\}/g, '${totalToDelete}');
replaceOnce(
  "        await supabase.from('customer_analysis').delete().in('customer_code', affectedIdentifiers);",
  "        await cleanupCustomerAnalysisByIdentifiers(affectedIdentifiers as string[]);",
  'customer analysis cleanup'
);

replaceRegex(
  /\n  const deleteTableRowsInChunks = async \(table: string, batchSize = 400\) => \{[\s\S]*?\n  \};\n\n  const deleteAllInvoices/,
  '\n\n  const deleteAllInvoices',
  'remove page chunk deleter'
);

replaceOnce(
  "      const deletedInvoices = await deleteTableRowsInChunks('sales_invoices');\n      await deleteTableRowsInChunks('customer_analysis');",
  "      const deletedInvoices = await deleteAllInvoiceManagementData();",
  'delete all service'
);

replaceRegex(
  /    const \{ error \} = await supabase\n      \.from\('sales_invoices'\)\n      \.update\(payload\)\n      \.eq\('id', editInvoice\.id\);\n    if \(error\) \{\n      toast\.error\(`تعذر تعديل الفاتورة: \$\{error\.message\}`\);\n    \} else \{/,
`    let updateError: Error | null = null;
    try {
      await updateManagedInvoice(editInvoice.id, payload);
    } catch (error) {
      updateError = error as Error;
    }
    if (updateError) {
      toast.error(\`تعذر تعديل الفاتورة: \${updateError.message}\`);
    } else {`,
  'update invoice direct access'
);

if (!src.includes('supabase.')) {
  src = src.replace("import { supabase } from '@/lib/supabase';\n", '');
}

if (src.includes(".from('sales_invoices')") || src.includes('.from("sales_invoices")')) {
  throw new Error('Invoices.tsx still contains direct sales_invoices access');
}

const approvedOld = "  'src/lib/readModels/unlinkedSellerNamesReadModel.ts',\n  'src/pages/Invoices.tsx',";
const approvedNew = "  'src/lib/readModels/unlinkedSellerNamesReadModel.ts',\n  'src/lib/invoices/invoiceManagementService.ts',";
if (gate.includes(approvedOld)) gate = gate.replace(approvedOld, approvedNew);
else if (!gate.includes("'src/lib/invoices/invoiceManagementService.ts'")) throw new Error('architecture gate anchor not found');

fs.writeFileSync(pagePath, src);
fs.writeFileSync(gatePath, gate);
console.log('Invoices management boundary migration applied.');
