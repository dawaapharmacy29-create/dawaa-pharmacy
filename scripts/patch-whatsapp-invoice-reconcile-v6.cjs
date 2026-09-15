const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/lib/invoiceImporter.ts');
let src = fs.readFileSync(file, 'utf8');

const from = `  await refreshImportSummaries(summary);`;
const to = `  // WhatsApp V6: after the daily invoice file is persisted, revisit recent commercial conversations.\n  // This closes the timing gap where the chat arrives before its invoice is uploaded.\n  // Reconciliation is conservative: only a unique customer/branch/time match (or explicit invoice number) becomes verified.\n  if (summary.fileMinDate && summary.fileMaxDate) {\n    try {\n      const { data: whatsappReconciliation, error: whatsappReconciliationError } = await supabase.rpc(\n        'dawaa_reconcile_whatsapp_sales_after_invoice_import_v1',\n        {\n          p_start_date: summary.fileMinDate,\n          p_end_date: summary.fileMaxDate,\n          p_branch: branch || null,\n        }\n      );\n      if (whatsappReconciliationError) {\n        summary.schemaWarnings?.push(\n          'تم استيراد الفواتير بنجاح، لكن تعذر إعادة مطابقة بعض محادثات واتساب تلقائيًا. يمكن إعادة المطابقة من WhatsApp Review.'\n        );\n        console.warn('[invoice-import] WhatsApp reconciliation failed', whatsappReconciliationError);\n      } else {\n        console.info('[invoice-import] WhatsApp reconciliation complete', whatsappReconciliation);\n      }\n    } catch (error) {\n      summary.schemaWarnings?.push(\n        'تم استيراد الفواتير، وتعذر تشغيل إعادة مطابقة واتساب في هذه المحاولة.'\n      );\n      console.warn('[invoice-import] WhatsApp reconciliation exception', error);\n    }\n  }\n\n  await refreshImportSummaries(summary);`;

if (src.includes(to)) {
  console.log('[whatsapp-invoice-reconcile-v6] already applied');
} else {
  if (!src.includes(from)) throw new Error('[whatsapp-invoice-reconcile-v6] anchor not found');
  src = src.replace(from, to);
  fs.writeFileSync(file, src);
  console.log('[whatsapp-invoice-reconcile-v6] automatic reconciliation wired after invoice import');
}
